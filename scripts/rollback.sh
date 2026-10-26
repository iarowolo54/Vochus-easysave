#!/bin/bash

# Vochus Easy Save — roll the PRODUCTION code back to the previous release.
# Restores the most recent snapshot taken by deploy.sh (code only — it never
# touches the database), rebuilds, and reloads. The database is unchanged; if a
# DB restore is needed, use a file from ./backups or ~/db-backups deliberately.
#
#   ./scripts/rollback.sh            # roll back to the most recent snapshot
#   ./scripts/rollback.sh <TS>       # roll back to a specific .releases/<TS>

set -euo pipefail
SERVER="administrator@69.197.164.193"
TARGET="${1:-}"

echo "↩️  Rolling PRODUCTION code back to the previous release..."
ssh "$SERVER" "TARGET='$TARGET' bash -s" <<'ENDSSH'
  set -e
  cd ~/vochus-easysave
  if [ -n "${TARGET:-}" ]; then
    REL="$HOME/vochus-easysave/.releases/$TARGET"
  else
    REL=$(ls -1dt "$HOME/vochus-easysave/.releases/"*/ 2>/dev/null | head -1 || true)
  fi
  [ -n "$REL" ] && [ -d "$REL" ] || { echo "❌ no release snapshot found in .releases/"; exit 1; }
  echo "   restoring: $REL"
  for p in src public prisma package.json package-lock.json next.config.ts tsconfig.json server.js ecosystem.config.cjs; do
    [ -e "$REL/$p" ] && cp -a "$REL/$p" "./" || true
  done
  sed -i "s|/home/administrator/vochus-easysave|$HOME/vochus-easysave|g" ecosystem.config.cjs
  npm install --legacy-peer-deps
  ./node_modules/.bin/prisma generate
  rm -f .next/build-lock.json 2>/dev/null || true
  npm run build
  pm2 reload vochus-easysave && pm2 save
  echo "✅ rolled back and reloaded"
ENDSSH
echo "🎉 Rollback finished — https://easysave.vochusglobalservices.co.uk"
