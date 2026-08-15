-- =====================================================================
--  Ügyeleti tábla – Supabase séma (Google SSO változat)
--  Futtatás: Supabase Dashboard → SQL Editor → beilleszt → Run
--  Többször is lefuttatható.
--
--  Belépés csak Google-fiókkal, és csak az alább felsorolt 5 e-mail-címmel.
--  Aki nincs a people táblában, az bejelentkezve sem lát és nem ír semmit:
--  ezt az adatbázis kényszeríti ki, nem a böngészőben futó kód.
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
  role        text not null default 'duty' check (role in ('duty', 'approver')),
  can_duty    boolean not null default true,   -- beosztható-e ügyeletre
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists people_email_uidx on public.people (lower(email));

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

create table if not exists public.months (
  month       date primary key,
  locked      boolean not null default false,
  locked_at   timestamptz,
  locked_by   uuid references public.people(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.app_config (
  id          int primary key default 1 check (id = 1),
  week_mode   text not null default 'weeks' check (week_mode in ('weeks', 'calendar')),
  updated_at  timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

create index if not exists marks_day_idx    on public.marks (day);
create index if not exists schedule_day_idx on public.schedule (day);

-- ---------------------------------------------------------------------
-- Kezdő névsor
--   Később a felületen is szerkeszthető (a véglegesítő tudja).
-- ---------------------------------------------------------------------

insert into public.people (name, email, color, role, can_duty, sort_order) values
  ('Vanda',  'vanda.buri@gmail.com',        '#1A73E8', 'approver', true, 1),
  ('Bálint', 'takacsbalint0202@gmail.com',  '#1E8E3E', 'duty',     true, 2),
  ('Peti',   'ppalotai4@gmail.com',         '#E8710A', 'duty',     true, 3),
  ('Barbi',  'barbara.kalanova@gmail.com',  '#D01884', 'duty',     true, 4),
  ('Bandi',  'laandro3@gmail.com',          '#7B1FA2', 'duty',     true, 5)
on conflict (lower(email)) do update
  set name       = excluded.name,
      role       = excluded.role,
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

-- Belépés után ezzel kérdezi le a felület, hogy kicsoda.
create or replace function public.whoami()
returns table (id uuid, name text, email text, color text, role text, can_duty boolean)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.email, p.color, p.role, p.can_duty
  from public.people p where p.id = public.current_person_id();
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
--   A névsort mindenki olvassa; jelölni csak magára tud;
--   a beosztást és a lezárást kizárólag a véglegesítő írja.
-- ---------------------------------------------------------------------

alter table public.people     enable row level security;
alter table public.marks      enable row level security;
alter table public.schedule   enable row level security;
alter table public.months     enable row level security;
alter table public.app_config enable row level security;

do $$
declare t text; p text;
begin
  foreach t in array array['people', 'marks', 'schedule', 'months', 'app_config'] loop
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
  with check (person_id = public.current_person_id() or public.is_approver());
create policy p_own_upd on public.marks for update to authenticated
  using (person_id = public.current_person_id() or public.is_approver())
  with check (person_id = public.current_person_id() or public.is_approver());
create policy p_own_del on public.marks for delete to authenticated
  using (person_id = public.current_person_id() or public.is_approver());

create policy p_read  on public.schedule for select to authenticated using (public.is_member());
create policy p_write on public.schedule for all    to authenticated
  using (public.is_approver()) with check (public.is_approver());

create policy p_read  on public.months for select to authenticated using (public.is_member());
create policy p_write on public.months for all    to authenticated
  using (public.is_approver()) with check (public.is_approver());

create policy p_read  on public.app_config for select to authenticated using (public.is_member());
create policy p_write on public.app_config for all    to authenticated
  using (public.is_approver()) with check (public.is_approver());

-- Bejelentkezés nélkül semmi nem érhető el.
revoke all on public.people, public.marks, public.schedule, public.months, public.app_config
  from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.people, public.marks, public.schedule, public.months, public.app_config
  to authenticated;
grant execute on function public.whoami(), public.is_member(),
                          public.is_approver(), public.current_person_id() to authenticated;

-- ---------------------------------------------------------------------
-- Ébren tartás
--   Adatot nem ad vissza, de lefuttat egy lekérdezést az adatbázisban,
--   így a Supabase nem tekinti tétlennek a projektet.
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
  foreach t in array array['people', 'marks', 'schedule', 'months', 'app_config'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
              when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Ellenőrzés – ennek az 5 embert kell visszaadnia:
--   select name, email, role from public.people order by sort_order;
-- ---------------------------------------------------------------------
