# Running multiple agents (8 GB Mac)

This project is developed on an 8 GB Mac with little free disk. Agents think remotely, so what they cost locally is the commands they run. Follow these limits whenever more than one session or agent is active.

## Limits at any one time

| Work | Limit |
|---|---|
| Read-only work (review, search, audit) | Several, while nothing heavy is running |
| Agents writing code, nothing running | 2–3, each in its own worktree |
| Full checks (`npx tsc --noEmit`, `next build`, Flutter/Gradle builds) | 1 |
| Dev server and browser testing | 1 agent owns them |
| Android emulator | 1, with nothing else heavy running |

If the limit is reached, wait or use a cloud agent. Don't start another local one.

## Dev server

- Only one dev server runs at a time. Before starting one, check: `lsof -nP -iTCP:3000 -sTCP:LISTEN`.
- If another session owns it, don't kill or restart it without the user's say-so. Use it, or hand your change to its owner for testing.
- Use `npx next dev --webpack -p <port>`. `npm run dev` also starts ngrok, so use it only when testing on a physical phone.
- Worktrees use their own port (3001 and up), and only when the main server is stopped.
- Stop any server, Gradle daemon or emulator you started once you're finished. Say so if you leave one running on purpose.

## Worktrees and the Prisma client

**Never symlink a worktree's `node_modules` to the main repo.** The Prisma client resolves `file:./dev.db` from wherever `prisma generate` last ran, so generating through a shared `node_modules` silently moves every server using it onto that worktree's database. Clone it instead (copy-on-write, so almost no extra disk):

```bash
cp -cR ../../node_modules ./node_modules
npx prisma generate
```

Don't run `prisma generate` in a worktree whose `node_modules` is a symlink.

If local accounts or data vanish or change unexpectedly, check this before anything else:

```bash
grep sourceFilePath node_modules/.prisma/client/index.js
lsof -p "$(pgrep -f next-server | head -1)" | grep '\.db'
```

Remove a worktree and its `.next` once its branch is merged.

## Keeping agents out of each other's way

- Split work by files. Don't give two agents the same file, especially `src/app/globals.css`.
- UI passes across screens that share CSS go to one agent.
- While writing, check only the files you changed. Run the full `tsc` or build once at the end, one branch at a time.
- One agent does the merging and final test.
- Before committing, stage only your own files. Another session's changes can be in the same working tree.

## Cloud agents

Use them when a task needs its own builds or running app while the Mac is already busy, and can be finished from the repo alone.

- **Good fit:** a self-contained feature or fix on its own branch, fixing type errors across many files, a long audit, tests, overnight batches.
- **Not a fit:** the emulator, Bluetooth printer or real fingerprint testing; anything needing local `dev.db` data (it's gitignored); production deploys, which the user approves.
- **Secrets:** never give a cloud agent live Paystack, SMTP or SMS keys, or production data. Use test keys or mocks.
- Cloud results come back as a branch to review and test locally, one at a time.
