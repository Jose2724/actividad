// The server's database, for real, on this machine: the same Postgres (PGlite, Postgres compiled to run inside Node),
// with the pieces of Supabase the app relies on (the roles anon / authenticated / service_role, auth.uid() taken from
// the request's claims, auth.users, the realtime publication), the shared project's own schema (the Freezer app's:
// employees and its accounts) and every Actividad migration, in order, as Jose runs them in Supabase > SQL Editor.
// Nothing leaves this machine and nothing real is used: the people and the rows are made up by each test.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const ACT_DIR = resolve(here, '../supabase/migrations')
// the shared project's schema is the Freezer app's (its repository sits beside this one on Jose's computer); without
// it, the columns of employees that Actividad uses are made here the same way
const FREEZER_DIR = resolve(here, '../../freezer-control/supabase')

/**
 * what Supabase gives every project before its own SQL: roles, their default privileges (every new table, function
 * and sequence of public is granted ALL to anon, authenticated and service_role, so what a migration does NOT revoke
 * is open, TRUNCATE included: see 018), the auth schema the policies call, the realtime publication
 */
const SUPABASE = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create publication supabase_realtime;
`
/** the employees table as the Freezer app leaves it, for a machine without its repository */
const EMPLOYEES = `
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true,
  updated_at timestamptz not null default now(), user_id uuid unique references auth.users(id) on delete set null,
  username text unique, role text not null default 'worker' check (role in ('admin','worker')), deleted boolean not null default false
);
alter table public.employees enable row level security;
grant select, insert, update, delete on public.employees to authenticated, service_role;
create policy "employees read list" on public.employees for select to authenticated using (true);
`
const sqlFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [])
export const actMigrations = () => sqlFiles(ACT_DIR)

/**
 * A new, empty copy of the server's database with every migration applied. `upTo` stops before a migration (to
 * test one as it is first run on a database that has the ones before). Returns the database and what was applied.
 */
export async function serverDb({ upTo } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(SUPABASE)
  const applied = []
  if (existsSync(resolve(FREEZER_DIR, 'schema.sql'))) {
    await db.exec(readFileSync(resolve(FREEZER_DIR, 'schema.sql'), 'utf8'))
    for (const f of sqlFiles(resolve(FREEZER_DIR, 'migrations'))) await db.exec(readFileSync(resolve(FREEZER_DIR, 'migrations', f), 'utf8'))
    applied.push('freezer-control')
  } else {
    await db.exec(EMPLOYEES)
    applied.push('employees (stand-in)')
  }
  for (const f of actMigrations()) {
    if (upTo && f >= upTo) break
    await runFile(db, f)
    applied.push(f)
  }
  return { db, applied }
}
/** one Actividad migration, as pasted in the SQL Editor; an error says which file it came from */
export async function runFile(db, file) {
  try { await db.exec(readFileSync(resolve(ACT_DIR, file), 'utf8')) } catch (e) { throw new Error(file + ': ' + (e?.message ?? e)) }
}

/** a person of the plant: an account and their employee row (made-up names, made-up ids) */
let people = 0
export async function person(db, { name, actRole, actDept = null, role = 'worker', active = true } = {}) {
  people++
  const id = '00000000-0000-4000-8000-' + String(people).padStart(12, '0')
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, 'p' + people + '@prueba.local'])
  await db.query('insert into public.employees (name, active, user_id, username, role, act_role, act_dept) values ($1, $2, $3, $4, $5, $6, $7)', [name, active, id, 'p' + people, role, actRole, actDept])
  return { id, name, claims: { sub: id, role: 'authenticated', aud: 'authenticated' } }
}

/**
 * Runs `fn` as that person, the way the server runs a request of theirs: in one transaction, with their claims and
 * the role "authenticated", so every policy and every security definer function sees exactly what it sees there.
 * Without a person: as the SQL Editor (the owner, no policies).
 */
export async function as(db, who, fn) {
  return db.transaction(async (tx) => {
    if (who) {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.claims)])
      await tx.exec('set local role authenticated')
    }
    return fn(tx)
  })
}
/** the SQLSTATE of what a statement threw ('' = it did not throw) */
export async function code(p) { try { await p; return '' } catch (e) { return String(e?.code ?? e?.message ?? e) } }
