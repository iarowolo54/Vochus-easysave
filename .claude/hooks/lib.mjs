import { readFileSync } from 'node:fs';
import path from 'node:path';

export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

export const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

export function rel(file) {
  if (!file) return null;
  const r = path.relative(projectDir, path.resolve(projectDir, file));
  return r.startsWith('..') ? null : r.split(path.sep).join('/');
}

export function block(message) {
  process.stderr.write(message.trim() + '\n');
  process.exit(2);
}

export function warn(message) {
  process.stderr.write(message.trim() + '\n');
  process.exit(0);
}
