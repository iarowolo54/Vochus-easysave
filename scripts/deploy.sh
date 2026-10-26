#!/bin/bash

# Vochus Easy Save Deployment Script
# Server: 69.197.164.193
# User: administrator
# Domain: easysave.vochusglobalservices.co.uk
# Port: 3004

set -e

SERVER="administrator@69.197.164.193"
APP_DIR="$PWD"

echo "🚀 Starting deployment to easysave.vochusglobalservices.co.uk..."
echo ""

# Create deployment package
echo "📁 Creating deployment package..."
tar --exclude='node_modules' --exclude='.next' --exclude='prisma/dev.db' --exclude='prisma/prod.db' -czf easysave-deploy.tar.gz \
  src \
  public \
  prisma \
  package.json \
  package-lock.json \
  next.config.ts \
  tsconfig.json \
  server.js \
  ecosystem.config.cjs \
  nginx-easysave.conf || echo "⚠️  Some files may be missing from package (continuing...)"

echo "✅ Package created: $(du -sh easysave-deploy.tar.gz | cut -f1)"

# Ensure remote directory exists
echo "📁 Creating remote directory..."
ssh $SERVER "mkdir -p ~/vochus-easysave"

# .env is managed on the server and never uploaded — local .env is for local dev only
echo "🔐 Checking server .env..."
ssh $SERVER "test -f ~/vochus-easysave/.env" || { echo "❌ ~/vochus-easysave/.env missing on server — create it there first"; exit 1; }
echo "✅ Server .env present"

# Upload package
echo "📤 Uploading deployment package..."
scp easysave-deploy.tar.gz $SERVER:/tmp/
echo "✅ Package uploaded"

# Deploy on server
echo "🔧 Deploying on server..."
ssh $SERVER bash << 'ENDSSH'
  set -e

  echo "📦 Extracting application..."
  mkdir -p ~/vochus-easysave
  cd ~/vochus-easysave
  tar -xzf /tmp/easysave-deploy.tar.gz
  rm /tmp/easysave-deploy.tar.gz
  mkdir -p ~/vochus-easysave/logs

  # Update paths in ecosystem config
  sed -i "s|/home/administrator/vochus-easysave|$HOME/vochus-easysave|g" ecosystem.config.cjs

  echo "💾 Ensuring swap space..."
  if ! swapon --show | grep -q '/swapfile'; then
    sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo "✅ 2G swap created"
  else
    echo "✅ Swap already active"
  fi

  echo "📦 Installing dependencies..."
  npm install --legacy-peer-deps

  echo "🗄️  Syncing database schema..."
  ./node_modules/.bin/prisma db push --accept-data-loss || echo "⚠️  DB push skipped"

  echo "⚙️  Generating Prisma client..."
  ./node_modules/.bin/prisma generate

  echo "🏗️  Building application..."
  rm -f .next/build-lock.json 2>/dev/null || true
  pkill -f "next build" 2>/dev/null || true
  npm run build

  echo "🌱 Seeding database..."
  npx tsx prisma/seed.ts || echo "⚠️  Seed skipped (data may already exist)"

  echo "✅ Build complete"
ENDSSH

# PM2 restart in a separate SSH call so build timeout doesn't prevent restart
echo "🔄 Restarting application..."
ssh $SERVER bash << 'ENDPM2'
  set -e
  cd ~/vochus-easysave
  pm2 reload vochus-easysave || (pm2 delete vochus-easysave || true; pm2 start ecosystem.config.cjs)

  # Ensure sibling PM2 apps are online before persisting dump — pm2 save writes
  # ONLY currently-running apps, so a missing sibling here would be lost on reboot.
  ensure_sibling() {
    local name="$1" dir="$2"
    if ! pm2 describe "$name" >/dev/null 2>&1; then
      if [ -f "$dir/ecosystem.config.cjs" ]; then
        echo "⚠️  Sibling '$name' not in PM2 — starting from $dir"
        (cd "$dir" && pm2 start ecosystem.config.cjs) || echo "⚠️  Failed to start $name"
      fi
    fi
  }
  ensure_sibling vochus-workforce "$HOME/vochus-workforce"
  ensure_sibling vochus-easysave-staging "$HOME/vochus-easysave-staging"
  ensure_sibling service-mgmt "$HOME/service-mgmt"

  pm2 save
  echo '✅ PM2 restarted'
  pm2 list
ENDPM2

# Setup nginx
echo ""
echo "🌐 Configuring Nginx for easysave.vochusglobalservices.co.uk..."
ssh $SERVER "sudo cp ~/vochus-easysave/nginx-easysave.conf /etc/nginx/sites-available/easysave.vochusglobalservices.co.uk && \
  sudo ln -sf /etc/nginx/sites-available/easysave.vochusglobalservices.co.uk /etc/nginx/sites-enabled/easysave.vochusglobalservices.co.uk && \
  sudo nginx -t && \
  sudo systemctl reload nginx && \
  echo '✅ Nginx configured'"

# SSL certificate
echo ""
echo "🔒 Obtaining SSL certificate..."
ssh $SERVER "sudo certbot --nginx -d easysave.vochusglobalservices.co.uk \
  --non-interactive --agree-tos --email admin@vochusglobalservices.co.uk --redirect 2>&1 || echo '⚠️  Certbot skipped (cert may already exist)'"

# Cleanup local
rm easysave-deploy.tar.gz

echo ""
echo "🎉 Deployment finished!"
echo "🌐 https://easysave.vochusglobalservices.co.uk"
