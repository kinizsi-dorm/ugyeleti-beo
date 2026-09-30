// Opcionális böngészőtesztek: playwright szükséges. Minden backendhívás helyi mock.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

let browser, server, origin;
const root = path.resolve(__dirname, '..');
const mockClient = `export function createClient() {
  let member = { id:'test-person', name:'Teszt Elek', email:'test@example.com', role:window.testRole || 'duty', sort_order:1, can_duty:true };
  let people = [member, {id:'other-person',name:'Másik Ember',email:'other@example.com',role:member.role==='approver'?'duty':'approver',can_duty:true,sort_order:2}];
  window.testWrites = [];
  window.testReadTables = [];
  window.testStatsCalls = 0;
  const session = { access_token:'test-session' };
  return {
    auth: {
      getSession: async () => ({data:{session:window.testSignedOut ? null : session}}),
      getUser: async () => ({data:{user:{email:member.email}}}),
      signInWithOAuth: async options => { window.testRedirect = options.options.redirectTo; return {}; },
      signOut: async () => { window.testAuth?.('SIGNED_OUT'); return {}; },
      onAuthStateChange: callback => { window.testAuth = callback; return {}; }
    },
    rpc: async name => {
      if (name === 'get_stats') { window.testStatsCalls++; return {data:window.testStats,error:window.testStatsError ? {message:'Test failure'} : null}; }
      return {data:window.testNonmember ? [] : [member]};
    },
    from: table => { window.testReadTables.push(table); const query = {
      select:()=>query, order:()=>query, eq:()=>query, gte:()=>query, lte:()=>query,
      maybeSingle:()=>query,
      upsert:value=>{window.testWrites.push({table,value}); if(table==='app_config') sessionStorage.setItem('test-week-mode',value.week_mode); if(table==='people') {people=value;member=people.find(p=>p.id==='test-person');} return query;},
      delete:()=>query, in:()=>query,
      then:resolve=>resolve({data:table==='people' ? people : table==='app_config' ? {week_mode:sessionStorage.getItem('test-week-mode') || 'weeks'} : []})
    }; return query; },
    channel: () => { const c={on:()=>c,subscribe:()=>c}; return c; }, removeChannel:()=>{}
  };
}`;

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/ugyeleti-beo/otp') { res.writeHead(301, { Location: '/ugyeleti-beo/otp/' }); res.end(); return; }
      const relative = pathname.replace(/^\/ugyeleti-beo\//, '');
      const file = path.resolve(root, relative + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml'};
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
      res.end(await fs.readFile(file));
    } catch { res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless:true, ...(process.env.OTP_TEST_BROWSER ? {channel:process.env.OTP_TEST_BROWSER} : {}) });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function fixture(t, { status=200, ttl=25000, code='012345', mobile=false, init } = {}) {
  const context = await browser.newContext({ viewport: mobile ? {width:375,height:812} : {width:1280,height:900} });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType:'text/javascript', body:mockClient }));
  let calls=0;
  const state = {status,ttl,code};
  await page.route('**/functions/v1/otp', async route => {
    calls++;
    assert.equal(route.request().headers().authorization, 'Bearer test-session');
    await route.fulfill({status:state.status, contentType:'application/json', body:JSON.stringify(state.status===200
      ? {code:state.code,period:30,serverTime:100000,expiresAt:100000+state.ttl} : {error:'test_error'})});
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text => {window.testCopied=text;}}});
  });
  if (init) await page.addInitScript(init);
  return {page,state,errors,calls:()=>calls};
}

async function assertNavigation(page, labels) {
  const links = page.locator('.site-nav .nav-link');
  await links.first().waitFor({state:'visible'});
  assert.deepEqual(await links.allTextContents().then(values=>values.map(value=>value.trim())), labels);
  for (const link of await links.all()) {
    assert.equal(await link.locator('svg[aria-hidden="true"]').count(), 1);
    assert.ok(await link.locator('svg').isVisible());
  }
}

async function assertRoleIcon(page, role, {toggle=false} = {}) {
  const icon = page.locator('.header-account .role-icon');
  assert.equal(await icon.getAttribute('data-role'), role);
  assert.equal(await icon.locator('svg[aria-hidden="true"]').count(), 1);
  assert.equal(await icon.textContent().then(value=>value.trim()), '');
  assert.equal(await page.locator('.user em, .view-toggle').count(), 0);
  assert.equal(await page.locator('.header-account [data-act="admin-view"]').count(), toggle ? 1 : 0);
}

test('OTP deep link, identity, copy leading zero, navigation, mobile layout', async t => {
  const {page,errors} = await fixture(t,{mobile:true});
  await page.goto(`${origin}/ugyeleti-beo/otp`);
  await page.waitForSelector('.otp-code:not(:disabled)');
  assert.match(await page.locator('.user').textContent(), /Teszt Elek/);
  await assertNavigation(page,['Beosztás','OTP']);
  await assertRoleIcon(page,'duty');
  assert.equal(await page.locator('[aria-current="page"]').textContent().then(s=>s.trim()), 'OTP');
  assert.equal(await page.locator('.weeks').count(), 0);
  await page.locator('.otp-code').click();
  assert.equal(await page.evaluate(() => window.testCopied), '012345');
  assert.match(await page.locator('.otp-copy-label').textContent(), /Kimásolva/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await fs.mkdir(path.join(root,'test-results'), {recursive:true});
  await page.screenshot({path:path.join(root,'test-results/otp-mobile.png'),fullPage:true});
  await page.getByRole('link',{name:'Beosztás',exact:true}).click();
  await page.waitForSelector('.weeks');
  assert.equal(new URL(page.url()).pathname, '/ugyeleti-beo/');
  await page.getByRole('link',{name:'OTP',exact:true}).click();
  await page.waitForSelector('.otp-code:not(:disabled)');
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:path.join(root,'test-results/otp-desktop.png'),fullPage:true});
  assert.deepEqual(errors, []);
});
test('expired code is hidden during network failure and manual retry recovers', async t => {
  const {page,state,calls} = await fixture(t,{ttl:1300});
  await page.goto(`${origin}/ugyeleti-beo/otp/`);
  await page.waitForSelector('.otp-code:not(:disabled)');
  state.status=502;
  await page.waitForSelector('.otp-retry:not([hidden])');
  assert.equal(await page.locator('.otp-code').isDisabled(), true);
  assert.equal(await page.locator('.otp-digits').textContent(), '••• •••');
  state.status=200; state.code='987654'; state.ttl=25000;
  await page.getByRole('button',{name:'Újrapróbálás'}).click();
  await page.waitForSelector('.otp-code:not(:disabled)');
  assert.equal(await page.locator('.otp-digits').textContent(), '987 654');
  assert.ok(calls() >= 3);
});
test('expired session and nonmember response never show a code', async t => {
  for (const status of [401,403,404,503]) {
    const {page,calls} = await fixture(t,{status});
    await page.goto(`${origin}/ugyeleti-beo/otp/`);
    await page.waitForSelector('.otp-retry:not([hidden])');
    assert.equal(await page.locator('.otp-code').isDisabled(), true);
    assert.equal(calls(), 1);
  }
});
test('hidden tab clears code, resume fetches again, signout clears immediately', async t => {
  const {page,state} = await fixture(t);
  await page.goto(`${origin}/ugyeleti-beo/otp/`);
  await page.waitForSelector('.otp-code:not(:disabled)');
  await page.evaluate(() => {
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('.otp-digits').textContent(), '••• •••');
  state.code='654321';
  await page.evaluate(() => {
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForSelector('.otp-code:not(:disabled)');
  assert.equal(await page.locator('.otp-digits').textContent(), '654 321');
  await page.evaluate(() => window.testAuth('SIGNED_OUT'));
  assert.equal(await page.locator('.otp-code').count(), 0);
  assert.ok(await page.getByRole('button',{name:'Belépés Google-fiókkal'}).isVisible());
});
test('direct OAuth login returns to OTP; nonmember gate never requests code', async t => {
  const signedOut = await fixture(t,{init:()=>{window.testSignedOut=true;}});
  await signedOut.page.goto(`${origin}/ugyeleti-beo/otp/`);
  await signedOut.page.waitForFunction(() => window.testRedirect);
  assert.equal(await signedOut.page.evaluate(()=>window.testRedirect), `${origin}/ugyeleti-beo/otp/`);
  assert.equal(signedOut.calls(),0);
  const blocked = await fixture(t,{init:()=>{window.testNonmember=true;}});
  await blocked.page.goto(`${origin}/ugyeleti-beo/otp/`);
  await blocked.page.getByRole('heading',{name:'Nincs hozzáférés'}).waitFor();
  assert.equal(blocked.calls(),0);
});
test('clipboard failure gives feedback without a false success', async t => {
  const {page} = await fixture(t,{init:()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Denied');}}});}});
  await page.goto(`${origin}/ugyeleti-beo/otp/`);
  await page.waitForSelector('.otp-code:not(:disabled)');
  await page.locator('.otp-code').click();
  assert.match(await page.locator('.otp-status').textContent(), /nem engedélyezte/);
});

test('admin starts as duty, switches to approver controls, and back to own marks', async t => {
  const {page,errors} = await fixture(t,{init:()=>{window.testRole='admin';}});
  await page.goto(`${origin}/ugyeleti-beo/`);
  await page.waitForSelector('.weeks');
  const roleSwitch = page.locator('[data-act="admin-view"]');
  assert.equal(await roleSwitch.getAttribute('aria-pressed'),'false');
  assert.equal(await roleSwitch.getAttribute('aria-label'),'Ügyelő nézet – váltás admin nézetre');
  await assertRoleIcon(page,'duty',{toggle:true});
  await assertNavigation(page,['Beosztás','OTP']);
  assert.equal(await page.getByRole('button',{name:'Névsor',exact:true}).count(),0);
  await page.locator('.cell').first().click();
  assert.equal(await page.evaluate(()=>window.testWrites.at(-1).table),'marks');
  await roleSwitch.focus();
  await page.keyboard.press('Enter');
  assert.equal(await roleSwitch.getAttribute('aria-pressed'),'true');
  assert.equal(await roleSwitch.getAttribute('aria-label'),'Admin nézet – váltás ügyelő nézetre');
  assert.equal(await roleSwitch.evaluate(element=>element===document.activeElement),true);
  await assertRoleIcon(page,'admin',{toggle:true});
  await assertNavigation(page,['Beosztás','OTP','Névsor','Stat','Beállítások']);
  assert.ok(await page.getByRole('button',{name:'Mindenki beosztása'}).isVisible());
  assert.ok(await page.getByRole('button',{name:'Véglegesítés',exact:true}).first().isVisible());
  assert.equal(await page.getByRole('link',{name:'Stat',exact:true}).getAttribute('href'),`${origin}/ugyeleti-beo/stats/`);
  await page.locator('.cell').first().click();
  assert.equal(await page.evaluate(()=>window.testWrites.at(-1).table),'schedule');
  await page.getByRole('button',{name:'Névsor',exact:true}).click();
  assert.ok(await page.getByRole('heading',{name:'Névsor',exact:true}).isVisible());
  assert.equal(await page.locator('.dialog').getByText('Hónap nézete').count(),0);
  assert.equal(await page.locator('.dialog').getByText('Véglegesítőből pontosan egy legyen.',{exact:false}).count(),0);
  await page.locator('.dialog [data-f="name"]').first().fill('Módosított Név');
  await page.getByRole('button',{name:'Mentés',exact:true}).click();
  await page.waitForSelector('.dialog',{state:'detached'});
  assert.match(await page.locator('.user-name').textContent(),/Módosított Név/);
  assert.equal(await page.evaluate(()=>window.testWrites.at(-1).table),'people');
  await roleSwitch.focus();
  await page.keyboard.press('Space');
  assert.equal(await roleSwitch.getAttribute('aria-pressed'),'false');
  assert.equal(await roleSwitch.evaluate(element=>element===document.activeElement),true);
  await assertRoleIcon(page,'duty',{toggle:true});
  assert.equal(await page.getByRole('button',{name:'Mindenki beosztása'}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Beállítások',exact:true}).count(),0);
  assert.match(await page.locator('.bar').textContent(),/jobb kattintás.*hosszú nyomás/);
  assert.deepEqual(errors,[]);
});

test('admin settings persist separately; view persists across pages; OTP keeps running on toggle', async t => {
  const {page,errors} = await fixture(t,{init:()=>{window.testRole='admin';}});
  await page.goto(`${origin}/ugyeleti-beo/`);
  const roleSwitch = page.locator('[data-act="admin-view"]');
  await roleSwitch.click();
  await page.getByRole('link',{name:'Beállítások',exact:true}).click();
  assert.equal(new URL(page.url()).pathname,'/ugyeleti-beo/settings/');
  await assertNavigation(page,['Beosztás','OTP','Névsor','Stat','Beállítások']);
  await assertRoleIcon(page,'admin',{toggle:true});
  await page.getByLabel('Hónap nézete').selectOption('calendar');
  await page.getByRole('button',{name:'Mentés',exact:true}).click();
  await page.getByText('Beállítások mentve',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.testWrites.map(w=>w.table)),['app_config']);
  await page.reload();
  assert.equal(await page.getByLabel('Hónap nézete').inputValue(),'calendar');
  await page.getByRole('link',{name:'OTP',exact:true}).click();
  await page.waitForSelector('.otp-code:not(:disabled)');
  assert.equal(await roleSwitch.getAttribute('aria-pressed'),'true');
  await roleSwitch.click();
  await assertRoleIcon(page,'duty',{toggle:true});
  await assertNavigation(page,['Beosztás','OTP']);
  assert.equal(await page.locator('.otp-code').isEnabled(),true);
  await page.locator('.otp-code').click();
  assert.equal(await page.evaluate(()=>window.testCopied),'012345');
  await roleSwitch.click();
  await assertRoleIcon(page,'admin',{toggle:true});
  await assertNavigation(page,['Beosztás','OTP','Névsor','Stat','Beállítások']);
  assert.equal(await page.locator('.otp-code').isEnabled(),true);
  await page.getByRole('link',{name:'Névsor',exact:true}).click();
  await page.getByRole('heading',{name:'Névsor',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/ugyeleti-beo/');
  assert.equal(await page.locator('.dialog select option[value="admin"]').count(),2);
  assert.equal(await roleSwitch.getAttribute('aria-pressed'),'true');
  assert.deepEqual(errors,[]);
});

test('nonadmins cannot enter admin mode or settings; approver keeps roster access', async t => {
  for (const role of ['duty','approver','viewer']) {
    const {page} = await fixture(t,{init:new Function(`window.testRole='${role}'; sessionStorage.setItem('admin-view.test-person','on');`)});
    await page.goto(`${origin}/ugyeleti-beo/`);
    await page.waitForSelector('.weeks');
    await assertRoleIcon(page,role);
    await assertNavigation(page,role==='approver' ? ['Beosztás','OTP','Névsor'] : ['Beosztás','OTP']);
    assert.equal(await page.getByRole('link',{name:'Beállítások',exact:true}).count(),0);
    if (role==='approver') {
      await page.getByRole('button',{name:'Névsor',exact:true}).click();
      assert.equal(await page.locator('.dialog select option[value="admin"]').count(),0);
      assert.equal(await page.locator('.dialog [data-f="weekMode"]').count(),0);
      await page.goto(`${origin}/ugyeleti-beo/otp/`);
      await page.waitForSelector('.otp-code:not(:disabled)');
      await assertRoleIcon(page,role);
      await assertNavigation(page,['Beosztás','OTP','Névsor']);
      await page.getByRole('link',{name:'Névsor',exact:true}).click();
      await page.getByRole('heading',{name:'Névsor',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname,'/ugyeleti-beo/');
      assert.equal(await page.locator('.dialog select option[value="admin"]').count(),0);
    }
    await page.goto(`${origin}/ugyeleti-beo/settings/`);
    await page.getByText('A beállításokat csak admin módosíthatja.').waitFor();
    assert.equal(await page.getByLabel('Hónap nézete').count(),0);
  }
});

test('admin header remains usable on narrow screens in both views', async t => {
  const {page} = await fixture(t,{init:()=>{window.testRole='admin';}});
  await page.goto(`${origin}/ugyeleti-beo/`);
  await page.waitForSelector('.weeks');
  for (const adminMode of [true,false]) {
    await page.locator('[data-act="admin-view"]').click();
    for (const width of [320,375,768,1024,1280]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if (width<=700) assert.equal(await page.locator('.site-nav').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
      await assertNavigation(page,adminMode ? ['Beosztás','OTP','Névsor','Stat','Beállítások'] : ['Beosztás','OTP']);
      await assertRoleIcon(page,adminMode ? 'admin' : 'duty',{toggle:true});
      assert.ok((await page.locator('.user-name').boundingBox()).width>20);
    }
  }
  await page.locator('[data-act="admin-view"]').click();
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/admin-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:812});
  await page.screenshot({path:path.join(root,'test-results/admin-mobile.png'),fullPage:true});
});

test('settings login reuses root OAuth callback and returns to settings for admin', async t => {
  const signedOut = await fixture(t,{init:()=>{window.testRole='admin';window.testSignedOut=true;}});
  await signedOut.page.goto(`${origin}/ugyeleti-beo/settings/`);
  await signedOut.page.waitForFunction(()=>window.testRedirect);
  assert.equal(await signedOut.page.evaluate(()=>window.testRedirect),`${origin}/ugyeleti-beo/`);
  assert.equal(await signedOut.page.evaluate(()=>sessionStorage.getItem('sso.return-page')),'settings/');

  const callback = await fixture(t,{init:()=>{
    window.testRole='admin';
    if (location.pathname==='/ugyeleti-beo/') {
      sessionStorage.setItem('sso.return-page','settings/');
      sessionStorage.setItem('admin-view.test-person','on');
    }
  }});
  await callback.page.goto(`${origin}/ugyeleti-beo/`);
  await callback.page.getByLabel('Hónap nézete').waitFor();
  assert.equal(new URL(callback.page.url()).pathname,'/ugyeleti-beo/settings/');
  assert.equal(await callback.page.evaluate(()=>sessionStorage.getItem('sso.return-page')),null);
});

const statsData = {
  people:[{id:'test-person',name:'Teszt Elek'},{id:'other-person',name:'Másik <Ember>'}],
  weeks:['2026-08-31','2026-09-07','2026-09-21'],
  rows:[
    {week:'2026-08-31',person_id:'test-person',yes:4,maybe:1,no:1,unmarked:1,eligible_days:7,assigned:2,weekday:1,weekend:1},
    {week:'2026-08-31',person_id:'other-person',yes:2,maybe:1,no:1,unmarked:3,eligible_days:7,assigned:1,weekday:1,weekend:0},
    {week:'2026-09-07',person_id:'test-person',yes:3,maybe:1,no:2,unmarked:1,eligible_days:7,assigned:2,weekday:1,weekend:1},
    {week:'2026-09-07',person_id:'other-person',yes:1,maybe:2,no:1,unmarked:3,eligible_days:7,assigned:3,weekday:2,weekend:1},
    {week:'2026-09-21',person_id:'test-person',yes:5,maybe:0,no:2,unmarked:0,eligible_days:7,assigned:3,weekday:2,weekend:1},
    {week:'2026-09-21',person_id:'other-person',yes:0,maybe:1,no:1,unmarked:5,eligible_days:7,assigned:1,weekday:1,weekend:0}
  ]
};
async function statsFixture(t, payload=statsData) {
  const f = await fixture(t);
  await f.page.addInitScript(data=>{
    window.testRole='admin'; window.testStats=data;
    sessionStorage.setItem('admin-view.test-person','on');
  },payload);
  await f.page.goto(`${origin}/ugyeleti-beo/stats/`);
  return f;
}

test('stats fetch once, filter full weeks locally, preserve filters on mode switch',async t=>{
  const {page,errors}=await statsFixture(t);
  await page.locator('[data-kpi="yes"] strong').waitFor();
  const value=key=>page.locator(`[data-kpi="${key}"] strong`).textContent();
  assert.equal(await value('yes'),'9');
  assert.equal(await value('assigned'),'9');
  assert.equal(await value('unmarked'),'9');
  assert.equal(await value('average'),'4,8');
  assert.equal(await page.locator('.stats-tick').count(),4); // Open week remains a real date interval.
  assert.equal(await page.locator('.stats-tick.is-closed').count(),3);
  assert.equal(await page.locator('#stats-person option').count(),3);
  assert.equal(await page.locator('[aria-current="page"]').textContent().then(s=>s.trim()),'Stat');
  await page.getByLabel('Ember',{exact:true}).selectOption('test-person');
  assert.equal(await value('yes'),'8');
  assert.equal(await value('average'),'6,5');
  await page.getByLabel('Záró hét',{exact:true}).focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#stats-to').inputValue(),'1'); // Cannot cross the start.
  assert.equal(await value('yes'),'3');
  await page.getByLabel('Kezdő hét',{exact:true}).focus();
  await page.keyboard.press('Home');
  assert.equal(await value('yes'),'7');
  await page.locator('[data-act="admin-view"]').click();
  assert.equal(await value('yes'),'7');
  await page.locator('[data-act="admin-view"]').click();
  await page.locator('.stats-heat-cell').first().click();
  assert.match(await page.locator('#stats-heat-detail').textContent(),/Teszt Elek.*ráér: 4/);
  assert.equal(await page.evaluate(()=>window.testStatsCalls),1);
  assert.deepEqual(await page.evaluate(()=>window.testReadTables),[]);
  await page.getByRole('button',{name:'Teljes időszak'}).click();
  assert.equal(await value('yes'),'12');
  await page.getByLabel('Ember',{exact:true}).selectOption('other-person');
  assert.match(await page.locator('.stats-heatmap').textContent(),/Másik <Ember>/);
  assert.deepEqual(errors,[]);
});

test('stats responsive filters and KPI row; gap-only range has no fabricated data',async t=>{
  const {page,errors}=await statsFixture(t);
  await page.locator('.stats-kpis').waitFor();
  for(const width of [320,375,768,1280]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const dateBox=await page.locator('.stats-date-filter').boundingBox();
    const personBox=await page.locator('.stats-person-filter').boundingBox();
    assert.equal(dateBox.y,personBox.y);
    assert.ok(personBox.x>=dateBox.x+dateBox.width);
    const cards=await page.locator('.stats-kpi').all();
    const boxes=await Promise.all(cards.map(c=>c.boundingBox()));
    assert.ok(boxes.every(b=>b.y===boxes[0].y));
  }
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/stats-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:812});
  await page.screenshot({path:path.join(root,'test-results/stats-mobile.png'),fullPage:true});
  await page.locator('#stats-from').fill('2');
  await page.locator('#stats-to').fill('2');
  await page.getByText('Nincs adat a kiválasztott szűréshez',{exact:true}).waitFor();
  assert.match(await page.locator('#stats-selection').textContent(),/0 véglegesített hét/);
  assert.equal(await page.evaluate(()=>window.testStatsCalls),1);
  assert.deepEqual(errors,[]);
});

test('stats handles single week, empty results and recoverable RPC failure',async t=>{
  const single=await statsFixture(t,{...statsData,weeks:['2026-09-07'],rows:statsData.rows.filter(r=>r.week==='2026-09-07')});
  await single.page.locator('.stats-kpis').waitFor();
  assert.equal(await single.page.locator('#stats-from').isDisabled(),true);
  assert.equal(await single.page.locator('#stats-to').isDisabled(),true);
  const empty=await statsFixture(t,{people:[],weeks:[],rows:[]});
  await empty.page.getByText(/Még nincs véglegesített hét/).waitFor();
  const failed=await fixture(t,{init:()=>{window.testRole='admin';window.testStatsError=true;}});
  await failed.page.goto(`${origin}/ugyeleti-beo/stats/`);
  await failed.page.getByRole('heading',{name:'A statisztika nem tölthető be'}).waitFor();
  await failed.page.evaluate(data=>{window.testStats=data;window.testStatsError=false;},statsData);
  await failed.page.getByRole('button',{name:'Újrapróbálás'}).click();
  await failed.page.locator('.stats-kpis').waitFor();
  assert.equal(await failed.page.evaluate(()=>window.testStatsCalls),2);
  await failed.page.locator('[data-act="signout"]').click();
  assert.equal(await failed.page.locator('.stats-kpis').count(),0);
});

test('stats OAuth reuses root callback then returns to the stats page',async t=>{
  const signedOut=await fixture(t,{init:()=>{window.testRole='admin';window.testSignedOut=true;}});
  await signedOut.page.goto(`${origin}/ugyeleti-beo/stats/`);
  await signedOut.page.waitForFunction(()=>window.testRedirect);
  assert.equal(await signedOut.page.evaluate(()=>window.testRedirect),`${origin}/ugyeleti-beo/`);
  assert.equal(await signedOut.page.evaluate(()=>sessionStorage.getItem('sso.return-page')),'stats/');
  const callback=await fixture(t);
  await callback.page.addInitScript(data=>{
    window.testRole='admin';window.testStats=data;
    if(location.pathname==='/ugyeleti-beo/') sessionStorage.setItem('sso.return-page','stats/');
  },statsData);
  await callback.page.goto(`${origin}/ugyeleti-beo/`);
  await callback.page.locator('.stats-kpis').waitFor();
  assert.equal(new URL(callback.page.url()).pathname,'/ugyeleti-beo/stats/');
  assert.equal(await callback.page.evaluate(()=>sessionStorage.getItem('sso.return-page')),null);
});

test('stats slider supports pointer dragging; long histories stay within mobile viewport',async t=>{
  const {page}=await statsFixture(t);
  await page.locator('.stats-kpis').waitFor();
  await page.getByRole('button',{name:'Teljes időszak'}).click();
  const box=await page.locator('#stats-from').boundingBox();
  const x=i=>box.x+10+(box.width-20)*i/3, y=box.y+box.height/2;
  await page.mouse.move(x(0),y);await page.mouse.down();await page.mouse.move(x(1),y,{steps:8});await page.mouse.up();
  assert.equal(await page.locator('#stats-from').inputValue(),'1');
  await page.mouse.move(x(3),y);await page.mouse.down();await page.mouse.move(x(2),y,{steps:8});await page.mouse.up();
  assert.equal(await page.locator('#stats-to').inputValue(),'2');
  assert.equal(await page.evaluate(()=>window.testStatsCalls),1);

  const weeks=Array.from({length:70},(_,i)=>new Date(Date.UTC(2025,8,1+i*7)).toISOString().slice(0,10));
  const longData={people:[statsData.people[0]],weeks,rows:weeks.map(week=>({...statsData.rows[0],week}))};
  const long=await statsFixture(t,longData);
  await long.page.getByRole('button',{name:'Teljes időszak'}).click();
  await long.page.setViewportSize({width:320,height:812});
  assert.equal(await long.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.ok(await long.page.locator('.stats-tick small').count()<=3);
  assert.match(await long.page.locator('.stats-axis-date').first().textContent(),/2025/);
  assert.match(await long.page.locator('.stats-axis-date').last().textContent(),/2026/);
  assert.equal(await long.page.evaluate(()=>window.testStatsCalls),1);
});
