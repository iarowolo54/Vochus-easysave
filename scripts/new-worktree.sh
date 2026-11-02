#!/bin/bash

# Creates an isolated git worktree for an agent. See .claude/rules/agents-and-resources.md.
#
#   ./scripts/new-worktree.sh <name> [branch]
#
# Gives it its own node_modules (a copy-on-write clone, so almost no extra disk), its own Prisma
# client and its own empty dev.db, so it can't repoint another server at the wrong database.
# Defaults to branch feature/<name>, cut from the latest local main.

set -euo pipefail

NAME="${1:-}"
if [[ ! "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Usage: ./scripts/new-worktree.sh <name> [branch]   (name: lowercase letters, digits, hyphens)" >&2
  exit 1
fi
BRANCH="${2:-feature/$NAME}"

ROOT="$(git rev-parse --path-format=absolute --git-common-dir)"
ROOT="$(dirname "$ROOT")"
DIR="$ROOT/.worktrees/$NAME"

if [ -e "$DIR" ]; then
  echo "Already exists: $DIR" >&2
  exit 1
fi
if [ ! -d "$ROOT/node_modules" ] || [ -L "$ROOT/node_modules" ]; then
  echo "Needs a real node_modules in $ROOT. Run npm install there first." >&2
  exit 1
fi

git -C "$ROOT" worktree add -q -b "$BRANCH" "$DIR" main
cp -cR "$ROOT/node_modules" "$DIR/node_modules"

cd "$DIR"
npx prisma generate >/dev/null
npx prisma migrate deploy >/dev/null

echo "Ready: $DIR (branch $BRANCH)"
echo "Its dev.db has the schema but no data. Only one dev server at a time; use -p 3001 or higher here."
