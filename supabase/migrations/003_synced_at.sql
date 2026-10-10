-- When a row reached the server (server clock), apart from when it was changed on the tablet (updated_at).
-- A tablet that was offline uploads rows whose updated_at is old; every other screen pulls by synced_at, so
-- nothing uploaded late is ever missed.
alter table public.act_lines    add column if not exists synced_at timestamptz not null default now();
alter table public.act_runs     add column if not exists synced_at timestamptz not null default now();
alter table public.act_stops    add column if not exists synced_at timestamptz not null default now();
alter table public.act_products add column if not exists synced_at timestamptz not null default now();
alter table public.act_schedule add column if not exists synced_at timestamptz not null default now();

create or replace function public.act_touch() returns trigger language plpgsql as $$
begin new.synced_at = now(); return new; end $$;

drop trigger if exists act_lines_touch on public.act_lines;
create trigger act_lines_touch before insert or update on public.act_lines for each row execute function public.act_touch();
drop trigger if exists act_runs_touch on public.act_runs;
create trigger act_runs_touch before insert or update on public.act_runs for each row execute function public.act_touch();
drop trigger if exists act_stops_touch on public.act_stops;
create trigger act_stops_touch before insert or update on public.act_stops for each row execute function public.act_touch();
drop trigger if exists act_products_touch on public.act_products;
create trigger act_products_touch before insert or update on public.act_products for each row execute function public.act_touch();
drop trigger if exists act_schedule_touch on public.act_schedule;
create trigger act_schedule_touch before insert or update on public.act_schedule for each row execute function public.act_touch();

create index if not exists act_lines_synced on public.act_lines (synced_at);
create index if not exists act_runs_synced on public.act_runs (synced_at);
create index if not exists act_stops_synced on public.act_stops (synced_at);
create index if not exists act_products_synced on public.act_products (synced_at);
create index if not exists act_schedule_synced on public.act_schedule (synced_at);
