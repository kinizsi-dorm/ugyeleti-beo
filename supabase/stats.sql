-- Supabase Dashboard → SQL Editor → New query → Run.
-- Önállóan, újra is futtatható. Csak a get_stats függvényt hozza létre.
create or replace function public.get_stats()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with members as (
    select id, name, sort_order,
           (created_at at time zone 'Europe/Budapest')::date as joined
    from public.people
    where role <> 'viewer'
  ), closed_weeks as (
    select week from public.weeks where locked = true
  ), daily as (
    select w.week, p.id as person_id, w.week + d.n as day,
           m.state, coalesce(s.person_id = p.id, false) as assigned
    from closed_weeks w
    cross join members p
    cross join generate_series(0, 6) as d(n)
    left join public.marks m
      on m.person_id = p.id and m.day = w.week + d.n
    left join public.schedule s on s.day = w.week + d.n
    -- Új tagok belépés előtti napjai nem számítanak hiányzó jelölésnek.
    -- Importált korábbi jelölés vagy beosztás viszont megmarad.
    where w.week + d.n >= p.joined
       or m.person_id is not null or s.person_id = p.id
  ), totals as (
    select week, person_id,
      count(*) as eligible_days,
      count(*) filter (where state = 'yes') as yes,
      count(*) filter (where state = 'maybe') as maybe,
      count(*) filter (where state = 'no') as no,
      count(*) filter (where state is null) as unmarked,
      count(*) filter (where assigned) as assigned,
      count(*) filter (where assigned and extract(isodow from day) < 6) as weekday,
      count(*) filter (where assigned and extract(isodow from day) >= 6) as weekend
    from daily
    group by week, person_id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name)
                       order by sort_order, name, id) from members
    ), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(week order by week) from closed_weeks
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.week, t.person_id)
      from totals t
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_stats() to anon, authenticated;
