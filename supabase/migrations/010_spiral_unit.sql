-- How Spiral counts each code: 'mezclas' (one by one), 'lb' (each mezcla weighed in pounds) or 'cajas' (each mezcla
-- counted in cases), as the office's SPIRAL sheets program some items ("3000 LB", "200 CS"). The room's program and
-- its lines use it. null = not said (mezclas). Run once in Supabase > SQL Editor, BEFORE the new version of the app is
-- published. Safe to run again. It only ADDS a column: nothing that exists is changed, and the rules of who reads and
-- writes act_products stay as they are.
alter table public.act_products add column if not exists spiral_unit text;
