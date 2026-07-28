<#
Aaral office-server setup — run on-site, section by section (not fully
unattended: BIOS/router/phone steps below can't be scripted and are marked
MANUAL). Goal: nothing ever visible on screen, survives a power outage with
zero human intervention, alerts the owner (not the client) if something
needs a human. Everything here becomes a real Windows Service, not a
startup script tied to a logged-in user — the PC can sit at the lock screen
forever and still run.

Folder structure this assumes (dashboard/whatsapp-bot depend on
payment-ledger-core via a relative path — copy the whole tree, not just
the Aaral Marketing folder):
  IntelliTech Solutions\
    packages\payment-ledger-core\
    Clients\Aaral Marketing\
      dashboard\  whatsapp-bot\  watchdog\
#>

# ── 1. Node + PM2 ────────────────────────────────────────────────
# Install Node LTS first if not present: winget install OpenJS.NodeJS.LTS
npm install -g pm2
npm install -g pm2-windows-service

# ── 2. PostgreSQL ────────────────────────────────────────────────
# Install PostgreSQL for Windows (official installer) — creates its own
# Windows Service automatically (postgresql-x64-<version>), Automatic by
# default. Confirm:
Get-Service -Name postgresql*
# Then restore/migrate the Aaral DB onto this instance (npm run migrate
# in dashboard/ and whatsapp-bot/) before continuing.

# ── 3. Install dependencies in each app ─────────────────────────
Set-Location "IntelliTech Solutions\packages\payment-ledger-core"; npm install
Set-Location "..\..\Clients\Aaral Marketing\dashboard"; npm install
Set-Location "..\whatsapp-bot"; npm install
Set-Location "..\watchdog"; npm install
# Copy each app's real .env into place (DB connection string, ports, etc.)
# before starting anything below.

# ── 4. Start everything under PM2 ───────────────────────────────
Set-Location "..\dashboard"; pm2 start ecosystem.config.js
Set-Location "..\whatsapp-bot"; pm2 start ecosystem.config.js
Set-Location "..\watchdog"; pm2 start ecosystem.config.js
pm2 status   # confirm all 3 apps show "online"
# Scan the WhatsApp QR when aaral-bridge prints it: pm2 logs aaral-bridge

# ── 5. Wrap PM2 itself as a real Windows Service ────────────────
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

# ── 6. Tailscale — client's remote/mobile access, no domain needed ─
# Install from tailscale.com/download/windows, then:
tailscale up
# MANUAL: log into your tailnet, enable MagicDNS in the Tailscale admin
# console, invite the client's phone/email into the same tailnet, have
# them install the Tailscale app once and log in. Tailscale installs its
# own Windows Service automatically (starts before login too).
# Client's URL afterward: http://<magicdns-hostname>:3400

# ── 7. LAN access for the 4-5 office systems ────────────────────
# MANUAL: reserve a static local IP for this PC via the router's DHCP
# reservation page, then bookmark http://<that-LAN-IP>:3400 on each of
# the 4-5 office machines.

# ── 8. BIOS setting — MANUAL, cannot be scripted ────────────────
# Reboot into BIOS/UEFI, set "Restore on AC Power Loss" (sometimes called
# "AC Power Recovery" / "After Power Failure") to Power On / On. Without
# this the PC just stays off after power returns, regardless of every
# service configured above — this is the one step that actually makes
# the whole thing survive a real unattended outage.

# ── 9. License — lock to this machine ───────────────────────────
wmic csproduct get UUID
# On your Mac, in IntelliTech Solutions/Tools/:
#   node license-gen.js --client "Aaral Marketing" --expiry <date> --machine "<UUID-from-above>"
# Copy the resulting license.key into dashboard/license.key on this box
# (overwrite the wildcard "*" one), update License_Tracker.xlsx.

# ── 10. Pre-go-live cleanup — don't skip ────────────────────────
# - Clear/remove TEST_MODE_ALLOWED_NUMBERS in whatsapp-bot/.env so the
#   bot replies to real customers, not just the test allowlist.
# - Wipe any test customers/invoices from the DB before real use.

# ── 11. Verification checklist ──────────────────────────────────
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
