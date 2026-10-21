-- The lot of a production order (Jose, 2026-10-20: "aquí falta poner el lote, por favor hacerlo para todos los
-- departamentos"). Optional: an order with a lot takes only what the room registers of that code WITH that lot; an
-- order with no lot ('') takes any lot of the code, as every order of before this file.
-- Run once in Supabase > SQL Editor (the whole file at once), BEFORE the build that uses it is published: that build
-- sends the column with every order, and a server without it would refuse the orders typed on it. Safe to run again.
-- Nothing that exists is changed: every order there is gets '' (no lot), and a tablet of before this file, which never
-- sends the column, leaves it as it is.
alter table public.act_work_orders add column if not exists lot text not null default '';
