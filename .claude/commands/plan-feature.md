---
description: Plan a feature before writing code (scope, data model, API, files, risks)
argument-hint: "<feature name or description>"
---

Plan the feature: **$ARGUMENTS**

If this is a small change, say so, skip the formal plan, and describe the approach in a few lines. Otherwise:

1. Read the relevant existing code (the API routes, `prisma/schema.prisma`, the `src/lib` helpers, and the pages involved).
2. Produce a short plan:
   - **Scope:** what's in, what's explicitly out.
   - **Actors & permissions:** which of customer / agent / sub-agent / staff / super admin can do what; what ownership checks each endpoint needs.
   - **Data:** Prisma model/field/index/migration changes.
   - **Money:** any balance changes — which wallets, the fee/commission split, and how the write stays atomic.
   - **API:** routes to add/change under `src/app/api/**`, with method and auth.
   - **UI:** pages/components to add/change, and the mobile (WebView) implications.
   - **Risks / open questions** — ask me about anything ambiguous instead of guessing.
3. Order the work into small, independently verifiable steps (schema → API → UI).

Do not write code until I approve the plan.
