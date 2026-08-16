-- =====================================================================
--  Ügyeleti tábla – Supabase séma
--  Futtatás: Supabase Dashboard → SQL Editor → New query → Run
--  Bármikor újra lefuttatható: a meglévő adatokat nem bántja, a névsort
--  és a jogosultsági szabályokat a jelenlegi állapotra hozza.
--
--  Szerepek:
--    approver – kioszt és véglegesít, ügyeletre is beosztható
--    duty     – jelöl, ügyeletre beosztható
--    viewer   – mindent lát, de semmit nem módosít
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Táblák
-- ---------------------------------------------------------------------

create table if not exists public.people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  color       text not null default '#5F6368',
  role        text not null default 'duty',
  can_duty    boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists people_email_uidx on public.people (lower(email));

-- A megtekintő szerep utólag került be, ezért a meglévő megszorítást cseréljük.
alter table public.people drop constraint if exists people_role_check;
alter table public.people add  constraint people_role_check
  check (role in ('duty', 'approver', 'viewer'));

create table if not exists public.marks (
  person_id   uuid not null references public.people(id) on delete cascade,
  day         date not null,
  state       text not null check (state in ('yes', 'maybe', 'no')),
  updated_at  timestamptz not null default now(),
  primary key (person_id, day)
);

create table if not exists public.schedule (
  day         date primary key,
  person_id   uuid references public.people(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- A véglegesítés egysége a hét: a kulcs mindig az adott hét hétfője.
create table if not exists public.weeks (
  week        date primary key,
  locked      boolean not null default false,
  locked_at   timestamptz,
  locked_by   uuid references public.people(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- A korábbi, hónap alapú zárolás megszűnt.
drop table if exists public.months;

create table if not exists public.app_config (
  id          int primary key default 1 check (id = 1),
  week_mode   text not null default 'weeks' check (week_mode in ('weeks', 'calendar')),
  updated_at  timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

create index if not exists marks_day_idx    on public.marks (day);
create index if not exists schedule_day_idx on public.schedule (day);

-- ---------------------------------------------------------------------
-- Névsor
--   A sorszám (sort_order) egyben a felületen látszó szám is.
--   A megtekintő nem kap sorszámot a naptárban, mert nem osztható be.
-- ---------------------------------------------------------------------

insert into public.people (name, email, color, role, can_duty, sort_order) values
  ('Vanda',  'vanda.buri@gmail.com',        '#5F6368', 'approver', true,  1),
  ('Bálint', 'takacsbalint0202@gmail.com',  '#5F6368', 'duty',     true,  2),
  ('Peti',   'ppalotai4@gmail.com',         '#5F6368', 'duty',     true,  3),
  ('Barbi',  'barbara.kalanova@gmail.com',  '#5F6368', 'duty',     true,  4),
  ('Bandi',  'laandro3@gmail.com',          '#5F6368', 'duty',     true,  5),
  ('Viktor', 'szeker.viktor97@gmail.com',   '#5F6368', 'viewer',   false, 6)
on conflict (lower(email)) do update
  set name       = excluded.name,
      role       = excluded.role,
      can_duty   = excluded.can_duty,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Ki vagyok? – a bejelentkezett Google-fiók e-mail-címe alapján
-- ---------------------------------------------------------------------

create or replace function public.current_person_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.people
  where lower(email) = lower(nullif(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.current_person_id() is not null; $$;

create or replace function public.is_approver()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id() and role = 'approver');
$$;

-- Jelölni csak az tud, aki ügyeletre beosztható. A megtekintő nem.
create or replace function public.can_mark()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id()
      and role in ('duty', 'approver')
      and can_duty);
$$;

create or replace function public.whoami()
returns table (id uuid, name text, email text, color text, role text,
               can_duty boolean, sort_order int)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.email, p.color, p.role, p.can_duty, p.sort_order
  from public.people p where p.id = public.current_person_id();
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
--   Olvasni mindenki tud, aki a névsorban van. Írni:
--     saját jelölés  → csak az ügyelők és a véglegesítő
--     beosztás, lezárás, névsor → csak a véglegesítő
--     megtekintő     → semmit
-- ---------------------------------------------------------------------

alter table public.people     enable row level security;
alter table public.marks      enable row level security;
alter table public.schedule   enable row level security;
alter table public.weeks      enable row level security;
alter table public.app_config enable row level security;

do $$
declare t text; p text;
begin
  foreach t in array array['people', 'marks', 'schedule', 'weeks', 'app_config'] loop
    foreach p in array array['p_read', 'p_write', 'p_own_ins', 'p_own_upd', 'p_own_del',
                             'anon_read', 'anon_write'] loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
  end loop;
end $$;

create policy p_read  on public.people for select to authenticated using (public.is_member());
create policy p_write on public.people for all    to authenticated
  using (public.is_approver()) with check (public.is_approver());

create policy p_read    on public.marks for select to authenticated using (public.is_member());
create policy p_own_ins on public.marks for insert to authenticated
  with check ((person_id = public.current_person_id() and public.can_mark()) or public.is_approver());
create policy p_own_upd on public.marks for update to authenticated
  using ((person_id = public.current_person_id() and public.can_mark()) or public.is_approver())
  with check ((person_id = public.current_person_id() and public.can_mark()) or public.is_approver());
create policy p_own_del on public.marks for delete to authenticated
  using ((person_id = public.current_person_id() and public.can_mark()) or public.is_approver());

create policy p_read  on public.schedule for select to authenticated using (public.is_member());
create policy p_write on public.schedule for all    to authenticated
  using (public.is_approver()) with check (public.is_approver());

create policy p_read  on public.weeks for select to authenticated using (public.is_member());
create policy p_write on public.weeks for all    to authenticated
  using (public.is_approver()) with check (public.is_approver());

create policy p_read  on public.app_config for select to authenticated using (public.is_member());
create policy p_write on public.app_config for all    to authenticated
  using (public.is_approver()) with check (public.is_approver());

-- Bejelentkezés nélkül semmi nem érhető el.
revoke all on public.people, public.marks, public.schedule, public.weeks, public.app_config
  from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.people, public.marks, public.schedule, public.weeks, public.app_config
  to authenticated;
grant execute on function public.whoami(), public.is_member(), public.is_approver(),
                          public.can_mark(), public.current_person_id() to authenticated;

-- ---------------------------------------------------------------------
-- Ébren tartás
--   Adatot nem ad vissza, de lefuttat egy lekérdezést, így a Supabase
--   nem tekinti tétlennek a projektet.
-- ---------------------------------------------------------------------

create or replace function public.ping()
returns text language sql security definer set search_path = public
as $$ select 'ok'::text; $$;

grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['people', 'marks', 'schedule', 'weeks', 'app_config'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
              when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Ellenőrzés – hat sort kell adnia, Viktor viewer szereppel:
--   select sort_order, name, email, role, can_duty
--   from public.people order by sort_order;
-- ---------------------------------------------------------------------
