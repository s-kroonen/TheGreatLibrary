Stack: Next.js App Router, TS, Tailwind, shadcn/ui, Drizzle + Postgres, Better Auth.
Design: mobile-first (design at 375px, then scale up), clean/minimal, one accent color,
generous spacing, system font stack, 44px touch targets, dark mode via CSS variables.
Structure: /app (routes), /db (schema + migrations), /lib/auth.ts, /components/ui.
Before dev server: `service postgresql start` if it isn't running.
Run `npx drizzle-kit push` after schema changes.
