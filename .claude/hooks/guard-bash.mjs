import { block, readInput } from './lib.mjs';

const cmd = String(readInput().tool_input?.command ?? '');
const isCommit = /\bgit\b[^|;&]*\bcommit\b/.test(cmd);

const rules = [
  [
    /\bgit\s+commit\b[^|;&]*--no-verify\b/,
    'Blocked: do not commit with --no-verify. Fix what the checks flag instead of skipping them.',
  ],
  [
    /\bgit\s+push\b[^|;&]*(\s--force(?!-with-lease)\b|\s-f\b)/,
    'Blocked: force push is not allowed. Use --force-with-lease on your own feature branch only, and only if the user asked.',
  ],
  [
    /\bgit\s+push\b[^|;&]*--force-with-lease\b[^|;&]*\b(main|master)\b/,
    'Blocked: never force-push main.',
  ],
  [
    /\b(cat|less|more|head|tail|bat|grep|rg|sed|awk|source|cp|mv|scp|curl)\b[^|;&]*(^|[\s'"/=])\.env(\.(?!example\b)[\w.-]+)?(?=$|[\s'";|&])/,
    'Blocked: reading or copying real .env files exposes live Paystack/SMTP/SMS secrets. Use the variable names only; ask the user for values.',
  ],
  [
    /\bprisma\s+migrate\s+reset\b/,
    'Blocked: `prisma migrate reset` wipes the database. On the local dev.db it destroys seeded data; never near production.',
  ],
  [
    /\bprisma\s+db\s+push\b[^|;&]*--accept-data-loss\b/,
    'Blocked: `prisma db push --accept-data-loss` can silently drop columns and their data. Create a migration with `prisma migrate dev` instead.',
  ],
  [
    /\b(TRUNCATE|DELETE\s+FROM|UPDATE)\s+("?\w+"?\.)?"?AuditLog\b/i,
    'Blocked: AuditLog is append-only. Never update/delete/truncate it.',
  ],
  [
    /\bDROP\s+(DATABASE|SCHEMA|TABLE)\b/i,
    'Blocked: dropping a database/schema/table must be done by the user deliberately, not by Claude.',
  ],
];

if (isCommit && /co-authored-by|generated with \[?claude|noreply@anthropic\.com/i.test(cmd)) {
  block(
    'Blocked: commit messages must never include a Claude co-author or attribution line (project owner rule). Remove the Co-Authored-By / "Generated with Claude" lines and commit again.',
  );
}

for (const [re, msg] of rules) if (re.test(cmd)) block(msg);
process.exit(0);
