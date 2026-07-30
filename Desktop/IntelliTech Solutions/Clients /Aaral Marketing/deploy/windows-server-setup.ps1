<#
Aaral office-server setup — run on-site, section by section (not fully
unattended: BIOS/router/phone steps below can't be scripted and are marked
MANUAL). Goal: nothing ever visible on screen, survives a power outage with
zero human intervention, alerts the owner (not the client) if something
needs a human. Everything here becomes a real Windows Service, not a
startup script tied to a logged-in user — the PC can sit at the lock screen
forever and still run.

This box provisions from the dedicated `aaral-marketing-deploy` GitHub repo
(private — NOT the mega-repo), via `git clone`, not a manual folder copy.
That repo already vendors payment-ledger-core as a sibling directory, so
after cloning you get exactly:
  C:\AaralApp\
    dashboard\  whatsapp-bot\  watchdog\  payment-ledger-core\
This is also what makes the self-update feature (dashboard → Updates page)
work later — it's a `git pull` inside this same clone.
#>

# ── 1. Node + Git + PM2 ──────────────────────────────────────────
# Install Node LTS and Git for Windows first if not present:
#   winget install OpenJS.NodeJS.LTS
#   winget install Git.Git
npm install -g pm2
npm install -g pm2-windows-service

# ── 2. PostgreSQL ────────────────────────────────────────────────
# Install PostgreSQL for Windows (official installer) — creates its own
# Windows Service automatically (postgresql-x64-<version>), Automatic by
# default. Confirm:
Get-Service -Name postgresql*
# Create the database (migrations run themselves in step 5 below — no
# separate restore needed for a fresh go-live):
#   & 'C:\Program Files\PostgreSQL\<version>\bin\createdb.exe' -U postgres aaral_bridge

# ── 3. Clone the deploy repo + install dependencies ─────────────
# Use the fine-grained, read-only PAT you generated for this repo
# (GitHub → Settings → Developer settings → Fine-grained tokens → scope
# to ONLY aaral-marketing-deploy, Contents: Read-only). This one-time
# clone is the only place the PAT touches disk in plaintext (inside
# .git/config) — the self-update feature later injects it fresh per
# request instead (see watchdog\.env in step 4).
git clone https://<PAT>@github.com/<your-github-org>/aaral-marketing-deploy.git C:\AaralApp
Set-Location C:\AaralApp\payment-ledger-core; npm install
Set-Location ..\dashboard; npm install
Set-Location ..\whatsapp-bot; npm install
Set-Location ..\watchdog; npm install

# ── 4. Environment files ─────────────────────────────────────────
# Each app already has a .env.production template committed. Copy each to
# .env, then fill in the real values before starting anything:
Set-Location C:\AaralApp\dashboard;    Copy-Item .env.production .env
Set-Location ..\whatsapp-bot;          Copy-Item .env.production .env
Set-Location ..\watchdog;              Copy-Item .env.production .env
# Edit by hand:
#   dashboard\.env and whatsapp-bot\.env — set the real DB_PASSWORD from
#     step 2.
#   watchdog\.env — set GITHUB_PAT to the SAME fine-grained token used to
#     clone above (needed for the self-update feature's own git commands).

# ── 5. Run migrations ────────────────────────────────────────────
Set-Location C:\AaralApp\dashboard;    npm run migrate
Set-Location ..\whatsapp-bot;          npm run migrate

# ── 6. Set the admin PIN ─────────────────────────────────────────
# Gates Update / Opening Balance / Add Customer in the dashboard. Pick a
# PIN only Vansh and the owner know:
Set-Location C:\AaralApp\dashboard
npm run set-admin-pin -- 4821   # replace 4821 with the real PIN

# ── 7. Start everything under PM2 ────────────────────────────────
Set-Location C:\AaralApp\dashboard;    pm2 start ecosystem.config.js
Set-Location ..\whatsapp-bot;          pm2 start ecosystem.config.js
Set-Location ..\watchdog;              pm2 start ecosystem.config.js
pm2 status   # confirm all 3 apps show "online"
# Scan the WhatsApp QR when aaral-bridge prints it: pm2 logs aaral-bridge

# ── 8. Wrap PM2 itself as a real Windows Service ─────────────────
# No window, no login needed — runs "pm2 resurrect" at boot before anyone
# logs in.
pm2-service-install
# When prompted, accept the PM2_HOME config and let it save the current
# process list.
pm2 save

# Wire service dependencies so Postgres starts before PM2, and set both
# to Automatic. Replace <version> with the real service name from step 2.
sc.exe config PM2 depend= postgresql-x64-<version>
sc.exe config PM2 start= auto
sc.exe config postgresql-x64-<version> start= auto

# ── 9. Tailscale — client's remote/mobile access, no domain needed ──
# Install from tailscale.com/download/windows, then:
tailscale up
# MANUAL: log into your tailnet, enable MagicDNS in the Tailscale admin
# console, invite the client's phone/email into the same tailnet, have
# them install the Tailscale app once and log in. Tailscale installs its
# own Windows Service automatically (starts before login too).
# Client's URL afterward: http://<magicdns-hostname>:3400

# ── 10. LAN access for the 4-5 office systems ────────────────────
# MANUAL: reserve a static local IP for this PC via the router's DHCP
# reservation page, then bookmark http://<that-LAN-IP>:3400 on each of
# the 4-5 office machines.

# ── 11. BIOS setting — MANUAL, cannot be scripted ────────────────
# Reboot into BIOS/UEFI, set "Restore on AC Power Loss" (sometimes called
# "AC Power Recovery" / "After Power Failure") to Power On / On. Without
# this the PC just stays off after power returns, regardless of every
# service configured above — this is the one step that actually makes
# the whole thing survive a real unattended outage.

# ── 12. License — lock to this machine ───────────────────────────
wmic csproduct get UUID
# On your Mac, in IntelliTech Solutions/Tools/:
#   node license-gen.js --client "Aaral Marketing" --expiry <date> --machine "<UUID-from-above>"
# Copy the resulting license.key into dashboard/license.key on this box
# (overwrite the wildcard "*" one), update License_Tracker.xlsx.

# ── 13. Pre-go-live cleanup — don't skip ─────────────────────────
# - Clear/remove TEST_MODE_ALLOWED_NUMBERS in whatsapp-bot/.env so the
#   bot replies to real customers, not just the test allowlist.
# - Wipe any test customers/invoices from the DB before real use.
# - Install the iPhone PWA now while you're on-site: open the Tailscale
#   URL in mobile Safari on the owner's iPhone → Share → Add to Home
#   Screen. Confirm it opens standalone (no Safari address bar).

# ── 14. Verification checklist ───────────────────────────────────
# [ ] pm2 status shows aaral-bridge, aaral-dashboard, aaral-watchdog all "online"
# [ ] License validates (dashboard loads, no /expired.html redirect)
# [ ] LAN URL loads from a second office machine
# [ ] Tailscale URL loads from the client's phone on cellular data (not
#     office wifi — proves it isn't accidentally LAN-only)
# [ ] Real reboot test: restart the PC without logging back in — confirm
#     Postgres, PM2 (all 3 apps), and Tailscale all come back with no
#     manual action and no visible window
# [ ] Run `pm2 restart aaral-dashboard` 3x within a few minutes — confirm
#     a WhatsApp crash-loop alert arrives
# [ ] Stop aaral-watchdog and wait ~20 min — confirm a "DOWN" WhatsApp
#     alert arrives from the Jalan Group heartbeat monitor, then restart
#     it and confirm a "back online" message
# [ ] Updates page: "Check for Updates" reports "up to date" with no PIN
#     needed; "Update Now" prompts for PIN and rejects a wrong one
# [ ] Cut one real test release (bump a comment, run
#     sync-to-deploy-repo.sh from the Mac, click Update Now on-site) and
#     confirm it pulls, restarts, and reports success end-to-end
# [ ] Interrupt an update by killing power mid-way once — confirm
#     watchdog auto-recovers to the previous version on reboot with no
#     manual fix
# [ ] iPhone PWA installed and confirmed working from Step 13
