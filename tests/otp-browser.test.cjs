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
  const member = { id:'test-person', name:'Teszt Elek', email:'test@example.com', role:'duty', sort_order:1, can_duty:true };
  const session = { access_token:'test-session' };
  return {
    auth: {
      getSession: async () => ({data:{session:window.testSignedOut ? null : session}}),
      getUser: async () => ({data:{user:{email:member.email}}}),
      signInWithOAuth: async options => { window.testRedirect = options.options.redirectTo; return {}; },
      signOut: async () => { window.testAuth?.('SIGNED_OUT'); return {}; },
      onAuthStateChange: callback => { window.testAuth = callback; return {}; }
    },
    rpc: async () => ({data:window.testNonmember ? [] : [member]}),
    from: table => { const query = {
      select:()=>query, order:()=>query, eq:()=>query, gte:()=>query, lte:()=>query,
      maybeSingle:()=>query,
      then:resolve=>resolve({data:table==='people' ? [member] : table==='app_config' ? {week_mode:'weeks'} : []})
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

test('OTP deep link, identity, copy leading zero, navigation, mobile layout', async t => {
  const {page,errors} = await fixture(t,{mobile:true});
  await page.goto(`${origin}/ugyeleti-beo/otp`);
  await page.waitForSelector('.otp-code:not(:disabled)');
  assert.match(await page.locator('.user').textContent(), /Teszt Elek/);
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
