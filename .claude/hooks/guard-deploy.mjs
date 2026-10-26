import { block, readInput } from './lib.mjs';

// Blocks commands that could tamper with PRODUCTION user data. Staging
// (deploy-staging.sh, the -staging dir) and local dev (vochus-easysave-main)
// are intentionally not matched. Defence in depth, not a boundary — a
// determined operator can still run these outside Claude, and the robust
// control is the in-script gate inside deploy.sh (safe by default). This hook
// stops accidental prod data loss and reflexive prod deploys.

const raw = String(readInput().tool_input?.command ?? '');
// Normalise for matching: drop quotes/backslashes so they can't split a token.
const cmd = raw.replace(/['"\\]/g, '');

// The production app directory — on the server only (~, $HOME, or the absolute
// home), exactly `vochus-easysave` (the boundary excludes -staging / -main).
const prodPath = /(?:\/home\/administrator|~|\$\{?HOME\}?)\/vochus-easysave(?![-\w])/;
const prodTargeted = prodPath.test(cmd);

// A. The destructive deploy opt-ins — wherever they appear, whatever the
//    wrapper (ALLOW_SEED=1 ./deploy.sh, env ALLOW_DB_PUSH=1 ..., sudo ...).
if (/\bALLOW_(?:DB_PUSH|SEED)\s*=\s*1\b/i.test(cmd)) {
  block(
    'Blocked: ALLOW_DB_PUSH / ALLOW_SEED would run the schema sync or the seed against PRODUCTION data. Run a prod deploy deliberately, in a terminal, with a fresh backup — never from here.',
  );
}

// B. EXECUTING the prod deploy or rollback script (command position, after
//    optional env assignments / wrappers / a shell), NOT merely referencing it
//    (so git add / cat / grep on the file is fine). Excludes deploy-staging.sh.
const wrapper = '(?:[A-Za-z_]\\w*=\\S*|sudo|env|nohup|exec|command|time|nice|ionice|bash|sh|source|\\.)(?:\\s+-\\S+)*\\s+';
const scriptExec = new RegExp(
  `(?:^|[;&|(\\n\`])\\s*(?:${wrapper})*(?:[\\w./-]*/)?(?:deploy(?!-staging)|rollback)[\\w.-]*\\.sh\\b`,
);
if (scriptExec.test(cmd)) {
  block(
    'Blocked: production deploys/rollbacks are a deliberate human action. scripts/deploy.sh is safe by default (backs up + downloads the prod DB, snapshots for rollback, code-only) — run it yourself in a terminal. DB steps need ALLOW_DB_PUSH=1 / ALLOW_SEED=1. Rollback: ./scripts/rollback.sh. Staging: scripts/deploy-staging.sh.',
  );
}

// C. Seeding the production directory overwrites live data.
const seed = /\b(prisma\s+db\s+seed|db:seed|tsx\s+prisma\/seed|prisma\/seed\.ts)\b/;
if (prodTargeted && seed.test(cmd)) {
  block(
    'Blocked: seeding against the production directory overwrites live data (admin approval PIN -> 4163, demo agent AGT-00142/collo123, reward promo). Never seed prod.',
  );
}

// D. Other destructive operations aimed at the production directory.
const destructive =
  /(?:\brm\s+-\w*[rR]\w*|\bprisma\s+migrate\s+reset\b|\bprisma\s+db\s+push\b|\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b)/i;
if (prodTargeted && destructive.test(cmd)) {
  block(
    'Blocked: destructive command aimed at the production directory. Take and download a backup, and run it deliberately outside Claude if you truly intend it.',
  );
}

process.exit(0);
