-- The history: who changed what, when. Corrections to runs and stops, edits to the products table, the day's program
-- and the lines; the records themselves already carry who made them. Rows are written by the tablet that made the
-- change (same rules as its runs: an operator only for their room) and read by everyone with a role.
create table if not exists public.act_changes (
  id text primary key,
  at timestamptz not null,
  by_name text not null default '',
  dept text,
  what text not null,
  before text not null default '',
  after text not null default '',
  ref_table text not null default '',
  ref_key text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  synced_at timestamptz not null default now()
);
alter table public.act_changes enable row level security;
drop policy if exists act_changes_read on public.act_changes;
create policy act_changes_read on public.act_changes for select to authenticated using (exists (select 1 from public.act_me()));
drop policy if exists act_changes_insert on public.act_changes;
create policy act_changes_insert on public.act_changes for insert to authenticated with check (public.act_can_write(dept));
drop policy if exists act_changes_update on public.act_changes;
create policy act_changes_update on public.act_changes for update to authenticated using (public.act_can_write(dept)) with check (public.act_can_write(dept));
grant select, insert, update on table public.act_changes to authenticated;

drop trigger if exists act_changes_touch on public.act_changes;
create trigger act_changes_touch before insert or update on public.act_changes for each row execute function public.act_touch();
create index if not exists act_changes_synced on public.act_changes (synced_at);
create index if not exists act_changes_at on public.act_changes (at);
do $$ begin alter publication supabase_realtime add table public.act_changes; exception when duplicate_object then null; end $$;
