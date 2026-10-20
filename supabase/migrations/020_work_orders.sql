-- The production orders of each room (Jose, 2026-10-19, with the office clerk's correction: "no es una cantidad por
-- lote, es una cantidad por mezcla: el pedido es de 1000 mezclas; el día 1 se programa hacer 80 ... lo que el día no
-- hizo vuelve al pedido"). The office types an order once: a room, a product code, how much in all in the room's own
-- unit (Kitchen and Spiral mezclas, or Spiral pounds / cases for the codes counted so, RTE pouches, MFO platos / copas /
-- pounds, Packing cases), the day it starts, and optionally its WO number and a note. Each day the office programs a
-- part of it (act_plan, as today) and that day's program now says which order it is a part of (order_id). What every
-- room registers of that code from the start day on is taken off the order by the app; what a day did not make goes
-- back to the order. An order is never erased: it is closed by hand (closed_at), or marked deleted when it was a
-- mistake, and the app works out when it was completed.
-- Run once in Supabase > SQL Editor (the whole file at once), BEFORE the build that uses it is published. Safe to run
-- again: every statement does nothing the second time or replaces itself with the same thing. Nothing that exists is
-- changed or refused: it ADDS a table and one empty column on act_plan; the tablets go on exactly as they are, whatever
-- version they run.
-- What it adds:
--   1. act_work_orders: one row per order. Its id is made on the device that typed it, so an order typed with no
--      signal goes up later as it is. Two orders of the same room and code may live side by side (two WOs): there is
--      no unique rule that could refuse the second one typed on another tablet.
--   2. Who reads and writes them: every Actividad role reads the orders of the rooms it reads (015: an operator, its
--      own room; managers, the office and "Solo ver", every room); the managers, the office and whoever holds the power
--      "Productos y programa" write them, as act_plan, each only in the rooms it reads: an operator with that power,
--      in its own room (an order planted in another room would take that room's production first). Nobody deletes or
--      empties the table from the app (018, 8).
--   3. act_plan.order_id: the order a day's program is a part of (empty = a plain day's program, as every program of
--      before this file). No foreign key on purpose: a program typed on a tablet may reach the server before its
--      order does (each table goes up on its own, and an order waits while the server is asked what it has of it); a
--      foreign key would refuse that program, and a refused row holds back what a tablet still has to send. The app
--      keeps the link, and the tests check it.
--   4. Every version of an order is kept in act_runs_log with the account that sent it, as the runs and the lines.

-- 1. the orders
create table if not exists public.act_work_orders (
  id uuid primary key,                          -- made by the device that typed it
  dept text not null,                           -- the room: Kitchen, Spiral, RTE, MFO, Packing
  code text not null,                           -- the product code, as the app writes it ("0889" and "889" are one)
  wo text not null default '',                  -- the order number (WO#), optional
  qty numeric not null,                         -- how much in all, in `unit`
  unit text not null default '',                -- mezclas, lb, cajas, pouches, platos, copas ('' = the room's own)
  start_date date not null,                     -- what the room registers of the code from this day on counts
  note text not null default '',
  created_at timestamptz not null default now(),-- when it was typed (the shared clock): two orders of one day go in this order
  created_by text not null default '',
  closed_at timestamptz,                        -- closed by hand: from this moment on it takes nothing more
  closed_by text,
  deleted boolean not null default false,       -- typed by mistake (kept on the server, gone from the screens)
  updated_at timestamptz not null default now(),
  updated_by text,
  synced_at timestamptz not null default now()  -- when it reached the server: every device pulls by it (003)
);
alter table public.act_work_orders enable row level security;

-- 2. who reads and writes them
drop policy if exists act_work_orders_read on public.act_work_orders;
create policy act_work_orders_read on public.act_work_orders for select to authenticated using (public.act_can_read(dept));
drop policy if exists act_work_orders_insert on public.act_work_orders;
-- (the room too: without it an operator of RTE holding "Productos y programa" could plant an MFO order with a plain
-- INSERT, one PostgREST makes without its upsert, and every MFO tablet would count MFO's production against it first;
-- the app never writes another room's order for anyone the read rule would not show it to. Review of 2026-10-20)
create policy act_work_orders_insert on public.act_work_orders for insert to authenticated with check ((public.act_is_mgr() or public.act_has('products')) and public.act_can_read(dept));
drop policy if exists act_work_orders_update on public.act_work_orders;
create policy act_work_orders_update on public.act_work_orders for update to authenticated using (public.act_is_mgr() or public.act_has('products')) with check ((public.act_is_mgr() or public.act_has('products')) and public.act_can_read(dept));
grant select, insert, update on table public.act_work_orders to authenticated;
revoke delete, truncate on table public.act_work_orders from anon, authenticated;

-- the server's moment on each version (every device pulls by it), its index, and live updates to every open screen.
-- The triggers are made only when they are not there, as in 018 (no DROP and CREATE again on every run)
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_work_orders'::regclass and tgname = 'act_work_orders_touch') then
    create trigger act_work_orders_touch before insert or update on public.act_work_orders for each row execute function public.act_touch();
  end if;
end $$;
create index if not exists act_work_orders_synced on public.act_work_orders (synced_at);
do $$ begin alter publication supabase_realtime add table public.act_work_orders; exception when duplicate_object then null; end $$;

-- 3. the order a day's program is a part of (null = none). Only a column, empty for every row there is: nothing is
-- rewritten, and a tablet of before this file, which never sends it, goes on as it does
alter table public.act_plan add column if not exists order_id uuid;
create index if not exists act_plan_order on public.act_plan (order_id) where order_id is not null;

-- 4. every version of an order, as it was before each change, with the account that sent it (011, 018)
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_work_orders'::regclass and tgname = 'act_work_orders_history') then
    create trigger act_work_orders_history before update on public.act_work_orders for each row execute function public.act_keep_history();
  end if;
end $$;
