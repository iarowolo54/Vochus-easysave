import { block, readInput } from './lib.mjs';

// Blocks commands that could tamper with PRODUCTION user data. Staging
// (deploy-staging.sh, the -staging dir) and local dev are intentionally not
// matched. Defence in depth, not a boundary — a determined operator can still
// run these outside Claude; this stops accidental prod data loss.

const cmd = String(readInput().tool_input?.command ?? '');

// Production app directory — NOT ~/vochus-easysave-staging. The SSH host alone
// can't tell prod from staging (same box), so we key on the prod path.
const prodPath = /(?:\/home\/administrator|~)\/vochus-easysave(?!-staging)(?=\/|$|\s|['"`])/;
const prodTargeted = prodPath.test(cmd);

// 1. The production deploy script bundles `prisma db push --accept-data-loss`
//    and the seed, both of which mutate live data.
if (/(?:^|[\s;&|/])(?:bash\s+|sh\s+)?(?:\.\/)?scripts\/deploy\.sh\b/.test(cmd)) {
  block(
    'Blocked: scripts/deploy.sh runs `prisma db push --accept-data-loss` and the seed against PRODUCTION (resets the admin PIN, recreates the demo agent, forces the promo on). Before any prod deploy: back up and download the prod DB, then use a code-only deploy (no db push, no seed). Ask to harden deploy.sh with a --code-only mode first. Staging: use scripts/deploy-staging.sh.',
  );
}

// 2. Seeding production mutates live data.
const seed = /\b(prisma\s+db\s+seed|db:seed|tsx\s+prisma\/seed|prisma\/seed\.ts)\b/;
if (prodTargeted && seed.test(cmd)) {
  block(
    'Blocked: seeding against the production directory overwrites live data (admin approval PIN -> 4163, demo agent AGT-00142/collo123, reward promo). Never seed prod.',
  );
}

// 3. Other destructive operations aimed at the production directory.
const destructive =
  /\b(rm\s+-rf|prisma\s+migrate\s+reset|prisma\s+db\s+push|DROP\s+(TABLE|DATABASE|SCHEMA)|DELETE\s+FROM|TRUNCATE)\b/i;
if (prodTargeted && destructive.test(cmd)) {
  block(
    'Blocked: destructive command aimed at the production directory. Take and download a backup, and run it deliberately outside Claude if you truly intend it.',
  );
}

process.exit(0);
