import { lstatSync } from 'node:fs';
import path from 'node:path';
import { block, readInput } from './lib.mjs';

const input = readInput();
const cmd = String(input.tool_input?.command ?? '');
const isCommit = /\bgit\b[^|;&]*\bcommit\b/.test(cmd);

// A worktree's symlinked node_modules shares the Prisma client with the main repo, so generating
// there silently moves every server using it onto that worktree's dev.db. See agents-and-resources.md.
const generate = cmd.search(/\bprisma\s+generate\b/);
if (generate !== -1) {
  const cds = [...cmd.slice(0, generate).matchAll(/\bcd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)];
  const target = cds.length ? cds[cds.length - 1][1].replace(/^["']|["']$/g, '') : '.';
  const dir = path.resolve(String(input.cwd ?? process.cwd()), target);
  let symlinked = false;
  try { symlinked = lstatSync(path.join(dir, 'node_modules')).isSymbolicLink(); } catch {}
  if (symlinked) {
    block('Blocked: node_modules here is a symlink, so `prisma generate` would repoint the shared Prisma client at this worktree\'s dev.db. Clone it first: rm node_modules && cp -cR ../../node_modules ./node_modules');
  }
}

const rules = [
  [
    // --no-verify (incl. abbreviations --no-v…) or short -n (incl. combined clusters
    // like -nm); allow global options between `git` and `commit`, e.g. git -c x=y commit.
    /\bgit\b[^|;&]*?\bcommit\b[^|;&]*(\s--no-v[a-z]*\b|\s-[A-Za-z]*n[A-Za-z]*\b)/,
    'Blocked: do not commit with --no-verify / -n. Fix what the checks flag instead of skipping them.',
  ],
  [
    // --force, -f, a combined short cluster containing f (e.g. -fv), or a +refspec push
    /\bgit\s+push\b[^|;&]*(\s--force(?!-with-lease)\b|\s-[A-Za-z]*f[A-Za-z]*\b|\s\+[^\s|;&]+)/,
    'Blocked: force push is not allowed. Use --force-with-lease on your own feature branch only, and only if the user asked.',
  ],
  [
    /\bgit\s+push\b[^|;&]*--force-with-lease\b[^|;&]*\b(main|master)\b/,
    'Blocked: never force-push main.',
  ],
  [
    // Any reference to a real .env (read, copy, redirect, interpreter, glob) in any
    // command; any non-word char is a boundary. .env.example is allowed. Defence in depth.
    /(^|[^\w.-])\.env(\.(?!example\b)[\w.-]+)?(?![\w.-])/i,
    'Blocked: this touches a real .env file (live Paystack/SMTP/SMS secrets). Use the variable names only; ask the user for values. .env.example is fine.',
  ],
  [
    // Writing/redirecting into a database file via the shell
    /(>>?|\btee\b)\s*[^\s|;&]*\.(db|sqlite3?)\b/i,
    'Blocked: do not write to a database file through the shell. Use Prisma.',
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
  [
    // Layer: don't let Claude rewrite the prod deploy/rollback scripts from the
    // shell (guard-deploy also verifies their content vs HEAD at approval time).
    // Blocks redirect/copy/move/sed-in-place/etc. onto a deploy/rollback script;
    // reading/running them is unaffected. `\s*` after redirect ops; case-insensitive.
    /(?:>>?|\btee\b|\bcp\b|\bmv\b|\bdd\b|\bsed\s+-\w*i|\bchmod\b|\bln\b)\s*[^|;&]*\bscripts\/(?:deploy[\w.-]*|rollback)\.sh\b/i,
    'Blocked: do not modify the production deploy/rollback scripts from the shell — they gate prod and must stay exactly as committed.',
  ],
];

if (isCommit && /co-authored-by|generated with \[?claude|noreply@anthropic\.com/i.test(cmd)) {
  block(
    'Blocked: commit messages must never include a Claude co-author or attribution line (project owner rule). Remove the Co-Authored-By / "Generated with Claude" lines and commit again.',
  );
}

for (const [re, msg] of rules) if (re.test(cmd)) block(msg);
process.exit(0);
