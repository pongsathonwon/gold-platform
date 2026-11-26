# Deploying GoldOffice on the company droplet

Target: the company's **DigitalOcean droplet** in Singapore, deployed by
the **HUG Jenkins** through the agent labelled **`g99`**, which runs on that droplet as user `dev` with
Docker. It replaces Cloud Build → Cloud Run + Cloud SQL + Firebase Hosting; the GCP setup is in git history
(the commit before this file was rewritten).

| Piece | What | Where |
|---|---|---|
| `postgres` | PostgreSQL 17 | container, data in docker volume `gold-platform-pgdata` |
| `api` | the Hono API | container `gold-platform-api:current` |
| `web` | the SPA in nginx; proxies `/api/` → `api` | container `gold-platform-web:current` |
| migrations | `node dist/scripts/migrate.js` | one-off `api` container, every deploy, before traffic moves |
| confirm sweep | `node dist/scripts/confirm-sweep.js` | Jenkins job, nightly 00:00 Bangkok |
| backup | `pg_dump -Fc` | Jenkins job, nightly 02:00 Bangkok, copy kept on the droplet + on Jenkins |

```
browser ──https──▶ nginx-proxy-manager (nginx_proxy, :80/:443, already serving the other golden99 sites)
                        │  proxy network (NPM's own docker network)
                        ▼
                   web (nginx) ──/api/──▶ api ──▶ postgres        ← backend network, nothing published
```

**One origin.** The SPA calls the API at `https://<host>/api/...`, so there is one domain, one certificate
and one proxy host. That removes the two-way dependency the Cloud setup had (`_API_URL` in the bundle,
`_CORS_ORIGIN` on the service, each pointing at the other).

**No published ports.** Docker's published ports bypass host firewalls such as `ufw`, so any `ports:`
mapping should be assumed open to the internet. Only `web` joins nginx-proxy-manager's network; `api` and `postgres` sit on a
private network that nothing outside the stack can reach.

| File | Role |
|---|---|
| [`Jenkinsfile`](../Jenkinsfile) | Multibranch pipeline: verify on every branch/PR; build + deploy on `main` |
| [`jenkins/verify.sh`](../jenkins/verify.sh) | install, type-check, test (in `node:22`) |
| [`jenkins/confirm-sweep.Jenkinsfile`](../jenkins/confirm-sweep.Jenkinsfile) | nightly confirm sweep |
| [`jenkins/backup.Jenkinsfile`](../jenkins/backup.Jenkinsfile) | nightly backup |
| [`deploy/compose.yml`](../deploy/compose.yml) | the stack |
| [`deploy/gold.sh`](../deploy/gold.sh) | the only way to run `docker compose` for it |
| [`deploy/restore.sh`](../deploy/restore.sh) | replace the database with a dump (cutover import, recovery) |
| [`deploy/nginx/web.conf`](../deploy/nginx/web.conf) | SPA + `/api/` proxy + cache headers |
| [`apps/web/Dockerfile`](../apps/web/Dockerfile), [`apps/api/Dockerfile`](../apps/api/Dockerfile) | the two images |

On the droplet the deploy copies `compose.yml`, `gold.sh` and `restore.sh` to
**`/home/dev/jenkins-deploy/prod/gold-platform/`**. Below, `GOLD` means
`/home/dev/jenkins-deploy/prod/gold-platform/gold.sh`.

---

## What this costs

Nothing new: the droplet and Jenkins already exist. Turning GCP off saves the Cloud SQL instance (~$30/month,
no free tier) and the warm Cloud Run instance (~$20/month). Footprint on the droplet: three small containers
(api ~100 MB RAM, nginx ~10 MB, Postgres ~100–200 MB) and a database measured in megabytes, plus a few
hundred MB of images and 14 days of dumps. Check free disk space before the first deploy.

What it costs in **guarantees** is the part to read: see "What changed from GCP" at the end.

---

## 1. One-time setup

### On the droplet (as `dev`, over SSH)

Check the tools the pipeline needs:

```bash
docker compose version          # the v2 plugin; the pipeline refuses to deploy without it
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' nginx_proxy
```

The second command must print a network other than `bridge` — that is the network `web` joins.
`gold.sh` finds it by itself each time; if it ever picks the wrong one, set `PROXY_NETWORK=<name>`.

Create the env file. It holds the only secrets, never leaves the host, and is read by `gold.sh`:

```bash
sudo install -d -o dev -g dev -m 700 /etc/gold-platform
umask 077
cat > /etc/gold-platform/prod.env <<EOF
PUBLIC_URL=https://goldoffice.golden99.co.th
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
WHOLESALE_BUY_AUTO_CONFIRM_HOUR=0
WHOLESALE_SELL_AUTO_CONFIRM_HOUR=0
EOF
chmod 600 /etc/gold-platform/prod.env
```

- **`PUBLIC_URL`** is the address operators type: `https://host`, no path, no trailing slash. It is baked
  into the SPA at build time (`VITE_API_URL=$PUBLIC_URL/api`) and is the API's `CORS_ORIGIN`. Changing it
  means re-running the `main` build.
- **`POSTGRES_PASSWORD`** goes into a URL, so hex only (the Preflight stage enforces `[A-Za-z0-9_-]{24,}`).
  **It is applied only when the volume is first created.** Changing it later in this file does not change
  the database's password: run `GOLD exec postgres psql -U gold_app -c "ALTER USER gold_app PASSWORD '...'"`
  first, then edit the file, then `GOLD up -d api`.
- The Preflight stage checks owner `dev`, mode `600`, LF line endings and each value's shape, without
  printing any of them.

### DNS and the proxy host

1. **DNS:** an `A` record for the `PUBLIC_URL` host → the droplet's public IP. (Whoever holds the `golden99.co.th`
   zone; the other golden99 names on this host were set up the same way.) If the zone is behind Cloudflare's
   proxy, read "Rate limiting on login" below first.
2. **nginx-proxy-manager** (its admin UI — reach it through an SSH tunnel, never over the public internet): *Hosts → Proxy Hosts → Add*
   - Domain: the `PUBLIC_URL` host · Scheme `http` · Forward hostname `gold-platform-web` · port `80`
   - *Block common exploits* on
   - SSL tab: *Request a new certificate* (Let's Encrypt), *Force SSL*, *HTTP/2*, *HSTS*

   Do this **after** the first successful `main` build: until the `web` container exists on the proxy
   network, NPM cannot resolve `gold-platform-web` and the host shows offline.

### Jenkins (the HUG Jenkins)

1. **Credential:** a GitHub credential that can read `pongsathonwon/gold-platform` (a fine-grained PAT with
   *Contents: read*, or a deploy key). The repository is under a personal account, not the GOLDEN-99
   organisation, so the org credential the other gold jobs use will not see it.
2. **`gold-platform`** — *New Item → Multibranch Pipeline*, GitHub branch source on that repository, build
   strategy: branches + pull requests, Script Path `Jenkinsfile`. Add a GitHub webhook (or a periodic scan)
   so a push to `main` starts a build.
3. **`gold-platform-confirm-sweep`** — *New Item → Pipeline*, *Pipeline script from SCM*, same repository,
   branch `*/main`, Script Path `jenkins/confirm-sweep.Jenkinsfile`.
4. **`gold-platform-backup`** — same, Script Path `jenkins/backup.Jenkinsfile`. Then *Configure → Enable
   project-based security* and limit read access: its artifacts are full database dumps.
5. **Run 3 and 4 once by hand** after the first `main` deploy. Jenkins registers a Jenkinsfile's `triggers`
   only after it has run once; until then neither job is scheduled.

---

## 2. Deploy

**Merge into `main`.** That is the release, as it was under Cloud Build. Every other branch and every pull
request runs `Verify` only — the replacement for the `gold-verify-pr` trigger.

| Stage | Branches | Does |
|---|---|---|
| Verify | all | `pnpm install --frozen-lockfile`, `pnpm type-check`, `pnpm test` in `node:22` |
| Preflight | `main` | compose plugin, env file (owner, mode, values), proxy container present |
| Build images | `main` | `gold-platform-api:<sha>`, `gold-platform-web:<sha>` (with `VITE_API_URL=$PUBLIC_URL/api`) |
| Deploy | `main` | start postgres → **migrate with the new image** → tag `current`→`previous`, `<sha>`→`current` → `up -d api web` |
| Health check | `main` | api healthy, `/api/health` through web's nginx, SPA served; else roll back to `previous` and fail |

Images are built on the droplet and never pushed anywhere — there is no registry. The last three builds
plus `current` and `previous` are kept; older tags are removed.

**Migrations run before traffic moves, never on server start**, as before: a failed migration fails the
build with the running release untouched. They are **not** reversed by a rollback, so the previous release
then runs against the new schema. Every migration so far is additive, which that tolerates; a destructive
one needs a two-step release (stop reading the column, then drop it).

### Operating it by hand

```bash
GOLD=/home/dev/jenkins-deploy/prod/gold-platform/gold.sh
$GOLD ps
$GOLD logs -f api
$GOLD exec postgres psql -U gold_app gold_platform
$GOLD run --rm --no-deps api node dist/scripts/confirm-sweep.js      # the sweep, now
```

**Never bare `docker compose`**: it would not find the env file or the proxy network, and from another
directory it would address a different project. `down -v` is safe in the sense that the data volume is
external and survives it — but do not reach for it.

**Rolling back by hand** (the Health check does this by itself on a failed deploy):

```bash
docker tag gold-platform-api:previous gold-platform-api:current
docker tag gold-platform-web:previous gold-platform-web:current
$GOLD up -d api web
```

Any kept `<sha>` tag works the same way. Better still, revert on `main` and let the pipeline ship it.

### Do not set `TZ`

The containers run in UTC, deliberately. Every date the business cares about is computed against
`Asia/Bangkok` explicitly — `businessDateOf()` and `todayBusinessDate()` in `@gold-platform/types`,
`nextAutoConfirmAt()` in `infrastructure/auto-confirm.ts` — and `settlement.ts` does its arithmetic in UTC
throughout. Setting `TZ=Asia/Bangkok` would change no output while making a stray
`new Date().getHours()` pass in production and fail everywhere else. The **Jenkins** cron lines carry
`TZ=Asia/Bangkok`; that is the scheduler's clock, not the app's.

---

## 3. Cutover from GCP

Run once. The database is small (tens of MB), so the freeze is minutes. Pick a time the shop is closed.

1. **Have the droplet side ready:** §1 done, a green `main` build (it creates an empty schema), the proxy host
   answering `https://<PUBLIC_URL>/api/health` with `{"status":"ok"}`. Run the backup job once — it will
   dump an empty database, which proves the job works.
2. **Stop GCP deploying:** delete or disable the `gold-deploy-main` and `gold-verify-pr` Cloud Build triggers
   (`cloudbuild*.yaml` no longer exist, so they would fail on the next push anyway).
3. **Freeze writes on GCP** — every API call returns 403 from here on, so nothing changes under the dump:
   ```bash
   gcloud run services remove-iam-policy-binding gold-api --region=asia-southeast1 \
     --member=allUsers --role=roles/run.invoker
   ```
4. **Dump Cloud SQL from the droplet.** Temporarily allow the droplet's address. `--authorized-networks`
   *replaces* the list, so read the current value first and include it if it is not empty:
   ```bash
   gcloud sql instances describe gold-platform --format='value(settings.ipConfiguration.authorizedNetworks)'
   gcloud sql instances patch gold-platform --authorized-networks=DROPLET_IP/32
   gcloud sql instances describe gold-platform --format='value(ipAddresses[0].ipAddress)'   # CLOUD_SQL_IP
   ```
   Then on the droplet, as `dev` (the password is read without echo and passed by environment, never on the
   command line):
   ```bash
   read -rs PGPASSWORD; export PGPASSWORD
   docker run --rm -e PGPASSWORD -e PGSSLMODE=require postgres:17-alpine \
     pg_dump -h CLOUD_SQL_IP -U gold_app -d gold_platform -Fc --no-owner --no-acl > ~/gold-platform-cutover.dump
   unset PGPASSWORD
   ```
   The client is 17 to match Cloud SQL's `POSTGRES_17`; an older `pg_dump` refuses a newer server.
5. **Restore into the droplet database:**
   ```bash
   /home/dev/jenkins-deploy/prod/gold-platform/restore.sh ~/gold-platform-cutover.dump
   ```
   It stops `api`/`web`, recreates the database, restores, runs migrations (a no-op: same code), and starts
   them again. If `pg_restore` lists errors it stops and says so; errors only about roles, owners or grants
   (Cloud SQL's `cloudsqlsuperuser`) are harmless and the script prints how to continue.
6. **Check it is the same data** — run on both (Cloud SQL via the same `docker run ... psql`, the droplet via
   `GOLD exec postgres psql -U gold_app gold_platform`) and compare:
   ```sql
   select (select count(*) from users) users,
          (select count(*) from inventory_movements) movements,
          (select count(*) from whole_buy_transactions) wbuy,
          (select count(*) from whole_sell_transactions) wsell,
          (select count(*) from retail_buy_transactions) rbuy,
          (select count(*) from retail_sell_transactions) rsell,
          (select sum(total_weight_gb) from inventory_balance) gold_gb,
          (select sum(total_cost) from inventory_balance) gold_cost;
   ```
7. **Log in at the new URL** with a real account (passwords came across with the `users` table), open the
   inventory and both wholesale lists, then tell the operators the new address. Run the backup job by hand
   so the first real dump exists.
8. **Close the door behind you:**
   ```bash
   gcloud sql instances patch gold-platform --clear-authorized-networks   # or restore the list read in step 4
   rm ~/gold-platform-cutover.dump
   ```

**Rollback during cutover:** until operators start writing on the droplet, GCP still holds the truth — add
the `allUsers` invoker binding back and keep using the old URL.

### Decommissioning GCP

Wait at least a week of normal trading and one restore test (§4) first. Then:

1. Export a final copy and keep it somewhere that is neither GCP nor the droplet:
   `gcloud sql export sql gold-platform gs://BUCKET/final.sql --database=gold_platform`, download it.
2. Delete the Cloud Scheduler job `gold-confirm-sweep-nightly` **before or at cutover**, not later — while
   it runs against the frozen database it does nothing, but it should not be the thing anyone relies on.
3. Delete the Cloud Run service `gold-api` and the jobs `gold-migrate`, `gold-confirm-sweep`, `gold-seed`.
4. Cloud SQL `gold-platform`: deletion protection is on — `gcloud sql instances patch gold-platform
   --no-deletion-protection`, then delete. (Backups go with the instance.)
5. Artifact Registry repository `gold-platform`, secrets `gold-database-url` and `gold-jwt-secret`, the
   Cloud Build repository connection `gold-github`.
6. Firebase Hosting site `goldoffice`: `firebase hosting:disable --site goldoffice` (or first deploy a
   one-page redirect to the new URL if bookmarks matter).
7. If nothing else lives in the project, shut the project down — that is the only step that guarantees the
   bill stops.

---

## 4. Backups and restore

`jenkins/backup.Jenkinsfile`, nightly at 02:00 Bangkok, after the midnight sweep:

- `pg_dump -Fc` from the `postgres` container, then `pg_restore --list` on the result — a dump that cannot be
  listed cannot be restored, so the job fails tonight rather than on the day it is needed.
- One copy in `/home/dev/backups/gold-platform/`, 14 days.
- One copy archived on the Jenkins controller, 30 builds. **This is the off-host copy**: if the droplet is
  lost, the droplet's backups are lost with it.

**What it does not replace: point-in-time recovery.** Cloud SQL could rewind to any minute in the last 7
days; this rewinds to the last 02:00. A bad afternoon now costs that afternoon's entries, re-typed from
paper. Options if that is not acceptable, in increasing effort: run the backup job more often (every few
hours costs nothing at this size); turn on DigitalOcean droplet backups (whole-machine, daily/weekly — only
the account owner can); WAL archiving to object storage (real PITR, more moving parts).

### Restoring

```bash
# from the droplet's own copies
ls -t /home/dev/backups/gold-platform/
/home/dev/jenkins-deploy/prod/gold-platform/restore.sh /home/dev/backups/gold-platform/gold_platform-YYYYMMDDTHHMMZ.dump
```

From a Jenkins artifact: download it from the build page, `scp` it to the droplet, same command.

**Test a restore without touching production** — a scratch Postgres beside it, gone when you are done:

```bash
docker run -d --name gold-restore-test -e POSTGRES_PASSWORD=x postgres:17-alpine
sleep 5
docker exec -i gold-restore-test createdb -U postgres gold_platform
docker exec -i gold-restore-test pg_restore -U postgres -d gold_platform --no-owner --no-acl < /home/dev/backups/gold-platform/LATEST.dump
docker exec gold-restore-test psql -U postgres gold_platform -c 'select count(*) from inventory_movements'
docker rm -f gold-restore-test
```

Do it after cutover and after any change to the backup job. A backup nobody has restored is a hypothesis.

---

## 5. The nightly confirm sweep

`PATCH /wholesale-{buy,sell}/:id` is accepted while a transaction is `CREATED` and refused after, so
confirmation is what locks the day's entries. `jenkins/confirm-sweep.Jenkinsfile` runs
`node dist/scripts/confirm-sweep.js` in a one-off container of the live image at 00:00 Bangkok (Jenkins'
`TZ=Asia/Bangkok` line). It talks to the database directly, with no HTTP surface and no token — the
reasoning is in the script's header comment.

**Keep the schedule and `WHOLESALE_*_AUTO_CONFIRM_HOUR` (in the env file) in agreement.** The cron decides
when the window actually closes; the env vars only decide what the UI *says* about it.

If Jenkins is down at midnight the sweep simply does not run that night: open transactions stay editable
until the next run or an admin's manual `confirm-all`. Re-running is always safe — once a transaction
leaves `CREATED` it stops matching.

---

## 6. Bootstrap the first admin

**Not needed at cutover** — the imported `users` table brings every account across. Only for a brand-new,
empty database:

```bash
SEED_PASSWORD=$(openssl rand -base64 18); echo "admin password: $SEED_PASSWORD"
$GOLD run --rm --no-deps -e SEED_PASSWORD="$SEED_PASSWORD" api node dist/scripts/seed.js
unset SEED_PASSWORD
```

That creates master data and exactly one `ADMIN` (`admin`). Change its password at first login, and issue
every further login through
`POST /auth/users`. `SEED_OPERATOR_PASSWORD` creates a shared operator login and is meant for demo
environments only.

---

## 7. After deploying

```bash
curl https://<PUBLIC_URL>/api/health                    # {"status":"ok"}
curl -i https://<PUBLIC_URL>/api/users                  # 401, not a list of password hashes
curl -i -X POST https://<PUBLIC_URL>/api/auth/register  # 404 — self-registration is gone
curl -I https://<PUBLIC_URL>/wholesale-buy/123          # 200 + Cache-Control: no-cache (SPA fallback)
```

### Rate limiting on login

`POST /auth/login` counts failures in two fifteen-minute buckets: **8 per username** and **40 per
address**. The address is the **last** `X-Forwarded-For` entry (`clientAddress()` in
`infrastructure/http/rate-limit.ts`): nginx-proxy-manager appends the real client address and
`deploy/nginx/web.conf` passes the header through unchanged, so that last entry is the caller.

Two ways to break that without noticing, both of which collapse every caller into one bucket (forty
failed logins across the whole shop locks everyone out for fifteen minutes):

- **A CDN or proxy in front of nginx-proxy-manager** (Cloudflare's orange cloud on the DNS record). The last
  entry becomes the CDN's edge address. Use a grey-cloud (DNS-only) record, or make NPM trust the CDN's
  `CF-Connecting-IP`.
- **A proxy hop added between NPM and `web` that appends** to the header.

Counted in process, with one `api` container — so the limits are exact, tighter than on Cloud Run's two
instances.

### Known gaps at this deployment

- **Thirteen domain routers end `toHttpError` with `JSON.stringify(error)` and a 500**, which can put a
  `RepositoryError`'s query text — table and column names — in the response. Every such route is behind
  `authMiddleware`, so this is disclosure to a signed-in operator rather than to the internet.
  `handleExit` in `infrastructure/http/errors.ts` is the shape they should adopt.
- **`POST /wholesale-*/:id/status` and the retail/receive routes have no role restriction.** Whether some
  moves (writing off stock, for instance) should be admin-only is a business question, not a bug.

---

## What changed from GCP, and what the host means for it

| | GCP | Droplet |
|---|---|---|
| Recovery | PITR to the minute, 7 days; 30 daily backups | nightly dump, 14 on host + 30 on Jenkins |
| Availability | managed restarts, zonal Cloud SQL | one VM; `restart: unless-stopped` covers crashes and reboots, not the VM |
| Secrets | Secret Manager, IAM-scoped | a 600 file; anyone with `sudo` on the host can read it |
| Deploy trigger | Cloud Build on push to `main` | Jenkins Multibranch on push to `main` |
| Cost | ~$50/month | already paid |

**The droplet is shared with other services, and that is the main risk to weigh.** Anyone with root on
the host can read the gold ledger, the password hashes and the env file; this stack publishes no ports,
but it cannot defend against root. Before cutover, review who has root, SSH and network access to the
droplet and who owns the DigitalOcean account, and turn on droplet backups and a cloud firewall
(80/443/SSH only). Host-specific findings belong in the internal infra notes, not in this public repo.
