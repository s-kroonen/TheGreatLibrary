# Deploying to Portainer (Community Edition)

Portainer CE can't auto-redeploy from a new *image* (that's a Business
Edition feature). Instead we use a **Git-based stack with a redeploy
webhook**: Portainer holds the git URL, builds the image itself on the
Portainer host from the `Dockerfile` in this repo, and GitHub Actions just
pings a webhook to say "there's a new commit, rebuild now."

## One-time setup in Portainer

1. **Stacks → Add stack → Repository.**
   - Repository URL: this repo's URL, reference `refs/heads/main`.
   - Compose path: `docker-compose.yml`.
   - Enable **"GitOps updates"** is optional — the webhook below is more
     immediate and doesn't need Portainer polling GitHub.
2. Under **Environment variables**, set (these are *not* committed to the
   repo — see `.env.example` for the full list):
   - `POSTGRES_PASSWORD` — a real password.
   - `BETTER_AUTH_SECRET` — a random 32+ byte string (e.g. `openssl rand -hex 32`).
   - `BETTER_AUTH_URL` — the public URL you'll reach the app at, e.g. `https://library.yourdomain.com`.
   - `APP_PORT` — the host port to publish (defaults to 3000 if unset).
   - `GOOGLE_BOOKS_API_KEY` — optional but recommended (see below).
3. Deploy the stack once manually to confirm it builds and starts.
4. Open the stack → **Webhooks** → enable it → copy the webhook URL.
   This is a plain `POST` endpoint that tells Portainer: pull the repo again,
   rebuild the image locally (since `docker-compose.yml`'s `app` service uses
   `build:`, not `image:`), and recreate the container. No registry involved.

## One-time setup in GitHub

Add the webhook URL from step 4 as a repository secret:

- **Settings → Secrets and variables → Actions → New repository secret**
- Name: `PORTAINER_STACK_WEBHOOK_URL`
- Value: the URL you copied from Portainer

## What happens on push

`.github/workflows/deploy.yml` runs on every push to `main`:

1. `verify` job — installs deps, lints, type-checks, and does a local
   `docker build` (no push, no registry) purely to confirm the image still
   builds before anything touches production.
2. `deploy` job — only runs if `verify` passed, and just does
   `curl -X POST "$PORTAINER_STACK_WEBHOOK_URL"`. Portainer then pulls the
   repo and rebuilds/restarts the stack on its own host.

If `verify` fails (lint, type error, broken Dockerfile), the webhook is
never called, so a broken commit can't take production down.

## Getting a Google Books API key (recommended)

Without a key, book search runs against Google's anonymous, per-IP quota,
which is small and **shared with everyone else on that IP range** — not
just this app. That's the actual cause of "I search the same title twice
and it sometimes finds nothing": the quota got hit, not anything wrong
with the query.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/),
   create a project (or reuse one) — no billing account required for this.
2. **APIs & Services → Library** → enable **"Books API"**.
3. **APIs & Services → Credentials → Create credentials → API key.**
4. Optionally restrict the key to the Books API only.
5. Set it as `GOOGLE_BOOKS_API_KEY` in the Portainer stack's environment
   variables and redeploy.

This moves the quota onto your own project, which is far higher and
isn't shared with unrelated traffic.

## Database migrations

The container's entrypoint (`docker-entrypoint.sh`) runs
`drizzle-kit push --force` against `DATABASE_URL` before starting the
server, so schema changes in `db/schema.ts` apply automatically on every
redeploy. This is the same tool used in local dev (`npm run db:push`) —
fine for a single-tenant personal app; if this ever needs zero-downtime
migrations with rollback history, switch to `drizzle-kit generate` +
`drizzle-kit migrate` instead.

## Local testing of the exact production image

```sh
cp .env.example .env   # fill in real values
docker compose up --build
```
