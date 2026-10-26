#!/bin/bash

# Vochus Easy Save — Staging Deployment
# Subdomain : staging.easysave.vochusglobalservices.co.uk
# Port      : 3005
# Dir       : ~/vochus-easysave-staging

set -e

SERVER="administrator@69.197.164.193"
APP_DIR="$PWD"

echo "🚀 Deploying to staging.easysave.vochusglobalservices.co.uk..."
echo ""

echo "📁 Creating deployment package..."
tar --exclude='node_modules' --exclude='.next' --exclude='prisma/dev.db' --exclude='prisma/prod.db' -czf easysave-staging.tar.gz \
  src \
  public \
  prisma \
  package.json \
  package-lock.json \
  next.config.ts \
  tsconfig.json \
  server.js \
  ecosystem.staging.cjs \
  nginx-easysave-staging.conf || echo "⚠️  Some files missing (continuing...)"

echo "✅ Package created: $(du -sh easysave-staging.tar.gz | cut -f1)"

# .env is managed on the server and never uploaded — local .env is for local dev only
echo "🔐 Checking server .env..."
ssh $SERVER "mkdir -p ~/vochus-easysave-staging"
ssh $SERVER "test -f ~/vochus-easysave-staging/.env" || { echo "❌ ~/vochus-easysave-staging/.env missing on server — create it there first"; exit 1; }

echo "📤 Uploading package..."
scp easysave-staging.tar.gz $SERVER:/tmp/

echo "🔧 Deploying on server..."
ssh $SERVER bash << 'ENDSSH'
  set -e

  echo "📦 Extracting..."
  mkdir -p ~/vochus-easysave-staging
  cd ~/vochus-easysave-staging
  tar -xzf /tmp/easysave-staging.tar.gz
  rm /tmp/easysave-staging.tar.gz
  mkdir -p logs

  sed -i "s|/home/administrator/vochus-easysave-staging|$HOME/vochus-easysave-staging|g" ecosystem.staging.cjs

  echo "📦 Installing dependencies..."
  npm install --legacy-peer-deps

  echo "🗄️  Syncing schema..."
  ./node_modules/.bin/prisma db push --accept-data-loss || echo "⚠️  DB push skipped"

  echo "⚙️  Generating Prisma client..."
  ./node_modules/.bin/prisma generate

  echo "🏗️  Building..."
  rm -f .next/build-lock.json 2>/dev/null || true
  pkill -f "next build" 2>/dev/null || true
  npm run build

  echo "🌱 Seeding staging DB..."
  npx tsx prisma/seed.ts || echo "⚠️  Seed skipped"

  chmod 600 prisma/dev.db 2>/dev/null || true
  echo "✅ Build complete"
ENDSSH

# PM2 restart in a separate SSH call
echo "🔄 Restarting staging app..."
ssh $SERVER "cd ~/vochus-easysave-staging && (pm2 reload vochus-easysave-staging || (pm2 delete vochus-easysave-staging || true; NODE_ENV=production PORT=3005 pm2 start server.js --name vochus-easysave-staging)) && pm2 save && echo '✅ Staging PM2 restarted' && pm2 list"

echo ""
echo "🌐 Configuring Nginx for staging..."
ssh $SERVER "sudo cp ~/vochus-easysave-staging/nginx-easysave-staging.conf /etc/nginx/sites-available/staging.easysave.vochusglobalservices.co.uk && \
  sudo ln -sf /etc/nginx/sites-available/staging.easysave.vochusglobalservices.co.uk /etc/nginx/sites-enabled/staging.easysave.vochusglobalservices.co.uk && \
  sudo nginx -t && \
  sudo systemctl reload nginx && \
  echo '✅ Nginx configured'"

echo ""
echo "🔒 Obtaining SSL certificate..."
ssh $SERVER "sudo certbot --nginx -d staging.easysave.vochusglobalservices.co.uk \
  --non-interactive --agree-tos --email admin@vochusglobalservices.co.uk --redirect 2>&1 || echo '⚠️  Certbot skipped'"

rm -f easysave-staging.tar.gz

echo ""
echo "🎉 Staging deployment finished!"
echo "🌐 https://staging.easysave.vochusglobalservices.co.uk"
