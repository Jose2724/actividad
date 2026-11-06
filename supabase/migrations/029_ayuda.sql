-- The app's AI helper, "🤖 Ayuda" (Jose, 2026-11-06: "una IA para esta Web App ... que la IA pueda saber quién le está
-- hablando ... que no puedan borrar nada con la IA"). Each question and its answer is kept here by the edge function
-- act-ayuda, which runs with the service key: the tablets never write this table, and only the owner (a Freezer RTE
-- admin) reads it, to see what people ask, which answers were wrong (👎) and what it costs. The rows say who asked
-- (as the server knew them, never as they said), when, what, the answer, the model and its tokens.
--
-- The daily limit per person is counted from these rows by the function. Nothing here gives the helper any power:
-- it has no tool and no key of the app's data; it only writes text.
--
-- Run once in Supabase > SQL Editor, BEFORE the build that uses it is published. Safe to run again.

create table if not exists public.act_ayuda (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid not null,
  name text,
  role text,
  dept text,
  kind text not null default 'ask',          -- 'ask' (a question) or 'paro' (which reason code for a stop)
  question text not null,
  had_image boolean not null default false,
  answer text,
  model text,
  tokens_in integer,
  tokens_out integer,
  cache_read integer,
  ms integer,
  rating smallint,                            -- 1 = 👍, -1 = 👎, null = nothing said
  error text
);
create index if not exists act_ayuda_user_at on public.act_ayuda (user_id, at desc);
create index if not exists act_ayuda_at on public.act_ayuda (at desc);

alter table public.act_ayuda enable row level security;

-- reading: the owner only (the function itself reads with the service key, which skips these rules)
drop policy if exists act_ayuda_owner_read on public.act_ayuda;
create policy act_ayuda_owner_read on public.act_ayuda for select to authenticated
  using (exists (select 1 from public.employees e
                 where e.user_id = auth.uid() and e.active and coalesce(e.deleted, false) = false and e.role = 'admin'));
-- no insert, update or delete rule: nobody writes it from the app (only the function, with the service key)
revoke all on public.act_ayuda from authenticated, anon;   -- not even TRUNCATE (018's rule for every act_ table)
grant select on public.act_ayuda to authenticated;

do $$ begin raise notice '029: table act_ayuda in place (written only by the act-ayuda function, read only by the owner)'; end $$;
