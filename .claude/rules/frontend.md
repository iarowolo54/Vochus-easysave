# Frontend (Next.js App Router, `src/app`, `src/components`)

- Plain CSS: `src/app/globals.css` and `src/app/superadmin/admin.css`. No Tailwind, no design-token system — match the styles already on the page you're editing.
- Three audiences under different route groups: `/dashboard` (agent), `/customer`, `/superadmin`. Each has its own layout and nav (`BottomNav`, `AgentBottomNav`) and idle-timeout component.
- **The mobile apps are Flutter WebViews of this site** (`mobile/`, `mobile-agent/`). So:
  - Every screen must work at ~360px width and with an on-screen keyboard.
  - Don't rely on hover; make tap targets large.
  - Prefer dynamic viewport height over fixed `100vh` where the keyboard would otherwise cover inputs.
- Client vs server components: keep server-only logic and secrets out of `'use client'` components. Data that needs the session is fetched through the API routes.
- Every data view handles loading, empty, and error states — not just the happy path.
- Amount inputs: use a mobile-friendly numeric keyboard; format money consistently (don't hand-roll per screen).
