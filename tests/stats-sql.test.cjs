// Opcionális helyi ellenőrzés: @electric-sql/pglite szükséges. Nem kapcsolódik Supabase-hez.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

test('stats SQL aggregates only locked weeks and excludes viewers and pre-join empty days',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table people(id uuid primary key,name text,role text,sort_order int,created_at timestamptz);
      create table weeks(week date primary key,locked boolean);
      create table marks(person_id uuid,day date,state text,primary key(person_id,day));
      create table schedule(day date primary key,person_id uuid);
      insert into people values
        ('00000000-0000-0000-0000-000000000001','Ügyelő','duty',1,'2026-08-01'),
        ('00000000-0000-0000-0000-000000000002','Új admin','admin',2,'2026-09-09'),
        ('00000000-0000-0000-0000-000000000003','Megtekintő','viewer',3,'2026-08-01');
    `);
    const sql=await fs.readFile(path.join(__dirname,'../supabase/stats.sql'),'utf8');
    await db.exec(sql);
    await db.exec(sql); // Safe to paste again.
    const read=async()=> (await db.query('select public.get_stats() as data')).rows[0].data;
    const empty=await read();
    assert.deepEqual(empty.weeks,[]);assert.deepEqual(empty.rows,[]);assert.equal(empty.people.length,2);
    await db.exec(`
      insert into weeks values ('2026-09-07',true),('2026-09-14',false),('2026-09-21',true);
      insert into marks values
        ('00000000-0000-0000-0000-000000000001','2026-09-07','yes'),
        ('00000000-0000-0000-0000-000000000001','2026-09-08','maybe'),
        ('00000000-0000-0000-0000-000000000001','2026-09-09','no'),
        ('00000000-0000-0000-0000-000000000001','2026-09-14','yes'),
        ('00000000-0000-0000-0000-000000000002','2026-09-07','yes'),
        ('00000000-0000-0000-0000-000000000003','2026-09-07','yes');
      insert into schedule values
        ('2026-09-07','00000000-0000-0000-0000-000000000001'),
        ('2026-09-12','00000000-0000-0000-0000-000000000001'),
        ('2026-09-13','00000000-0000-0000-0000-000000000002'),
        ('2026-09-14','00000000-0000-0000-0000-000000000001');
    `);
    const data=await read();
    assert.deepEqual(data.weeks,['2026-09-07','2026-09-21']);
    assert.equal(data.rows.length,4);
    const first=data.rows.find(r=>r.week==='2026-09-07'&&r.person_id.endsWith('1'));
    assert.deepEqual(first,{week:'2026-09-07',person_id:'00000000-0000-0000-0000-000000000001',yes:1,maybe:1,no:1,unmarked:4,eligible_days:7,assigned:2,weekday:1,weekend:1});
    const newcomer=data.rows.find(r=>r.week==='2026-09-07'&&r.person_id.endsWith('2'));
    assert.equal(newcomer.eligible_days,6); // Wed–Sun plus imported Monday mark; Tuesday excluded.
    assert.equal(newcomer.unmarked,5);assert.equal(newcomer.yes,1);assert.equal(newcomer.weekend,1);
    assert.ok(data.rows.every(r=>r.yes+r.maybe+r.no+r.unmarked===r.eligible_days));
    assert.ok(data.rows.every(r=>r.weekday+r.weekend===r.assigned));
    await db.exec("update weeks set locked=false where week='2026-09-07'");
    assert.deepEqual((await read()).weeks,['2026-09-21']);
  } finally { await db.close(); }
});
