// Opcionális PostgreSQL/RLS tesztek: @electric-sql/pglite, kizárólag helyi adatbázissal.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
let db, people;
const migration = readFileSync(join(__dirname,'../supabase/admin-role.sql'),'utf8');
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
  `);
  // gen_random_uuid beépített; a tesztmotorban nincs külön pgcrypto csomag.
  const schema = readFileSync(join(__dirname,'../supabase/schema.sql'),'utf8')
    .replace('create extension if not exists pgcrypto;', '');
  await db.exec(schema);
  people = (await db.query('select * from public.people order by sort_order')).rows;
});
after(async () => { await db?.close(); });
const person = name => people.find(p=>p.name===name);
async function asUser(name, fn, withAdmin = true) {
  await db.exec('begin');
  try {
    if (withAdmin) await db.query("update public.people set role='admin' where id=$1",[person('Bandi').id]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claims', $1, true)",[JSON.stringify({email:person(name)?.email || 'outsider@example.com',role:'authenticated'})]);
    await fn();
  } finally { await db.exec('rollback'); }
}
async function denied(fn) {
  await db.exec('savepoint expected_denial');
  try { await assert.rejects(fn); }
  finally { await db.exec('rollback to savepoint expected_denial; release savepoint expected_denial'); }
}
const rows = async () => (await db.query('select * from public.people order by sort_order')).rows;
const save = (list, removed=[]) => db.query('select public.save_roster($1::jsonb, $2::uuid[])',[JSON.stringify(list),removed]);

test('migration is repeatable, preserves records, and never assigns an admin', async () => {
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(await rows(), people);
  assert.equal(people.some(p=>p.role==='admin'), false);
});
test('admin can mark their duty, assign and lock weeks, and change month mode', async () => {
  await asUser('Bandi', async () => {
    await db.query("insert into public.marks(person_id,day,state) values ($1,'2030-01-07','yes')",[person('Bandi').id]);
    await db.query("insert into public.schedule(day,person_id) values ('2030-01-07',$1)",[person('Bandi').id]);
    await db.query("insert into public.weeks(week,locked,locked_by) values ('2030-01-07',true,$1)",[person('Bandi').id]);
    await db.exec("update public.app_config set week_mode='calendar' where id=1");
    assert.equal((await db.query('select week_mode from public.app_config')).rows[0].week_mode,'calendar');
  });
});
test('approver keeps scheduling rights but cannot change month settings', async () => {
  await asUser('Vanda', async () => {
    await db.query("insert into public.schedule(day,person_id) values ('2030-01-07',$1)",[person('Vanda').id]);
    await db.exec("update public.app_config set week_mode='calendar' where id=1");
    assert.equal((await db.query('select week_mode from public.app_config')).rows[0].week_mode,'weeks');
    await denied(()=>db.exec("insert into public.app_config(id,week_mode) values(1,'calendar') on conflict(id) do update set week_mode=excluded.week_mode"));
  });
});
test('duty, viewer and outsider cannot edit roster, schedule, locks or settings', async () => {
  for (const name of ['Peti','Viktor','outsider']) await asUser(name, async () => {
    await denied(()=>save(people));
    await denied(()=>db.query("insert into public.schedule(day,person_id) values ('2030-01-07',$1)",[person('Peti').id]));
    await denied(()=>db.exec("insert into public.weeks(week,locked) values('2030-01-07',true)"));
    await denied(()=>db.exec("insert into public.app_config(id,week_mode) values(1,'calendar') on conflict(id) do update set week_mode=excluded.week_mode"));
  });
});
test('approver may edit ordinary roles and transfer approver role atomically', async () => {
  await asUser('Vanda', async () => {
    const list = await rows();
    list.find(p=>p.name==='Peti').role='viewer';
    list.find(p=>p.name==='Peti').can_duty=false;
    list.find(p=>p.name==='Vanda').role='duty';
    list.find(p=>p.name==='Bálint').role='approver';
    await save(list);
    const saved = await rows();
    assert.equal(saved.find(p=>p.name==='Vanda').role,'duty');
    assert.equal(saved.find(p=>p.name==='Bálint').role,'approver');
    assert.equal(saved.find(p=>p.name==='Peti').role,'viewer');
  });
});
test('approver cannot promote, demote, rename, delete or insert admins via RPC', async () => {
  await asUser('Vanda', async () => {
    for (const mutate of [
      list=>{list.find(p=>p.name==='Peti').role='admin';},
      list=>{list.find(p=>p.name==='Bandi').role='duty';},
      list=>{list.find(p=>p.name==='Bandi').email='stolen@example.com';},
      list=>{list.push({...list[0],id:'11111111-1111-4111-8111-111111111111',email:'new@example.com',role:'admin'});}
    ]) {
      const list=await rows(); mutate(list); await denied(()=>save(list));
    }
    await denied(()=>save((people.filter(p=>p.name!=='Bandi')),[person('Bandi').id]));
    // Közvetlen táblamódosítás sem kerülheti meg az RPC ellenőrzéseit.
    await denied(()=>db.exec("update public.people set role='admin' where name='Peti'"));
  });
});
test('admin may promote and demote admins, including self, when another admin remains', async () => {
  await asUser('Bandi', async () => {
    let list=await rows();
    list.find(p=>p.name==='Peti').role='admin';
    await save(list);
    list=await rows(); list.find(p=>p.name==='Bandi').role='duty';
    await save(list);
    assert.equal((await rows()).find(p=>p.name==='Bandi').role,'duty');
    assert.equal((await rows()).find(p=>p.name==='Peti').role,'admin');
  });
});
test('failed roster save rolls back deletions and cannot remove the last admin', async () => {
  await asUser('Bandi', async () => {
    const original=await rows();
    let list=original.filter(p=>p.name!=='Peti').map(p=>({...p}));
    list.find(p=>p.name==='Vanda').role='duty';
    await denied(()=>save(list,[person('Peti').id]));
    assert.deepEqual(await rows(),original);
    list=original.map(p=>({...p})); list.find(p=>p.name==='Bandi').role='duty';
    await denied(()=>save(list));
    assert.deepEqual(await rows(),original);
  });
});
