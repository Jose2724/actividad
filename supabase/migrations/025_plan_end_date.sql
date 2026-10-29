-- A program of several days (the office through Jose, 2026-10-28: "que puedan programar también para días más
-- adelante, y que se vaya descontando si es el mismo programa"). A row of act_plan (a day, a room, a code and its
-- lot) may now say its last day: end_date. Then qty is the total for every day from date to end_date, and what the
-- room makes of that code and lot on any of those days is taken off the same row. Null = a day's program, as before.
--
-- Run once in Supabase > SQL Editor, BEFORE the build that uses it is published. Safe to run again. Nothing that is
-- there changes: every row keeps end_date null (a day's program). A build from before this file never sends the
-- column, and a program typed on it keeps going up; the new build sends it only for a program of several days, and
-- while this file has not been run such a program waits on the device and the screen says so ("Falta ejecutar en
-- Supabase el SQL 025").
alter table public.act_plan add column if not exists end_date date;
alter table public.act_plan drop constraint if exists act_plan_end_after_start;
alter table public.act_plan add constraint act_plan_end_after_start check (end_date is null or end_date > date);
