#!/usr/bin/env bash
# Run from Vansh's Mac whenever cutting a release. Copies this client's
# runtime code + the payment-ledger-core package it depends on into a
# separate standalone clone of the private aaral-marketing-deploy repo
# (never the mega-repo itself — see the design doc for why), rewrites the
# payment-ledger-core file: dependency to the standalone layout, commits,
# and pushes.
set -euo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_CLONE="${DEPLOY_CLONE_PATH:-$SRC_ROOT/../../aaral-marketing-deploy-clone}"
VERSION_TAG="${1:-}"

if [ ! -d "$DEPLOY_CLONE/.git" ]; then
  echo "Deploy clone not found at $DEPLOY_CLONE — run the one-time gh repo create + git clone first." >&2
  exit 1
fi

echo "Syncing dashboard/ whatsapp-bot/ watchdog/ ..."
for dir in dashboard whatsapp-bot watchdog; do
  rsync -a --delete \
    --exclude 'node_modules/' --exclude '.env' --exclude '.env.production' \
    --exclude 'logs/' --exclude 'wa-sessions/' --exclude '.wwebjs_cache/' \
    --exclude 'ruvector.db' --exclude '.swarm/' --exclude '.update-lock.json' \
    "$SRC_ROOT/$dir/" "$DEPLOY_CLONE/$dir/"
done

echo "Vendoring payment-ledger-core..."
rsync -a --delete \
  --exclude 'node_modules/' --exclude '.env.test' \
  "$SRC_ROOT/../../packages/payment-ledger-core/" "$DEPLOY_CLONE/payment-ledger-core/"

echo "Rewriting payment-ledger-core dependency path for the standalone layout..."
for pkg in dashboard/package.json whatsapp-bot/package.json; do
  node -e "
    const fs = require('fs');
    const p = '$DEPLOY_CLONE/$pkg';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.dependencies['payment-ledger-core'] = 'file:../payment-ledger-core';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
done

cd "$DEPLOY_CLONE"
git add -A
if git diff --cached --quiet; then
  echo "No changes to release."
  exit 0
fi
git commit -m "release: sync from source $(date +%Y-%m-%d)"
[ -n "$VERSION_TAG" ] && git tag "$VERSION_TAG"
git push origin main
[ -n "$VERSION_TAG" ] && git push origin "$VERSION_TAG"
echo "Pushed${VERSION_TAG:+ and tagged $VERSION_TAG}."
