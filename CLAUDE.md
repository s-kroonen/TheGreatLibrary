Stack: Next.js App Router, TS, Tailwind, shadcn/ui, Drizzle + Postgres, Better Auth.
Design: mobile-first (design at 375px, then scale up), clean/minimal, one accent color,
generous spacing, system font stack, 44px touch targets, dark mode via CSS variables.
Structure: /app (routes), /db (schema + migrations), /lib/auth.ts, /components/ui.
Before dev server: `service postgresql start` if it isn't running.
Run `npx drizzle-kit push` after schema changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
