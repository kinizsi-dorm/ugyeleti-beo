-- Meglévő projekthez: Supabase Dashboard → SQL Editor → teljes fájl → Run.
-- A névsor és beosztás megmarad; senki nem kap automatikusan admin szerepet.
begin;

alter table public.people drop constraint if exists people_role_check;
alter table public.people add constraint people_role_check
  check (role in ('duty', 'approver', 'viewer', 'admin'));

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id() and role = 'admin');
$$;

-- A meglévő beosztás-, jelölés- és heti zárolási szabályok ezt használják.
create or replace function public.is_approver()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id() and role in ('approver', 'admin'));
$$;

create or replace function public.can_mark()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people
    where id = public.current_person_id()
      and role in ('duty', 'approver', 'admin') and can_duty);
$$;

drop policy if exists p_write on public.app_config;
create policy p_write on public.app_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A névsor mentése egy tranzakció: a saját szerep átadása is végigfut,
-- és hiba esetén a törlések, módosítások együtt visszagördülnek.
-- A véglegesítő nem emelhet adminná senkit, és adminfiókot sem írhat át.
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

drop policy if exists p_write on public.people;
revoke insert, update, delete on public.people from authenticated;
revoke all on function public.save_roster(jsonb, uuid[]) from public, anon;
grant execute on function public.save_roster(jsonb, uuid[]) to authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

commit;
