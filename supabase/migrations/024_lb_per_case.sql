-- 024: each product's pounds per case (QA's "target specifications" sheet; Jose, 2026-10-28: "carga las libras por
-- caja igual que los guacales"). With it the KPI's productivity can be said in pounds per labor hour as well as in
-- cases. null = not said. Run once in Supabase > SQL Editor, BEFORE the new version of the app is published. Safe to
-- run again. It only ADDS a column: nothing that exists is changed, and the rules of who reads and writes
-- act_products stay as they are.
alter table public.act_products add column if not exists lb_per_case numeric;
