// Egyetlen heti/személyi adatcsomag; a szűrők ezután csak helyben dolgoznak.
const FIELDS = ['yes', 'maybe', 'no', 'unmarked', 'assigned', 'weekday', 'weekend', 'eligible_days'];
const LABELS = { yes: 'Ráér', maybe: 'Ha muszáj', no: 'Nem ér rá', unmarked: 'Jelöletlen', weekday: 'Hétköznap', weekend: 'Hétvége' };
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = (n, digits = 0) => new Intl.NumberFormat('hu-HU', { maximumFractionDigits: digits }).format(n);
const parse = (s) => new Date(`${s}T12:00:00Z`);
const plus = (s, days) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const date = (s, year = false) => new Intl.DateTimeFormat('hu-HU', { ...(year ? { year: 'numeric' } : {}), month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parse(s));
const weekLabel = (s) => `${date(s, true)} – ${date(plus(s, 6))}`;
const zero = () => Object.fromEntries(FIELDS.map(k => [k, 0]));
const add = (a, b) => FIELDS.forEach(k => { a[k] += Number(b[k] || 0); });

export function calendarWeeks(weeks) {
  if (!weeks.length) return [];
  const out = [];
  for (let w = weeks[0]; w <= weeks[weeks.length - 1]; w = plus(w, 7)) out.push(w);
  return out;
}

export function summarize(data, from, to, person = '') {
  const weeks = data.weeks.filter(w => w >= from && w <= to);
  const allowed = new Set(weeks);
  const people = data.people.filter(p => !person || p.id === person);
  const ids = new Set(people.map(p => p.id));
  const rows = data.rows.filter(r => allowed.has(r.week) && ids.has(r.person_id));
  const total = zero();
  const weekly = new Map(weeks.map(week => [week, { week, participants: 0, ...zero() }]));
  for (const r of rows) {
    add(total, r);
    add(weekly.get(r.week), r);
    weekly.get(r.week).participants++;
  }
  return { weeks, people, rows, total, weekly: [...weekly.values()],
    average: rows.length ? (total.yes + total.maybe + total.no) / rows.length : null };
}

function legend(keys) {
  return `<div class="stats-legend">${keys.map(k => `<span><i class="stats-color-${k}"></i>${LABELS[k]}</span>`).join('')}</div>`;
}

function columns(summary, keys, availability = false) {
  const max = availability ? 7 : Math.max(1, ...summary.weekly.map(w => w.assigned));
  const unit = availability ? 'nap / fő' : 'ügyelet';
  const showYear = summary.weeks[0]?.slice(0, 4) !== summary.weeks.at(-1)?.slice(0, 4);
  return `<div class="stats-plot-scroll" tabindex="0" aria-label="${availability ? 'Heti ráérésjelölések' : 'Heti beosztások'}, vízszintesen görgethető">
    <div class="stats-columns" style="--columns:${summary.weeks.length}">
    ${summary.weekly.map(w => {
      const divisor = availability ? (w.participants || 1) : 1;
      const values = keys.map(k => `${LABELS[k]}: ${number(w[k] / divisor, 1)} ${unit}`).join('; ');
      const label = `${weekLabel(w.week)}. ${values}`;
      return `<div class="stats-column">
        <span class="stats-column-total">${number(availability ? (w.yes + w.maybe + w.no) / divisor : w.assigned, 1)}</span>
        <div class="stats-column-track" role="img" aria-label="${escape(label)}" title="${escape(label)}">
          ${keys.map(k => `<span class="stats-segment stats-color-${k}" style="height:${w[k] / divisor / max * 100}%"></span>`).join('')}
        </div><span class="stats-axis-date">${escape(date(w.week, showYear))}</span>
      </div>`;
    }).join('')}</div></div>`;
}

function detailTable(summary) {
  return `<details class="stats-details"><summary>Heti adatok táblázatban</summary>
    <div class="stats-table-scroll" tabindex="0" aria-label="Heti adatok"><table class="stats-data-table">
    <caption>Összes jelölés és beosztás a szűrt időszakban, darabszám</caption>
    <thead><tr><th scope="col">Hét</th>${['Ráér', 'Ha muszáj', 'Nem ér rá', 'Jelöletlen', 'Ügyelet', 'Ebből hétvége'].map(s => `<th scope="col">${s}</th>`).join('')}</tr></thead>
    <tbody>${summary.weekly.map(w => `<tr><th scope="row">${escape(weekLabel(w.week))}</th>${['yes', 'maybe', 'no', 'unmarked', 'assigned', 'weekend'].map(k => `<td>${number(w[k])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></details>`;
}

function heatmap(summary) {
  const cells = new Map(summary.rows.map(r => [`${r.person_id}|${r.week}`, r]));
  const showYear = summary.weeks[0]?.slice(0, 4) !== summary.weeks.at(-1)?.slice(0, 4);
  return `<div class="stats-table-scroll" tabindex="0" aria-label="Jelölési hőtérkép, vízszintesen görgethető">
    <table class="stats-heatmap"><caption class="stats-sr">Jelölt napok személyenként és hetente, 0–7 nap.</caption>
      <thead><tr><th scope="col">Név</th>${summary.weeks.map(w => `<th scope="col" title="${escape(weekLabel(w))}">${escape(date(w, showYear))}</th>`).join('')}</tr></thead>
      <tbody>${summary.people.map(p => `<tr><th scope="row">${escape(p.name)}</th>${summary.weeks.map(w => {
        const r = cells.get(`${p.id}|${w}`);
        const marked = r ? r.yes + r.maybe + r.no : null;
        const label = `${p.name} · ${weekLabel(w)}: ${r ? `${marked} jelölt nap; ráér: ${r.yes}, ha muszáj: ${r.maybe}, nem ér rá: ${r.no}, jelöletlen: ${r.unmarked}` : 'Nincs adat erre a hétre'}`;
        return `<td><button type="button" class="stats-heat-cell" data-level="${marked ?? 'empty'}" data-heat="${escape(label)}" aria-label="${escape(label)}">${marked ?? '–'}</button></td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div><p class="stats-heat-detail" id="stats-heat-detail" aria-live="polite">Válassz egy cellát a jelölések részleteihez. A sötétebb szín több jelölt napot jelent.</p>`;
}

function resultsHTML(summary) {
  const { total: t } = summary;
  const kpi = (key, label, value, detail) => `<article class="stats-kpi" data-kpi="${key}"><h2>${label}</h2><strong>${value}</strong><p>${detail}</p></article>`;
  return `<div class="stats-kpis">
    ${kpi('assigned', 'Beosztott napok', number(t.assigned), `${number(t.weekday)} hétköznap · ${number(t.weekend)} hétvége`)}
    ${kpi('yes', 'Ráér jelölések', number(t.yes), `Ha muszáj: ${number(t.maybe)} · Nem ér rá: ${number(t.no)}`)}
    ${kpi('average', 'Heti jelölési átlag', summary.average === null ? '–' : number(summary.average, 1), 'Jelölt nap / fő / hét · minden válasz')}
    ${kpi('unmarked', 'Jelöletlen napok', number(t.unmarked), `${number(t.eligible_days)} személy–napból nincs válasz`)}
  </div>
  ${!summary.rows.length ? '<div class="stats-empty"><h2>Nincs adat a kiválasztott szűréshez</h2><p>Válassz másik időszakot vagy személyt.</p></div>' : `
  <div class="stats-charts">
    <section class="stats-chart stats-chart-wide"><div class="stats-chart-heading"><h2>Heti ráérésjelölések</h2><p>Személyenkénti heti átlag, legfeljebb 7 nap. Az oszlop fölött a megjelölt napok száma látható.</p></div>
      ${legend(['yes', 'maybe', 'no', 'unmarked'])}${columns(summary, ['yes', 'maybe', 'no', 'unmarked'], true)}${detailTable(summary)}
    </section>
    <section class="stats-chart"><div class="stats-chart-heading"><h2>Heti beosztások</h2><p>A kiválasztott emberek ügyeletei, hétköznapi és hétvégi bontásban.</p></div>
      ${legend(['weekday', 'weekend'])}${columns(summary, ['weekday', 'weekend'])}
    </section>
    <section class="stats-chart"><div class="stats-chart-heading"><h2>Jelölési hőtérkép</h2><p>Hány napra érkezett válasz? A „Nem ér rá” is jelölésnek számít.</p></div>
      ${heatmap(summary)}
    </section>
  </div>`}`;
}

export function mountStats(root, load) {
  let disposed = false, busy = false, data, timeline, from = 0, to = 0, person = '';

  function renderResults() {
    const a = timeline[from], b = timeline[to];
    const result = summarize(data, a, b, person);
    root.querySelector('#stats-range-label').textContent = `${date(a, true)} – ${date(plus(b, 6), true)}`;
    root.querySelector('#stats-selection').textContent = `${result.weeks.length} véglegesített hét · ${result.people.length} ember`;
    root.querySelector('#stats-results').innerHTML = resultsHTML(result);
    for (const [id, index] of [['stats-from', from], ['stats-to', to]]) {
      const input = root.querySelector(`#${id}`);
      input.value = index;
      input.setAttribute('aria-valuetext', weekLabel(timeline[index]));
    }
    const slider = root.querySelector('.stats-slider');
    const max = Math.max(1, timeline.length - 1);
    slider.style.setProperty('--from', `${from / max * 100}%`);
    slider.style.setProperty('--to', `${to / max * 100}%`);
    slider.classList.toggle('stats-same-week', from === to);
  }

  function renderDashboard() {
    if (!data.weeks.length) {
      root.innerHTML = '<div class="stats-empty"><h1>Statisztika</h1><p>Még nincs véglegesített hét. A lezárt hetek adatai itt jelennek majd meg.</p></div>';
      return;
    }
    timeline = calendarWeeks(data.weeks);
    to = timeline.length - 1;
    // A legutolsó véglegesített hónap; az első megnyitáskor így rögtön van adat.
    from = timeline.findIndex(w => w.slice(0, 7) === timeline[to].slice(0, 7));
    const max = timeline.length - 1, closed = new Set(data.weeks);
    const step = Math.max(1, Math.ceil(max / 2));
    root.innerHTML = `<div class="stats-intro"><h1>Statisztika</h1><span>Csak véglegesített hetek</span></div>
      <section class="stats-filters" aria-label="Statisztika szűrői">
        <div class="stats-date-filter"><div class="stats-filter-title"><span>Időszak</span><output id="stats-range-label" for="stats-from stats-to"></output></div>
          <div class="stats-slider">
            <div class="stats-slider-rail"><div class="stats-slider-fill"></div></div>
            <input id="stats-from" type="range" min="0" max="${max}" value="${from}" step="1" aria-label="Kezdő hét" ${max === 0 ? 'disabled' : ''}>
            <input id="stats-to" type="range" min="0" max="${max}" value="${to}" step="1" aria-label="Záró hét" ${max === 0 ? 'disabled' : ''}>
          </div>
          <div class="stats-ticks" aria-hidden="true">${timeline.map((w, i) => `<span class="stats-tick ${closed.has(w) ? 'is-closed' : ''}" style="left:${max ? i / max * 100 : 0}%" title="${escape(weekLabel(w))} · ${closed.has(w) ? 'véglegesített' : 'nyitott'}">${i % step === 0 && max - i >= step / 2 || i === max ? `<small>${escape(date(w))}</small>` : ''}</span>`).join('')}</div>
          <div class="stats-range-actions"><span>Hetek kezdete: hétfő</span><button type="button" data-stats="all">Teljes időszak</button></div>
        </div>
        <div class="stats-person-filter"><label for="stats-person">Ember</label><select id="stats-person"><option value="">Mindenki</option>${data.people.map(p => `<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}</select></div>
      </section>
      <p class="stats-selection" id="stats-selection" role="status" aria-live="polite"></p>
      <div id="stats-results"></div>`;
    renderResults();
  }

  async function fetchData() {
    if (disposed || busy) return;
    busy = true;
    root.innerHTML = '<div class="stats-empty" role="status">Statisztika betöltése…</div>';
    try {
      const response = await load();
      if (disposed) return;
      data = { ...response, weeks: [...response.weeks].sort() };
      renderDashboard();
    } catch {
      if (!disposed) root.innerHTML = '<div class="stats-empty" role="alert"><h1>A statisztika nem tölthető be</h1><p>Próbáld újra néhány pillanat múlva.</p><button type="button" class="btn" data-stats="retry">Újrapróbálás</button></div>';
    } finally { busy = false; }
  }

  function input(event) {
    if (!data || !timeline) return;
    if (event.target.id === 'stats-from') from = Math.min(Number(event.target.value), to);
    else if (event.target.id === 'stats-to') to = Math.max(Number(event.target.value), from);
    else if (event.target.id === 'stats-person') person = event.target.value;
    else return;
    renderResults();
  }
  function heatDetail(event) {
    const cell = event.target.closest('[data-heat]');
    if (cell) root.querySelector('#stats-heat-detail').textContent = cell.dataset.heat;
  }
  function click(event) {
    const action = event.target.closest('[data-stats]')?.dataset.stats;
    if (action === 'retry') fetchData();
    if (action === 'all') { from = 0; to = timeline.length - 1; renderResults(); }
    heatDetail(event);
  }
  root.addEventListener('input', input);
  root.addEventListener('change', input);
  root.addEventListener('click', click);
  root.addEventListener('focusin', heatDetail);
  fetchData();
  return { destroy() {
    disposed = true;
    data = null;
    root.removeEventListener('input', input);
    root.removeEventListener('change', input);
    root.removeEventListener('click', click);
    root.removeEventListener('focusin', heatDetail);
    root.innerHTML = '';
  } };
}
