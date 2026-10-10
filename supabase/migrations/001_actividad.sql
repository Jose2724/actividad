-- Actividad · its own tables inside the Freezer RTE Supabase project (prefix act_). Nothing here changes the
-- freezer tables. Run once in Supabase › SQL Editor. Safe to run again.

-- Who may use Actividad: op = one department; mgr = every room, products, schedule, corrections;
-- office = sees every room, keeps products and the schedule. Same people and PINs as Freezer RTE.
alter table public.employees add column if not exists act_role text check (act_role in ('op', 'mgr', 'office'));
alter table public.employees add column if not exists act_dept text;

create table if not exists public.act_lines (
  id uuid primary key,
  dept text not null,
  name text not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- one product code run on one line; its units (carts, mezclas, bins, pallets) travel inside as JSON
create table if not exists public.act_runs (
  id uuid primary key,
  dept text not null,
  line_id uuid not null,
  line text not null default '',
  code text not null,
  lot text not null default '',
  date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  units jsonb not null default '[]'::jsonb,
  per_unit numeric,
  waste numeric not null default 0,
  by_name text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create table if not exists public.act_stops (
  id uuid primary key,
  dept text not null,
  line_id uuid,
  reason text not null,
  note text not null default '',
  started_at timestamptz not null,
  ended_at timestamptz,
  by_name text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- the office's master table (yields, pouches per case, 12xN, cases per pallet)
create table if not exists public.act_products (
  code text primary key,
  name text not null default '',
  pouches_per_case numeric not null default 0,
  cases_per_mix numeric not null default 0,
  crates_per_cart numeric not null default 24,
  pouches_per_crate numeric not null default 0,
  cases_per_pallet numeric not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- mezclas scheduled per day and code
create table if not exists public.act_schedule (
  date date not null,
  code text not null,
  mixes numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  primary key (date, code)
);

create index if not exists act_runs_updated on public.act_runs (updated_at);
create index if not exists act_runs_date on public.act_runs (date);
create index if not exists act_stops_updated on public.act_stops (updated_at);
create index if not exists act_lines_updated on public.act_lines (updated_at);
create index if not exists act_products_updated on public.act_products (updated_at);
create index if not exists act_schedule_updated on public.act_schedule (updated_at);

-- the caller's Actividad role and department (an active employee with an act_role)
create or replace function public.act_me() returns table (role text, dept text)
language sql stable security definer set search_path = public as $$
  select e.act_role, e.act_dept from public.employees e
  where e.user_id = auth.uid() and e.active and coalesce(e.deleted, false) = false and e.act_role is not null
  limit 1
$$;
create or replace function public.act_can_write(d text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.act_me() m where m.role in ('mgr', 'office') or (m.role = 'op' and m.dept = d))
$$;
create or replace function public.act_is_mgr() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.act_me() m where m.role in ('mgr', 'office'))
$$;

alter table public.act_lines enable row level security;
alter table public.act_runs enable row level security;
alter table public.act_stops enable row level security;
alter table public.act_products enable row level security;
alter table public.act_schedule enable row level security;

-- everyone with an Actividad role reads every room (the office view needs all of them)
drop policy if exists act_lines_read on public.act_lines;
create policy act_lines_read on public.act_lines for select to authenticated using (exists (select 1 from public.act_me()));
drop policy if exists act_runs_read on public.act_runs;
create policy act_runs_read on public.act_runs for select to authenticated using (exists (select 1 from public.act_me()));
drop policy if exists act_stops_read on public.act_stops;
create policy act_stops_read on public.act_stops for select to authenticated using (exists (select 1 from public.act_me()));
drop policy if exists act_products_read on public.act_products;
create policy act_products_read on public.act_products for select to authenticated using (exists (select 1 from public.act_me()));
drop policy if exists act_schedule_read on public.act_schedule;
create policy act_schedule_read on public.act_schedule for select to authenticated using (exists (select 1 from public.act_me()));

-- writes: an operator only in their department; the manager and the office anywhere. Nothing is ever deleted
-- outright: a row is marked deleted (so every tablet learns about it).
drop policy if exists act_lines_insert on public.act_lines;
create policy act_lines_insert on public.act_lines for insert to authenticated with check (public.act_can_write(dept));
drop policy if exists act_lines_update on public.act_lines;
create policy act_lines_update on public.act_lines for update to authenticated using (public.act_can_write(dept)) with check (public.act_can_write(dept));
drop policy if exists act_runs_insert on public.act_runs;
create policy act_runs_insert on public.act_runs for insert to authenticated with check (public.act_can_write(dept));
drop policy if exists act_runs_update on public.act_runs;
create policy act_runs_update on public.act_runs for update to authenticated using (public.act_can_write(dept)) with check (public.act_can_write(dept));
drop policy if exists act_stops_insert on public.act_stops;
create policy act_stops_insert on public.act_stops for insert to authenticated with check (public.act_can_write(dept));
drop policy if exists act_stops_update on public.act_stops;
create policy act_stops_update on public.act_stops for update to authenticated using (public.act_can_write(dept)) with check (public.act_can_write(dept));

-- products and the schedule: manager and office
drop policy if exists act_products_insert on public.act_products;
create policy act_products_insert on public.act_products for insert to authenticated with check (public.act_is_mgr());
drop policy if exists act_products_update on public.act_products;
create policy act_products_update on public.act_products for update to authenticated using (public.act_is_mgr()) with check (public.act_is_mgr());
drop policy if exists act_schedule_insert on public.act_schedule;
create policy act_schedule_insert on public.act_schedule for insert to authenticated with check (public.act_is_mgr());
drop policy if exists act_schedule_update on public.act_schedule;
create policy act_schedule_update on public.act_schedule for update to authenticated using (public.act_is_mgr()) with check (public.act_is_mgr());

-- live updates to every open screen
do $$ begin alter publication supabase_realtime add table public.act_lines; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.act_runs; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.act_stops; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.act_products; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.act_schedule; exception when duplicate_object then null; end $$;

-- the Freezer RTE administrators (Jose) run Actividad as managers
update public.employees set act_role = 'mgr' where role = 'admin' and act_role is null;
