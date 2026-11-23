// gold-platform (GoldOffice): CI/CD on the HUG Jenkins, Multibranch Pipeline.
// Replaces Cloud Build + Cloud Run + Cloud SQL + Firebase Hosting. Setup, cutover and operations: docs/DEPLOY.md
//
// Agent: g99, the Jenkins agent that runs ON the company DigitalOcean droplet as user `dev` with docker.
// The agent IS the target host, so build and deploy are both local: no ssh, no registry.
//
//   every branch and PR   Verify: pnpm install, type-check, test (in a node:22 container)
//   main                  + Preflight, Build images, Deploy (migrate first, then traffic), Health check
//
// main is the release branch, as it was under Cloud Build: merging into main deploys. No approval gate.
// Must be a Multibranch Pipeline: without BRANCH_NAME nothing ever deploys.
//
// What runs on the host (deploy/compose.yml, driven only through deploy/gold.sh):
//   postgres   postgres:17-alpine, data in the external volume gold-platform-pgdata (survives `down -v`)
//   api        gold-platform-api:current   (apps/api/Dockerfile)
//   web        gold-platform-web:current   (apps/web/Dockerfile: the SPA in nginx, /api/ proxied to api)
// No container publishes a port. nginx-proxy-manager (container nginx_proxy, already on 80/443 for the
// other golden99 sites) reaches `web` over its own docker network, so the database and the API are never
// on the public interface. (Published docker ports bypass host firewalls such as ufw.)
//
// Secrets never touch Jenkins or git: they live in ENV_FILE on the host (dev:dev 600), read by compose.
// Shell traps (INFRA-DEPLOY-NOTES.md 5.5): agent sh may be dash, keep it POSIX; in sh '''...''' a literal
// backslash is \\ ; no multi-line docker run (the in-container steps are in jenkins/verify.sh instead).
pipeline {
    agent { label 'g99' }

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '15'))
    }

    environment {
        NODE_IMAGE = 'node:22'
        // stable home of compose.yml + gold.sh on the host; the nightly jobs and humans use it too
        DEPLOY_DIR = '/home/dev/jenkins-deploy/prod/gold-platform'
        // PUBLIC_URL, POSTGRES_PASSWORD, JWT_SECRET (+ optional WHOLESALE_*_AUTO_CONFIRM_HOUR). docs/DEPLOY.md section 1
        ENV_FILE = '/etc/gold-platform/prod.env'
        // the nginx-proxy-manager container; gold.sh joins `web` to its network
        PROXY_CONTAINER = 'nginx_proxy'
        // pnpm store on the host, outside the workspace, so Verify does not download everything each build
        PNPM_STORE = '.cache/gold-platform-pnpm-store'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.DEP_SHA = sh(returnStdout: true, script: 'git rev-parse --short=12 HEAD').trim()
                }
            }
        }

        stage('Verify') {
            // Same gate as cloudbuild.verify.yaml was: type-check and test. A red test = no image = no deploy.
            // Runs as the agent uid so nothing in the workspace ends up root-owned (cleanWs keeps working).
            steps {
                sh '''
                    set -e
                    command -v docker >/dev/null || { echo "agent has no docker"; exit 1; }
                    docker info >/dev/null 2>&1 || { echo "cannot talk to the docker daemon (is $(id -un) in the docker group?)"; exit 1; }
                    mkdir -p "$WORKSPACE/.home" "$HOME/$PNPM_STORE"
                    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/app/.home -e CI=true -e PNPM_STORE_DIR=/pnpm-store -v "$WORKSPACE:/app" -v "$HOME/$PNPM_STORE:/pnpm-store" -w /app "$NODE_IMAGE" bash jenkins/verify.sh
                '''
            }
        }

        stage('Preflight') {
            // Everything the deploy depends on, checked before anything is built or stopped.
            when { branch 'main' }
            steps {
                sh '''
                    set -e
                    fail() { echo "deploy cancelled: $1"; exit 1; }
                    docker compose version >/dev/null 2>&1 || fail "the docker compose v2 plugin is not installed on $NODE_NAME"

                    [ -f "$ENV_FILE" ] || fail "$ENV_FILE does not exist: create it as in docs/DEPLOY.md section 1"
                    [ "$(stat -c %U "$ENV_FILE")" = "$(id -un)" ] || fail "$ENV_FILE must be owned by $(id -un)"
                    [ "$(stat -c %a "$ENV_FILE")" = 600 ] || fail "$ENV_FILE must be mode 600 (it holds the database password and the JWT secret)"
                    if grep -q "$(printf '\\r')" "$ENV_FILE"; then fail "$ENV_FILE has Windows line endings: sed -i 's/\\r$//' $ENV_FILE"; fi

                    # values are tested, never printed
                    val() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
                    val PUBLIC_URL | grep -Eq '^https://[A-Za-z0-9.-]+$' || fail "PUBLIC_URL in $ENV_FILE must be https://host with no path or trailing slash"
                    val POSTGRES_PASSWORD | grep -Eq '^[A-Za-z0-9_-]{24,}$' || fail "POSTGRES_PASSWORD in $ENV_FILE must be 24+ chars of [A-Za-z0-9_-] (it goes into a URL): openssl rand -hex 24"
                    val JWT_SECRET | grep -Eq '^.{32,}$' || fail "JWT_SECRET in $ENV_FILE must be at least 32 characters: openssl rand -base64 48"

                    docker inspect "$PROXY_CONTAINER" >/dev/null 2>&1 || fail "no container named $PROXY_CONTAINER (nginx-proxy-manager) on $NODE_NAME"
                    echo "preflight ok: $(val PUBLIC_URL) on $NODE_NAME"
                '''
                script {
                    // not a secret: it is the address the browser uses, baked into the SPA and used as CORS_ORIGIN
                    env.PUBLIC_URL = sh(returnStdout: true, script: 'sed -n "s/^PUBLIC_URL=//p" "$ENV_FILE" | tail -n 1').trim()
                }
            }
        }

        stage('Build images') {
            when { branch 'main' }
            steps {
                // The SPA calls the API on its own origin under /api (deploy/nginx/web.conf proxies it), so
                // there is no second domain, no CORS preflight across origins, and no circular first deploy.
                sh '''
                    set -e
                    docker build --pull -f apps/api/Dockerfile -t "gold-platform-api:$DEP_SHA" .
                    docker build --pull -f apps/web/Dockerfile --build-arg "VITE_API_URL=$PUBLIC_URL/api" -t "gold-platform-web:$DEP_SHA" .
                '''
            }
        }

        stage('Deploy') {
            when { branch 'main' }
            steps {
                echo "Deploying ${env.DEP_SHA} -> ${env.PUBLIC_URL} (${env.NODE_NAME}:${env.DEPLOY_DIR})"
                sh '''
                    set -e
                    mkdir -p "$DEPLOY_DIR/nginx"
                    cp deploy/compose.yml deploy/gold.sh deploy/restore.sh "$DEPLOY_DIR/"
                    chmod 755 "$DEPLOY_DIR/gold.sh" "$DEPLOY_DIR/restore.sh"
                    GOLD="$DEPLOY_DIR/gold.sh"

                    # external, so no `docker compose down -v` can ever take the ledger with it
                    docker volume inspect gold-platform-pgdata >/dev/null 2>&1 || docker volume create gold-platform-pgdata

                    "$GOLD" up -d postgres
                    STATUS=""
                    for i in $(seq 1 30); do
                        STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$("$GOLD" ps -q postgres)" 2>/dev/null || true)
                        [ "$STATUS" = healthy ] && break
                        sleep 2
                    done
                    [ "$STATUS" = healthy ] || { echo "postgres is not healthy ($STATUS): $GOLD logs postgres"; exit 1; }

                    # Migrations run to completion with the NEW image before the new code takes traffic, never on
                    # server start. A failure here leaves the running release untouched.
                    IMAGE_TAG="$DEP_SHA" "$GOLD" run --rm --no-deps api node dist/scripts/migrate.js

                    # keep what is running now as :previous, for the Health check rollback and for a manual one
                    for svc in api web; do
                        NEW=$(docker image inspect -f '{{.Id}}' "gold-platform-$svc:$DEP_SHA")
                        CUR=$(docker image inspect -f '{{.Id}}' "gold-platform-$svc:current" 2>/dev/null || true)
                        if [ -n "$CUR" ] && [ "$CUR" != "$NEW" ]; then docker tag "gold-platform-$svc:current" "gold-platform-$svc:previous"; fi
                        docker tag "gold-platform-$svc:$DEP_SHA" "gold-platform-$svc:current"
                    done
                    "$GOLD" up -d --remove-orphans api web
                '''
            }
        }

        stage('Health check') {
            // 1) api container healthy = the server proved its database connection and answers /health
            // 2) the same call through web's nginx = the /api proxy works
            // 3) the SPA is served
            // Any failure puts :previous back (if there is one) and fails the build. Migrations are NOT
            // reversed, so the previous release runs against the new schema: fine for additive migrations.
            // 4) the public URL through nginx-proxy-manager: reported only (DNS / certificate are set up by hand)
            when { branch 'main' }
            steps {
                sh '''
                    GOLD="$DEPLOY_DIR/gold.sh"
                    fail() {
                        echo "$1"
                        "$GOLD" logs --tail 80 api || true
                        if docker image inspect gold-platform-api:previous >/dev/null 2>&1; then
                            echo "rolling back to :previous"
                            for svc in api web; do docker tag "gold-platform-$svc:previous" "gold-platform-$svc:current"; done
                            "$GOLD" up -d api web || true
                        else
                            echo "no :previous release on this host (first deploy): nothing to roll back to"
                        fi
                        exit 1
                    }
                    STATUS=""
                    for i in $(seq 1 30); do
                        STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$("$GOLD" ps -q api)" 2>/dev/null || true)
                        [ "$STATUS" = healthy ] && break
                        sleep 3
                    done
                    [ "$STATUS" = healthy ] || fail "api is not healthy after deploy ($STATUS)"
                    "$GOLD" exec -T web wget -qO- http://127.0.0.1/api/health | grep -q '"ok"' || fail "web cannot reach the api through /api/"
                    "$GOLD" exec -T web wget -qO /dev/null http://127.0.0.1/ || fail "web does not serve the SPA"
                    echo "health check ok"

                    PUB=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL/api/health" || true)
                    echo "public $PUBLIC_URL/api/health -> HTTP $PUB (report only; 200 once DNS and the proxy host exist)"

                    # keep :current, :previous and the three newest builds of each image
                    for svc in api web; do
                        docker images "gold-platform-$svc" --format '{{.Tag}}' | grep -vxE 'current|previous|<none>' | tail -n +4 | while read -r t; do docker rmi "gold-platform-$svc:$t" >/dev/null 2>&1 || true; done
                    done
                '''
            }
        }
    }

    post {
        // keep .git so the next build does not re-clone
        always { cleanWs(patterns: [[pattern: '.git/**', type: 'EXCLUDE']]) }
        success { echo "Build succeeded: ${env.BRANCH_NAME} ${env.DEP_SHA ?: ''} (deploys only on main)" }
    }
}
