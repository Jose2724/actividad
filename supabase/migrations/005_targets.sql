-- The goal of each room (per hour and/or per shift, in the room's own quantity: pouches, cajas, mezclas), set by the
-- manager or the office and shown on every tablet of the room.
create table if not exists public.act_targets (
  dept text primary key,
  per_hour numeric,
  per_shift numeric,
  updated_at timestamptz not null default now(),
  updated_by text,
  synced_at timestamptz not null default now()
);
alter table public.act_targets enable row level security;
drop policy if exists act_targets_read on public.act_targets;
create policy act_targets_read on public.act_targets for select to authenticated using (exists (select 1 from public.act_me()));
drop policy if exists act_targets_insert on public.act_targets;
create policy act_targets_insert on public.act_targets for insert to authenticated with check (public.act_is_mgr());
drop policy if exists act_targets_update on public.act_targets;
create policy act_targets_update on public.act_targets for update to authenticated using (public.act_is_mgr()) with check (public.act_is_mgr());
grant select, insert, update on table public.act_targets to authenticated;

drop trigger if exists act_targets_touch on public.act_targets;
create trigger act_targets_touch before insert or update on public.act_targets for each row execute function public.act_touch();
create index if not exists act_targets_synced on public.act_targets (synced_at);
do $$ begin alter publication supabase_realtime add table public.act_targets; exception when duplicate_object then null; end $$;
