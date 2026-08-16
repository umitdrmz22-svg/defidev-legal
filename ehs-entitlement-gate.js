'use strict';
(() => {
  const script = document.currentScript;
  const productId = script?.dataset?.productId || '';
  const moduleTitle = script?.dataset?.moduleTitle || 'EHS-Modul';
  const allowed = new Set([
    'ehs_ba_monthly',
    'ehs_fluchtplan_monthly',
    'ehs_brandschutzordnung_monthly',
    'ehs_gefahrstoffkataster_monthly',
    'ehs_dokumentmanagement_monthly',
    'ehs_unfallmanagement_monthly',
  ]);
  if (!allowed.has(productId)) {
    console.error('DefiDev EHS: invalid module product id');
    return;
  }

  const SUPABASE_URL = 'https://rqvcbjomrjccyuchxpuh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_iKh-ZfqV3iJpr_9b7SErEA_XhrqnSsY';
  const LEGACY = 'ehs_pro_monthly';
  const ACCESS_KEY = 'defidev_ehs_access_token';
  const REFRESH_KEY = 'defidev_ehs_refresh_token';
  const CLASS = 'defidev-ehs-license-checking';

  document.documentElement.classList.add(CLASS);
  const style = document.createElement('style');
  style.textContent = `
    html.${CLASS} body > *:not(#defidevEhsLicenseGate){visibility:hidden!important}
    #defidevEhsLicenseGate{visibility:visible!important;position:fixed;inset:0;z-index:2147483647;background:#f4f7fb;color:#172033;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
    #defidevEhsLicenseGate .ehs-card{visibility:visible!important;width:min(520px,100%);background:#fff;border:1px solid #dbe3ef;border-radius:22px;box-shadow:0 18px 60px rgba(25,40,70,.16);padding:24px;box-sizing:border-box}
    #defidevEhsLicenseGate h1{margin:0 0 8px;font-size:26px;line-height:1.2}
    #defidevEhsLicenseGate p{margin:8px 0;color:#526071;line-height:1.5}
    #defidevEhsLicenseGate label{display:block;margin:12px 0 4px;font-size:13px;font-weight:700}
    #defidevEhsLicenseGate input{width:100%;box-sizing:border-box;border:1px solid #bfcadb;border-radius:10px;padding:12px;font:inherit}
    #defidevEhsLicenseGate button{width:100%;border:0;border-radius:10px;padding:12px 14px;margin-top:12px;font:inherit;font-weight:700;background:#2457c5;color:#fff;cursor:pointer}
    #defidevEhsLicenseGate button.secondary{background:#eef3fb;color:#26364f}
    #defidevEhsLicenseGate .status{font-size:13px;min-height:20px;margin-top:10px}
    #defidevEhsLicenseGate .price{font-weight:800;color:#172033}
    #defidevEhsLicenseGate .small{font-size:12px}
  `;
  document.head.appendChild(style);

  const safeJson = async response => {
    try { return await response.json(); } catch { return {}; }
  };
  const headers = token => ({
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });
  const parseFragmentToken = () => {
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    const params = new URLSearchParams(raw);
    const token = params.get('ehs_token');
    if (!token) return '';
    localStorage.setItem(ACCESS_KEY, token);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return token;
  };
  const storeSession = payload => {
    if (payload?.access_token) localStorage.setItem(ACCESS_KEY, payload.access_token);
    if (payload?.refresh_token) localStorage.setItem(REFRESH_KEY, payload.refresh_token);
  };
  const clearSession = () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  };
  const refreshSession = async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY) || '';
    if (!refreshToken) return '';
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload.access_token) {
      clearSession();
      return '';
    }
    storeSession(payload);
    return payload.access_token;
  };
  const getUser = async token => {
    if (!token) return null;
    let activeToken = token;
    let response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: headers(activeToken) });
    if (response.status === 401) {
      activeToken = await refreshSession();
      if (!activeToken) return null;
      response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: headers(activeToken) });
    }
    if (!response.ok) return null;
    const user = await safeJson(response);
    return user?.id ? { user, token: activeToken } : null;
  };
  const isEntitled = row => {
    if (!row) return false;
    if (!['active', 'grace', 'canceled'].includes(row.status)) return false;
    if (!row.expires_at) return true;
    return Date.parse(row.expires_at) > Date.now();
  };
  const checkEntitlement = async auth => {
    const query = new URLSearchParams({
      select: 'product_id,status,expires_at',
      user_id: `eq.${auth.user.id}`,
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/ehs_subscriptions?${query}`, {
      headers: headers(auth.token),
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const rows = await safeJson(response);
    return Array.isArray(rows) && rows.some(row =>
      (row.product_id === productId || row.product_id === LEGACY) && isEntitled(row)
    );
  };
  const reveal = () => {
    document.getElementById('defidevEhsLicenseGate')?.remove();
    document.documentElement.classList.remove(CLASS);
    window.dispatchEvent(new CustomEvent('defidev-ehs-entitlement-ready', { detail: { productId, entitled: true } }));
  };
  const gate = () => {
    let root = document.getElementById('defidevEhsLicenseGate');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'defidevEhsLicenseGate';
    root.innerHTML = `<div class="ehs-card"><h1>${moduleTitle}</h1><p>Lizenz wird geprüft …</p><div class="status" role="status"></div></div>`;
    document.body.appendChild(root);
    return root;
  };
  const setGateContent = (mode, text = '') => {
    const root = gate();
    if (mode === 'login') {
      root.innerHTML = `<div class="ehs-card">
        <h1>${moduleTitle}</h1>
        <p>Dieses Modul ist Teil von <b>DefiDev EHS</b> und benötigt ein aktives Modul-Abonnement.</p>
        <form id="defidevEhsLoginForm">
          <label for="defidevEhsEmail">E-Mail</label><input id="defidevEhsEmail" type="email" autocomplete="email" required>
          <label for="defidevEhsPassword">Passwort</label><input id="defidevEhsPassword" type="password" autocomplete="current-password" required>
          <button type="submit">Anmelden und Lizenz prüfen</button>
        </form>
        <div class="status" id="defidevEhsStatus">${text}</div>
        <p class="small">Ein Abonnement wird ausschließlich in der DefiDev-EHS-Android-App über Google Play abgeschlossen.</p>
      </div>`;
      root.querySelector('#defidevEhsLoginForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        const status = root.querySelector('#defidevEhsStatus');
        if (status) status.textContent = 'Anmeldung wird geprüft …';
        const email = String(root.querySelector('#defidevEhsEmail')?.value || '').trim();
        const password = String(root.querySelector('#defidevEhsPassword')?.value || '');
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const payload = await safeJson(response);
        if (!response.ok || !payload.access_token) {
          if (status) status.textContent = 'Anmeldung fehlgeschlagen. E-Mail und Passwort prüfen.';
          return;
        }
        storeSession(payload);
        await verify(payload.access_token);
      });
      return;
    }
    root.innerHTML = `<div class="ehs-card">
      <h1>${moduleTitle}</h1>
      <p>Für dieses Modul wurde kein aktives Abonnement gefunden.</p>
      <p class="price">Startpreis Deutschland: 4,99 € / Monat</p>
      <p>Öffnen Sie die DefiDev-EHS-Android-App, um genau dieses Modul über Google Play zu abonnieren oder einen bestehenden Kauf wiederherzustellen.</p>
      <button type="button" id="defidevEhsRetry">Lizenz erneut prüfen</button>
      <button type="button" class="secondary" id="defidevEhsLogout">Abmelden</button>
      <div class="status">${text}</div>
    </div>`;
    root.querySelector('#defidevEhsRetry')?.addEventListener('click', () => verify(localStorage.getItem(ACCESS_KEY) || ''));
    root.querySelector('#defidevEhsLogout')?.addEventListener('click', () => { clearSession(); setGateContent('login'); });
  };
  const verify = async token => {
    gate();
    const auth = await getUser(token);
    if (!auth) {
      setGateContent('login');
      return;
    }
    localStorage.setItem(ACCESS_KEY, auth.token);
    const entitled = await checkEntitlement(auth);
    if (entitled) reveal();
    else setGateContent('locked');
  };

  const start = () => {
    gate();
    const token = parseFragmentToken() || localStorage.getItem(ACCESS_KEY) || '';
    verify(token).catch(error => {
      console.error('DefiDev EHS entitlement check failed', error);
      setGateContent('login', 'Lizenzprüfung konnte nicht abgeschlossen werden.');
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
