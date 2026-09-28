-- =====================================================================
--  Ügyeleti tábla – Supabase séma
--  Futtatás: Supabase Dashboard → SQL Editor → New query → Run
--  Új projekthez vagy újrafuttatáshoz: a meglévő névsort nem írja felül.
--  Meglévő projekt adminfrissítéséhez az admin-role.sql fájlt használd.
--
--  Szerepek:
--    approver – kioszt és véglegesít, ügyeletre is beosztható
--    duty     – jelöl, ügyeletre beosztható
--    admin    – ügyelő, admin nézetben véglegesítői jogok és beállítások
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

-- A megtekintő és admin szerepekhez frissítjük a meglévő megszorítást.
alter table public.people drop constraint if exists people_role_check;
alter table public.people add  constraint people_role_check
  check (role in ('duty', 'approver', 'viewer', 'admin'));

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
on conflict (lower(email)) do nothing;

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

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id() and role = 'admin');
$$;

create or replace function public.is_approver()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id() and role in ('approver', 'admin'));
$$;

-- Jelölni csak az tud, aki ügyeletre beosztható. A megtekintő nem.
create or replace function public.can_mark()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id()
      and role in ('duty', 'approver', 'admin') and can_duty);
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
--     saját jelölés  → ügyelő, véglegesítő, admin
--     beosztás, lezárás → véglegesítő és admin
--     névsor → save_roster RPC, adminjogot csak admin adhat
--     app_config → csak admin
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
  using (public.is_admin()) with check (public.is_admin());

-- Bejelentkezés nélkül semmi nem érhető el.
revoke all on public.people, public.marks, public.schedule, public.weeks, public.app_config
  from anon;
grant usage on schema public to authenticated;
grant select on public.people to authenticated;
revoke insert, update, delete on public.people from authenticated;
grant select, insert, update, delete
  on public.marks, public.schedule, public.weeks, public.app_config
  to authenticated;
grant execute on function public.whoami(), public.is_member(), public.is_approver(),
                          public.can_mark(), public.current_person_id() to authenticated;

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

-- Névsor mentése jogosultságellenőrzéssel, egyetlen tranzakcióban.
create or replace function public.save_roster(p_people jsonb, p_removed uuid[] default '{}')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean;
  v_had_admin boolean;
begin
  lock table public.people in share row exclusive mode;
  if not public.is_approver() then
    raise exception 'A névsort csak véglegesítő vagy admin módosíthatja.' using errcode = '42501';
  end if;
  v_admin := public.is_admin();
  select exists(select 1 from public.people where role = 'admin') into v_had_admin;

  if p_people is null or jsonb_typeof(p_people) <> 'array' then
    raise exception 'Érvénytelen névsor.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_people) as r(id uuid, name text, email text, role text, can_duty boolean, sort_order int)
    where r.id is null or nullif(trim(r.name), '') is null or nullif(trim(r.email), '') is null
      or r.role is null or r.role not in ('duty', 'approver', 'viewer', 'admin')
      or r.can_duty is null or r.sort_order is null
  ) then raise exception 'Minden személyhez név, e-mail és érvényes szerep szükséges.'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_people) as r(id uuid)
    group by r.id having count(*) > 1
  ) then raise exception 'Ismétlődő személy a névsorban.'; end if;

  if not v_admin then
    if exists (select 1 from public.people where id = any(coalesce(p_removed, '{}')) and role = 'admin')
      or exists (
        select 1 from jsonb_to_recordset(p_people)
          as r(id uuid, name text, email text, color text, role text, can_duty boolean)
        left join public.people p on p.id = r.id
        where (r.role = 'admin' or p.role = 'admin')
          and (p.id is null or (r.name, r.email, coalesce(r.color, '#5F6368'), r.role, r.can_duty)
            is distinct from (p.name, p.email, p.color, p.role, p.can_duty))
      ) then
      raise exception 'Adminjogot és adminfiókot csak admin módosíthat.' using errcode = '42501';
    end if;
  end if;

  delete from public.people where id = any(coalesce(p_removed, '{}'));
  insert into public.people (id, name, email, color, role, can_duty, sort_order)
  select r.id, trim(r.name), lower(trim(r.email)), coalesce(r.color, '#5F6368'), r.role, r.can_duty, r.sort_order
  from jsonb_to_recordset(p_people)
    as r(id uuid, name text, email text, color text, role text, can_duty boolean, sort_order int)
  on conflict (id) do update set
    name = excluded.name, email = excluded.email, color = excluded.color,
    role = excluded.role, can_duty = excluded.can_duty, sort_order = excluded.sort_order;

  if (select count(*) from public.people where role = 'approver') <> 1 then
    raise exception 'Pontosan egy véglegesítő legyen.';
  end if;
  if (select count(*) from public.people) < 2 then
    raise exception 'Legalább két személy szükséges.';
  end if;
  if v_had_admin and not exists(select 1 from public.people where role = 'admin') then
    raise exception 'Az utolsó admin nem törölhető és nem fokozható le.';
  end if;
end;
$$;

revoke all on function public.save_roster(jsonb, uuid[]) from public, anon;
grant execute on function public.save_roster(jsonb, uuid[]) to authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
