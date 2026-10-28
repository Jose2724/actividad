-- 023: the freezer's people and the office write to each other (Jose, 2026-10-28: "chat directo también con los del
-- freezer"). The conversation is the one the rooms have (act_changes rows of ref_table 'act_chat'), with 'Freezer' as
-- its room. Freezer RTE's admins and workers (employees.role; with or without an E.R. - Ops Summary role) read that
-- conversation and add to it, and nothing else of E.R. - Ops Summary. The office and the managers read and write it
-- as any room's (018's rules: act_can_read / act_can_write take any room). Run once in the SQL editor of the shared
-- project, after 022. Safe to run again.

begin;

create or replace function public.act_is_freezer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.user_id = auth.uid() and e.active and coalesce(e.deleted, false) = false and e.role in ('admin', 'worker')
  )
$$;
revoke execute on function public.act_is_freezer() from public, anon;
grant execute on function public.act_is_freezer() to authenticated, service_role;

drop policy if exists act_changes_freezer_read on public.act_changes;
create policy act_changes_freezer_read on public.act_changes for select to authenticated
  using (dept = 'Freezer' and ref_table = 'act_chat' and public.act_is_freezer());

drop policy if exists act_changes_freezer_insert on public.act_changes;
create policy act_changes_freezer_insert on public.act_changes for insert to authenticated
  with check (dept = 'Freezer' and ref_table = 'act_chat' and id like 'chat:%' and not deleted and public.act_is_freezer());

commit;

-- What the server has now: the rules of act_changes, with the two of the freezer among them.
select policyname as regla, cmd as para from pg_policies where schemaname = 'public' and tablename = 'act_changes' order by policyname;
