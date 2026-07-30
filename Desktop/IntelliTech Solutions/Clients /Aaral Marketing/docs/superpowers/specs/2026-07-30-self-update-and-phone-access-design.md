# Aaral Marketing — Self-Update Mechanism + Phone PWA Access Design

## Problem

Aaral's dashboard/whatsapp-bot/watchdog will soon run unattended on the
client's real office PC (deployment via `deploy/windows-server-setup.ps1`,
already built). Every future code change currently requires Vansh to take
TeamViewer control of that machine. The client wants:

1. A self-service way to pull and apply updates without TeamViewer.
2. Phone access for the owner (iPhone) that feels like an installed app,
   not just a bookmarked browser tab.

The client is described as technically sophisticated and expects the
mechanism to be genuinely robust, not just working in the happy path —
this design is written with that bar in mind: every failure mode below
(power loss mid-update, concurrent triggers, visible windows on a
service that must show nothing) is handled explicitly, not left as a
known gap.

## Non-goals

- No staged/canary rollout — one office PC, one environment.
- No down-migrations — migrations stay additive-only (already the
  existing convention: `002_add_destination.sql`,
  `006_add_manual_payment_methods.sql`); rollback reverts *code* to the
  previous commit, which is safe against a schema that's slightly ahead,
  since old code simply ignores columns it doesn't know about. A
  destructive migration would break this and must be deployed manually
  instead — this convention must hold going forward.
- No offline mode and no live-push data updates (e.g. a payment
  appearing without a refresh) for the phone PWA. It's the same
  dashboard, reached the same way, just installable — not a new
  real-time layer. A genuine "live ticker" is a different, separate ask.
- No full user-login system. A single admin PIN gates a small set of
  sensitive actions (see **Access control**); staff-level accounts are
  out of scope.
- No separate mobile-only UI. The iPhone gets the exact same dashboard,
  installed via Safari's "Add to Home Screen," not a rebuilt lightweight
  view.

## Architecture

```
GitHub (private)
└── aaral-marketing-deploy/          (new repo — deploy target only)
    ├── dashboard/
    ├── whatsapp-bot/
    ├── watchdog/
    └── payment-ledger-core/          (vendored copy, not a path dependency)

Office PC (Windows, PM2-as-a-Service, no visible window ever)
├── aaral-dashboard   (PM2)  — Express app, gets an "Updates" panel + admin PIN
├── aaral-bridge      (PM2)  — WhatsApp bot, unchanged by this design
└── aaral-watchdog    (PM2)  — gains the update-orchestrator role
    ├── local-only HTTP endpoints: /update/check, /update/apply, /update/status
    └── .update-lock.json           (mutex + power-loss recovery marker)
```

`aaral-marketing-deploy` is a **new, dedicated private repo** — not the
existing home-directory mega-repo, which contains every other client's
code and personal files and can never be pulled onto a client's machine.
Vansh maintains a small sync script on his own Mac (rsync-style copy of
just these four paths out of the mega-repo, excluding `node_modules`,
`.env`, `wa-sessions`, `logs`) that commits and pushes to this repo,
optionally tagged (`v1.3.0`), whenever he wants to cut a release. This
becomes the reusable pattern for future clients' self-update needs too.

**Why watchdog orchestrates, not dashboard:** dashboard is one of the
things being replaced/restarted mid-update. An update process living
inside dashboard risks being killed by its own `pm2 restart`. Watchdog
is never touched by an update, so it can drive the whole sequence and
independently verify the other two apps came back healthy. Dashboard's
"Updates" panel is a thin proxy: it calls watchdog's local endpoints and
polls status, it does not run git/npm itself.

## Update flow

**Check** (no changes made): watchdog does `git fetch` in its clone of
`aaral-marketing-deploy`, compares local `HEAD` to `origin/main`, reports
"up to date" or "vX.Y available, N commits behind" back to the dashboard
panel.

**Apply** (on explicit confirm, PIN-gated — see below):

1. Refuse if `.update-lock.json` already exists (an update is already
   running — see **Concurrency**).
2. Write `.update-lock.json`: previous commit hash, current step,
   timestamp.
3. `git pull` in the deploy clone.
4. `npm install` in `dashboard/`, `whatsapp-bot/`, `payment-ledger-core/`.
5. `npm run migrate` (dashboard + whatsapp-bot).
6. `pm2 restart aaral-dashboard aaral-bridge` (watchdog excluded — it's
   the one running this script).
7. Poll both apps for up to ~60s: PM2 status "online" + a lightweight
   `/health` hit on each.
8. **Success:** delete the lock file, WhatsApp-alert Vansh
   ("Aaral updated to vX.Y ✅"), dashboard panel shows success.
9. **Failure** (migration error, or apps unhealthy after 60s):
   `git reset --hard <previous commit>`, reinstall if needed, restart,
   re-verify health, delete the lock file, WhatsApp-alert either way
   ("Aaral update failed, rolled back to vX.Y" — or, if rollback itself
   fails, an urgent alert, since that's the one case that genuinely
   needs Vansh to remote in).

## Hardening

**Power-loss mid-update:** the lock file written in step 2 is the
recovery marker. If the PC loses power mid-update, the existing
BIOS-auto-recovery + PM2-service-resurrect design already brings
watchdog back up unattended. On startup, watchdog checks for a leftover
lock file and treats it as an interrupted update: automatically
completes the rollback path (step 9) using the commit hash recorded in
the lock file, then alerts Vansh ("update interrupted by power loss,
auto-recovered to vX.Y"). This is the single most likely real failure
mode on this machine (per the deploy plan's own outage requirement) and
is handled automatically, not left as a manual-fix gap.

**Concurrency:** the same lock file is a mutex. Since all office machines
hit one shared dashboard instance, a second Update click while one is
already running is rejected with "update already in progress" — never
two overlapping attempts.

**No visible windows:** Windows Services run in Session 0, which has no
access to the interactive desktop, so spawned child processes (git, npm)
cannot paint a window there by construction. Every spawn call additionally
passes `windowsHide: true` as defense-in-depth. This gets a real manual
test (physically watch the screen through a triggered update) as part of
verification, not just trusted in theory.

**Update source auth:** a fine-grained GitHub PAT, read-only, scoped to
only `aaral-marketing-deploy`, stored in `watchdog/.env` (git-ignored,
same existing pattern as every other secret in this project) — never
baked into `.git/config` in plaintext. Blast radius if the machine were
ever compromised: read-only access to one non-sensitive deploy repo.

## Access control

No login exists in the dashboard today (machine-locked license, not
per-user auth). Add a lightweight **admin PIN** prompt gating:

- Update (check is unguarded/read-only; apply requires the PIN)
- Opening Balance entry
- Add Customer

These three are the actions a technically sophisticated client would
expect locked down that are currently open to anyone with the bookmarked
URL. The PIN is checked server-side on the relevant API routes (hashed
storage, e.g. in `.env` or a small config table) — never a client-side-only
gate that dev tools could bypass.

## Phone PWA (iPhone-specific)

Client's phone is an iPhone; office machines are all Windows PCs/laptops
(no Android phone in scope, though the manifest-based approach happens to
also work there for free). iOS Safari's "Add to Home Screen" does **not**
require a service worker to install (unlike Android's Chrome install
banner) but does need iOS-specific meta tags to look right once installed:

- `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`,
  `apple-mobile-web-app-status-bar-style`
- `apple-touch-icon` (reusing the already-produced
  `dashboard/public/assets/aaral-logo-*.png` assets)
- A standard `manifest.json` (name, `theme_color` navy `#211155`,
  `background_color` concrete `#ece7dc`, `display: "standalone"`) for
  correctness and any future Android use, even though iOS doesn't
  strictly require it for install.
- A minimal service worker caching only static assets (CSS/JS/logo) —
  **never** API responses, since ledger balances must always be live.

No new backend, no separate sync layer: it's the same session hitting
the same server (over Tailscale off the office network, or LAN on it),
so data is identical to desktop by construction — there's only ever one
source of truth.

## Testing / verification (adds to the existing pre-go-live checklist)

- [ ] Interrupt an update by killing power mid-`npm install` — confirm
      auto-recovery on reboot with no manual fix needed
- [ ] Trigger Update from two browser tabs/machines at once — confirm the
      second is rejected, not run in parallel
- [ ] Watch the physical screen through a full update cycle — confirm
      zero visible windows/flashes
- [ ] Wrong PIN on Update / Opening Balance / Add Customer — confirm
      rejected server-side even with dev tools open and the client-side
      check bypassed
- [ ] Install the PWA on the client's actual iPhone over Tailscale, off
      the office wifi — confirm it opens as a standalone app (no Safari
      chrome) and data matches desktop live
- [ ] `Check for Updates` with no new commits — confirm it reports
      "up to date" and makes no changes
- [ ] A real update with a migration included — confirm it applies and
      the app comes back healthy within the 60s window
