// Exposed so pages that render admin-only controls dynamically (e.g. a
// per-row Delete button built after an async ledger fetch) can check the
// role themselves instead of racing this file's one-shot DOM cleanup below,
// which only catches elements already in the document when it runs.
window.AaralAuth = (function () {
  let userPromise = null;
  function getUser() {
    if (!userPromise) {
      userPromise = fetch('/api/auth/me').then((r) => r.json()).then((d) => d.user);
    }
    return userPromise;
  }
  return { getUser };
})();

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

(async function () {
  const user = await window.AaralAuth.getUser();
  if (!user) return;

  if (user.role !== 'admin') {
    document.querySelectorAll('[data-admin-only]').forEach((el) => el.remove());
  }

  const card = document.getElementById('profileCard');
  if (!card) return;
  card.querySelector('#profileAvatar').textContent = initials(user.displayName);
  card.querySelector('#profileName').textContent = user.displayName;
  card.querySelector('#profileRole').textContent = user.role;
  card.style.display = 'flex';

  const logoutBtn = card.querySelector('#navLogoutBtn');
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  initWhatsAppBadge(user);
})();

// ── WhatsApp connection badge ───────────────────────────────────
// Lives in this shared file so every page gets it without 12 separate edits.
// Styles are inlined deliberately: styles.css is cached by sw.js, so editing it
// requires bumping CACHE_NAME and reloading twice before changes appear — a
// trap this file is not subject to, since the service worker never intercepts
// it.
//
// Why this exists at all: staff previously had no way to know WhatsApp was
// down until a send failed, and no way to fix it without someone connecting to
// the office PC remotely. Now the state is always visible, and the common
// failure has a one-click fix that needs no phone.
function initWhatsAppBadge(user) {
  const isAdmin = user.role === 'admin';

  const style = document.createElement('style');
  style.textContent = `
    #waBadge{position:fixed;right:16px;bottom:16px;z-index:9998;display:flex;align-items:center;gap:8px;
      padding:8px 14px;border-radius:999px;font:600 13px/1 'IBM Plex Sans',system-ui,sans-serif;
      cursor:pointer;border:1px solid transparent;box-shadow:0 2px 10px rgba(33,17,85,.14);
      background:#fff;color:#211155;transition:opacity .2s}
    #waBadge .dot{width:9px;height:9px;border-radius:50%;flex:none}
    #waBadge[data-state="connected"]{opacity:.6;font-weight:500}
    #waBadge[data-state="connected"]:hover{opacity:1}
    #waBadge[data-state="connected"] .dot{background:#1a9e5f}
    #waBadge[data-state="starting"]{border-color:#e0a800;background:#fff8e6}
    #waBadge[data-state="starting"] .dot{background:#e0a800;animation:waPulse 1.2s infinite}
    #waBadge[data-state="qr"],#waBadge[data-state="disconnected"],#waBadge[data-state="unreachable"]{
      border-color:#c62828;background:#fdecec;color:#8e1b1b}
    #waBadge[data-state="qr"] .dot,#waBadge[data-state="disconnected"] .dot,
    #waBadge[data-state="unreachable"] .dot{background:#c62828}
    @keyframes waPulse{0%,100%{opacity:1}50%{opacity:.35}}
    #waPanelWrap{position:fixed;inset:0;z-index:9999;background:rgba(33,17,85,.45);
      display:flex;align-items:center;justify-content:center;padding:20px}
    #waPanel{background:#fff;border-radius:14px;max-width:440px;width:100%;padding:24px;
      font:400 14px/1.55 'IBM Plex Sans',system-ui,sans-serif;color:#211155;
      box-shadow:0 18px 50px rgba(33,17,85,.3);max-height:90vh;overflow:auto}
    #waPanel h3{margin:0 0 4px;font:700 18px/1.3 'Space Grotesk','IBM Plex Sans',sans-serif}
    #waPanel .sub{color:#5c5470;margin:0 0 18px}
    #waPanel .err{background:#fdecec;color:#8e1b1b;padding:9px 12px;border-radius:8px;
      font-size:12.5px;word-break:break-word;margin:0 0 14px;font-family:'IBM Plex Mono',monospace}
    #waPanel button{font:600 14px/1 'IBM Plex Sans',sans-serif;padding:11px 16px;border-radius:8px;
      cursor:pointer;border:none;width:100%;margin-top:8px}
    #waPanel .primary{background:#0093d9;color:#fff}
    #waPanel .ghost{background:#f2f0ea;color:#211155}
    #waPanel .danger{background:#fff;color:#8e1b1b;border:1px solid #e5b4b4}
    #waPanel button:disabled{opacity:.55;cursor:default}
    #waPanel img.qr{display:block;width:250px;height:250px;margin:14px auto;border-radius:8px}
  `;
  document.head.appendChild(style);

  const badge = document.createElement('div');
  badge.id = 'waBadge';
  badge.innerHTML = '<span class="dot"></span><span class="label">WhatsApp</span>';
  badge.addEventListener('click', openPanel);
  document.body.appendChild(badge);

  let latest = { state: 'starting' };

  // What the shop actually needs to know, in plain language. "reconnecting
  // automatically" matters most: it is what stops someone reaching for the
  // destructive re-pair button during a repair that would have finished by
  // itself.
  function describe(s) {
    if (!s.reachable && s.state === 'unreachable') {
      return { label: 'WhatsApp service down', detail: 'The WhatsApp service is not running on this PC. It normally restarts by itself within a minute.' };
    }
    if (s.recovering || s.state === 'starting') {
      return { label: 'WhatsApp reconnecting…', detail: 'The connection dropped and is being repaired automatically. This usually takes under a minute — nothing to do.' };
    }
    if (s.state === 'connected') {
      return { label: `WhatsApp connected${s.number ? ` · ${s.number}` : ''}`, detail: 'Everything is working. Invoices, receipts and quotations can be sent.' };
    }
    if (s.state === 'qr') {
      return { label: 'WhatsApp needs scanning', detail: 'WhatsApp has been unlinked and needs to be paired again. Open the panel and scan the code with the phone.' };
    }
    return { label: 'WhatsApp disconnected', detail: 'WhatsApp is not connected. Try Repair below — it does not need the phone.' };
  }

  async function refresh() {
    try {
      const res = await fetch('/api/whatsapp/status', { signal: AbortSignal.timeout(8000) });
      latest = await res.json();
    } catch (e) {
      latest = { reachable: false, state: 'unreachable', reason: e.message };
    }
    const state = !latest.reachable ? 'unreachable' : (latest.recovering ? 'starting' : latest.state);
    badge.dataset.state = state;
    badge.querySelector('.label').textContent = describe(latest).label;
    if (document.getElementById('waPanel')) renderPanel();
  }

  function openPanel() {
    if (document.getElementById('waPanelWrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'waPanelWrap';
    wrap.innerHTML = '<div id="waPanel"></div>';
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById('waPanel');
    if (!panel) return;
    const d = describe(latest);
    const busy = latest.recovering === true;

    panel.innerHTML = `
      <h3>${d.label}</h3>
      <p class="sub">${d.detail}</p>
      ${latest.lastError ? `<p class="err">${escapeHtml(latest.lastError)}</p>` : ''}
      ${latest.contractMismatch ? '<p class="err">Version mismatch: the dashboard and the WhatsApp service are from different releases. Finish the update before relying on this.</p>' : ''}
      <div id="waQrSlot"></div>
      <button class="primary" id="waRepairBtn" ${busy ? 'disabled' : ''}>
        ${busy ? 'Repairing…' : 'Repair connection'}
      </button>
      ${isAdmin ? '<button class="danger" id="waResetBtn">Re-pair with a phone (needs QR scan)</button>' : ''}
      <button class="ghost" id="waCloseBtn">Close</button>
    `;

    panel.querySelector('#waCloseBtn').onclick = () => document.getElementById('waPanelWrap').remove();

    panel.querySelector('#waRepairBtn').onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Repairing… (may take a minute)';
      await fetch('/api/whatsapp/repair', { method: 'POST' }).catch(() => {});
      await refresh();
    };

    const resetBtn = panel.querySelector('#waResetBtn');
    if (resetBtn) {
      // Two-step, no native confirm(): this throws away the pairing, and
      // recovering from a mis-click needs whoever holds the client's phone.
      resetBtn.onclick = async (e) => {
        if (e.target.dataset.armed !== '1') {
          e.target.dataset.armed = '1';
          e.target.textContent = 'Sure? This unlinks the phone — click again';
          return;
        }
        e.target.disabled = true;
        e.target.textContent = 'Re-pairing…';
        await fetch('/api/whatsapp/repair-full', { method: 'POST' }).catch(() => {});
        await refresh();
      };
    }

    if (latest.state === 'qr') loadQr();
  }

  async function loadQr() {
    const slot = document.getElementById('waQrSlot');
    if (!slot) return;
    try {
      const data = await (await fetch('/api/whatsapp/qr')).json();
      if (data.ok && data.dataUrl && document.getElementById('waQrSlot')) {
        document.getElementById('waQrSlot').innerHTML =
          `<img class="qr" src="${data.dataUrl}" alt="WhatsApp pairing QR code">
           <p class="sub" style="text-align:center;margin:0 0 6px">On the phone: WhatsApp → Settings → Linked devices → Link a device</p>`;
      }
    } catch (e) { /* the panel is still useful without the code */ }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  refresh();
  setInterval(refresh, 30000);
}
