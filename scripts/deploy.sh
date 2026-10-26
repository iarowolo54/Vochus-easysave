#!/bin/bash

# Vochus Easy Save — PRODUCTION deploy (safe by default)
# Server: 69.197.164.193 · user: administrator · domain: easysave.vochusglobalservices.co.uk · port 3004
#
# SAFE BY DEFAULT: code only. It takes and downloads a DB backup, snapshots the
# current release for rollback, then deploys code (install → generate → build →
# reload). It NEVER touches the database unless you opt in explicitly:
#
#   ./scripts/deploy.sh                 # code-only (recommended)
#   ALLOW_DB_PUSH=1 ./scripts/deploy.sh # also sync schema (can DROP columns)
#   ALLOW_SEED=1    ./scripts/deploy.sh # also run the seed (mutates live data)
#   ALLOW_INFRA=1   ./scripts/deploy.sh # also re-apply nginx + certbot
#
# Rollback the code: ./scripts/rollback.sh

set -euo pipefail

SERVER="administrator@69.197.164.193"
APP_DIR="$PWD"
REMOTE_DIR="vochus-easysave"
ALLOW_DB_PUSH="${ALLOW_DB_PUSH:-0}"
ALLOW_SEED="${ALLOW_SEED:-0}"
ALLOW_INFRA="${ALLOW_INFRA:-0}"

echo "🚀 PRODUCTION deploy → easysave.vochusglobalservices.co.uk"
echo "   mode: code-only$([ "$ALLOW_DB_PUSH" = 1 ] && echo " + DB PUSH")$([ "$ALLOW_SEED" = 1 ] && echo " + SEED")$([ "$ALLOW_INFRA" = 1 ] && echo " + INFRA")"
echo ""

# 1. Server must already have its own .env (never uploaded from here).
echo "🔐 Checking server .env..."
ssh "$SERVER" "test -f ~/$REMOTE_DIR/.env" || { echo "❌ ~/$REMOTE_DIR/.env missing on server — create it there first"; exit 1; }

# 2. Back up the production database and download it BEFORE any change.
echo "💾 Backing up production database..."
REMOTE_BACKUP=$(ssh "$SERVER" "bash -s" <<'EOS'
set -e
mkdir -p ~/db-backups
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$HOME/db-backups/predeploy-$TS.db"
sqlite3 "$HOME/vochus-easysave/prisma/dev.db" ".backup $OUT"
gzip -f "$OUT"
echo "${OUT}.gz"
EOS
)
mkdir -p "$APP_DIR/backups"
LOCAL_BACKUP="$APP_DIR/backups/$(basename "$REMOTE_BACKUP")"
scp "$SERVER:$REMOTE_BACKUP" "$LOCAL_BACKUP"
gzip -t "$LOCAL_BACKUP"
if command -v sqlite3 >/dev/null 2>&1; then
  TMP_DB=$(mktemp); gzip -dc "$LOCAL_BACKUP" > "$TMP_DB"
  ic=$(sqlite3 "$TMP_DB" "pragma integrity_check;" | head -1); rm -f "$TMP_DB"
  [ "$ic" = "ok" ] || { echo "❌ backup failed integrity_check: $ic"; exit 1; }
fi
echo "✅ backup verified and saved: $LOCAL_BACKUP"

# 3. Build the code package (no .env, no node_modules, no db files).
echo "📁 Packaging code..."
tar --exclude='node_modules' --exclude='.next' --exclude='prisma/dev.db' --exclude='prisma/prod.db' -czf easysave-deploy.tar.gz \
  src public prisma package.json package-lock.json next.config.ts tsconfig.json server.js ecosystem.config.cjs nginx-easysave.conf
scp easysave-deploy.tar.gz "$SERVER:/tmp/"
rm easysave-deploy.tar.gz

# 4. On the server: snapshot current release, deploy code, gate the DB steps.
echo "🔧 Deploying on server..."
ssh "$SERVER" "ALLOW_DB_PUSH='$ALLOW_DB_PUSH' ALLOW_SEED='$ALLOW_SEED' bash -s" <<'ENDSSH'
  set -e
  cd ~/vochus-easysave

  echo "📦 Snapshotting current release for rollback..."
  TS=$(date -u +%Y%m%d-%H%M%S)
  REL="$HOME/vochus-easysave/.releases/$TS"
  mkdir -p "$REL"
  for p in src public prisma package.json package-lock.json next.config.ts tsconfig.json server.js ecosystem.config.cjs; do
    [ -e "$p" ] && cp -a "$p" "$REL/" || true
  done
  ls -1dt "$HOME/vochus-easysave/.releases/"*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
  echo "   snapshot: $REL"

  echo "📦 Extracting new code..."
  tar -xzf /tmp/easysave-deploy.tar.gz
  rm /tmp/easysave-deploy.tar.gz
  mkdir -p logs
  sed -i "s|/home/administrator/vochus-easysave|$HOME/vochus-easysave|g" ecosystem.config.cjs

  if ! swapon --show | grep -q '/swapfile'; then
    sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile; sudo mkswap /swapfile; sudo swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi

  echo "📦 Installing dependencies..."
  npm install --legacy-peer-deps

  if [ "${ALLOW_DB_PUSH:-0}" = "1" ]; then
    echo "⚠️  ALLOW_DB_PUSH=1 — syncing schema (can DROP columns)"
    ./node_modules/.bin/prisma db push --accept-data-loss
  else
    echo "⏭  skipping prisma db push (code-only). Set ALLOW_DB_PUSH=1 to enable."
  fi

  echo "⚙️  Generating Prisma client..."
  ./node_modules/.bin/prisma generate

  echo "🏗️  Building..."
  rm -f .next/build-lock.json 2>/dev/null || true
  pkill -f "next build" 2>/dev/null || true
  npm run build

  if [ "${ALLOW_SEED:-0}" = "1" ]; then
    echo "⚠️  ALLOW_SEED=1 — running seed (mutates live data)"
    npx tsx prisma/seed.ts || echo "⚠️  seed failed"
  else
    echo "⏭  skipping seed (code-only). Set ALLOW_SEED=1 to enable."
  fi
  echo "✅ Build complete"
ENDSSH

# 5. Zero-downtime reload (separate SSH call).
echo "🔄 Reloading application..."
ssh "$SERVER" "bash -s" <<'ENDPM2'
  set -e
  cd ~/vochus-easysave
  pm2 reload vochus-easysave || (pm2 delete vochus-easysave || true; pm2 start ecosystem.config.cjs)
  pm2 save
  pm2 list | grep -E "vochus-easysave|Mem" || true
  echo '✅ reloaded'
ENDPM2

# 6. Infra (nginx + certbot) only on request — the cert auto-renews on its own timer.
if [ "$ALLOW_INFRA" = "1" ]; then
  echo "🌐 Re-applying nginx + certbot..."
  ssh "$SERVER" "sudo cp ~/$REMOTE_DIR/nginx-easysave.conf /etc/nginx/sites-available/easysave.vochusglobalservices.co.uk && \
    sudo ln -sf /etc/nginx/sites-available/easysave.vochusglobalservices.co.uk /etc/nginx/sites-enabled/easysave.vochusglobalservices.co.uk && \
    sudo nginx -t && sudo systemctl reload nginx && echo '✅ nginx reloaded'"
  ssh "$SERVER" "sudo certbot --nginx -d easysave.vochusglobalservices.co.uk --non-interactive --agree-tos --email admin@vochusglobalservices.co.uk --redirect 2>&1 || echo '⚠️  certbot skipped'"
fi

echo ""
echo "🎉 Deploy finished — https://easysave.vochusglobalservices.co.uk"
echo "   backup:   $LOCAL_BACKUP"
echo "   rollback: ./scripts/rollback.sh"
