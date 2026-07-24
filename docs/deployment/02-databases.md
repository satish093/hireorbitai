# 02 · Databases — two fully separated environments

Two databases, two servers, zero overlap:

| Env         | Database         | Where                                | Reached by                       |
| ----------- | ---------------- | ------------------------------------ | -------------------------------- |
| Production  | `hireorbit_prod` | PostgreSQL on the VPS (local socket) | the VPS backend only             |
| Development | `hireorbit_dev`  | **Neon** (free managed Postgres)     | Render dev backend + your laptop |

Separation is enforced three ways:

1. **Different physical servers** — dev (Neon) literally cannot reach prod (VPS).
2. **Naming convention** — `hireorbit_prod` vs `hireorbit_dev`.
3. **Startup guard** — `DB_GUARD` in `backend/src/config/env.ts` exits if
   `NODE_ENV` and the DB name disagree (see [README](README.md#the-cross-environment-db-guard)).

---

## A. Production DB — `hireorbit_prod` on the VPS

Production is **not live yet**, so create it cleanly. On the VPS as a Postgres
superuser (or via CloudPanel → Databases):

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE hireorbit_prod_user WITH LOGIN PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE hireorbit_prod OWNER hireorbit_prod_user;
\connect hireorbit_prod
GRANT ALL ON SCHEMA public TO hireorbit_prod_user;
SQL
```

> **CloudPanel UI alternative:** Databases → Add Database → name `hireorbit_prod`,
> user `hireorbit_prod_user`. Copy the generated password.

Connection string for `backend/.env` on the VPS (local socket, **never** exposed):

```
DATABASE_URL=postgres://hireorbit_prod_user:CHANGE_ME_STRONG@127.0.0.1:5432/hireorbit_prod
DATABASE_SSL=disable
```

Keep PostgreSQL bound to localhost (default). Do **not** open port 5432 in the
firewall — nothing outside the VPS needs it.

### Load the schema (one time)

```bash
cd ~/hireorbitai
set -a; source backend/.env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/init.sql   # consolidated schema
npm --prefix backend run migrate:up                            # any newer migrations
npm --prefix backend run bootstrap:admin                       # first SUPER_ADMIN
```

`database/init.sql` is the mechanically-generated single-file schema (regenerate
with `npm run db:build-init` after editing `database/*.sql`). New changes go in
`backend/migrations/` and apply on every deploy via `update.sh`.

---

## B. Development DB — `hireorbit_dev` on Neon

1. Sign up free at **https://neon.tech** (GitHub login is fine).
2. **Create project** → name it `hireorbit-dev`, region near you.
3. In the project, the default database is `neondb`. Either rename it or create a
   new database named **`hireorbit_dev`** (Branches → database → Add). The name
   _must_ contain `hireorbit_dev` so the guard recognises it as dev.
4. **Connection Details** → copy the **pooled** connection string. It looks like:

   ```
   postgres://USER:PASSWORD@ep-xxxx-pooler.us-east-2.aws.neon.tech/hireorbit_dev?sslmode=require
   ```

This single string is used in three places:

- GitHub secret **`DEV_DATABASE_URL`** (for `dev.yml` migrations) — [04](04-github-actions.md)
- Render env var **`DATABASE_URL`** on `hireorbit-api-dev` — [03](03-render-dev-hosting.md)
- your local `backend/.env` if you want to develop against the shared dev DB

`DATABASE_SSL=require` (Neon mandates TLS).

### Build the dev schema (one time)

From your Windows machine (no psql needed — uses Node):

```powershell
node --env-file=backend\.env.development scripts\reset-dev.mjs --yes --seed
```

This wipes `hireorbit_dev`, loads `init.sql`, applies migrations, and seeds demo
users. (Make a `backend\.env.development` from the template first — see [03](03-render-dev-hosting.md).)
After the first build, `dev.yml` keeps the schema current by running migrations
on every push to `dev`.

---

## C. Backups (production)

`scripts/backup.sh` dumps DB + uploads to `~/backups/<UTC-stamp>/`:

```bash
cd ~/hireorbitai && bash scripts/backup.sh
```

Add a daily cron (VPS, site user):

```bash
crontab -e
# 03:15 UTC daily, keep 14 days
15 3 * * * cd ~/hireorbitai && bash scripts/backup.sh && find ~/backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} \;
```

Restore with `scripts/restore.sh <stamp> all --force`. Neon keeps its own
point-in-time history, so the dev DB needs no manual backups.

---

## Alternative: `hireorbit_dev` on the VPS instead of Neon

If you must keep both DBs on the VPS (your original target), create
`hireorbit_dev` next to `hireorbit_prod`:

```bash
sudo -u postgres psql -c "CREATE ROLE hireorbit_dev_user LOGIN PASSWORD 'x';"
sudo -u postgres psql -c "CREATE DATABASE hireorbit_dev OWNER hireorbit_dev_user;"
```

Then the Render dev backend must reach it. Since Render free has no static egress
IP, you have two safe choices (do **not** just open 5432 to `0.0.0.0/0` — that
exposes the same server that runs prod):

- **Tailscale** (recommended): install on the VPS + add Render as a tailnet node;
  point `DATABASE_URL` at the VPS's tailnet IP. Postgres stays firewalled.
- **SSH tunnel** from the Render service (more fragile on free tier).

Everything else (guard, naming, migrations) is identical. Neon is simpler and
strictly safer, which is why it's the default.

→ Next: [03 · Render dev hosting](03-render-dev-hosting.md)
