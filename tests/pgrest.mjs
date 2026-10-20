// Supabase's REST API for the tests, answered by the real Postgres of pg.mjs the way the server answers it: each
// request in its own transaction, as the person its token names (role "authenticated", their claims in
// request.jwt.claims), so every grant, policy and trigger runs exactly as there. Only what the app uses: select with
// eq / neq / gt / gte / lt / lte / in / is / cs and or(...), order, offset and limit, a single object; upsert on a
// conflict key; HEAD (the clock). Errors come back as PostgREST sends them: { code, message, details, hint } and its
// HTTP status. A token is read, not checked: these are made-up people on this machine.
const STATUS = { '42501': 403, '23505': 409, '23503': 409, '42P01': 404, PGRST205: 404, PGRST116: 406, PGRST204: 400 }
const json = (body, status = 200, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const fail = (e) => { const code = String(e?.code ?? 'XX000'); return json({ code, message: String(e?.message ?? e), details: e?.detail ?? null, hint: e?.hint ?? null }, STATUS[code] ?? (/^(22|23)/.test(code) ? 400 : 500)) }
const ident = (c) => { const t = c.trim(); if (!/^[a-z_][a-z0-9_]*$/i.test(t)) throw Object.assign(new Error('bad column ' + c), { code: '42703' }); return '"' + t + '"' }
const unquote = (v) => v.replace(/^"(.*)"$/s, '$1')
/** splits on the commas that are not inside parentheses or quotes */
function splitTop(s) {
  const out = []; let depth = 0, quote = false, cur = ''
  for (const ch of s) {
    if (ch === '"') quote = !quote
    if (!quote && ch === '(') depth++
    if (!quote && ch === ')') depth--
    if (!quote && depth === 0 && ch === ',') { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
function cond(col, expr, params) {
  const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|in|is|cs)\.(.*)$/s.exec(expr)
  if (!m) throw Object.assign(new Error('unknown filter ' + col + '=' + expr), { code: 'PGRST100' })
  const [, not, op, raw] = m, p = (v) => { params.push(v); return '$' + params.length }
  let sql
  if (op === 'is') sql = ident(col) + ' is ' + ({ null: 'null', true: 'true', false: 'false' }[raw] ?? 'unknown')
  else if (op === 'in') { const items = splitTop(raw.replace(/^\((.*)\)$/s, '$1')).map((x) => unquote(x.trim())); sql = items.length ? ident(col) + ' in (' + items.map(p).join(', ') + ')' : 'false' }
  else if (op === 'cs') sql = ident(col) + ' @> ' + p(unquote(raw)) + '::jsonb'
  else sql = ident(col) + ' ' + OPS[op] + ' ' + p(unquote(raw))
  return not ? 'not (' + sql + ')' : sql
}
function orOf(v, params) {
  return '(' + splitTop(v.replace(/^\((.*)\)$/s, '$1')).map((part) => { const i = part.indexOf('.'); return cond(part.slice(0, i), part.slice(i + 1), params) }).join(' or ') + ')'
}
const claimsOf = (headers) => {
  const tok = String(headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').split('.')[1]
  try { const c = JSON.parse(Buffer.from(tok, 'base64url').toString('utf8')); return c && c.sub ? c : null } catch { return null }
}
/** the primary key of a table, the conflict key of an upsert that names none */
async function keyOf(db, table) {
  const r = await db.query("select a.attname as c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = ('public.' || $1)::regclass and i.indisprimary", [table])
  return r.rows.map((x) => x.c)
}

/** a fetch for the app's Supabase client: the REST API of the server, over the database `db` */
export function restOver(db, { log } = {}) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase(), headers = new Headers(init.headers ?? {})
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { Date: new Date().toUTCString() } })
    if (!url.pathname.includes('/rest/v1/')) return json({ message: 'not here' }, 404)
    const table = url.pathname.split('/rest/v1/')[1].replace(/\/$/, '')
    const claims = claimsOf(headers)
    log?.push([method, table, claims?.sub ?? 'anon'])
    try {
      const exists = await db.query("select to_regclass('public.' || $1) is not null as ok", [table])
      if (!exists.rows[0].ok) throw Object.assign(new Error(`Could not find the table 'public.${table}' in the schema cache`), { code: 'PGRST205' })
      return await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: 'anon' })])
        await tx.exec(claims ? 'set local role authenticated' : 'set local role anon')
        if (method === 'GET') {
          const params = [], where = [], order = []
          let cols = '*', offset = 0, limit = null
          for (const [k, v] of url.searchParams) {
            if (k === 'select') cols = v.trim() === '*' ? '*' : v.split(',').map(ident).join(', ')
            else if (k === 'offset') offset = Number(v)
            else if (k === 'limit') limit = Number(v)
            else if (k === 'order') for (const o of v.split(',')) { const [c, dir = 'asc', nulls] = o.split('.'); order.push(ident(c) + (dir === 'desc' ? ' desc' : ' asc') + (nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : '')) }
            else if (k === 'or') where.push(orOf(v, params))
            else where.push(cond(k, v, params))
          }
          const sql = 'select ' + cols + ' from public.' + ident(table) + (where.length ? ' where ' + where.join(' and ') : '') + (order.length ? ' order by ' + order.join(', ') : '') + (limit != null ? ' limit ' + limit : '') + (offset ? ' offset ' + offset : '')
          const rows = (await tx.query(sql, params)).rows
          if (/vnd\.pgrst\.object/.test(String(headers.get('accept') ?? ''))) {
            if (rows.length !== 1) throw Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116', detail: 'The result contains ' + rows.length + ' rows' })
            return json(rows[0])
          }
          return json(rows)
        }
        if (method === 'POST') {
          const body = JSON.parse(String(init.body ?? '[]')), list = Array.isArray(body) ? body : [body]
          const merge = /merge-duplicates/.test(String(headers.get('prefer') ?? ''))
          const key = url.searchParams.get('on_conflict')?.split(',') ?? (await keyOf(tx, table))
          // a column the table does not have: the real server refuses the whole row before Postgres sees it, with its
          // own code and words (PGRST204, "Could not find the 'order_id' column of 'act_plan' in the schema cache"),
          // not Postgres's 42703 (what a tablet meets until the SQL that adds the column is run, Jose 2026-10-19)
          const have = new Set((await tx.query("select attname from pg_attribute where attrelid = ('public.' || $1)::regclass and attnum > 0 and not attisdropped", [table])).rows.map((r) => r.attname))
          for (const row of list) for (const c of Object.keys(row)) if (!have.has(c)) throw Object.assign(new Error(`Could not find the '${c}' column of '${table}' in the schema cache`), { code: 'PGRST204' })
          for (const row of list) {
            const cols = Object.keys(row), vals = cols.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]))
            const set = cols.filter((c) => !key.includes(c)).map((c) => ident(c) + ' = excluded.' + ident(c)).join(', ')
            await tx.query('insert into public.' + ident(table) + ' (' + cols.map(ident).join(', ') + ') values (' + cols.map((_, i) => '$' + (i + 1)).join(', ') + ')' + (merge ? ' on conflict (' + key.map(ident).join(', ') + ') do ' + (set ? 'update set ' + set : 'nothing') : ''), vals)
          }
          return new Response(null, { status: 201 })
        }
        throw Object.assign(new Error('method ' + method + ' is not used by the app'), { code: 'PGRST000' })
      })
    } catch (e) { return fail(e) }
  }
}
