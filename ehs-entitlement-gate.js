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
  const SUPABASE_STORAGE_KEY = 'sb-rqvcbjomrjccyuchxpuh-auth-token';
  const ACCESS_KEY = 'defidev_ehs_access_token';
  const REFRESH_KEY = 'defidev_ehs_refresh_token';
  const WORK_KEY = `defidev_ehs_selected_werk_${productId}`;
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
    #defidevEhsLicenseGate input,#defidevEhsLicenseGate select{width:100%;box-sizing:border-box;border:1px solid #bfcadb;border-radius:10px;padding:12px;font:inherit;background:#fff;color:#172033}
    #defidevEhsLicenseGate button{width:100%;border:0;border-radius:10px;padding:12px 14px;margin-top:12px;font:inherit;font-weight:700;background:#2457c5;color:#fff;cursor:pointer}
    #defidevEhsLicenseGate button.secondary{background:#eef3fb;color:#26364f}
    #defidevEhsLicenseGate .status{font-size:13px;min-height:20px;margin-top:10px}
    #defidevEhsLicenseGate .price{font-weight:800;color:#172033}
    #defidevEhsLicenseGate .small{font-size:12px}
    #defidevEhsReadBanner{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;background:#172033;color:#fff;border-radius:12px;padding:10px 14px;font:600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.18);text-align:center}
    html[data-defidev-ehs-mode="read"] input:disabled,html[data-defidev-ehs-mode="read"] textarea:disabled,html[data-defidev-ehs-mode="read"] select:disabled{opacity:.72;cursor:not-allowed}
  `;
  document.head.appendChild(style);

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeJson = async response => {
    try { return await response.json(); } catch { return {}; }
  };
  const headers = token => ({
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });
  const decodeJwt = token => {
    try {
      const part = token.split('.')[1];
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      return JSON.parse(atob(padded));
    } catch { return {}; }
  };
  const syncSupabaseStorage = (token, user, refreshToken = '') => {
    if (!token || !user?.id) return;
    const jwt = decodeJwt(token);
    const expiresAt = Number(jwt.exp || 0);
    const now = Math.floor(Date.now() / 1000);
    const session = {
      access_token: token,
      token_type: 'bearer',
      expires_in: Math.max(0, expiresAt - now),
      expires_at: expiresAt,
      refresh_token: refreshToken || localStorage.getItem(REFRESH_KEY) || '',
      user,
    };
    try { localStorage.setItem(SUPABASE_STORAGE_KEY, JSON.stringify(session)); } catch {}
  };
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
    if (payload?.access_token && payload?.user) {
      syncSupabaseStorage(payload.access_token, payload.user, payload.refresh_token || '');
    }
  };
  const clearSession = () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(SUPABASE_STORAGE_KEY);
    localStorage.removeItem(WORK_KEY);
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
    if (!user?.id) return null;
    syncSupabaseStorage(activeToken, user);
    return { user, token: activeToken };
  };
  const getModuleAccess = async auth => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-ehs-entitlements`, {
      method: 'GET',
      headers: headers(auth.token),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await safeJson(response);
    if (!Array.isArray(payload?.modules)) return null;
    const access = payload.modules.find(item => item?.productId === productId);
    return access?.active ? access : null;
  };

  const lockReaderControls = () => {
    document.querySelectorAll('input,textarea,select,[contenteditable="true"]').forEach(el => {
      if (el.closest('#defidevEhsLicenseGate')) return;
      if (el.matches('input[type="search"],input[role="searchbox"]')) return;
      if (el.matches('[contenteditable="true"]')) {
        el.setAttribute('contenteditable', 'false');
        el.setAttribute('aria-readonly', 'true');
      } else {
        el.disabled = true;
        el.setAttribute('aria-disabled', 'true');
      }
    });
    const mutating = /(speichern|save|löschen|loeschen|delete|entfernen|remove|erstellen|create|hochladen|upload|import|freigeben|approve|ablehnen|reject|bearbeiten|edit|update|hinzufügen|hinzufuegen|\badd\b|senden|submit)/i;
    document.querySelectorAll('button,[role="button"]').forEach(el => {
      if (el.closest('#defidevEhsLicenseGate')) return;
      const text = [el.id, el.className, el.getAttribute('name'), el.getAttribute('title'), el.getAttribute('aria-label'), el.textContent]
        .filter(Boolean).join(' ');
      if (!mutating.test(text)) return;
      if ('disabled' in el) el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
      el.style.pointerEvents = 'none';
      el.style.opacity = '.55';
    });
  };
  const accessForWerk = (access, selectedWerk) => {
    if (!selectedWerk) return access;
    return {
      ...access,
      mode: selectedWerk.seatType === 'editor' ? 'edit' : 'read',
      selectedWerk,
    };
  };
  const applyAccessMode = (access, selectedWerk = null) => {
    const effective = accessForWerk(access, selectedWerk);
    const mode = effective?.mode === 'read' ? 'read' : 'edit';
    document.documentElement.dataset.defidevEhsMode = mode;
    globalThis.DefiDevEHSAccess = Object.freeze({
      productId,
      mode,
      sources: Array.isArray(effective?.sources) ? [...effective.sources] : [],
      works: Array.isArray(effective?.works) ? effective.works.map(w => ({ ...w })) : [],
      selectedWerk: selectedWerk ? { ...selectedWerk } : null,
      organizationId: selectedWerk?.organizationId || null,
    });
    if (mode !== 'read') return effective;
    const addBanner = () => {
      if (document.getElementById('defidevEhsReadBanner')) return;
      const banner = document.createElement('div');
      banner.id = 'defidevEhsReadBanner';
      banner.textContent = `Firmenlizenz · Lesemodus${selectedWerk?.name ? ` · ${selectedWerk.name}` : ''} — Änderungen sind für diesen Benutzer gesperrt.`;
      document.body.appendChild(banner);
    };
    lockReaderControls();
    addBanner();
    const observer = new MutationObserver(() => lockReaderControls());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('submit', event => {
      if (!event.target.closest('#defidevEhsLicenseGate')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    return effective;
  };

  const reveal = (access, selectedWerk = null) => {
    document.getElementById('defidevEhsLicenseGate')?.remove();
    document.documentElement.classList.remove(CLASS);
    const effective = applyAccessMode(access, selectedWerk);
    window.dispatchEvent(new CustomEvent('defidev-ehs-entitlement-ready', {
      detail: {
        productId,
        entitled: true,
        mode: effective?.mode || 'edit',
        sources: effective?.sources || [],
        works: effective?.works || [],
        selectedWerk: selectedWerk ? { ...selectedWerk } : null,
        organizationId: selectedWerk?.organizationId || null,
      },
    }));
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
  const chooseWerk = access => {
    const works = Array.isArray(access?.works) ? access.works.filter(w => w?.id && w?.organizationId) : [];
    if (!works.length) {
      reveal(access, null);
      return;
    }
    const storedId = localStorage.getItem(WORK_KEY) || '';
    const stored = works.find(w => String(w.id) === storedId);
    if (works.length === 1 || stored) {
      const selected = stored || works[0];
      localStorage.setItem(WORK_KEY, String(selected.id));
      reveal(access, selected);
      return;
    }
    const root = gate();
    root.innerHTML = `<div class="ehs-card">
      <h1>${moduleTitle}</h1>
      <p>Dieses Konto hat Zugriff auf mehrere Werke. Bitte wählen Sie das Werk, dessen Daten Sie öffnen möchten.</p>
      <label for="defidevEhsWerkSelect">Werk</label>
      <select id="defidevEhsWerkSelect">
        ${works.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name || w.code || 'Werk')}${w.code ? ` · ${escapeHtml(w.code)}` : ''}${w.seatType === 'reader' ? ' · Leser' : ' · Bearbeiter'}</option>`).join('')}
      </select>
      <button type="button" id="defidevEhsWerkOpen">Werk öffnen</button>
      <button type="button" class="secondary" id="defidevEhsLogout">Abmelden</button>
      <div class="status">Die Auswahl gilt nur für dieses EHS-Modul und kann durch Abmelden zurückgesetzt werden.</div>
    </div>`;
    root.querySelector('#defidevEhsWerkOpen')?.addEventListener('click', () => {
      const id = String(root.querySelector('#defidevEhsWerkSelect')?.value || '');
      const selected = works.find(w => String(w.id) === id);
      if (!selected) return;
      localStorage.setItem(WORK_KEY, String(selected.id));
      reveal(access, selected);
    });
    root.querySelector('#defidevEhsLogout')?.addEventListener('click', () => { clearSession(); setGateContent('login'); });
  };
  const setGateContent = (mode, text = '') => {
    const root = gate();
    if (mode === 'login') {
      root.innerHTML = `<div class="ehs-card">
        <h1>${moduleTitle}</h1>
        <p>Dieses Modul ist Teil von <b>DefiDev EHS</b> und benötigt eine aktive Einzel- oder Firmenlizenz.</p>
        <form id="defidevEhsLoginForm">
          <label for="defidevEhsEmail">E-Mail</label><input id="defidevEhsEmail" type="email" autocomplete="email" required>
          <label for="defidevEhsPassword">Passwort</label><input id="defidevEhsPassword" type="password" autocomplete="current-password" required>
          <button type="submit">Anmelden und Lizenz prüfen</button>
        </form>
        <div class="status" id="defidevEhsStatus">${text}</div>
        <p class="small">Einzelabos werden in der DefiDev-EHS-Android-App über Google Play abgeschlossen. Firmen-/Werk-Lizenzen werden zentral zugewiesen.</p>
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
      <p>Für dieses Modul wurde keine aktive Einzel- oder Firmenlizenz gefunden.</p>
      <p class="price">Einzelabo Deutschland: 4,99 € / Monat</p>
      <p>Ein Einzelabo kann in der DefiDev-EHS-Android-App über Google Play abgeschlossen werden. Firmenzugänge werden durch die Werk-Administration zugewiesen.</p>
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
    const access = await getModuleAccess(auth);
    if (access) chooseWerk(access);
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
