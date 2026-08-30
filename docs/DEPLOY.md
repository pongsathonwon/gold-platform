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

## What this costs

Sized against measured volume: the busiest domain peaks at ~15 transactions a day, so all four
together are on the order of 60 — roughly one every eight minutes across a working day. That is
small enough that most of this stack falls inside permanent free tiers, and the bill is dominated
by two decisions rather than by traffic.

| Piece | Monthly | Note |
|---|---|---|
| Cloud SQL `db-g1-small` | ~$30 | **no free tier** — the only unavoidable cost |
| Cloud Run, `--min-instances=1` | ~$20 | a warm instance bills for wall-clock time |
| Cloud Run, `--min-instances=0` | ~$0 | request load is ~3% of the free tier |
| Firebase Hosting | $0 | within free tier |
| Artifact Registry, Secret Manager | <$1 | |
| Egress | ~$0.01 | the free allowance is North America only, but this is JSON |

**Start on the $300 / 90-day trial credit.** It covers this entire stack — warm instance, Cloud SQL
with point-in-time recovery, everything — for the full ninety days. That is the recommended way in:
run the real configuration rather than a cut-down one, and arrive at the end of the trial with three
months of actual usage instead of estimates.

**Two things to do before the credit expires**, because both get harder afterwards:

1. **Decide `--min-instances`.** At 1 it is ~$20/month and the operator never waits. At 0 it is free
   and they wait a few seconds after each idle gap — several times a day at this traffic, not once
   in the morning. The reasoning is written at the flag itself in `cloudbuild.yaml`.
2. ~~**Test a restore.**~~ Done on 2026-08-30: cloned to a point in time before that day's
   migrations, confirmed the clone held the pre-migration schema, confirmed production was
   untouched, deleted the clone. Procedure in "Testing a restore" under Cloud SQL below. Worth
   repeating after any change to the backup configuration — and note PITR only reaches back 7 days,
   so a problem has to be noticed inside a week.

Cloud Run's permanent free tier — 2M requests, 180,000 vCPU-seconds, 360,000 GiB-seconds a month —
comfortably covers this service's *requests*. It does not cover an idle warm instance, which is
about fourteen times the whole vCPU allowance. Traffic is not what decides the Cloud Run bill here;
that one flag is.

---

## 1. One-time setup

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com \
  firebasehosting.googleapis.com
```

### Artifact Registry

```bash
gcloud artifacts repositories create gold-platform \
  --repository-format=docker --location=asia-southeast1
```

### Cloud SQL

This database holds the gold position. Backups and point-in-time recovery are not optional.

**On the tier, and what it costs you.** `db-g1-small` is a shared-core machine type, and Google
excludes both shared-core tiers from the Cloud SQL SLA — the documentation is blunt that they are
"designed to provide low-cost test and development instances only". That is a deliberate choice
here, not an oversight: SLA coverage requires high availability *and* a dedicated CPU, which is a
jump to roughly $100/month for a workload whose four transaction domains together see on the order
of 60 writes a day. The shop is buying durability, not uptime — thirty retained backups and
point-in-time recovery, so a bad afternoon is recoverable to the minute — and accepting that a
zonal incident means an outage rather than a failover.

Revisit that if the shop ever cannot trade without this system. It is a tier change and a failover
replica, not a rewrite. What would *not* be a good trade is dropping to `db-f1-micro` to save the
difference: it is the same no-SLA bucket with 0.6 GB of RAM, and `sumMovementsBefore` — the opening
balance behind `GET /inventory/movements` — aggregates every movement before the window with no
limit, so it is the one query whose cost grows with the age of the ledger rather than the size of
the request.

```bash
gcloud sql instances create gold-platform \
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
gcloud sql databases create gold_platform --instance=gold-platform
gcloud sql users create gold_app --instance=gold-platform --password="$PASSWORD"
```

**The instance and the database differ only by the separator** — `gold-platform` with a hyphen is
the Cloud SQL instance, `gold_platform` with an underscore is the database inside it. Postgres would
have folded an unquoted hyphen into a subtraction, so the database could not carry the same name.
Nothing warns you when they are swapped: the connection string simply fails to find a database.

```bash
```

**Generating that password: not `openssl rand -base64 32`.** Two constraints collide. Base64 emits
`+`, `/` and `=`, and the password goes into a URL — `postgres://gold_app:PASSWORD@/...` — where `/`
truncates it and `+` decodes as a space, so the connection fails with a credentials error that looks
nothing like a quoting bug. Meanwhile Cloud SQL's default password policy rejects anything without
an uppercase, a lowercase, a digit *and* a non-alphanumeric, so plain `openssl rand -hex` is refused
outright. What satisfies both is a base64url alphabet plus a fixed suffix covering the four classes;
the entropy is all in the random part, so a known suffix costs nothing:

```bash
PASSWORD="$(openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n')Aa1-"
```

`-` and `_` are unreserved in a URI, so nothing needs escaping downstream.

**Test the restore before you go live.** A backup nobody has restored is a hypothesis. See
"Testing a restore" below — it has been done once, on 2026-08-30, and the procedure is written down.

### Testing a restore

**Clone to a new instance. Never restore over the live one to find out whether restoring works.**

`gcloud sql backups restore` overwrites its target, so using it as a test converts a drill into an
outage. `gcloud sql instances clone` builds a *separate* instance from the transaction logs, which
makes the test non-destructive and lets the clone be inspected side by side with production.

The question worth answering is not "does a backup exist" but **"can I get back to the state just
before a bad change"** — so pick a point in time, not the nightly backup:

```bash
# A moment after the pre-change backup and before the migrations ran.
gcloud sql instances clone gold-platform gold-restore-test \
  --point-in-time='2026-08-30T07:22:00.000Z'
```

Then prove it actually rewound, rather than trusting that it did. Connect to the clone's own IP and
ask it something that changed:

```
                         clone (07:22)      production (now)
  migrations applied     3                  5
  users.id type          integer            uuid
  bare numeric columns   53                 0
  accounts               admin (id 1)       admin (uuid)
```

That is the real output of the drill: the clone was genuinely on the far side of migrations `0003`
and `0004`, with the old integer keys and the unscaled columns. Production was verified untouched in
the same pass.

**Then delete the clone** — it bills like any other instance. It inherits deletion protection from
its source, so that comes off first, and *only on the clone*:

```bash
gcloud sql instances patch gold-restore-test --no-deletion-protection --quiet
gcloud sql instances delete gold-restore-test --quiet
```

Two things this drill established beyond the restore itself: PITR reaches back **7 days**
(`transactionLogRetentionDays`), so a problem has to be noticed inside a week; and production has
deletion protection on, which is why the clone did too.

### Secrets

Never as `--set-env-vars`, and never as a Cloud Build substitution — both end up in logs.

```bash
# Cloud Run mounts the socket at /cloudsql/INSTANCE. Note `localhost` — see below.
printf 'postgres://gold_app:THE_PASSWORD@localhost/gold_platform?host=/cloudsql/PROJECT:asia-southeast1:gold-platform' \
  | gcloud secrets create gold-database-url --data-file=-

openssl rand -base64 48 | tr -d '\n' | gcloud secrets create gold-jwt-secret --data-file=-
```

**The `localhost` is load-bearing, and the libpq form does not work here.** Postgres tooling
conventionally writes a socket connection with an empty host — `postgres://user:pass@/db?host=/sock`
— but postgres.js parses connection strings with the WHATWG `new URL()`, which rejects that: there
is no host. The process then dies at construction with `ERR_INVALID_URL` **and prints the whole
string, password included**, so the first symptom is a credential in your logs. Percent-encoding the
path as the host is worse, because it parses: `url.hostname` stays encoded and it quietly dials a
socket named `%2Fcloudsql%2F...`.

postgres.js only takes a socket from its `host` *option*, never from the URL — `path` is derived as
`host.indexOf('/') > -1 && host + '/.s.PGSQL.' + port`, and the options object outranks the URL. So
the URL carries `localhost` purely to stay parseable, `?host=` carries the socket, and
`parseConnection()` in `infrastructure/db/connection.ts` moves it across — and strips
`?host=` from the url, because postgres.js forwards unrecognised query parameters to the server as
startup parameters and `host` is not a Postgres setting. Locally there is no `?host=`,
`localhost` is the real host, and it is ordinary TCP — one variable, both environments, no branching.

Every entry point that opens a connection goes through that helper. The server, the migration job
and the seed job each build their own client and all three broke identically without it.

Grant the runtime service account read access to both:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
for s in gold-database-url gold-jwt-secret; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

### Project roles — the step that actually blocks the first build

Secret access alone is not enough, and the default compute service account **starts with no project
roles at all** in a project created today. That is a change from the old behaviour this document was
written against, where it was granted Editor and everything below happened to work. It no longer
does, and each missing role fails at a different stage with an error that does not name the role.

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for role in cloudsql.client artifactregistry.writer run.admin iam.serviceAccountUser \
            logging.logWriter firebasehosting.admin serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:${SA}" --role="roles/${role}" --condition=None
done
```

| Role | Without it |
|---|---|
| `cloudsql.client` | the service and the migrate job cannot reach the database at all |
| `artifactregistry.writer` | `push` fails after a successful build |
| `run.admin` | `run jobs deploy` and `run deploy` are denied |
| `iam.serviceAccountUser` | the build cannot *act as* the runtime SA, so deploy is denied |
| `logging.logWriter` | the build fails immediately — `cloudbuild.yaml` sets `CLOUD_LOGGING_ONLY`, and a build that cannot write logs cannot start |
| `firebasehosting.admin` | the `web` step builds the SPA and then cannot publish it |
| `serviceusage.serviceUsageConsumer` | the Firebase CLI resolves the project before it deploys, and that call is denied first |

That last one is the confusing one: the build fails before running a single step, and the message is
about logging configuration rather than permissions.

There is a sixth grant, and it is not a project role. `gcloud builds submit` uploads the source as a
tarball to a staging bucket **as you**, then the build service account reads it back — so it needs
object read on that bucket or the build dies at "could not resolve source" before any step runs,
which reads like a missing file rather than a permission:

```bash
gcloud storage buckets add-iam-policy-binding gs://YOUR_PROJECT_ID_cloudbuild \
  --member="serviceAccount:${SA}" --role=roles/storage.objectViewer
```

Scoped to the bucket rather than granted project-wide, since reading the source archive is all it
needs to do with storage.

> This grants five roles to the default compute service account, which is both the build identity
> and the runtime identity. Splitting them — a build SA that can push and deploy, a runtime SA that
> can only read secrets and reach Cloud SQL — is the right shape once the first deployment is
> working, and needs `--service-account` on the build and `--service-account` on the Cloud Run
> service. Doing it before anything has ever deployed makes a first failure much harder to read.

---

## 2. Deploy

**Merge into `main`.** That is the release.

Work happens on `dev`. Two triggers watch the GitHub repository, and the split matters: the config
that deploys must never run on a change somebody is only proposing.

| Trigger | Fires on | Config | Does |
|---|---|---|---|
| `gold-verify-pr` | pull request → `main` | [`cloudbuild.verify.yaml`](../cloudbuild.verify.yaml) | type-check, tests |
| `gold-deploy-main` | push to `main` | [`cloudbuild.yaml`](../cloudbuild.yaml) | verify, build, migrate, deploy API, publish SPA |

Migrations run as a Cloud Run job, to completion, before traffic moves — never on server startup,
where starting N instances would race them through the same DDL. The SPA is published last, after
the API revision it was built against is live.

### Connecting the repository — one time

A 2nd-generation connection, which is an installation of the Cloud Build GitHub App. The
authorisation is a browser flow either way, so the console (Cloud Build → Repositories → *Connect
repository*, region `asia-southeast1`) is the easier path. On the CLI:

```bash
gcloud builds connections create github gold-github --region=asia-southeast1
# prints an authorisation URL — open it and install the App on pongsathonwon/gold-platform
gcloud builds repositories create gold-platform \
  --remote-uri=https://github.com/pongsathonwon/gold-platform.git \
  --connection=gold-github --region=asia-southeast1
```

Doing it from the console instead — Cloud Build → Triggers → Create trigger → *Link repository* — is the
same thing and needs no CLI. It names the repository resource `pongsathonwon-gold-platform`, which is
what this deployment has; the CLI form above would have named it `gold-platform`. Either works, but
the trigger path below has to match whichever one exists.

The connection is **regional and must match the triggers' region**, and creating it needs
`roles/secretmanager.admin` on *you* — the App's token is stored as a secret.

### The triggers — one time

Written with this deployment's real values rather than placeholders, because these are exactly the
three that are painful to reconstruct — and none of them is a secret: the project id is already
committed in `apps/web/.firebaserc`, and both URLs are public addresses.

```bash
# The console owner-prefixes the repository resource when it links one. Read the real name back
# with `gcloud builds repositories list --connection=gold-github --region=asia-southeast1`
# rather than assuming it matches the GitHub repo name.
REPO=projects/project-6ae60f7c-b11d-492a-bf9/locations/asia-southeast1/connections/gold-github/repositories/pongsathonwon-gold-platform

gcloud builds triggers create github --name=gold-deploy-main \
  --region=asia-southeast1 --repository=$REPO \
  --branch-pattern='^main$' --build-config=cloudbuild.yaml \
  --substitutions=_SQL_INSTANCE=project-6ae60f7c-b11d-492a-bf9:asia-southeast1:gold-platform,_CORS_ORIGIN=https://goldoffice.web.app,_API_URL=https://gold-api-onf535drkq-as.a.run.app

gcloud builds triggers create github --name=gold-verify-pr \
  --region=asia-southeast1 --repository=$REPO \
  --pull-request-pattern='^main$' --build-config=cloudbuild.verify.yaml
```

`_CORS_ORIGIN` and `_API_URL` above are what the running service and the hosting site actually use
today, read back off the deployment — so the first triggered build changes neither.

The substitutions live on the trigger from here on; nobody types them again, and the deploy stops
depending on whoever ran it remembering all three. If gcloud asks for `--service-account`, give it
`projects/project-6ae60f7c-b11d-492a-bf9/serviceAccounts/442257468432-compute@developer.gserviceaccount.com`
— the same account the role grants above went to.

**`_API_URL` is the SPA's copy of the API address and `_CORS_ORIGIN` is the API's copy of the SPA
address.** Nothing checks that either is right. A wrong `_CORS_ORIGIN` is loud — the browser blocks
every call. A wrong `_API_URL` is silent until someone tries to log in.

### Two wirings that look right and are not

Google offers this project two other ways to deploy on a push, and both are one button away from
where you will be standing. Neither can express what `cloudbuild.yaml` does.

**Cloud Run → "Continuously deploy from a repository".** It creates its own Cloud Build trigger with
a generated config, and offers exactly two build types: Dockerfile or buildpacks. There is no field
for a build config file, so it can only ever build an image and deploy it — no `pnpm test`, no
migration job, no SPA. Set up beside the trigger above, it also fires on every push to `main`, so
two builds race into the same service. The tell is the URL: `/run/create`, not `/cloud-build`.

**Cloud Run → deploy on new image in Artifact Registry.** Worse, because it looks closest to right.
Read the step order: `push` puts the image in the registry, *then* `migrate` runs to completion,
*then* `deploy` moves traffic. A registry-linked service deploys at `push` — the new revision starts
serving before its own migrations have run, which is the single ordering this whole file exists to
prevent. Nothing about it fails loudly; it just runs new code against an old schema.

Both are subsets of the trigger. Only the trigger owns the whole sequence, which is the only place
"migrate, *then* traffic" can be guaranteed.

### Deploying by hand

Still works, and is the way out if the trigger is broken or the repository connection lapses:

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_SQL_INSTANCE=PROJECT:asia-southeast1:gold-platform,_CORS_ORIGIN=https://your-spa-domain,_API_URL=https://YOUR-API,SHORT_SHA=$(git rev-parse --short HEAD)
```

**`SHORT_SHA` has to be passed by hand here.** It is a built-in substitution Cloud Build fills in
only for builds started by a *trigger*, from a commit it knows about. A manual `builds submit` has
no commit, so it resolves to empty — and since `cloudbuild.yaml` tags images `gold-api:${SHORT_SHA}`,
the tag silently degrades rather than erroring usefully. A triggered build supplies the real value.

That manual path also deploys **your working tree**, not a commit — including changes you have not
pushed. The trigger builds what is on `main`, which is the whole point of moving to it.

Two things that apply only to `builds submit`, because a triggered build clones from GitHub instead
of uploading anything:

- `.gcloudignore` at the repo root decides what is uploaded. Without it gcloud derives one from
  `.gitignore`, which says nothing about `.claude/` — and the agent worktrees under it are full
  copies of the repository. The upload goes from 1.7 MB to well over a gigabyte, and each of those
  copies carries its own `cloudbuild.yaml` and `drizzle/`.
- The build service account needs object read on the staging bucket, granted in §1.

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
  --set-cloudsql-instances=PROJECT:asia-southeast1:gold-platform \
  --set-secrets=DATABASE_URL=gold-database-url:latest,SEED_PASSWORD=gold-seed-password:latest \
  --execute-now --wait
```

Create `gold-seed-password` as a generated value first. `SEED_PASSWORD` has no default and must be
at least 12 characters — the script refuses to run without it. Change the password at first login
and delete the secret afterwards.

**On this deployment that is already done.** The seeded `admin` was deactivated once a named admin
account existed, and `gold-seed-password` was destroyed on 2026-08-30 — so the only secrets left are
`gold-database-url` and `gold-jwt-secret`. The `admin` row is kept rather than deleted, because
deactivating reserves the username permanently and keeps the audit trail naming one person; see the
`deletedAt` comment in `user.schema.ts`. Do not recreate the secret to "get back in": issue a login
through `POST /auth/users` as an existing admin.

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

**Released by the same build as the API** — the `web` step in `cloudbuild.yaml`, which runs after
the API revision is serving. There is no separate frontend deploy to remember, and no window where
the two halves are from different commits beyond the minute the build takes.

`VITE_API_URL` comes from the `_API_URL` substitution and is inlined into the bundle, so the SPA is
pinned to one API address at build time. `apps/web/.firebaserc` pins the project and
`apps/web/firebase.json` names the site, so the step passes neither; `firebase.json` also rewrites
all paths to `index.html`, which a client-side router needs — without it a refresh on
`/wholesale-buy/123` returns 404.

By hand, if the pipeline is unavailable:

```bash
VITE_API_URL=https://gold-api-xxxx-as.a.run.app pnpm --filter @gold-platform/web build
cd apps/web && firebase deploy --only hosting
```

**On a first deploy the two references are circular**, and the trigger cannot resolve that for you:
the API needs `_CORS_ORIGIN` to be the hosting domain, and the SPA needs `_API_URL` to be the Cloud
Run URL. Ship the API once with a placeholder origin, read the two real URLs off the created
resources, put both on the trigger, and push again. After that neither changes.

---

## 5. The nightly confirm sweep

`PATCH /wholesale-{buy,sell}/:id` is accepted while a transaction is `CREATED` and refused after, so
confirmation is what locks the day's entries. Until this job exists that lock never closes on its
own, and `confirmDueAt` — which the UI shows an operator as their deadline — describes a run that
never happens.

A Cloud Run job on a Cloud Scheduler trigger, not a scheduled HTTP call:

```bash
gcloud run jobs deploy gold-confirm-sweep \
  --image=asia-southeast1-docker.pkg.dev/PROJECT/gold-platform/gold-api:latest \
  --command=node --args=dist/scripts/confirm-sweep.js \
  --region=asia-southeast1 \
  --set-cloudsql-instances=PROJECT:asia-southeast1:gold-platform \
  --set-secrets=DATABASE_URL=gold-database-url:latest,JWT_SECRET=gold-jwt-secret:latest \
  --set-env-vars=CORS_ORIGIN=https://your-spa-domain,NODE_ENV=production \
  --max-retries=1 --task-timeout=300s

gcloud scheduler jobs create http gold-confirm-sweep-nightly \
  --location=asia-southeast1 --schedule="0 0 * * *" --time-zone="Asia/Bangkok" \
  --uri="https://run.googleapis.com/v2/projects/PROJECT/locations/asia-southeast1/jobs/gold-confirm-sweep:run" \
  --http-method=POST --oauth-service-account-email="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
```

**Why a job and not `POST /wholesale-*/confirm-all`.** Those routes are `requireRole('ADMIN')`, so a
scheduled caller needs a token the app itself minted, and those last an hour — leaving either a
standing credential or a refresh dance, to reach an endpoint that ends the edit window for every
open transaction at once. The job talks to the database and exposes no HTTP surface at all.

**Keep the schedule and `WHOLESALE_*_AUTO_CONFIRM_HOUR` in agreement.** The cron decides when the
window actually closes; the env vars only decide what the UI *says* about it. Nothing enforces that
they match, so a change to one is silently a lie in the other. Both default to midnight Bangkok.

Two notes from getting this running:

- The job needs `CORS_ORIGIN` — a setting it has no use for — because `AppConfig` bundles the HTTP
  configuration with the database, and it needs the database.
- It cannot be given `PORT`: that is a reserved env name on Cloud Run, rejected on a job and injected
  only into services. `PORT` is therefore defaulted in `env.ts` rather than required.

Verify the whole chain rather than just the job, since the scheduler's OAuth is its own failure mode:

```bash
gcloud scheduler jobs run gold-confirm-sweep-nightly --location=asia-southeast1
gcloud run jobs executions list --job=gold-confirm-sweep --region=asia-southeast1 --limit=1
```

A fresh execution timestamped to that moment is the proof. Re-running is safe: once a transaction
leaves `CREATED` it stops matching, so a retry or double-fire confirms nothing twice.

---

## 6. After deploying

Verify:

```bash
curl https://YOUR-API/health                       # {"status":"ok"}
curl -i https://YOUR-API/users                     # 401, not a list of password hashes
curl -i -X POST https://YOUR-API/auth/register     # 404 — self-registration is gone
```

Then log in as the admin, create the operator accounts, and confirm an operator gets 403 on
`POST /inventory/loss`.

### Rate limiting on login

`POST /auth/login` counts failed attempts in two buckets, both fifteen-minute windows: **8 per
username** and **40 per address**. Only failures count and a success clears the username's bucket,
so ordinary use — including a run of typos — never approaches either.

The username bucket is the one that protects an account, because a caller cannot lie about which
account they are guessing at. The address bucket catches spraying across many usernames, and is
deliberately loose: a branch behind one NAT shares an address, and locking out a whole shop because
two people mistyped is a worse outage than the attack.

Counted in process, not in the database. At `--max-instances=2` the real budget is therefore up to
twice the configured one — a factor of two against an attacker who would otherwise have no ceiling,
bought without a database write on every login. If a global limit is ever wanted, that is Cloud
Armor on a load balancer (~$18/month), not a rewrite here.

An infrastructure failure does **not** count against anyone: only `InvalidCredentialsError` does.
Counting every non-success would let an unreachable database burn through every user's allowance,
leaving the shop locked out for fifteen minutes after the database came back.

### Known gaps at this deployment

These were identified in review and are **not** fixed in this pass:

- **Thirteen domain routers end `toHttpError` with `JSON.stringify(error)` and a 500**, which can
  put a `RepositoryError`'s underlying query text — table and column names — in the response. Every
  such route is behind `authMiddleware`, so this is disclosure to a signed-in operator rather than
  to the internet. `handleExit` in `infrastructure/http/errors.ts` is *not* affected: it maps every
  error to a fixed generic message, and is the shape the domain routers should adopt.
- ~~**The SPA bundle is one 700 KB chunk.**~~ Fixed. Routes load on demand and the framework is
  split from the app's code, so the entry chunk is no longer the whole application: the largest
  chunk is now 330 KB (99 KB gzipped) and React, the router and the query client are their own
  cacheable chunks. The reasoning is at `vendorChunk()` in `apps/web/vite.config.ts`, and it matters
  more now that `/assets/**` is served immutable for a year — a chunk that does not change is a
  chunk nobody fetches twice.
- **`POST /wholesale-*/:id/status` and the retail/receive routes have no role restriction.** They
  require authentication but any operator may drive any transition. Whether some of those moves
  (writing off stock, for instance) should be admin-only is a business question, not a bug.
