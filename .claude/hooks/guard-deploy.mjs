import { block, readInput } from './lib.mjs';

// Blocks commands that could tamper with PRODUCTION user data. Staging
// (deploy-staging.sh, the -staging dir) and local dev (vochus-easysave-main)
// are intentionally not matched. Defence in depth, not a boundary — a
// determined operator can still run these outside Claude. The robust control
// is the in-script gate inside deploy.sh (it refuses the destructive steps
// without an explicit opt-in); this hook stops accidental prod data loss.

const raw = String(readInput().tool_input?.command ?? '');
// Normalise for matching: drop quotes/backslashes so they can't split a token.
const cmd = raw.replace(/['"\\]/g, '');

// The production app directory — on the server only (~, $HOME, or the absolute
// home), and exactly `vochus-easysave`: the boundary (?![-\w]) excludes
// -staging, -main, and any other suffix, and the prefix excludes local paths
// like /Users/.../vochus-easysave-main.
const prodPath = /(?:\/home\/administrator|~|\$\{?HOME\}?)\/vochus-easysave(?![-\w])/;
const prodTargeted = prodPath.test(cmd);

// 1. EXECUTING the prod deploy script (not merely referencing it, so
//    `git add`/`cat scripts/deploy.sh` is fine). Matches it in command
//    position — at a command boundary, after optional env assignments and an
//    optional bash/sh/source/. and path prefix — excluding deploy-staging.sh.
const deployExec =
  /(?:^|[;&|(])\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:bash|sh|source|\.)\s+)?(?:[\w./-]*\/)?deploy(?!-staging)[\w.-]*\.sh\b/;
if (deployExec.test(cmd)) {
  block(
    'Blocked: production deploys are a deliberate human action. scripts/deploy.sh is now safe by default (backs up + downloads the prod DB, snapshots for rollback, code-only) — run it yourself in a terminal. It only touches the DB with ALLOW_DB_PUSH=1 / ALLOW_SEED=1. Rollback: ./scripts/rollback.sh. Staging: scripts/deploy-staging.sh.',
  );
}

// 2. Seeding the production directory overwrites live data.
const seed = /\b(prisma\s+db\s+seed|db:seed|tsx\s+prisma\/seed|prisma\/seed\.ts)\b/;
if (prodTargeted && seed.test(cmd)) {
  block(
    'Blocked: seeding against the production directory overwrites live data (admin approval PIN -> 4163, demo agent AGT-00142/collo123, reward promo). Never seed prod.',
  );
}

// 3. Other destructive operations aimed at the production directory. rm flag
// order/spelling (-rf, -fr, -r ...) is matched loosely on purpose.
const destructive =
  /(?:\brm\s+-\w*[rR]\w*|\bprisma\s+migrate\s+reset\b|\bprisma\s+db\s+push\b|\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b)/i;
if (prodTargeted && destructive.test(cmd)) {
  block(
    'Blocked: destructive command aimed at the production directory. Take and download a backup, and run it deliberately outside Claude if you truly intend it.',
  );
}

process.exit(0);
