// Csak rövid életű kódot tartunk memóriában; a TOTP secret a szerveren marad.
export function mountOtp(panel, sb, config) {
  panel.innerHTML = `
    <div class="otp-symbol" aria-hidden="true">
      <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>
    </div>
    <h1>Egyszer használatos jelszó</h1>
    <p class="otp-description">Kattints a kódra a másoláshoz.</p>
    <button class="otp-code" type="button" disabled aria-label="Egyszer használatos kód másolása">
      <span class="otp-digits">••• •••</span>
      <span class="otp-copy-label">Kód betöltése…</span>
    </button>
    <div class="otp-expiry" aria-hidden="true">
      <span class="otp-dot"></span><span class="otp-countdown">Kapcsolódás…</span>
    </div>
    <div class="otp-track" aria-hidden="true"><div class="otp-progress"></div></div>
    <p class="otp-status" role="status" aria-live="polite"></p>
    <button class="btn otp-retry" type="button" hidden>Újrapróbálás</button>`;

  const button = panel.querySelector('.otp-code');
  const digits = panel.querySelector('.otp-digits');
  const copyLabel = panel.querySelector('.otp-copy-label');
  const countdown = panel.querySelector('.otp-countdown');
  const progress = panel.querySelector('.otp-progress');
  const status = panel.querySelector('.otp-status');
  const retry = panel.querySelector('.otp-retry');
  let code = '', period = 30, deadline = 0, wallDeadline = 0;
  let pending = false, stopped = false, paused = false, requestId = 0;
  let retryAt = 0, controller, copyTimer;
  const remaining = () => Math.min(deadline - performance.now(), wallDeadline - Date.now());

  function clearCode(label = 'Kód betöltése…') {
    code = '';
    button.disabled = true;
    digits.textContent = '••• •••';
    copyLabel.textContent = label;
    progress.style.transform = 'scaleX(0)';
    countdown.textContent = 'Frissítés…';
    panel.classList.remove('otp-expiring');
    clearTimeout(copyTimer);
  }

  async function refresh() {
    if (pending || stopped || paused || document.hidden) return;
    pending = true;
    const id = ++requestId;
    clearCode();
    status.textContent = '';
    retry.hidden = true;
    const requestController = new AbortController();
    controller = requestController;
    const signal = requestController.signal;
    const timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const { data, error } = await sb.auth.getSession();
      if (id !== requestId || stopped) return;
      if (error || !data.session) throw Object.assign(new Error(), { status: 401 });
      const started = performance.now();
      const response = await fetch(`${config.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: config.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json' },
        body: '{}', cache: 'no-store', signal
      });
      if (!response.ok) throw Object.assign(new Error(), { status: response.status });
      const result = await response.json();
      if (id !== requestId || stopped || paused || document.hidden) return;
      if (!/^\d{6}$/.test(result.code) || result.period !== 30 ||
          !Number.isFinite(result.serverTime) || !Number.isFinite(result.expiresAt) ||
          result.expiresAt <= result.serverTime || result.expiresAt - result.serverTime > 30000) {
        throw new Error('Invalid response');
      }
      // A teljes hálózati idő levonása konzervatív: lejárt kód nem marad másolható.
      const validFor = result.expiresAt - result.serverTime - (performance.now() - started);
      if (validFor <= 250) { retryAt = performance.now() + 500; return; }
      code = result.code;
      period = result.period;
      deadline = performance.now() + validFor;
      wallDeadline = Date.now() + validFor;
      digits.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
      copyLabel.textContent = 'Kattints a másoláshoz';
      button.disabled = false;
      status.textContent = 'A kód automatikusan frissül.';
      updateCountdown();
    } catch (error) {
      if (id !== requestId || stopped || paused) return;
      clearCode('A kód most nem érhető el');
      countdown.textContent = 'Nincs érvényes kód';
      const messages = {
        401: 'A munkamenet lejárt. Lépj ki, majd jelentkezz be újra.',
        403: 'Ezzel a fiókkal nincs hozzáférés az OTP-kódhoz.',
        404: 'Az OTP-szolgáltatás még nincs beállítva.',
        503: 'Az OTP-szolgáltatás még nincs beállítva.'
      };
      status.textContent = messages[error.status] || 'Nem sikerült betölteni a kódot. Hamarosan újrapróbáljuk.';
      retryAt = messages[error.status] ? Infinity : performance.now() + 5000;
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (id === requestId) pending = false;
    }
  }

  function updateCountdown() {
    const ms = remaining();
    countdown.textContent = `Új kód ${Math.max(0, Math.ceil(ms / 1000))} másodperc múlva`;
    progress.style.transform = `scaleX(${Math.max(0, Math.min(1, ms / (period * 1000)))})`;
    panel.classList.toggle('otp-expiring', ms < 5000);
  }

  function tick() {
    if (stopped || paused || document.hidden) return;
    if (code && remaining() <= 0) { clearCode(); retryAt = 0; }
    if (code) updateCountdown();
    else if (!pending && performance.now() >= retryAt) void refresh();
  }

  async function copy() {
    if (!code || remaining() <= 0) { tick(); return; }
    const value = code;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement('textarea');
        input.value = value;
        input.readOnly = true;
        input.className = 'clipboard-fallback';
        document.body.append(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
        } finally { input.remove(); button.focus(); }
      }
      if (stopped || code !== value || remaining() <= 0) return;
      copyLabel.textContent = 'Kimásolva ✓';
      status.textContent = 'A kód a vágólapra került.';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { if (code) copyLabel.textContent = 'Kattints a másoláshoz'; }, 2000);
    } catch {
      if (!stopped && code === value) status.textContent = 'A másolást a böngésző nem engedélyezte. Írd be a kijelzett kódot.';
    }
  }

  function suspend() {
    paused = true;
    ++requestId;
    controller?.abort();
    pending = false;
    clearCode();
    status.textContent = '';
  }
  function resume() {
    if (stopped) return;
    paused = false;
    retryAt = 0;
    tick();
  }
  function visibility() { document.hidden ? suspend() : resume(); }
  button.addEventListener('click', copy);
  retry.addEventListener('click', refresh);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
  const timer = setInterval(tick, 250);
  void refresh();
  return {
    destroy() {
      stopped = true;
      suspend();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', resume);
      button.removeEventListener('click', copy);
      retry.removeEventListener('click', refresh);
    }
  };
}
