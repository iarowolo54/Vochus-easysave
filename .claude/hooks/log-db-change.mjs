import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectDir, readInput } from './lib.mjs';

// Records every change an agent makes to the PRODUCTION database in .claude/db-changes.md
// (gitignored, one copy across worktrees, next to the board). Two sources:
//   1. A clean production deploy: the migrations it applied and the backup it took first.
//   2. A command run against the production server that reads like a database change
//      (sqlite3, prisma, UPDATE/DELETE/INSERT/ALTER/DROP, a db file copy).
// It runs after the command and never blocks. App writes by users are not here: those are in the AuditLog table.

const HEADING = '# Production database change log (written by a hook, newest last; leave these lines in place)';
const KEEP = 60;
const SERVER = /69\.197\.164\.193/;
const DB_WORDS = /(sqlite3|prisma|migrate|db push|dev\.db|\.db\b|\.sqlite3?\b|update\s+["'`\w]+\s+set|delete\s+from|insert\s+into|alter\s+table|drop\s+(table|column|index)|truncate)/i;
const DEPLOY = /^(?:cd (\/[A-Za-z0-9_./-]+)\s*&&\s*)?(ALLOW_DB_PUSH=1 )?(?:\.\/)?scripts\/(deploy|rollback)\.sh$/;

const input = readInput();
const command = String(input.tool_input?.command ?? '').trim();
const failed = input.hook_event_name === 'PostToolUseFailure';
const background = input.tool_input?.run_in_background === true;

function attempt(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function responseText() {
  const r = input.tool_response;
  if (r == null) return '';
  if (typeof r === 'string') return r;
  return [r.stdout, r.output, r.stderr, r.content].filter((x) => typeof x === 'string').join('\n') || attempt(() => JSON.stringify(r), '');
}

// Secrets must never reach the log: mask anything that looks like a credential assignment or key.
function redact(text) {
  return text
    .replace(/(password|passwd|pass|secret|token|key|pin|otp)(\s*[=:]\s*)\S+/gi, '$1$2[hidden]')
    .replace(/\b(sk|pk)_(live|test)_\w+/g, '[hidden]')
    .replace(/\s+/g, ' ');
}

function boardDir() {
  const common = attempt(
    () => execFileSync('git', ['-C', String(input.cwd ?? projectDir), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    null,
  );
  return path.join(common ? path.dirname(common) : projectDir, '.claude');
}

function entryFor() {
  const when = new Date().toLocaleString('sv-SE').slice(0, 16);
  const who = `session ${String(input.session_id ?? 'unknown').slice(0, 8)}`;
  const result = failed ? 'FAILED or cut off, may have partly applied, check the live data' : background ? 'started in the background, result not recorded' : 'ok';

  const m = command.match(DEPLOY);
  if (m) {
    const [, , dbPush, script] = m;
    if (script === 'rollback') return `- ${when} | rollback | ${result} | code only, the database is NOT restored | ${who}`;
    const out = responseText();
    const migrations = [...out.matchAll(/Applying migration `([^`]+)`/g)].map((x) => x[1]);
    const backup = out.match(/backup verified and saved: (\S+)/)?.[1];
    const noPending = /No pending migrations/.test(out);
    const parts = [
      `- ${when}`,
      `deploy${dbPush ? ' with a schema sync (db push)' : ''}`,
      result,
      migrations.length
        ? `migrations applied: ${migrations.join(', ')}`
        : noPending
          ? 'no database changes (no pending migrations)'
          : 'migrations: not captured, see the deploy output',
    ];
    if (backup) parts.push(`restore point: ${path.basename(backup)}`);
    parts.push(who);
    return parts.join(' | ');
  }

  // A command sent to the production server that looks like it reads or changes the database.
  if (SERVER.test(command) && DB_WORDS.test(command)) {
    const shown = redact(command).slice(0, 300);
    return `- ${when} | manual command on the server | ${result} | ${shown} | ${who}`;
  }
  return null;
}

const entry = entryFor();
if (!entry) process.exit(0);

const file = path.join(boardDir(), 'db-changes.md');
try {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('- ')) : [];
  lines.push(entry);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${HEADING}\n\n${lines.slice(-KEEP).join('\n')}\n`);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: `Logged in ${file}.` } }));
} catch (err) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: `This production database change could NOT be logged automatically (${err.code ?? 'error'}). Add it to ${file} by hand.` } }));
}
process.exit(0);
