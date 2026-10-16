-- The "Solo ver" role (viewer): a person who looks at everything and writes nothing. The employees table only
-- accepted op, mgr and office, so saving a person as "Solo ver" failed with "violates check constraint
-- employees_act_role_check" (seen by Jose on 2026-10-16). Run once in Supabase > SQL Editor. Safe to run again.
-- It only widens that check: the rules of who writes what do not change (act_can_write, act_is_mgr and act_has
-- already give a viewer nothing to write; act_me lets it read, like everybody with a role).
alter table public.employees drop constraint if exists employees_act_role_check;
alter table public.employees add constraint employees_act_role_check check (act_role in ('op', 'mgr', 'office', 'viewer'));
