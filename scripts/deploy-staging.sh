#!/bin/bash

# Vochus Easy Save — STAGING deploy (safe by default, mirrors deploy.sh)
# Subdomain: staging.easysave.vochusglobalservices.co.uk · port 3005 · dir ~/vochus-easysave-staging
#
#   ./scripts/deploy-staging.sh                 # code-only (recommended)
#   ALLOW_DB_PUSH=1 ./scripts/deploy-staging.sh # also sync schema (can DROP columns)
#   ALLOW_SEED=1    ./scripts/deploy-staging.sh # also run the seed
#   ALLOW_INFRA=1   ./scripts/deploy-staging.sh # also re-apply nginx + certbot

set -euo pipefail

SERVER="administrator@69.197.164.193"
APP_DIR="$PWD"
REMOTE_DIR="vochus-easysave-staging"
ALLOW_DB_PUSH="${ALLOW_DB_PUSH:-0}"
ALLOW_SEED="${ALLOW_SEED:-0}"
ALLOW_INFRA="${ALLOW_INFRA:-0}"

echo "🚀 STAGING deploy → staging.easysave.vochusglobalservices.co.uk"
echo "   mode: code-only$([ "$ALLOW_DB_PUSH" = 1 ] && echo " + DB PUSH")$([ "$ALLOW_SEED" = 1 ] && echo " + SEED")$([ "$ALLOW_INFRA" = 1 ] && echo " + INFRA")"
echo ""

echo "🔐 Checking server .env..."
ssh "$SERVER" "mkdir -p ~/$REMOTE_DIR"
ssh "$SERVER" "test -f ~/$REMOTE_DIR/.env" || { echo "❌ ~/$REMOTE_DIR/.env missing on server — create it there first"; exit 1; }

echo "💾 Backing up staging database..."
REMOTE_BACKUP=$(ssh "$SERVER" "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'EOS'
set -e
mkdir -p ~/db-backups
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$HOME/db-backups/${REMOTE_DIR}-predeploy-$TS.db"
sqlite3 "$HOME/$REMOTE_DIR/prisma/dev.db" ".backup $OUT"
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

echo "📁 Packaging code..."
tar --exclude='node_modules' --exclude='.next' --exclude='prisma/*.db*' -czf easysave-staging.tar.gz \
  src public prisma package.json package-lock.json next.config.ts tsconfig.json server.js ecosystem.staging.cjs nginx-easysave-staging.conf
scp easysave-staging.tar.gz "$SERVER:/tmp/"
rm easysave-staging.tar.gz

echo "🔧 Deploying on server..."
ssh "$SERVER" "ALLOW_DB_PUSH='$ALLOW_DB_PUSH' ALLOW_SEED='$ALLOW_SEED' bash -s" <<'ENDSSH'
  set -e
  cd ~/vochus-easysave-staging

  echo "📦 Snapshotting current release for rollback..."
  TS=$(date -u +%Y%m%d-%H%M%S)
  REL="$HOME/vochus-easysave-staging/.releases/$TS"
  mkdir -p "$REL"
  # Code only — NEVER the database.
  for p in src public package.json package-lock.json next.config.ts tsconfig.json server.js ecosystem.staging.cjs prisma/schema.prisma prisma/migrations prisma/seed.ts; do
    if [ -e "$p" ]; then mkdir -p "$REL/$(dirname "$p")"; cp -a "$p" "$REL/$p"; fi
  done
  ls -1dt "$HOME/vochus-easysave-staging/.releases/"*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
  echo "   snapshot: $REL"

  echo "📦 Extracting new code..."
  tar -xzf /tmp/easysave-staging.tar.gz
  rm /tmp/easysave-staging.tar.gz
  mkdir -p logs
  sed -i "s|/home/administrator/vochus-easysave-staging|$HOME/vochus-easysave-staging|g" ecosystem.staging.cjs

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
    echo "⚠️  ALLOW_SEED=1 — running seed (mutates data)"
    npx tsx prisma/seed.ts || echo "⚠️  seed failed"
  else
    echo "⏭  skipping seed (code-only). Set ALLOW_SEED=1 to enable."
  fi
  echo "✅ Build complete"
ENDSSH

echo "🔄 Reloading staging app..."
ssh "$SERVER" "cd ~/$REMOTE_DIR && (pm2 reload vochus-easysave-staging || (pm2 delete vochus-easysave-staging || true; NODE_ENV=production PORT=3005 pm2 start server.js --name vochus-easysave-staging)) && pm2 save && echo '✅ reloaded'"

if [ "$ALLOW_INFRA" = "1" ]; then
  echo "🌐 Re-applying nginx + certbot..."
  ssh "$SERVER" "sudo cp ~/$REMOTE_DIR/nginx-easysave-staging.conf /etc/nginx/sites-available/staging.easysave.vochusglobalservices.co.uk && \
    sudo ln -sf /etc/nginx/sites-available/staging.easysave.vochusglobalservices.co.uk /etc/nginx/sites-enabled/staging.easysave.vochusglobalservices.co.uk && \
    sudo nginx -t && sudo systemctl reload nginx && echo '✅ nginx reloaded'"
  ssh "$SERVER" "sudo certbot --nginx -d staging.easysave.vochusglobalservices.co.uk --non-interactive --agree-tos --email admin@vochusglobalservices.co.uk --redirect 2>&1 || echo '⚠️  certbot skipped'"
fi

echo ""
echo "🎉 Staging deploy finished — https://staging.easysave.vochusglobalservices.co.uk"
echo "   backup: $LOCAL_BACKUP"
