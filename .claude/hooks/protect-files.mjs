import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { block, projectDir, readInput, rel } from './lib.mjs';

const input = readInput();
const rawPath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;

// Layer: the production deploy/rollback scripts gate prod (guard-deploy also
// verifies their content against HEAD before the UI approval). Claude must not
// modify them via Write/Edit — in the main checkout OR any worktree (where rel()
// is null) — so checked by basename, before the rel early-exit.
if (rawPath) {
  const rawBase = path.posix.basename(String(rawPath).replace(/\\/g, '/').toLowerCase());
  if (/^(?:deploy[\w.-]*|rollback)\.sh$/.test(rawBase)) {
    block(
      `Blocked: ${rawPath} is a production deploy/rollback script that gates prod. Claude must not modify it — change it yourself if you need to.`,
    );
  }
}

const file = rel(rawPath);
if (!file) process.exit(0);
// Match case-insensitively: the dev filesystem (macOS) is case-insensitive,
// so .ENV resolves to the same file as .env. Keep `file` for git/messages.
const lower = file.toLowerCase();
const base = path.posix.basename(lower);

if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
  block(
    `Blocked: ${file} holds live secrets and must not be edited by Claude. Tell the user which keys to set and let them edit it.`,
  );
}

if (base === 'package-lock.json') {
  block(
    'Blocked: package-lock.json is generated. Change package.json and run `npm install` instead.',
  );
}

if (/\.db$|\.db\.(bak|journal)$|\.sqlite3?$/.test(base)) {
  block(`Blocked: ${file} is a database file (real/seeded data). Never write to it directly; use Prisma.`);
}

if (/^prisma\/migrations\/.+\.sql$/.test(lower)) {
  // Compare case-insensitively against the committed tree (the FS is case-insensitive,
  // but git's tree is not). Fail open: this is a forward-only hygiene rule, not a
  // security boundary, and a fresh repo with no HEAD must still allow a first migration.
  let committed = false;
  try {
    const tree = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'prisma/migrations'],
      { cwd: projectDir, encoding: 'utf8' },
    );
    committed = tree.split('\n').some((p) => p.toLowerCase() === lower);
  } catch {
    committed = false;
  }
  if (committed) {
    block(
      `Blocked: ${file} is a committed migration. Migrations are forward-only — create a new one with \`prisma migrate dev\` instead of editing this one.`,
    );
  }
}

process.exit(0);
