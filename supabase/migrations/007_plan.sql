-- The program of each room for a day: which codes it has to make and how much of each, in the room's own quantity
-- (mezclas, pouches, cajas). The office types it; every tablet of the room sees it, and what the room registers of
-- each code is taken off it by the app. Run once in Supabase > SQL Editor. Safe to run again. It only ADDS a table:
-- nothing that exists is changed.
create table if not exists public.act_plan (
  date date not null,
  dept text not null,
  code text not null,
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text,
  synced_at timestamptz not null default now(),
  primary key (date, dept, code)
);
alter table public.act_plan enable row level security;
-- every Actividad user reads it (each room sees its program); the office and the managers, or whoever holds the
-- power "Productos y programa", write it
-- (015 later narrowed the reading to an operator's own room: created only when it is not there yet, so running this
-- file again never undoes 015, 2026-10-18)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_plan' and policyname = 'act_plan_read') then
    create policy act_plan_read on public.act_plan for select to authenticated using (exists (select 1 from public.act_me()));
  end if;
end $$;
drop policy if exists act_plan_insert on public.act_plan;
create policy act_plan_insert on public.act_plan for insert to authenticated with check (public.act_is_mgr() or public.act_has('products'));
drop policy if exists act_plan_update on public.act_plan;
create policy act_plan_update on public.act_plan for update to authenticated using (public.act_is_mgr() or public.act_has('products')) with check (public.act_is_mgr() or public.act_has('products'));
grant select, insert, update on table public.act_plan to authenticated;

drop trigger if exists act_plan_touch on public.act_plan;
create trigger act_plan_touch before insert or update on public.act_plan for each row execute function public.act_touch();
create index if not exists act_plan_synced on public.act_plan (synced_at);
do $$ begin alter publication supabase_realtime add table public.act_plan; exception when duplicate_object then null; end $$;
