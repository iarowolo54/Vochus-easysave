# TypeScript

The build is configured with `typescript.ignoreBuildErrors: true` (`next.config.ts`), so `npm run build` will **not** fail on type errors. Treat `npx tsc --noEmit` as the real type gate and run it before calling work done.

## For new / edited code

- No new `any` or `as any`. Use `unknown` + narrowing. (The legacy code is full of `as any` — the invariants hook only warns, it won't block; don't add more.)
- Use `@ts-expect-error <reason>`, never `@ts-ignore`.
- No TS `namespace`; use ES modules.
- Don't leave `.only` / `.skip` in any test you add.
- No `process.env.X ?? 'literal-fallback'` for secrets or URLs — fail closed, or centralise env reads.

These are advisory (warned by `.claude/hooks/invariants.mjs`), not enforced, because the inherited codebase predates them. Aim to leave each file you touch no worse, and ideally a little cleaner.
