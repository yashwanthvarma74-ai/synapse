# Deploying Synapse so anyone can use it

**Status: written and partly tested.** The Atlas connection, object storage (against a real MinIO),
and every setting named here were run on a laptop. **Nothing has been deployed to a public host**, and
`docker compose` was **not run** (Docker is not installed on the development machine); its YAML was only
checked for structure. Expect to fix small things the first time.

## Free deployment (no credit card): Vercel + Render + Atlas

This is the cheapest route and needs no card. **Status: every file below was prepared and the server was
run in exactly this mode locally (one port, Node 22, production settings, a real sync), but the Render and
Vercel steps themselves have not been performed yet.**

| Part | Where | Cost | Catch |
|---|---|---|---|
| Website | Vercel (Hobby plan) | free | personal, non-commercial use |
| Server (API + live sync) | Render (free web service, Singapore) | free | **sleeps after ~15 minutes without traffic**; the first visitor then waits roughly a minute, and open live sessions drop |
| Database | MongoDB Atlas M0 (Mumbai) | free | 512 MB |

Redis is not needed: one server instance has no other gateway to talk to. Uploads and the AI summary stay
off until you add their settings.

**Keeping the server awake.** `.github/workflows/uptime.yml` checks the site every 5 minutes. Once you set its
two variables it also stops the free server from sleeping. GitHub does not promise exact timing for scheduled
runs (they can be delayed by many minutes at busy times), so expect an occasional cold start anyway.

### Steps

1. **Put the code on GitHub** (both hosts deploy from it). Create an empty repository, then from the project
   folder: `git remote add origin https://github.com/<you>/synapse.git` and `git push -u origin main`.
   Nothing secret is in the repository: `server/.env` is git-ignored.
2. **Atlas:** Network Access must allow `0.0.0.0/0` (Render's addresses change). Your connection string is in
   `server/.env`; you will paste it into Render, not into GitHub.
3. **Render:** New > Blueprint > choose the repository. When asked, set `MONGO_URL` to your Atlas string and
   `WEB_ORIGIN` to a placeholder for now (`https://example.com`). Wait for the first deploy to go green and
   copy its address (like `https://synapse-server-xxxx.onrender.com`). Check
   `https://<that address>/health` shows `{"ok":true,...}`.
4. **Vercel:** New Project > import the repository > set **Root Directory** to `web` > add two environment
   variables **before the first deploy**: `NEXT_PUBLIC_API_URL` = the Render address and
   `NEXT_PUBLIC_GATEWAY_URL` = the same address with `wss://` instead of `https://`. Deploy, and copy the
   Vercel address.
5. **Back in Render:** change `WEB_ORIGIN` to the Vercel address (no trailing slash) and let it redeploy.
   Until you do, browsers are blocked by the server's cross-origin rule.
6. **Open the Vercel address**, press **Try it now**, then test the invite link in a private window.
7. **Keep-alive:** in the GitHub repository, Settings > Secrets and variables > Actions > Variables, add
   `SYNAPSE_API_URL` and `SYNAPSE_GATEWAY_URL`, both set to the Render address (the gateway one with `wss://`).

If something fails: Render's **Logs** tab shows the server's JSON log lines; a blank page with network errors in
the browser console usually means step 5 was missed or a `NEXT_PUBLIC_` variable was set after the build (they
are baked in at build time; change them and redeploy).

## The shape

```
Browser ──HTTPS──> Web app (Next.js)
   │ ──HTTPS──────> API (Express)          ──> MongoDB Atlas
   │ ──WSS────────> Gateways (WebSocket) ──┘      (+ Atlas Search)
   │                    └─ Redis (only when you run 2+ gateways)
   └ ──HTTPS PUT──> Object storage (R2 / S3), straight from the browser
```

**Never let browsers connect to the database.** They talk to the API and the gateway; only those talk
to MongoDB. Anyone with a database connection string can read and delete everything.

## 1. The database: MongoDB Atlas

1. Create a free **M0** cluster (pick a region near your users).
2. **Database Access:** add a user with a long random password and the "read and write to any
   database" role.
3. **Network Access:** add `0.0.0.0/0` once your server's address is not fixed (most hosts), or the host's
   fixed addresses if it has them. The password is then your protection, so make it strong.
4. **Connect > Drivers:** copy the `mongodb+srv://...` string into the server's `MONGO_URL` setting.
   Never commit it. Locally it goes in `server/.env` (git-ignored; `server/.env.example` is the template).
5. Start the server once: it creates the indexes and the **Atlas Search index** (`doc_search`) itself. It
   takes a minute or two to become ready; until then search falls back to the plain text index.

## 2. Object storage (uploads)

Cloudflare R2 (generous free tier) or AWS S3. Create a **private** bucket and an access key limited to
it, then set `S3_ENDPOINT` (R2: `https://<account>.r2.cloudflarestorage.com`; leave empty for AWS),
`S3_REGION` (`auto` for R2), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

**The bucket needs a CORS rule**, because browsers upload to it directly:

```json
[{ "AllowedOrigins": ["https://your-web-address"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type", "content-length"], "MaxAgeSeconds": 3600 }]
```

If the server reaches the bucket by a different address than browsers do (Docker, private networks), set
`S3_PUBLIC_ENDPOINT` to the browsers' address; signed URLs carry it. Details and risks: ADR 0014.

## 3. The server (API + gateway)

Any host that runs Node and supports **WebSockets** (Fly.io, Render, Railway, a VPS). Serverless
platforms that cannot hold a WebSocket open (Vercel functions) are not suitable for this part.

| Setting | Meaning |
|---|---|
| `JWT_SECRET` | **Required.** 32+ random characters. `openssl rand -base64 48`. Changing it logs everyone out |
| `MONGO_URL`, `MONGO_DB` | Atlas string and database name (default `synapse`) |
| `WEB_ORIGIN` | Your web app's address, comma-separated if several. **Browsers from other origins are blocked** |
| `PUBLIC_API_URL` | The API's public address, used in file links |
| `REDIS_URL` | Only needed with 2+ gateways (they relay edits through it) |
| `SERVICE` | `both` (default), or `api` / `gateway` to run them as separate processes |
| `PORT` | If set (Render, Railway and Heroku set it), the API and the live-sync gateway share this one port; `API_PORT` and `GATEWAY_PORT` are then ignored |
| `API_PORT`, `GATEWAY_PORT` | Defaults 4001 and 4000 when `PORT` is not set |
| `S3_*` | See section 2. Without them, uploads are off |
| `ANTHROPIC_API_KEY`, `SUMMARY_MODEL` | Turns on the AI summary (ADR 0016). Sends page text to Anthropic |
| `GUESTS_ENABLED`, `MAX_GUESTS_PER_HOUR` | Guest accounts (ADR 0012) |
| `AUTH_RATE_LIMIT`, `INVITE_RATE_LIMIT`, `UPLOAD_RATE_LIMIT`, `SUMMARIES_PER_HOUR` | Abuse limits (in memory, per instance) |
| `METRICS_PORT` | Prometheus metrics (default 9464, bound to localhost; `0` turns it off) |
| `CHAT_RETENTION_DAYS` | How long chat messages are kept (default 180). They expire on their own through a MongoDB TTL index |
| `LOG_LEVEL` | `info` (default), `debug`, `warn`... Logs are JSON, one per line |
| `NODE_ENV=production` | Makes a missing `JWT_SECRET` a hard error |

Start command: `npx tsx src/index.ts` from `server/` (a `Dockerfile` is provided). Put the API and the
gateway behind **HTTPS / WSS** (most hosts do this for you). A browser on an HTTPS page will refuse a plain
`ws://` connection.

## 4. The web app

Vercel, Netlify or any Node host. The two addresses are baked in **at build time**:

```
NEXT_PUBLIC_API_URL=https://api.your-address
NEXT_PUBLIC_GATEWAY_URL=wss://gateway.your-address
```

`NEXT_PUBLIC_TELEMETRY=off` turns off the browser timing beacon.

## 5. Everything on one machine with Docker

```bash
cp .env.example .env        # set JWT_SECRET
docker compose up --build   # then open http://localhost:3000
```

Starts MongoDB, Redis, MinIO, the API, **two gateways behind a small Caddy load balancer** (so you can
watch an edit cross between gateways through Redis), and the web app. Set `MONGO_URL` in `.env` to use
Atlas instead. **Untested**, see the status line at the top.

## Before you tell anyone the address: a checklist

- [ ] `JWT_SECRET` is long, random and set only on the server.
- [ ] `WEB_ORIGIN` lists only your real web address.
- [ ] HTTPS and WSS everywhere.
- [ ] Atlas user password is strong; Atlas Network Access reviewed.
- [ ] Decide on guests: leave on (easiest for visitors) or `GUESTS_ENABLED=false`; schedule
      `npm run prune-guests -- --days 30 --delete` (nothing deletes guests on its own).
- [ ] Bucket is private, with the CORS rule above.
- [ ] If `ANTHROPIC_API_KEY` is set: you are happy for page text to go to Anthropic, and the hourly
      limit suits your budget.
- [ ] Set the uptime workflow variables (`.github/workflows/uptime.yml`) and add Alertmanager or a
      notification path; the alert rules notify nobody on their own.
- [ ] Read "What is not built" in the README: no email verification, no password reset, tokens in
      `localStorage`, in-memory rate limits.
