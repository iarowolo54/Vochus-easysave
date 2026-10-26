import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { projectDir, readInput, rel } from './lib.mjs';

const file = rel(readInput().tool_input?.file_path);
if (!file || !/\.(ts|tsx|js|mjs|cjs|json|css|md)$/.test(file)) process.exit(0);
if (/(^|\/)(node_modules|dist|coverage|\.next|build)\/|package-lock\.json$/.test(file))
  process.exit(0);

const prettier = path.join(projectDir, 'node_modules', '.bin', 'prettier');
if (!existsSync(prettier)) process.exit(0);

try {
  execFileSync(prettier, ['--write', '--log-level', 'warn', file], {
    cwd: projectDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 20_000,
  });
} catch {
  process.exit(0);
}
process.exit(0);
