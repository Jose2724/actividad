-- Powers and shift per person. Safe to run more than once. Nothing that works today gets stricter: this only ADDS
-- the columns, one function, and policies that let a person who was given a power write the rows that power is about.
-- (Taking a power away from a manager is enforced by the app's screens in this version.)
alter table public.employees add column if not exists act_powers text[];   -- null = the powers of the role
alter table public.employees add column if not exists act_shift smallint;  -- null = both shifts, 1 or 2

-- does the person signed in hold this power? The Freezer RTE admin (the owner) holds them all; with none saved, the
-- office holds them all, a manager all but correcting the other shift, an operator none.
create or replace function public.act_has(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.user_id = auth.uid() and e.active and coalesce(e.deleted, false) = false and e.act_role is not null
      and (e.role = 'admin'
        or (e.act_powers is null and (e.act_role = 'office' or (e.act_role = 'mgr' and p <> 'othershift')))
        or (e.act_powers is not null and p = any(e.act_powers))))
$$;
grant execute on function public.act_has(text) to authenticated;

-- goals (of a room or of a line) and the hours of the shifts live in act_targets. 018 later gave the week and the
-- days apart to "shifts" and the line rules to the managers alone: these two rules are created only when they are not
-- there yet, so running this file again never undoes 018 (2026-10-18)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_targets' and policyname = 'act_targets_insert_power') then
    create policy act_targets_insert_power on public.act_targets for insert to authenticated
      with check ((dept like 'shifts:%' and public.act_has('shifts')) or (dept not like 'shifts:%' and public.act_has('goals')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_targets' and policyname = 'act_targets_update_power') then
    create policy act_targets_update_power on public.act_targets for update to authenticated
      using ((dept like 'shifts:%' and public.act_has('shifts')) or (dept not like 'shifts:%' and public.act_has('goals')))
      with check ((dept like 'shifts:%' and public.act_has('shifts')) or (dept not like 'shifts:%' and public.act_has('goals')));
  end if;
end $$;

-- rows of act_changes without a room: the orders, the start of the day, and the history lines of what a power does
-- (018 later tied the ids of a day's start and of an order to their own kind: created only when it is not there yet,
-- so running this file again never undoes 018, 2026-10-18)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_changes' and policyname = 'act_changes_insert_power') then
    create policy act_changes_insert_power on public.act_changes for insert to authenticated
      with check (dept is null and (
        (ref_table in ('act_orders', 'act_orders_log') and public.act_has('orders'))
        or (ref_table = 'act_days' and public.act_has('day'))
        or (ref_table = 'act_targets' and (public.act_has('shifts') or public.act_has('goals')))
        or (ref_table in ('act_products', 'act_schedule') and public.act_has('products'))));
  end if;
end $$;
-- (018 later made the new row keep the same power, not only "no room": created only when it is not there yet, so
-- running this file again never undoes 018)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_changes' and policyname = 'act_changes_update_power') then
    create policy act_changes_update_power on public.act_changes for update to authenticated
      using (dept is null and (
        (ref_table in ('act_orders', 'act_orders_log') and public.act_has('orders'))
        or (ref_table = 'act_days' and public.act_has('day'))
        or (ref_table = 'act_targets' and (public.act_has('shifts') or public.act_has('goals')))
        or (ref_table in ('act_products', 'act_schedule') and public.act_has('products'))))
      with check (dept is null);
  end if;
end $$;

-- the products table and the day's program
drop policy if exists act_products_insert_power on public.act_products;
create policy act_products_insert_power on public.act_products for insert to authenticated with check (public.act_has('products'));
drop policy if exists act_products_update_power on public.act_products;
create policy act_products_update_power on public.act_products for update to authenticated using (public.act_has('products')) with check (public.act_has('products'));
drop policy if exists act_schedule_insert_power on public.act_schedule;
create policy act_schedule_insert_power on public.act_schedule for insert to authenticated with check (public.act_has('products'));
drop policy if exists act_schedule_update_power on public.act_schedule;
create policy act_schedule_update_power on public.act_schedule for update to authenticated using (public.act_has('products')) with check (public.act_has('products'));
