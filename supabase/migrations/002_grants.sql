-- Signed-in users may use the Actividad tables (the row-level rules in 001 decide who may touch which rows).
grant usage on schema public to authenticated;
grant select, insert, update on table public.act_lines, public.act_runs, public.act_stops, public.act_products, public.act_schedule to authenticated;
grant execute on function public.act_me() to authenticated;
grant execute on function public.act_can_write(text) to authenticated;
grant execute on function public.act_is_mgr() to authenticated;
