import { readFileSync } from 'node:fs';
import path from 'node:path';
import { projectDir, readInput, rel, warn } from './lib.mjs';

const file = rel(readInput().tool_input?.file_path);
if (!file || !/\.(ts|tsx|mts)$/.test(file) || file.endsWith('.d.ts')) process.exit(0);
if (!/^src\//.test(file)) process.exit(0);

let src;
try {
  src = readFileSync(path.join(projectDir, file), 'utf8');
} catch {
  process.exit(0);
}

const isTest = /\.test\.tsx?$|\/__tests__\//.test(file);

const checks = [
  { re: /@ts-ignore\b/, msg: 'Use `@ts-expect-error <reason>` instead of `@ts-ignore`.' },
  { re: /^\s*(export\s+)?(declare\s+)?namespace\s+\w+/, msg: 'No `namespace` — use ES modules.' },
  { re: /\b(it|test|describe)\.only\(/, when: isTest, msg: 'Remove `.only` before finishing.' },
  { re: /\b(it|test|describe)\.skip\(/, when: isTest, msg: 'Remove `.skip` before finishing.' },
  {
    re: /process\.env\.[A-Z_]+\s*\?\?\s*['"][^'"]+['"]/,
    msg: 'No hardcoded fallback for an env var (secrets/URLs) — fail closed or read it from one env module.',
  },
];

const lines = src.split('\n');
const violations = [];
for (const c of checks) {
  if (c.when === false) continue;
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (c.re.test(line))
      violations.push(`  ${file}:${i + 1} — ${c.msg}\n      ${line.trim().slice(0, 140)}`);
  });
}

if (violations.length) {
  warn(
    `Advisory (not blocking) — invariant issues in ${file}. Fix new ones; legacy ones are known:\n${violations.join('\n')}`,
  );
}
process.exit(0);
