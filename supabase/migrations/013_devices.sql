-- Each device (a tablet, the office PC) tells the server every minute how it is doing: who is signed in on it, which
-- build of the app it runs, what it has recorded that has not gone up yet and why, when it last brought the server's
-- rows, and whether its clock is set. The manager's screen lists every device (tab "Tablets"), so a tablet that
-- stopped sending (a session the server no longer takes, no signal, an old version, a clock of its own) is found
-- from the office instead of hours later on the floor. Run once in Supabase > SQL Editor. Safe to run again. It only
-- ADDS a table: nothing that exists is changed.
create table if not exists public.act_devices (
  id text primary key,                      -- the device's own id, kept on it (not the person's)
  name text not null default '',            -- who is signed in on it
  user_id text not null default '',         -- that person's employee id
  role text not null default '',
  dept text not null default '',
  build text not null default '',           -- the build of the app it runs (see version.json)
  seen_at timestamptz,                      -- the moment of its last word, by the shared clock
  last_sync timestamptz,                    -- when it last brought the server's rows
  pending integer not null default 0,       -- rows recorded on it that have not gone up
  oldest_at timestamptz,                    -- when the oldest of those was recorded
  error text not null default '',           -- what the server (or the signal) last answered it
  clock text not null default '',           -- fine / rough / own: how its clock is set
  offset_ms integer not null default 0,     -- how far its own clock is from the server's
  ua text not null default '',              -- what kind of device and browser
  updated_at timestamptz not null default now(),
  updated_by text,
  synced_at timestamptz not null default now()
);
alter table public.act_devices enable row level security;
-- every signed-in person writes the row of the device they are on; the managers and the office read them all
-- (014 later let every signed-in person read it, which an operator's tablet needs to write over its own row: created
-- only when it is not there yet, so running this file again never silences the operators' tablets, 2026-10-18)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_devices' and policyname = 'act_devices_read') then
    create policy act_devices_read on public.act_devices for select to authenticated using (public.act_is_mgr());
  end if;
end $$;
drop policy if exists act_devices_insert on public.act_devices;
create policy act_devices_insert on public.act_devices for insert to authenticated with check (exists (select 1 from public.act_me()));
drop policy if exists act_devices_update on public.act_devices;
create policy act_devices_update on public.act_devices for update to authenticated using (exists (select 1 from public.act_me())) with check (exists (select 1 from public.act_me()));
grant select, insert, update on table public.act_devices to authenticated;

drop trigger if exists act_devices_touch on public.act_devices;
create trigger act_devices_touch before insert or update on public.act_devices for each row execute function public.act_touch();
create index if not exists act_devices_seen on public.act_devices (seen_at);
