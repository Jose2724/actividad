// Supabase Edge Function "act-ayuda": the app's AI helper, "🤖 Ayuda" (Jose, 2026-11-06). Somebody signed in asks how
// the app works (with a photo of a screen if they like) or which reason code fits a stop; Claude answers from the
// app's guide, only the parts that person's role may read.
//
// What keeps it safe:
// - who asks comes from the sign-in (employees row), never from what they write;
// - the guide sent is already cut to their role and room (core.ts), so there is nothing else to tell;
// - the model gets NO tool and no key of the app's data: it can only write text, never register, change or delete;
// - the API key lives only here, as a Supabase secret (ANTHROPIC_API_KEY), never on a tablet;
// - off in Ajustes, only the owner may use it; on, everybody, with a daily limit per person; every question is kept
//   in act_ayuda (029_ayuda.sql) for the owner to read.
//
// Secrets: ANTHROPIC_API_KEY (required). Optional: AYUDA_MODEL (default claude-opus-5-5), AYUDA_EFFORT (default low),
// AYUDA_DAILY (questions per person per 24 h, default 60).
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { apiMessages, cleanCtx, cleanMessages, meOf, plantNow, systemFor, whoText } from './core.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const MODEL = Deno.env.get('AYUDA_MODEL') || 'claude-opus-5-5'
const EFFORT = (Deno.env.get('AYUDA_EFFORT') || 'low') as 'low' | 'medium' | 'high'
const DAILY = Number(Deno.env.get('AYUDA_DAILY')) || 60
/** the server-side fallback on a refusal: on the models that take it (not Haiku) */
const FALLBACK = /opus|sonnet|fable/.test(MODEL)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) return json({ error: 'not_signed_in' }, 401)
    const row = (await admin.from('employees').select('id, name, role, active, deleted, act_role, act_dept, act_powers, act_shift').eq('user_id', user.id).maybeSingle()).data
    const me = meOf(row as Record<string, unknown> | null)
    if (!me) return json({ error: 'no_role' }, 403)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    // 👍 / 👎 on an answer of one's own
    if (body.action === 'rate') {
      const rating = Number(body.rating) === 1 ? 1 : Number(body.rating) === -1 ? -1 : null
      const { error } = await admin.from('act_ayuda').update({ rating }).eq('id', String(body.id ?? '')).eq('user_id', user.id)
      return error ? json({ error: 'rate' }, 400) : json({ ok: true })
    }

    // off in Ajustes (Pantallas nuevas › Ayuda): the owner's alone
    const opt = (await admin.from('act_targets').select('per_hour').eq('dept', 'opt:view:ayuda').maybeSingle()).data
    if (!me.admin && Number(opt?.per_hour) !== 1) return json({ error: 'off' }, 403)
    if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'no_key' }, 503)

    const msgs = cleanMessages(body.messages)
    if (!msgs.ok) return json({ error: msgs.error }, 400)
    const ctx = cleanCtx(body.ctx)
    const lang = body.lang === 'en' ? 'en' : 'es'
    const kind = body.kind === 'paro' ? 'paro' : 'ask'
    const last = msgs.messages[msgs.messages.length - 1]

    if (!me.admin) {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { count } = await admin.from('act_ayuda').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('at', since)
      if ((count ?? 0) >= DAILY) return json({ error: 'limit', limit: DAILY }, 429)
    }

    const t0 = Date.now()
    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })
    const params = {
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: EFFORT },
      // the rules and the guide of this role are the same each time: cached; who asks and the hour go after
      system: [
        { type: 'text', text: systemFor(me), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: whoText(me, ctx, plantNow(Date.now(), lang), lang) },
      ],
      messages: apiMessages(msgs.messages),
    }
    // deno-lint-ignore no-explicit-any
    let res: any
    try {
      // deno-lint-ignore no-explicit-any
      res = FALLBACK ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as any) : await client.messages.create(params as any)
    } catch (e) {
      // a fallback the account does not take yet: once more without it
      // deno-lint-ignore no-explicit-any
      if (FALLBACK && e instanceof Anthropic.BadRequestError) res = await client.messages.create(params as any)
      else throw e
    }
    const refused = res.stop_reason === 'refusal'
    // deno-lint-ignore no-explicit-any
    const text = refused ? (lang === 'en' ? 'I can only help with how the app works.' : 'Solo puedo ayudar con cómo funciona la app.') : (res.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
    const u = res.usage ?? {}
    const { data: logged } = await admin.from('act_ayuda').insert({
      user_id: user.id, name: me.name, role: me.role, dept: me.dept || null, kind,
      question: last.text.slice(0, 2000), had_image: !!last.image, answer: text.slice(0, 8000), model: res.model ?? MODEL,
      tokens_in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tokens_out: u.output_tokens ?? null, cache_read: u.cache_read_input_tokens ?? null,
      ms: Date.now() - t0, error: refused ? 'refusal' : res.stop_reason === 'max_tokens' ? 'max_tokens' : null,
    }).select('id').maybeSingle()
    return json({ id: logged?.id ?? null, text: text || (lang === 'en' ? 'I have no answer for that.' : 'No tengo respuesta para eso.') })
  } catch (e) {
    const status = e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.AuthenticationError ? 503 : 500
    console.error('act-ayuda', e)
    return json({ error: status === 503 ? 'no_key' : status === 429 ? 'busy' : 'ai' }, status)
  }
})
