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
- PostgreSQL 16 — either installed locally, or via Docker (see **Postgres via Docker** below, the easier route if you don't already have Postgres set up)

### Setup

```sh
npm install
cp .env.example .env
```

Fill in `.env` (the defaults already match the Docker Postgres setup below,
so if you're using that you can leave `DATABASE_URL` as-is):

- `DATABASE_URL` — defaults to `postgres://librarian:librarian@localhost:5432/greatlibrary`.
- `BETTER_AUTH_SECRET` — any random string for local dev (`openssl rand -hex 32`).
- `BETTER_AUTH_URL` — `http://localhost:3000` for local dev.
- `GOOGLE_BOOKS_API_KEY` — optional but recommended; see **Google Books API key** below.

Start Postgres — either your own local install:

```sh
service postgresql start
```

or in Docker (see **Postgres via Docker** below).

Push the schema (needed once, and again after any `db/schema.ts` change):

```sh
npm run db:push
```

Run the dev server:

```sh
npm run dev
```

The app is at `http://localhost:3000`.

### Postgres via Docker

Two different things, depending on what you want:

**Just Postgres, for day-to-day dev** — this is the one that pairs with
`npm run dev` above and still gives you hot reload:

```sh
docker compose -f docker-compose.dev.yml up -d
```

Starts a `postgres:16-alpine` container on `localhost:5432` with a
persistent volume, using the same `librarian`/`librarian`/`greatlibrary`
credentials `DATABASE_URL` already defaults to — no extra env vars
needed. Stop it with `docker compose -f docker-compose.dev.yml down`
(add `-v` to also wipe the data).

**The whole app, built as the real production image** — no hot reload,
but confirms the actual Docker build/Postgres/entrypoint sequence works
exactly like it will in production:

```sh
docker compose up --build
```

This is `docker-compose.yml` (the same file Portainer deploys from — see
[DEPLOY.md](./DEPLOY.md)), so it needs the fuller set of env vars that
file's `${...}` references expect (`POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`,
etc.) — set in `.env` as usual.

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
