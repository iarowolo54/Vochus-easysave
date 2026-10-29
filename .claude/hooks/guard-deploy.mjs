import { execFileSync } from 'node:child_process';
import { block, projectDir, readInput } from './lib.mjs';

// Guards PRODUCTION deploys/rollbacks and commands that could tamper with
// production user data. Staging (deploy-staging.sh, the -staging dir) and local
// dev (vochus-easysave-main) are intentionally not matched.
//
// A production deploy/rollback is never allowed silently: the human approves the
// EXACT command in the Claude Code UI (an `ask` permission decision). That is the
// only real boundary available here — Claude runs as the same OS user as the
// human, so no file-based token on the shared filesystem could be a boundary the
// agent can't forge (a text denylist is defence in depth at best). The UI prompt
// is out-of-band: the agent cannot approve it. Everything destructive that is NOT
// a clean deploy/rollback invocation is still hard-blocked.

const raw = String(readInput().tool_input?.command ?? '');
// Normalise for matching: drop quotes/backslashes so they can't split a token.
const cmd = raw.replace(/['"\\]/g, '');

// The production app directory — on the server only (~, $HOME, or the absolute
// home), exactly `vochus-easysave` (the boundary excludes -staging / -main).
const prodPath = /(?:\/home\/administrator|~|\$\{?HOME\}?)\/vochus-easysave(?![-\w])/;
const prodTargeted = prodPath.test(cmd);

// Detect EXECUTING the prod deploy or rollback script (command position, after
// optional env assignments / wrappers / a shell), NOT merely referencing it
// (so git add / cat / grep on the file is fine). Excludes deploy-staging.sh.
const wrapper = '(?:[A-Za-z_]\\w*=\\S*|sudo|env|nohup|exec|command|time|nice|ionice|bash|sh|source|\\.)(?:\\s+-\\S+)*\\s+';
const scriptExec = new RegExp(
  // `[^\\s/]*` after the name (not `[\\w.-]*`) so an obfuscated/globbed reference
  // like deploy*.sh or deploy?.sh is still recognised and forced to a clean,
  // approvable form rather than slipping through with no opinion.
  `(?:^|[;&|(\\n\`])\\s*(?:${wrapper})*(?:[\\w./-]*/)?(?:deploy(?!-staging)|rollback)[^\\s/]*\\.sh\\b`,
);

// A command is a CLEAN deploy only if the WHOLE command is exactly the
// deploy/rollback script (with an optional single `cd <dir> &&` and an optional
// ALLOW_DB_PUSH=1). No command substitution, pipes, sequencing, redirection,
// backgrounding or extra segments — so the human approves a single, legible
// command with nothing riding alongside it. (ALLOW_SEED is deliberately NOT
// allowed here — seeding prod is never a routine deploy; the user runs that
// themselves.)
function isCleanDeploy(command) {
  const c = command.trim();
  if (c.length === 0) return false;
  // Reject every shell metacharacter that enables substitution, expansion,
  // globbing, redirection, piping, sequencing or control. The approved text must
  // be exactly what executes — no `$VAR`, `$(...)`, `~`, globs or escapes that
  // could expand to something the human didn't see. `&` is intentionally NOT here
  // (`&&` is the one allowed separator); a stray single `&` is caught below.
  if (/[$`~{}()[\]*?\\<>|;!#]/.test(c) || /[\x00-\x1f]/.test(c)) return false;
  const segs = c.split('&&').map((s) => s.trim());
  if (segs.length > 2 || segs.some((s) => s.length === 0)) return false;
  if (segs.some((s) => s.includes('&'))) return false; // stray single & / backgrounding
  const deployRe = /^(?:ALLOW_DB_PUSH=1 )?(?:\.\/)?scripts\/(?:deploy|rollback)\.sh$/;
  if (!deployRe.test(segs[segs.length - 1])) return false;
  // The `cd` target must be a literal absolute path (no expansion chars — already
  // excluded above — and must start at root, so the human sees the real directory).
  if (segs.length === 2 && !/^cd \/[A-Za-z0-9_./-]+$/.test(segs[0])) return false;
  return true;
}

// The directory the command runs in: the `cd` target (a literal absolute path,
// per isCleanDeploy) or, with no cd, the project directory.
function resolveDeployDir(command) {
  const segs = command.trim().split('&&').map((s) => s.trim());
  if (segs.length === 2) {
    const m = segs[0].match(/^cd (\/[A-Za-z0-9_./-]+)$/);
    if (m) return m[1];
  }
  return projectDir;
}

// The real control behind the UI prompt: the script that will actually run must
// be the committed one, so approving `./scripts/deploy.sh` can't run tampered
// content (a text denylist on edits can't guarantee this — a worktree path or a
// parser trick routes around it). Verify, in the target checkout, that the
// deploy/rollback scripts have no tracked changes vs HEAD and no untracked
// override. Fail CLOSED: any git error (not a checkout, missing script) blocks.
function scriptsMatchHead(dir) {
  try {
    // Both scripts must be tracked and in normal state — reject skip-worktree (S)
    // or assume-unchanged (lowercase flag), which would make `git diff` ignore a
    // tampered working copy. `ls-files -v` prefixes each path with a status letter.
    const v = execFileSync('git', ['-C', dir, 'ls-files', '-v', '--', 'scripts/deploy.sh', 'scripts/rollback.sh'], { encoding: 'utf8' }).trim();
    const lines = v ? v.split('\n') : [];
    if (lines.length < 2 || !lines.every((l) => l.startsWith('H '))) return false;
    // No tracked changes vs the committed tree...
    execFileSync('git', ['-C', dir, 'diff', '--quiet', 'HEAD', '--', 'scripts/deploy.sh', 'scripts/rollback.sh'], { stdio: 'ignore' });
    // ...and no untracked override.
    const untracked = execFileSync('git', ['-C', dir, 'ls-files', '--others', '--exclude-standard', '--', 'scripts/deploy.sh', 'scripts/rollback.sh'], { encoding: 'utf8' }).trim();
    return untracked.length === 0;
  } catch {
    return false;
  }
}

function deployScriptHash(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'hash-object', 'scripts/deploy.sh'], { encoding: 'utf8' }).trim().slice(0, 12);
  } catch {
    return 'unknown';
  }
}

// 1. A clean deploy/rollback invocation: hand it to the human to approve in the
//    UI. `ask` forces a prompt even under broad allow rules; the agent cannot
//    answer it, so this is a genuine human-in-the-loop gate. First verify the
//    script that will run is the committed one.
if (isCleanDeploy(raw)) {
  const dir = resolveDeployDir(raw);
  if (!scriptsMatchHead(dir)) {
    block(
      `Blocked: the deploy/rollback scripts in ${dir} differ from the committed version (modified, untracked, or not a clean git checkout). The approval can only vouch for the committed script. Restore/commit scripts/deploy.sh and scripts/rollback.sh there, then retry.`,
    );
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          `PRODUCTION deploy/rollback in ${dir} (scripts/deploy.sh @ ${deployScriptHash(dir)}; no local diff vs committed HEAD, not skip-worktree). Approve ONLY if you intend to deploy to prod now, and only if the directory is one you recognise. Command: ${raw.trim()}`,
      },
    }),
  );
  process.exit(0);
}

// A. The destructive deploy opt-ins outside a clean deploy — wherever they
//    appear, whatever the wrapper (ALLOW_SEED=1 ./deploy.sh, env ..., sudo ...).
if (/\bALLOW_(?:DB_PUSH|SEED)\s*=\s*1\b/i.test(cmd)) {
  block(
    'Blocked: ALLOW_DB_PUSH / ALLOW_SEED would run the schema sync or the seed against PRODUCTION data. Run the deploy as a single clean command (`cd <dir> && ALLOW_DB_PUSH=1 ./scripts/deploy.sh`) so it can be approved in the UI — no pipes, redirects or extra commands. ALLOW_SEED is never auto-approved; run a prod seed yourself.',
  );
}

// B. Executing the prod deploy/rollback script in a NON-clean form (pipe,
//    redirect, chained, backgrounded, substitution). Force a clean invocation
//    so the human approves exactly what runs.
if (scriptExec.test(cmd)) {
  block(
    'Blocked: run the production deploy/rollback as a single clean command so it can be approved in the UI — exactly `cd <dir> && ALLOW_DB_PUSH=1 ./scripts/deploy.sh` (or ./scripts/rollback.sh), with no pipe, redirect, `;`, extra `&&` or `$(...)`. Staging: scripts/deploy-staging.sh.',
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
