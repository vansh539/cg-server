# Remote Claude Code Access from iPhone/iPad — Design

## Goal
Let Vansh SSH into his MacBook from iPhone or iPad (over Tailscale, from anywhere — home wifi, cellular, other networks) and drive full interactive Claude Code sessions, with sessions surviving connection drops.

## Current state (as of 2026-07-09)
- Tailscale already installed (`brew`, v1.98.3) and running on the Mac (`vanshs-macbook-pro`).
- iPhone (`iphone-15-pro-max`) already joined to the same tailnet, currently showing offline (app likely just not opened recently — reconnects on open).
- iPad not yet joined to the tailnet.
- Tailscale SSH not yet enabled on the Mac.
- tmux not yet installed on the Mac.
- No iOS SSH client confirmed installed.

## Architecture
```
iPhone/iPad (Termius app)
   │  Tailscale-encrypted WireGuard connection
   ▼
Tailscale mesh (existing tailnet, vanshjalan1@ account)
   │
   ▼
MacBook — Tailscale SSH server (`tailscale up --ssh`)
   │
   ▼
tmux session "main" → Claude Code running interactively
```

## Components & decisions
1. **Auth**: Tailscale SSH (not traditional keys) — no key management, access gated by Tailscale account + ACLs to Vansh's own devices only. Free, already-installed infra.
2. **Persistence**: tmux session named `main` on the Mac. SSH in → `tmux attach -t main` → Claude Code keeps running across disconnects (elevator, tunnel, app switch).
3. **Sleep prevention**: `pmset` set so the Mac doesn't sleep on AC power. Hard limitation: closing the lid still sleeps the machine regardless of pmset — practical rule is "leave it open and plugged in" when heading out without it.
4. **iOS client**: Termius (free tier) on both iPhone and iPad, holding a saved host entry for the Mac's Tailscale hostname.

## Setup steps (who does what)
**Claude (on the Mac, via Bash):**
- Enable Tailscale SSH: `sudo tailscale set --ssh`
- Install tmux: `brew install tmux`
- Set sleep prevention on AC power: `sudo pmset -c sleep 0 displaysleep 10 disksleep 0`
- Create/verify a persistent tmux session exists for future use

**Vansh (manual, on iPhone and iPad — Claude has no device access):**
- Open Tailscale app on iPhone (reconnect) and install+log in on iPad
- Approve iPad as a new device in the Tailscale admin console if prompted
- Install Termius from the App Store on both devices
- Add the Mac as a host in Termius using its Tailscale hostname, connect via Tailscale SSH (username = Mac username, no password/key needed — Tailscale handles auth)
- Verify: `tmux attach -t main` on first connect

## Error handling / edge cases
- **Mac asleep when trying to connect**: nothing reachable; no software fix, this is a laptop hardware limitation on lid-close.
- **Connection drops mid-session**: tmux keeps Claude Code running server-side; reconnect and reattach to `main`, no lost work.
- **New/hostile wifi networks**: Tailscale's NAT traversal handles the vast majority automatically; DERP relay is the automatic fallback (slightly higher latency, still works).

## Testing / verification
1. Confirm all 3 devices show "online" in `tailscale status` / admin console.
2. SSH from iPhone over cellular (not wifi) to confirm it's not just LAN-local.
3. Start a task in Claude Code inside tmux, force-quit Termius, reopen, reattach — confirm task/session survived.

## Out of scope (future sub-projects)
- Push notifications for permission prompts when not actively driving a session.
- Notes → Reminders auto-sync (next sub-project after this one).
- Broader "life automation" — needs its own scoping once concrete recurring tasks are identified.
