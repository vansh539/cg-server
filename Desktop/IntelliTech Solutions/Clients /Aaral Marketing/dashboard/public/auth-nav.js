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

(async function () {
  const user = await window.AaralAuth.getUser();
  if (!user) return;

  if (user.role !== 'admin') {
    document.querySelectorAll('[data-admin-only]').forEach((el) => el.remove());
  }

  const nav = document.querySelector('.hero-nav');
  if (!nav) return;
  const userBox = document.createElement('span');
  userBox.style.cssText = 'display:inline-flex;align-items:center;gap:0.6rem;margin-left:0.4rem;padding-left:0.8rem;border-left:1px solid rgba(255,255,255,0.18);';
  userBox.innerHTML = `
    <span style="color:rgba(255,255,255,0.6);font-size:0.82rem;">${user.displayName}</span>
    <button id="navLogoutBtn" type="button" style="background:none;border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.85);border-radius:999px;padding:0.4rem 0.9rem;font-size:0.78rem;font-weight:600;cursor:pointer;">Logout</button>
  `;
  nav.appendChild(userBox);
  document.getElementById('navLogoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
})();
