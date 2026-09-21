# The Great Library

A personal book inventory app: catalogue what you own, track wishlists,
follow series completion, and share a read-only wishlist link — no
account needed to view it.

Stack: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui,
Drizzle ORM + Postgres, Better Auth. Book data comes from Google Books
and Open Library.

## Local development

### Prerequisites

- Node.js 22+
- PostgreSQL 16 (running locally, or via Docker — see below)

### Setup

```sh
npm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — defaults to `postgres://librarian:librarian@localhost:5432/greatlibrary`.
  Either create that role/database locally, or point it at whatever
  Postgres instance you're running.
- `BETTER_AUTH_SECRET` — any random string for local dev (`openssl rand -hex 32`).
- `BETTER_AUTH_URL` — `http://localhost:3000` for local dev.
- `GOOGLE_BOOKS_API_KEY` — optional but recommended; see **Google Books API key** below.

Start Postgres (adjust for your OS/setup):

```sh
service postgresql start
```

Push the schema (needed once, and again after any `db/schema.ts` change):

```sh
npm run db:push
```

Run the dev server:

```sh
npm run dev
```

The app is at `http://localhost:3000`.

### Running in WebStorm

Opening the project in WebStorm picks up the shared run configurations
committed in `.idea/runConfigurations/`:

- **Dev Server** — `npm run dev`
- **DB Push** — `npm run db:push`

Postgres itself isn't managed by these — start it separately (`service postgresql start`,
Docker, or however you normally run it) before using **Dev Server**.

### Google Books API key

Book search works without one, but shares Google's low, per-IP anonymous
quota — the usual cause of "the same search sometimes finds nothing."
A free key (no billing required for normal usage) fixes that:

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Library** → enable **Books API**.
3. **APIs & Services → Credentials → Create credentials → API key.**
4. Optionally restrict the key to the Books API only.
5. Put it in `.env` as `GOOGLE_BOOKS_API_KEY`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:push` | Push `db/schema.ts` to the database |
| `npm run verify:google-books` | Check whether `GOOGLE_BOOKS_API_KEY` is set and working against the real API |
| `npx tsx scripts/backfill-series.ts` | Re-link any book missing its series (runs automatically on every deploy — see below) |

## Deploying

See [DEPLOY.md](./DEPLOY.md) for deploying to Portainer via Docker Compose.
