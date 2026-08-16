/* =====================================================================
   Ügyeleti tábla
   GitHub Pages (statikus oldal) + Supabase (adatbázis és Google belépés).
   A véglegesítés egysége a hét; a naptár mindig teljes heteket mutat.
   ===================================================================== */

const CFG = window.APP_CONFIG || {};

const HU_MONTH = ['január', 'február', 'március', 'április', 'május', 'június',
                  'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const HU_SHORT = ['jan', 'febr', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec'];
const DOW = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];
const DOW_ABBR = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

const STATE_LABEL = { yes: 'Ráér', maybe: 'Ha muszáj', no: 'Nem ér rá' };
const STATE_COLOR = { yes: 'var(--yes)', maybe: 'var(--maybe)', no: 'var(--no)' };
const CYCLE = [null, 'yes', 'maybe', 'no'];
const ROLE_LABEL = { approver: 'véglegesítő', duty: 'ügyelő', viewer: 'megtekintő' };

/* Az ügyelet napi idősávja és a naptár időzónája. Ha változik, elég itt átírni. */
const SHIFT_FROM = 19, SHIFT_TO = 23, TZ = 'Europe/Budapest';

/* --------------------------------------------------------------- eszközök */

const el = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dowIdx = (d) => (d.getDay() + 6) % 7;
const huDate = (d) => `${d.getFullYear()}. ${HU_SHORT[d.getMonth()]}. ${d.getDate()}.`;
const mondayOf = (d) => addDays(d, -dowIdx(d));
const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uuid = () => (crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));

const slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'nevtelen';

/** A hónap napjai – mindig teljes hetek, hétfőtől vasárnapig. */
function monthDays(year, month, mode) {
  const days = [];
  if (mode === 'calendar') {
    const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
    let cur = addDays(first, -dowIdx(first));
    const end = addDays(last, 6 - dowIdx(last));
    while (cur <= end) { days.push(cur); cur = addDays(cur, 1); }
  } else {
    const first = new Date(year, month, 1);
    let cur = dowIdx(first) === 0 ? first : addDays(first, 7 - dowIdx(first));
    while (cur.getMonth() === month && cur.getFullYear() === year) {
      for (let i = 0; i < 7; i++) days.push(addDays(cur, i));
      cur = addDays(cur, 7);
    }
  }
  return days;
}

/** Hét felirata: „aug. 17 – 23.” vagy hónapfordulón „aug. 31 – szept. 6.” */
function weekLabel(monISO) {
  const a = fromISO(monISO), b = addDays(a, 6);
  const left = `${HU_SHORT[a.getMonth()]}. ${a.getDate()}.`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}.` : `${HU_SHORT[b.getMonth()]}. ${b.getDate()}.`;
  return `${left} – ${right}`;
}

function appUrl() {
  return location.origin + location.pathname.replace(/index\.html?$/i, '');
}

const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* nem baj */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* nem baj */ } }
};

/* ============================================================== backendek */

/** Bemutató mód: nincs Supabase, az adatok az oldal frissítéséig élnek. */
function demoBackend() {
  const mk = (name, email, role, order) => ({
    id: uuid(), name, email, color: '#5F6368', role,
    can_duty: role !== 'viewer', sort_order: order
  });
  const people = [
    mk('Vanda', 'vanda.buri@gmail.com', 'approver', 1),
    mk('Bálint', 'takacsbalint0202@gmail.com', 'duty', 2),
    mk('Peti', 'ppalotai4@gmail.com', 'duty', 3),
    mk('Barbi', 'barbara.kalanova@gmail.com', 'duty', 4),
    mk('Bandi', 'laandro3@gmail.com', 'duty', 5),
    mk('Viktor', 'szeker.viktor97@gmail.com', 'viewer', 6)
  ];
  const marks = new Map(), sched = new Map(), locks = new Map();
  let config = { week_mode: 'weeks' }, who = null;

  return {
    kind: 'demo',
    async signedIn() { return !!who; },
    async whoami() { return who; },
    async signIn(id) { who = people.find((p) => p.id === id) || null; },
    async signOut() { who = null; },
    async listPeople() { return people.slice().sort((a, b) => a.sort_order - b.sort_order); },
    async savePeople(rows, removed) {
      removed.forEach((id) => {
        const i = people.findIndex((p) => p.id === id);
        if (i >= 0) people.splice(i, 1);
        [...marks.keys()].filter((k) => k.startsWith(id + '|')).forEach((k) => marks.delete(k));
        [...sched.entries()].forEach(([d, p]) => { if (p === id) sched.delete(d); });
      });
      rows.forEach((r) => {
        const i = people.findIndex((p) => p.id === r.id);
        if (i >= 0) people[i] = { ...people[i], ...r }; else people.push({ ...r });
      });
      if (who) who = people.find((p) => p.id === who.id) || null;
    },
    async loadRange(from, to) {
      const inR = (d) => d >= from && d <= to;
      const m = {};
      marks.forEach((st, k) => { const [p, d] = k.split('|'); if (inR(d)) ((m[p] ||= {})[d] = st); });
      const s = {};
      sched.forEach((p, d) => { if (inR(d)) s[d] = p; });
      const l = {};
      locks.forEach((v, w) => { if (w >= from && w <= to) l[w] = v; });
      return { marks: m, schedule: s, locks: l };
    },
    async setMark(p, d, st) { const k = `${p}|${d}`; st ? marks.set(k, st) : marks.delete(k); },
    async setAssign(d, p) { p ? sched.set(d, p) : sched.delete(d); },
    async setAssignMany(list) { list.forEach(([d, p]) => (p ? sched.set(d, p) : sched.delete(d))); },
    async setLock(week, locked, by) {
      locks.set(week, { week, locked, locked_at: locked ? new Date().toISOString() : null, locked_by: by });
    },
    async getConfig() { return config; },
    async setConfig(patch) { config = { ...config, ...patch }; },
    subscribe() { return () => {}; }
  };
}

/** Éles mód: Supabase + Google belépés. */
async function supabaseBackend(url, key) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(url, key, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true, flowType: 'pkce' }
  });
  const ok = (res) => { if (res.error) throw new Error(res.error.message); return res.data; };

  return {
    kind: 'supabase',
    sb,
    async signedIn() { return !!(await sb.auth.getSession()).data.session; },
    async email() { return (await sb.auth.getUser()).data.user?.email || null; },
    async whoami() { return ok(await sb.rpc('whoami'))?.[0] || null; },
    async signIn() {
      ok(await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: appUrl(), queryParams: { prompt: 'select_account' } }
      }));
    },
    async signOut() { await sb.auth.signOut(); },
    async listPeople() {
      return ok(await sb.from('people')
        .select('id,name,email,color,role,can_duty,sort_order').order('sort_order')) || [];
    },
    async savePeople(rows, removed) {
      if (removed.length) ok(await sb.from('people').delete().in('id', removed));
      if (rows.length) ok(await sb.from('people').upsert(rows, { onConflict: 'id' }));
    },
    async loadRange(from, to) {
      const [mk, sc, wk] = await Promise.all([
        sb.from('marks').select('person_id,day,state').gte('day', from).lte('day', to),
        sb.from('schedule').select('day,person_id').gte('day', from).lte('day', to),
        sb.from('weeks').select('week,locked,locked_at,locked_by').gte('week', from).lte('week', to)
      ]);
      const marks = {};
      (ok(mk) || []).forEach((r) => ((marks[r.person_id] ||= {})[r.day] = r.state));
      const schedule = {};
      (ok(sc) || []).forEach((r) => { if (r.person_id) schedule[r.day] = r.person_id; });
      const locks = {};
      (ok(wk) || []).forEach((r) => { locks[r.week] = r; });
      return { marks, schedule, locks };
    },
    async setMark(person, day, state) {
      if (!state) ok(await sb.from('marks').delete().eq('person_id', person).eq('day', day));
      else ok(await sb.from('marks').upsert({ person_id: person, day, state, updated_at: new Date().toISOString() },
        { onConflict: 'person_id,day' }));
    },
    async setAssign(day, person) {
      if (!person) ok(await sb.from('schedule').delete().eq('day', day));
      else ok(await sb.from('schedule').upsert({ day, person_id: person, updated_at: new Date().toISOString() },
        { onConflict: 'day' }));
    },
    async setAssignMany(list) {
      const up = list.filter(([, p]) => p).map(([day, person_id]) => ({ day, person_id, updated_at: new Date().toISOString() }));
      const del = list.filter(([, p]) => !p).map(([day]) => day);
      if (del.length) ok(await sb.from('schedule').delete().in('day', del));
      if (up.length) ok(await sb.from('schedule').upsert(up, { onConflict: 'day' }));
    },
    async setLock(week, locked, by) {
      ok(await sb.from('weeks').upsert({
        week, locked,
        locked_at: locked ? new Date().toISOString() : null,
        locked_by: locked ? by : null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'week' }));
    },
    async getConfig() {
      return ok(await sb.from('app_config').select('week_mode').eq('id', 1).maybeSingle()) || { week_mode: 'weeks' };
    },
    async setConfig(patch) {
      ok(await sb.from('app_config').upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' }));
    },
    subscribe(cb) {
      const ch = sb.channel('ugyelet').on('postgres_changes', { event: '*', schema: 'public' }, cb).subscribe();
      return () => sb.removeChannel(ch);
    }
  };
}

/* ================================================================= állapot */

const S = {
  phase: 'loading',           // loading | setup | signin | blocked | board
  backend: null, demo: false, error: null, setup: null,
  authEmail: null,
  people: [], me: null,
  cursor: new Date(),
  weekMode: 'weeks',
  mode: 'assign',             // véglegesítőnek: assign | mark
  marks: {}, schedule: {}, locks: {},
  days: [], pending: 0, lastSync: null,
  collapsed: {},              // hét → be van-e csukva (alapból a véglegesített)
  dialog: null, draft: null, toastTimer: null
};

const byId = (id) => S.people.find((p) => p.id === id) || null;
/** Az ügyeletbe bevonható emberek, adatbázis-sorrendben. A számozás alapja. */
const roster = () => S.people.filter((p) => p.role !== 'viewer' && p.can_duty !== false);
const numOf = (id) => { const i = roster().findIndex((p) => p.id === id); return i < 0 ? null : i + 1; };
const approver = () => S.people.find((p) => p.role === 'approver') || null;
const isApprover = () => S.me?.role === 'approver';
const isViewer = () => S.me?.role === 'viewer';
const canMark = () => !!S.me && S.me.role !== 'viewer' && S.me.can_duty !== false;
const markOf = (pid, day) => S.marks[pid]?.[day] || null;

const weekKey = (day) => iso(mondayOf(fromISO(day)));
const lockedWeek = (weekISO) => !!S.locks[weekISO]?.locked;
const dayLocked = (day) => lockedWeek(weekKey(day));
/** A mai naphoz képest a következő hét hétfője – ez kap kiemelést. */
const nextWeekKey = () => iso(addDays(mondayOf(today()), 7));
/** A véglegesített hetek alapból össze vannak csukva. */
const isCollapsed = (w) => S.collapsed[w] ?? lockedWeek(w);

function recomputeDays() {
  S.days = monthDays(S.cursor.getFullYear(), S.cursor.getMonth(), S.weekMode);
}

/** A hónap napjai heti bontásban. */
function weekBlocks() {
  const out = [];
  for (let i = 0; i < S.days.length; i += 7) {
    const days = S.days.slice(i, i + 7);
    out.push({ key: iso(days[0]), days });
  }
  return out;
}

/* ================================================================ indulás */

async function boot() {
  render();

  const url = new URL(location.href);
  const wantDemo = url.searchParams.has('demo') || CFG.DEMO === true;
  const hasUrl = /^https?:\/\/.+/i.test(CFG.SUPABASE_URL || '');
  const hasKey = (CFG.SUPABASE_ANON_KEY || '').length > 20;

  if (!hasUrl || !hasKey) {
    if (!wantDemo) { S.phase = 'setup'; S.setup = { hasUrl, hasKey }; return render(); }
    S.backend = demoBackend();
    S.demo = true;
    S.people = await S.backend.listPeople();
    S.phase = 'signin';
    return render();
  }

  try {
    S.backend = await supabaseBackend(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  } catch (e) {
    S.error = 'Nem sikerült betölteni a Supabase könyvtárat: ' + (e.message || e);
    S.phase = 'signin';
    return render();
  }

  const authError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (authError) {
    S.error = String(authError).replace(/\+/g, ' ');
    history.replaceState({}, '', appUrl());
  }

  if (!(await S.backend.signedIn())) {
    if (!S.error && !session.get('sso.tried')) {
      session.set('sso.tried', String(Date.now()));
      S.phase = 'loading';
      render();
      try { return await S.backend.signIn(); } catch (e) { S.error = e.message || String(e); }
    }
    S.phase = 'signin';
    return render();
  }

  session.del('sso.tried');
  if (url.searchParams.has('code')) history.replaceState({}, '', appUrl());

  try {
    S.authEmail = S.backend.email ? await S.backend.email() : null;
    S.me = await S.backend.whoami();
    if (!S.me) { S.phase = 'blocked'; return render(); }

    const [people, config] = await Promise.all([S.backend.listPeople(), S.backend.getConfig()]);
    S.people = people;
    S.weekMode = config?.week_mode || 'weeks';
    S.mode = S.me.role === 'approver' ? 'assign' : 'mark';
    recomputeDays();
    await loadMonth();
    S.phase = 'board';
    render();
    startSync();
  } catch (e) {
    S.error = e.message || String(e);
    S.phase = S.me ? 'board' : 'blocked';
    render();
  }
}

async function loadMonth(silent) {
  if (!S.days.length) recomputeDays();
  try {
    const data = await S.backend.loadRange(iso(S.days[0]), iso(S.days[S.days.length - 1]));
    S.marks = data.marks; S.schedule = data.schedule; S.locks = data.locks || {};
    S.lastSync = new Date(); S.error = null;
  } catch (e) {
    if (!silent) S.error = e.message || String(e);
  }
  if (silent) render();
}

function startSync() {
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(() => loadMonth(true), 400); };
  try { S.backend.subscribe(refresh); } catch { /* marad a lekérdezés */ }
  setInterval(() => { if (!document.hidden) loadMonth(true); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadMonth(true); });
}

async function save(fn) {
  S.pending++; render();
  try { await fn(); S.lastSync = new Date(); }
  catch (e) { toast('Nem sikerült menteni: ' + (e.message || e)); await loadMonth(true); }
  finally { S.pending--; render(); }
}

/* ============================================================== műveletek */

function cycleOwnMark(day) {
  if (dayLocked(day) || !canMark()) return;
  setOwnMark(day, CYCLE[(CYCLE.indexOf(markOf(S.me.id, day)) + 1) % CYCLE.length]);
}

function setOwnMark(day, state) {
  if (dayLocked(day) || !canMark()) return;
  const bag = (S.marks[S.me.id] ||= {});
  state ? (bag[day] = state) : delete bag[day];
  save(() => S.backend.setMark(S.me.id, day, state));
}

function cycleAssign(day) {
  const order = [
    ...roster().filter((p) => markOf(p.id, day) === 'yes'),
    ...roster().filter((p) => markOf(p.id, day) === 'maybe'),
    ...roster().filter((p) => !markOf(p.id, day))
  ];
  if (!order.length) { toast('Erre a napra mindenki nemet mondott – nyisd meg a napot a kézi beosztáshoz'); return; }
  const cur = S.schedule[day] || null;
  const at = order.findIndex((p) => p.id === cur);
  const next = at < 0 ? order[0] : (order[at + 1] || null);
  setAssign(day, next ? next.id : null);
}

function setAssign(day, personId) {
  if (dayLocked(day) || !isApprover()) return;
  personId ? (S.schedule[day] = personId) : delete S.schedule[day];
  save(() => S.backend.setAssign(day, personId));
}

/** Üres napok kitöltése a nyitott hetekben. */
function autofill(onlyWeek) {
  const counts = {};
  roster().forEach((p) => { counts[p.id] = Object.values(S.schedule).filter((x) => x === p.id).length; });
  const changes = [];
  let prev = null;
  for (const d of S.days) {
    const day = iso(d);
    if (onlyWeek && weekKey(day) !== onlyWeek) continue;
    if (dayLocked(day)) { prev = S.schedule[day] || null; continue; }
    if (S.schedule[day]) { prev = S.schedule[day]; continue; }
    const yes = roster().filter((p) => markOf(p.id, day) === 'yes');
    const maybe = roster().filter((p) => markOf(p.id, day) === 'maybe');
    const pool = yes.length ? yes : maybe;
    if (!pool.length) { prev = null; continue; }
    const sorted = pool.slice().sort((a, b) => counts[a.id] - counts[b.id]);
    const pick = sorted.find((p) => p.id !== prev) || sorted[0];
    S.schedule[day] = pick.id; counts[pick.id]++; prev = pick.id;
    changes.push([day, pick.id]);
  }
  if (!changes.length) { toast('Nincs kitölthető nap'); return; }
  save(() => S.backend.setAssignMany(changes));
  toast(`${changes.length} nap kitöltve – nézd át, mielőtt véglegesíted`);
}

function clearWeek(weekISO) {
  if (lockedWeek(weekISO)) return;
  const list = S.days.map(iso).filter((d) => weekKey(d) === weekISO && S.schedule[d]).map((d) => [d, null]);
  if (!list.length) return;
  if (!confirm('Törlöd a hét beosztását? A jelölések megmaradnak.')) return;
  list.forEach(([d]) => delete S.schedule[d]);
  save(() => S.backend.setAssignMany(list));
}

async function toggleWeekLock(weekISO, lock) {
  const days = S.days.filter((d) => weekKey(iso(d)) === weekISO);
  if (lock) {
    const empty = days.filter((d) => !S.schedule[iso(d)]).length;
    if (empty && !confirm(`${empty} nap még üres ezen a héten. Így is véglegesíted?`)) return;
  } else if (!confirm('Feloldod a hét véglegesítését? Utána újra lehet jelölni és kiosztani.')) return;

  S.locks[weekISO] = { week: weekISO, locked: lock, locked_at: lock ? new Date().toISOString() : null, locked_by: S.me.id };
  await save(() => S.backend.setLock(weekISO, lock, S.me.id));
  delete S.collapsed[weekISO];      // visszaáll az alapértelmezésre: zárva = csukva
  if (lock) toast('Hét véglegesítve – a Naptárba gombbal küldheted el magadnak');
}

/* ==================================================== naptárba küldés */

/** A hét beosztott napjai. Minden nap külön esemény, mert időpontos. */
function shiftsOf(weekISO, personId) {
  return S.days
    .filter((d) => weekKey(iso(d)) === weekISO)
    .map(iso)
    .filter((day) => S.schedule[day] && (!personId || S.schedule[day] === personId))
    .map((day) => ({ day, person: S.schedule[day] }));
}

const stampAt = (day, hour) => `${day.replace(/-/g, '')}T${pad(hour)}0000`;
const shiftText = (day) => {
  const d = fromISO(day);
  return `${DOW[dowIdx(d)]}, ${huDate(d)} ${SHIFT_FROM}:00–${SHIFT_TO}:00`;
};

/**
 * Google Naptár „esemény hozzáadása" link. Fájl nélkül működik, telefonon is:
 * megnyílik a naptár a kitöltött eseménnyel, egy koppintás a mentés.
 */
function gcalLink(sh) {
  const p = byId(sh.person);
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Ügyelet – ${p ? p.name : ''}`,
    dates: `${stampAt(sh.day, SHIFT_FROM)}/${stampAt(sh.day, SHIFT_TO)}`,
    ctz: TZ,
    details: `Ügyeleti beosztás, ${weekLabel(weekKey(sh.day))}.`
  });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
  .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 73) return line;
  let out = '', cur = '', len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > 71) { out += (out ? '\r\n ' : '') + cur; cur = ''; len = 0; }
    cur += ch; len += n;
  }
  return out + (out ? '\r\n ' : '') + cur;
}

/**
 * Sima, közzétett naptárfájl. Szándékosan nincs benne ORGANIZER/ATTENDEE és
 * METHOD:REQUEST: attól az iPhone meghívónak nézi a fájlt, és nem engedi
 * egyszerű eseményként hozzáadni.
 */
function buildICS(weekISO, personId) {
  const list = shiftsOf(weekISO, personId);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ugyeleti tabla//HU',
             'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
             `X-WR-CALNAME:${icsEsc('Ügyelet ' + weekLabel(weekISO))}`,
             // Az időzóna leírása nélkül egyes naptárak eltolva mutatnák az órákat.
             'BEGIN:VTIMEZONE', `TZID:${TZ}`, `X-LIC-LOCATION:${TZ}`,
             'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
             'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
             'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
             'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
             'END:VTIMEZONE'];

  for (const sh of list) {
    const p = byId(sh.person);
    if (!p) continue;
    L.push('BEGIN:VEVENT',
      `UID:ugyelet-${sh.day}-${slug(p.name)}@ugyeleti-tabla`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TZ}:${stampAt(sh.day, SHIFT_FROM)}`,
      `DTEND;TZID=${TZ}:${stampAt(sh.day, SHIFT_TO)}`,
      `SUMMARY:${icsEsc('Ügyelet – ' + p.name)}`,
      `DESCRIPTION:${icsEsc('Ügyeleti beosztás, ' + weekLabel(weekISO) + '.')}`,
      'TRANSP:OPAQUE', 'STATUS:CONFIRMED',
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY',
      `DESCRIPTION:${icsEsc('Ma este ügyelet: ' + p.name)}`, 'END:VALARM',
      'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

function downloadICS(weekISO, personId) {
  const ics = buildICS(weekISO, personId);
  if (!ics.includes('BEGIN:VEVENT')) { toast('Nincs mit letölteni'); return; }
  const p = personId ? byId(personId) : null;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ugyelet-${weekISO}${p ? '-' + slug(p.name) : ''}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* =========================================================== megjelenítés */

function toast(msg) {
  clearTimeout(S.toastTimer);
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  S.toastTimer = setTimeout(() => t.remove(), 3600);
}

function render() {
  const app = el('app');
  if (S.phase === 'loading') { app.innerHTML = `<div class="loading">Belépés…</div>`; return; }
  if (S.phase === 'setup')   { app.innerHTML = setupScreen(); return; }
  if (S.phase === 'signin')  { app.innerHTML = signinScreen(); return; }
  if (S.phase === 'blocked') { app.innerHTML = blockedScreen(); return; }
  const focused = document.activeElement?.closest?.('.cell')?.dataset.day;
  app.innerHTML = boardScreen();
  if (focused) app.querySelector(`.cell[data-day="${focused}"]`)?.focus();
  renderDialog();
}

const GOOGLE_ICON = `<svg class="gicon" viewBox="0 0 48 48" aria-hidden="true">
<path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-3.9H24v7.1h12c-.2 1.9-1.5 4.7-4.4 6.6l6.7 5.2c4-3.7 6.7-9.1 6.7-15z"/>
<path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 40.3 15.4 46 24 46z"/>
<path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z"/>
<path fill="#EA4335" d="M24 10.2c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4 29.9 2 24 2 15.4 2 8 7.7 4.4 14.1l7.1 5.5C13.3 14.3 18.2 10.2 24 10.2z"/></svg>`;

function setupScreen() {
  const { hasUrl, hasKey } = S.setup || {};
  return `<div class="gate">
    <h1>Hiányzik a kapcsolat</h1>
    <p>Az <b>assets/config.js</b> még nincs kitöltve, ezért nincs mihez csatlakozni,
      és a Google-belépés sem indul el.</p>
    <div class="blocked">
      SUPABASE_URL: ${hasUrl ? 'megvan' : '<b>hiányzik</b>'}<br>
      SUPABASE_ANON_KEY: ${hasKey ? 'megvan' : '<b>hiányzik</b>'}
    </div>
    <p class="small">A két érték a Supabase felületén, a Project Settings → API alatt található.
      Adatbázis nélkül kipróbálni <a href="?demo=1">bemutató módban</a> lehet.</p>
  </div>`;
}

function signinScreen() {
  if (S.demo) {
    return `<div class="gate">
      <h1>Ügyeleti tábla</h1>
      <p>Bemutató mód: a Google-belépés helyett válaszd ki, kinek a szemével nézed.
        Az adatok az oldal frissítéséig élnek.</p>
      <div class="picker">${S.people.map((p) => `
        <button class="opt" data-act="demo-in" data-id="${p.id}">
          <b class="badge">${numOf(p.id) ?? '·'}</b>
          <span class="nm">${esc(p.name)}</span>
          <span class="st">${ROLE_LABEL[p.role]}</span>
        </button>`).join('')}</div>
    </div>`;
  }
  return `<div class="gate">
    <h1>Ügyeleti tábla</h1>
    <p>A belépés Google-fiókkal történik. Csak a névsorban szereplő címek tudnak belépni.</p>
    ${S.error ? `<div class="blocked">${esc(S.error)}</div>` : ''}
    <button class="btn btn-primary" data-act="signin">${GOOGLE_ICON} Belépés Google-fiókkal</button>
  </div>`;
}

function blockedScreen() {
  return `<div class="gate">
    <h1>Nincs hozzáférés</h1>
    <div class="blocked">A <b>${esc(S.authEmail || 'megadott')}</b> fiók nem szerepel a névsorban.
      Ha ez tévedés, a véglegesítő tudja felvenni a címet.</div>
    <button class="btn" data-act="signout">Belépés másik fiókkal</button>
  </div>`;
}

function boardScreen() {
  const myNum = numOf(S.me.id);
  const viewer = isViewer();

  return `
  <div class="top">
    <div class="brand">Ügyeleti tábla ${S.demo ? '<span>· bemutató</span>' : ''}</div>
    <div class="spacer"></div>
    <span class="user" title="${esc(S.me.email || '')}">
      ${myNum ? `<b class="badge">${myNum}</b>` : ''}${esc(S.me.name)}
      <em>${ROLE_LABEL[S.me.role] || ''}</em>
    </span>
    ${isApprover() ? '<button class="btn btn-sm btn-quiet" data-act="settings">Névsor</button>' : ''}
    <button class="btn btn-sm btn-quiet" data-act="signout">Kilépés</button>
  </div>

  <div class="monthbar">
    <button class="arrow" data-act="prev" aria-label="Előző hónap">&#8249;</button>
    <button class="arrow" data-act="next" aria-label="Következő hónap">&#8250;</button>
    <div class="month"><b>${S.cursor.getFullYear()}.</b> ${HU_MONTH[S.cursor.getMonth()]}</div>
    <button class="btn btn-sm btn-quiet" data-act="today">Mai hónap</button>
    ${viewer ? '' : `<span class="sync">${S.pending ? 'mentés…' : (S.lastSync
      ? 'frissítve ' + S.lastSync.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : '')}
      <button class="btn btn-sm btn-quiet" data-act="refresh">Frissítés</button></span>`}
  </div>

  ${S.error ? `<div class="blocked">${esc(S.error)}</div>` : ''}

  ${viewer ? '' : toolbarHTML()}

  <div class="weeks">${weekBlocks().map(weekHTML).join('')}</div>

  ${viewer ? '' : barHTML()}`;
}

function weekHTML(w) {
  const locked = lockedWeek(w.key);
  const isNext = w.key === nextWeekKey();
  const viewer = isViewer();
  const closed = isCollapsed(w.key);
  const lock = S.locks[w.key];
  const filled = w.days.filter((d) => S.schedule[iso(d)]).length;

  const actions = viewer ? '' : (locked
    ? `<button class="btn btn-sm" data-act="export" data-week="${w.key}">Naptárba</button>
       ${isApprover() ? `<button class="btn btn-sm btn-quiet" data-act="unlock" data-week="${w.key}">Feloldás</button>` : ''}`
    : (isApprover()
        ? `<button class="btn btn-sm btn-quiet" data-act="wfill" data-week="${w.key}">Javaslat</button>
           <button class="btn btn-sm btn-quiet" data-act="wclear" data-week="${w.key}">Ürítés</button>
           <button class="btn btn-sm btn-primary" data-act="lock" data-week="${w.key}">Véglegesítés</button>`
        : ''));

  const body = closed ? '' : `
    <div class="hrow">${DOW_ABBR.map((d, i) => `<div class="${i > 4 ? 'we' : ''}">${d}</div>`).join('')}</div>
    <div class="grid">${w.days.map((d) => cellHTML(d, locked)).join('')}</div>`;

  return `<section class="week ${isNext ? 'is-next' : ''} ${locked ? 'is-locked' : ''} ${closed ? 'is-closed' : ''}">
    <header class="whead">
      <button class="wtoggle" data-act="toggle-week" data-week="${w.key}"
          aria-expanded="${!closed}" title="${closed ? 'Kinyitás' : 'Összecsukás'}">
        <span class="chev" aria-hidden="true">&#9662;</span>
        <span class="wname">${weekLabel(w.key)}</span>
      </button>
      ${isNext ? '<span class="tag tag-next">következő hét</span>' : ''}
      ${locked ? `<span class="tag tag-lock">véglegesítve${lock?.locked_by && byId(lock.locked_by)
        ? ' · ' + esc(byId(lock.locked_by).name) : ''}</span>` : ''}
      <span class="spacer"></span>
      ${viewer ? '' : `<span class="wnote">${filled}/7 nap</span>`}
      ${actions}
    </header>
    ${body}
  </section>`;
}

function cellHTML(d, locked) {
  const day = iso(d);
  const inMonth = d.getMonth() === S.cursor.getMonth();
  const usable = S.weekMode === 'weeks' || inMonth;
  const person = byId(S.schedule[day]);
  const mine = S.me ? markOf(S.me.id, day) : null;
  const isToday = day === iso(today());
  const viewer = isViewer();

  const marks = viewer ? '' : roster().map((p, i) => {
    const st = markOf(p.id, day);
    return `<i class="mk ${st || ''} ${p.id === S.me.id ? 'me' : ''}"
      title="${i + 1}. ${esc(p.name)}: ${st ? STATE_LABEL[st] : 'nem jelölt'}">${i + 1}</i>`;
  }).join('');

  const cls = ['cell'];
  if (dowIdx(d) > 4) cls.push('we');
  if (!usable) cls.push('out');
  if (isToday) cls.push('today');
  if (locked) cls.push('locked');

  return `<button class="${cls.join(' ')}" data-day="${day}" ${usable ? '' : 'disabled'}
      title="${DOW[dowIdx(d)]}, ${huDate(d)}">
    <span class="date"><b>${d.getDate()}</b>${!inMonth ? `<i>${HU_SHORT[d.getMonth()]}</i>` : ''}
      <em class="dow">${DOW[dowIdx(d)]}</em></span>
    ${person ? `<span class="who"><b class="badge">${numOf(person.id) ?? '·'}</b><span>${esc(person.name)}</span></span>`
             : '<span class="who empty"></span>'}
    ${viewer ? '' : `<span class="marks">${usable ? marks : ''}</span>`}
  </button>`;
}

/** Fejléc alatti sáv: módváltó, névsor-számok és a színek jelentése. */
function toolbarHTML() {
  return `<div class="toolbar">
    ${isApprover() ? `<span class="seg">
      <button class="${S.mode === 'assign' ? 'on' : ''}" data-act="mode" data-v="assign">Mindenki beosztása</button>
      <button class="${S.mode === 'mark' ? 'on' : ''}" data-act="mode" data-v="mark">Saját jelölés</button>
    </span>` : ''}
    <div class="roster">${rosterHTML()}</div>
    <div class="legend">
      <span><i style="background:var(--yes)"></i>ráér</span>
      <span><i style="background:var(--maybe)"></i>ha muszáj</span>
      <span><i style="background:var(--no)"></i>nem ér rá</span>
      <span><i style="background:var(--none)"></i>nem jelölt</span>
    </div>
  </div>`;
}

function rosterHTML() {
  return roster().map((p, i) => {
    const n = S.days.filter((d) => S.schedule[iso(d)] === p.id).length;
    return `<span class="rperson ${p.id === S.me.id ? 'is-me' : ''}">
      <b class="badge">${i + 1}</b><span class="nm">${esc(p.name)}</span>
      <span class="n">${n} nap</span></span>`;
  }).join('');
}

function barHTML() {
  const hint = isApprover()
    ? 'Beosztás módban a kattintás lépteti az aznapi ügyeletest; a véglegesítés hetenként, a hét fejlécében történik.'
    : (canMark()
        ? 'Kattints egy napra: ráér → ha muszáj → nem ér rá → üres. Hosszú nyomás a nap részleteihez.'
        : 'Megtekintő nézet.');
  return `<div class="bar"><span class="hint">${hint}</span></div>`;
}

/* ---------------------------------------------------------------- ablakok */

function renderDialog(force) {
  const root = el('modal-root');
  if (!S.dialog) { root.innerHTML = ''; return; }
  if (isViewer() && S.dialog.kind !== 'settings') { S.dialog = null; root.innerHTML = ''; return; }
  if (S.dialog.kind === 'settings' && !force && root.querySelector('.dialog')) return;
  root.innerHTML = S.dialog.kind === 'settings' ? settingsDialog()
    : S.dialog.kind === 'export' ? exportDialog() : dayDialog();
}

function dayDialog() {
  const day = S.dialog.day;
  const d = fromISO(day);
  const locked = dayLocked(day);
  const mayMark = !locked && canMark();
  const canAssign = !locked && isApprover();

  const states = mayMark ? `
    <div class="sub">Az én jelölésem</div>
    <div class="states">
      ${[['yes', 'Ráér'], ['maybe', 'Ha muszáj'], ['no', 'Nem ér rá'], ['', 'Törlés']].map(([v, l]) => `
        <button class="btn btn-sm ${(markOf(S.me.id, day) || '') === v ? 'on' : ''}" data-act="mark" data-v="${v}">
          ${v ? `<i style="background:${STATE_COLOR[v]}"></i>` : ''}${l}</button>`).join('')}
    </div>` : '';

  const list = roster().map((p, i) => {
    const st = markOf(p.id, day);
    const on = S.schedule[day] === p.id;
    return `<button class="opt ${on ? 'on' : ''}" data-act="assign" data-id="${p.id}" ${canAssign ? '' : 'disabled'}>
      <b class="badge">${i + 1}</b><span class="nm">${esc(p.name)}</span>
      <span class="st">${st ? `<i style="background:${STATE_COLOR[st]}"></i>${STATE_LABEL[st]}` : 'nem jelölt'}</span>
    </button>`;
  }).join('');

  return `<div class="overlay" data-act="close-bg"><div class="dialog" role="dialog" aria-modal="true">
    <div class="dhead"><h2>${DOW[dowIdx(d)]}, ${huDate(d)}</h2>
      <button class="x" data-act="close" aria-label="Bezárás">&times;</button></div>
    <div class="dbody">
      ${locked ? '<div class="hintbox">Ez a hét véglegesítve van, ezért nem módosítható.</div>' : ''}
      ${states}
      <div class="sub">${canAssign ? 'Kire osztod?' : 'Jelölések'}</div>
      ${list}
      ${canAssign ? `<button class="opt" data-act="assign" data-id="">
        <b class="badge">–</b><span class="nm">Nincs beosztva</span></button>` : ''}
    </div>
  </div></div>`;
}

/**
 * Naptárba küldés. Elsődlegesen linkkel, mert az minden telefonon működik;
 * a fájl csak másodlagos lehetőség.
 */
function exportDialog() {
  const week = S.dialog.week;
  const mine = S.me ? shiftsOf(week, S.me.id) : [];

  const row = (sh) => `<div class="exrow">
      <span class="nm">${esc(shiftText(sh.day))}</span>
      <a class="btn btn-sm btn-primary" href="${gcalLink(sh)}" target="_blank" rel="noopener">Naptárba</a>
    </div>`;

  return `<div class="overlay" data-act="close-bg"><div class="dialog" role="dialog" aria-modal="true">
    <div class="dhead"><h2>Az én ügyeleteim – ${weekLabel(week)}</h2>
      <button class="x" data-act="close" aria-label="Bezárás">&times;</button></div>
    <div class="dbody">
      ${mine.length ? `
        ${mine.map(row).join('')}
        <div class="sub">Fájlként</div>
        <div class="states">
          <button class="btn btn-sm" data-act="ics" data-week="${week}">Az én napjaim (.ics)</button>
        </div>
        <p class="small">Asztali Google Naptárba és Outlookba importálható.
          iPhone-on a Naptárba gomb a megbízhatóbb.</p>`
        : '<p class="small">Ezen a héten nincs ügyeleted.</p>'}
    </div>
  </div></div>`;
}

function settingsDialog() {
  const d = S.draft;
  const num = (i) => d.people[i].role === 'viewer' ? '·'
    : d.people.filter((q, j) => j < i && q.role !== 'viewer').length + 1;
  const row = (p, i) => `
    <div class="prow">
      <span class="badge">${num(i)}</span>
      <input type="text" value="${esc(p.name)}" data-f="name" data-i="${i}" placeholder="Név">
      <input type="email" value="${esc(p.email || '')}" data-f="email" data-i="${i}" placeholder="google e-mail cím">
      <select data-f="role" data-i="${i}" aria-label="Szerep">
        <option value="duty" ${p.role === 'duty' ? 'selected' : ''}>ügyelő</option>
        <option value="approver" ${p.role === 'approver' ? 'selected' : ''}>véglegesítő</option>
        <option value="viewer" ${p.role === 'viewer' ? 'selected' : ''}>megtekintő</option>
      </select>
      <button class="rm" data-act="rm-person" data-i="${i}" aria-label="Törlés">&times;</button>
    </div>`;

  return `<div class="overlay" data-act="close-bg"><div class="dialog wide" role="dialog" aria-modal="true">
    <div class="dhead"><h2>Névsor és beállítások</h2>
      <button class="x" data-act="close" aria-label="Bezárás">&times;</button></div>
    <div class="dbody">
      <div class="hintbox">A belépés az itt megadott Google-címekhez van kötve: aki nincs a listán,
        be sem tud lépni. A sorrend adja a naptárban látszó sorszámokat.</div>
      ${d.people.map(row).join('')}
      <button class="btn btn-sm" data-act="add-person">+ Új személy</button>
      <p class="small">Véglegesítőből pontosan egy legyen. A megtekintő csak a kész beosztást látja.</p>

      <div class="sub">Hónap nézete</div>
      <select data-f="weekMode">
        <option value="weeks" ${d.weekMode === 'weeks' ? 'selected' : ''}>Teljes hetek a hónap első hétfőjétől</option>
        <option value="calendar" ${d.weekMode === 'calendar' ? 'selected' : ''}>Naptári hónap, teljes hetekre kiegészítve</option>
      </select>
    </div>
    <div class="dfoot">
      <button class="btn btn-quiet" data-act="close">Mégsem</button>
      <button class="btn btn-primary" data-act="save-settings">Mentés</button>
    </div>
  </div></div>`;
}

function openSettings() {
  S.draft = { people: S.people.map((p) => ({ ...p })), weekMode: S.weekMode, removed: [] };
  S.dialog = { kind: 'settings' };
  renderDialog(true);
}

async function saveSettings() {
  const d = S.draft;
  const rows = [];
  d.people.forEach((p, i) => {
    if (!p.name.trim() || !p.email?.trim()) { if (S.people.some((q) => q.id === p.id)) d.removed.push(p.id); return; }
    const role = p.role || 'duty';
    rows.push({
      id: p.id, name: p.name.trim(), email: p.email.trim().toLowerCase(),
      color: p.color || '#5F6368', role, can_duty: role !== 'viewer', sort_order: i + 1
    });
  });
  if (rows.filter((r) => r.role === 'approver').length !== 1) { toast('Pontosan egy véglegesítő legyen'); return; }
  if (rows.length < 2) { toast('Legalább két embert adj meg'); return; }
  const removed = d.removed.filter((id) => S.people.some((p) => p.id === id));
  if (removed.length && !confirm('A törölt emberek jelölései és beosztott napjai is elvesznek. Folytatod?')) return;

  try {
    await S.backend.savePeople(rows, removed);
    if (d.weekMode !== S.weekMode) { await S.backend.setConfig({ week_mode: d.weekMode }); S.weekMode = d.weekMode; }
    S.people = await S.backend.listPeople();
    S.me = (await S.backend.whoami()) || S.me;
    if (!byId(S.me.id)) { await S.backend.signOut(); location.reload(); return; }
    S.dialog = null; S.draft = null;
    recomputeDays();
    await loadMonth();
    render();
    toast('Mentve');
  } catch (e) {
    toast('Nem sikerült menteni: ' + (e.message || e));
  }
}

/* ================================================================ események */

function openDay(day) { S.dialog = { kind: 'day', day }; renderDialog(true); }

function onClick(e) {
  const bg = e.target.closest('[data-act="close-bg"]');
  if (bg && e.target === bg) { S.dialog = null; S.draft = null; renderDialog(); return; }
  if (e.target.closest('a[href]')) return;

  const btn = e.target.closest('[data-act]');
  if (btn) {
    const act = btn.dataset.act, id = btn.dataset.id, week = btn.dataset.week;
    switch (act) {
      case 'signin': S.backend.signIn().catch((err) => { S.error = err.message; render(); }); return;
      case 'demo-in': demoSignIn(id); return;
      case 'signout': doSignOut(); return;
      case 'prev': step(-1); return;
      case 'next': step(1); return;
      case 'today': S.cursor = new Date(); recomputeDays(); render(); loadMonth(true); return;
      case 'refresh': loadMonth(true); return;
      case 'settings': openSettings(); return;
      case 'close': S.dialog = null; S.draft = null; renderDialog(); return;
      case 'mode': S.mode = btn.dataset.v; render(); return;
      case 'wfill': autofill(week); return;
      case 'wclear': clearWeek(week); return;
      case 'lock': toggleWeekLock(week, true); return;
      case 'unlock': toggleWeekLock(week, false); return;
      case 'export': S.dialog = { kind: 'export', week }; renderDialog(true); return;
      case 'toggle-week': S.collapsed[week] = !isCollapsed(week); render(); return;
      case 'ics': downloadICS(week, S.me.id); return;
      case 'add-person':
        S.draft.people.push({ id: uuid(), name: '', email: '', color: '#5F6368', role: 'duty', can_duty: true });
        renderDialog(true);
        document.querySelectorAll('[data-f="name"]')[S.draft.people.length - 1]?.focus();
        return;
      case 'rm-person': {
        const p = S.draft.people.splice(Number(btn.dataset.i), 1)[0];
        if (p) S.draft.removed.push(p.id);
        renderDialog(true); return;
      }
      case 'save-settings': saveSettings(); return;
      case 'mark': setOwnMark(S.dialog.day, btn.dataset.v || null); renderDialog(true); return;
      case 'assign': setAssign(S.dialog.day, id || null); S.dialog = null; renderDialog(); return;
    }
  }

  const cell = e.target.closest('.cell');
  if (cell && !cell.disabled && !cell.dataset.lp) {
    const day = cell.dataset.day;
    if (isViewer()) return;
    if (dayLocked(day)) return openDay(day);
    if (isApprover() && S.mode === 'assign') cycleAssign(day);
    else if (canMark()) cycleOwnMark(day);
    else openDay(day);
  }
}

function step(n) {
  S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + n, 1);
  recomputeDays(); render(); loadMonth(true);
}

async function demoSignIn(id) {
  S.dialog = null; S.draft = null;
  await S.backend.signIn(id);
  S.me = await S.backend.whoami();
  S.people = await S.backend.listPeople();
  S.weekMode = (await S.backend.getConfig()).week_mode;
  S.mode = S.me.role === 'approver' ? 'assign' : 'mark';
  recomputeDays();
  await loadMonth();
  S.phase = 'board';
  render();
}

async function doSignOut() {
  S.dialog = null; S.draft = null;
  await S.backend.signOut();
  session.del('sso.tried');
  if (S.demo) { S.phase = 'signin'; S.me = null; return render(); }
  location.href = appUrl();
}

let pressTimer = null, pressCell = null;
function onPointerDown(e) {
  const cell = e.target.closest('.cell');
  if (!cell || cell.disabled || isViewer()) return;
  pressCell = cell;
  pressTimer = setTimeout(() => {
    cell.dataset.lp = '1';
    openDay(cell.dataset.day);
    navigator.vibrate?.(10);
  }, 450);
}
function endPress() {
  clearTimeout(pressTimer);
  if (pressCell) { const c = pressCell; pressCell = null; setTimeout(() => delete c.dataset.lp, 60); }
}

function onInput(e) {
  const f = e.target.dataset.f;
  if (!f || !S.draft) return;
  if (f === 'weekMode') { S.draft.weekMode = e.target.value; return; }
  const p = S.draft.people[Number(e.target.dataset.i)];
  if (p) p[f] = e.target.value;
}

document.addEventListener('click', onClick);
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);
document.addEventListener('pointerdown', onPointerDown);
document.addEventListener('pointerup', endPress);
document.addEventListener('pointercancel', endPress);
document.addEventListener('pointermove', endPress);
document.addEventListener('contextmenu', (e) => {
  const cell = e.target.closest('.cell');
  if (cell && !cell.disabled && !isViewer()) { e.preventDefault(); openDay(cell.dataset.day); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.dialog) { S.dialog = null; S.draft = null; renderDialog(); return; }
  if (S.dialog || S.phase !== 'board') return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});

boot();
