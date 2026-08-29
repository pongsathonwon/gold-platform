# Deploying GoldOffice to Google Cloud

Target: **Cloud Run + Cloud SQL for PostgreSQL**, region `asia-southeast1` (Singapore) — the
closest GCP region to Bangkok. Check whether a Thailand region is available to your project; if
PDPA data residency is a requirement, prefer it and substitute the region throughout.

Three deployed pieces:

| Piece | What | Where |
|---|---|---|
| `gold-api` | the Hono API | Cloud Run service |
| `gold-migrate` | `node dist/scripts/migrate.js` | Cloud Run job, run per release |
| the SPA | static `apps/web` build | Firebase Hosting |

---

## 1. One-time setup

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
```

### Artifact Registry

```bash
gcloud artifacts repositories create gold-platform \
  --repository-format=docker --location=asia-southeast1
```

### Cloud SQL

This database holds the gold position. Backups and point-in-time recovery are not optional.

```bash
gcloud sql instances create gold-db \
  --database-version=POSTGRES_17 \
  --tier=db-g1-small \
  --region=asia-southeast1 \
  --storage-auto-increase \
  --backup-start-time=19:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=30 \
  --retained-transaction-log-days=7
```

`--backup-start-time` is UTC: 19:00 UTC is 02:00 in Bangkok, comfortably after the shop closes.

```bash
gcloud sql databases create gold_platform --instance=gold-db
gcloud sql users create gold_app --instance=gold-db --password="$(openssl rand -base64 32)"
```

**Test the restore before you go live.** A backup nobody has restored is a hypothesis.

### Secrets

Never as `--set-env-vars`, and never as a Cloud Build substitution — both end up in logs.

```bash
# The Cloud SQL unix-socket form. Cloud Run mounts the socket at /cloudsql/INSTANCE.
printf 'postgres://gold_app:THE_PASSWORD@/gold_platform?host=/cloudsql/PROJECT:asia-southeast1:gold-db' \
  | gcloud secrets create gold-database-url --data-file=-

openssl rand -base64 48 | tr -d '\n' | gcloud secrets create gold-jwt-secret --data-file=-
```

Grant the runtime service account read access to both:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
for s in gold-database-url gold-jwt-secret; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

> Use a dedicated service account rather than the default compute one for anything beyond a first
> deployment. The default is broadly privileged.

---

## 2. Deploy

The Cloud Build trigger at [`cloudbuild.yaml`](../cloudbuild.yaml) runs type-check and tests,
builds the image, runs migrations **to completion**, then deploys.

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_SQL_INSTANCE=PROJECT:asia-southeast1:gold-db,_CORS_ORIGIN=https://your-spa-domain
```

Migrations run as a job before traffic moves, never on server startup — starting N instances
would race them through the same DDL.

### Do not set `TZ` on the service

The container runs in UTC, deliberately. Every date the business cares about is computed against
`Asia/Bangkok` explicitly — `businessDateOf()` and `todayBusinessDate()` in `@gold-platform/types`,
`nextAutoConfirmAt()` in `infrastructure/auto-confirm.ts` — and `settlement.ts` does its arithmetic
in UTC throughout. Nothing reads the host's clock for a business decision.

Setting `TZ=Asia/Bangkok` would therefore change no output, while making the one class of bug it
looks like it prevents *invisible in production and still broken everywhere else* — a
`new Date().getHours()` slipped in later would pass on the deployed service and fail in CI, in dev,
and in tests. The host timezone is not load-bearing and should not be made so.

---

## 3. Bootstrap the first admin

The seed creates master data (purities, brands, product types, the conversion factor, the `NA`
sentinel) and exactly one `ADMIN`. Every later account is created by that admin through
`POST /auth/users` and defaults to `OPERATOR`.

```bash
gcloud run jobs deploy gold-seed \
  --image=asia-southeast1-docker.pkg.dev/PROJECT/gold-platform/gold-api:latest \
  --command=node --args=dist/scripts/seed.js \
  --region=asia-southeast1 \
  --set-cloudsql-instances=PROJECT:asia-southeast1:gold-db \
  --set-secrets=DATABASE_URL=gold-database-url:latest,SEED_PASSWORD=gold-seed-password:latest \
  --execute-now --wait
```

Create `gold-seed-password` as a generated value first. `SEED_PASSWORD` has no default and must be
at least 12 characters — the script refuses to run without it. Change the password at first login
and delete the secret afterwards.

The seed can also create a second, `OPERATOR` login via `SEED_OPERATOR_USERNAME` (default
`operator`) and `SEED_OPERATOR_PASSWORD`. It is **skipped unless that password is set**, and it is
meant for local and demo environments: a production deployment should not carry a shared operator
account nobody is named on. Issue real staff logins individually through `POST /auth/users`.

Locally:

```bash
SEED_PASSWORD=... SEED_OPERATOR_PASSWORD=... pnpm --filter @gold-platform/api db:seed
```

**Upgrading an existing database:** migration `0014_user_roles` adds `role` with a default of
`OPERATOR`, so every pre-existing account is an operator and nobody can administer anything.
Promote one by hand:

```sql
UPDATE users SET role = 'ADMIN' WHERE username = 'the-admin-username';
```

---

## 4. The SPA

`VITE_API_URL` is baked in at build time, so the API must be deployed first.

```bash
VITE_API_URL=https://gold-api-xxxx-as.a.run.app pnpm --filter @gold-platform/web build
firebase deploy --only hosting
```

`apps/web/firebase.json` rewrites all paths to `index.html`, which a client-side router needs —
without it a refresh on `/wholesale-buy/123` returns 404.

Set `_CORS_ORIGIN` to the hosting domain and redeploy the API. The two references are circular on
a first deploy: ship the API with a placeholder, build the SPA against its URL, then redeploy the
API with the real origin.

---

## 5. After deploying

Verify:

```bash
curl https://YOUR-API/health                       # {"status":"ok"}
curl -i https://YOUR-API/users                     # 401, not a list of password hashes
curl -i -X POST https://YOUR-API/auth/register     # 404 — self-registration is gone
```

Then log in as the admin, create the operator accounts, and confirm an operator gets 403 on
`POST /inventory/loss`.

### Known gaps at this deployment

These were identified in review and are **not** fixed in this pass:

- **`resolveWeights` picks the newest conversion factor by `effectiveDate` including future-dated
  rows.** Do not insert a future-dated `unit_conversion` row until this is fixed.
- **Error responses fall through to `JSON.stringify(error)` with a 500**, which can leak table and
  column names to a caller.
- **A crash between an inventory movement and its status row can double-book stock on retry.**
  The two are separate transactions; there is no unique constraint on
  `inventory_movements(reference_type, reference_id)` to catch a repeat.
- **No rate limiting on `POST /auth/login`.** Consider Cloud Armor on the load balancer.
- **The SPA bundle is one 700 KB chunk.** Fine over a LAN, worth code-splitting before any
  branch uses it over mobile data.
- **`POST /wholesale-*/:id/status` and the retail/receive routes have no role restriction.** They
  require authentication but any operator may drive any transition. Whether some of those moves
  (writing off stock, for instance) should be admin-only is a business question, not a bug.
