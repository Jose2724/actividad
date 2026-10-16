-- A history of every change to a run (act_runs) and to a stop (act_stops): the row AS IT WAS before each update, with
-- who sent the change and when. Nothing the app shows reads it; it is there so that a unit (a pallet, a cart, a
-- mezcla) that seems to have vanished can be found and brought back from Supabase > Table Editor > act_runs_log.
-- Run once in Supabase > SQL Editor. Safe to run again. It only ADDS a table and two triggers: nothing that exists
-- is changed, and the rules of who reads and writes act_runs and act_stops stay as they are.
create table if not exists public.act_runs_log (
  n bigserial primary key,
  at timestamptz not null default now(),
  table_name text not null,
  row_id text not null,
  by_name text,
  was jsonb not null
);
alter table public.act_runs_log enable row level security;
-- nobody writes it from the app (only the triggers, as the table's owner); managers and the office may read it
drop policy if exists act_runs_log_read on public.act_runs_log;
create policy act_runs_log_read on public.act_runs_log for select to authenticated using (public.act_is_mgr());
grant select on table public.act_runs_log to authenticated;
create index if not exists act_runs_log_row on public.act_runs_log (table_name, row_id, at);

create or replace function public.act_keep_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.act_runs_log (table_name, row_id, by_name, was) values (tg_table_name, old.id::text, new.updated_by, to_jsonb(old));
  return new;
end $$;
drop trigger if exists act_runs_history on public.act_runs;
create trigger act_runs_history before update on public.act_runs for each row execute function public.act_keep_history();
drop trigger if exists act_stops_history on public.act_stops;
create trigger act_stops_history before update on public.act_stops for each row execute function public.act_keep_history();
