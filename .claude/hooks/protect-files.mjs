import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { block, projectDir, readInput, rel } from './lib.mjs';

const input = readInput();
const file = rel(input.tool_input?.file_path ?? input.tool_input?.notebook_path);
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
  let committed = false;
  try {
    execFileSync('git', ['cat-file', '-e', `HEAD:${file}`], { cwd: projectDir, stdio: 'ignore' });
    committed = true;
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
