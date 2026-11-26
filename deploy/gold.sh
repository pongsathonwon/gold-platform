#!/bin/sh
# Every `docker compose` call for gold-platform on the droplet goes through here: the deploy,
# the nightly Jenkins jobs and anyone at a shell. It pins what a bare `docker compose` would get
# wrong or leave out:
#   - the project name, so it is always the same stack whatever the current directory is
#   - the env file with the secrets (/etc/gold-platform/prod.env, dev:dev 600)
#   - PROXY_NETWORK, the docker network of the nginx-proxy-manager container
#
#   ./gold.sh ps
#   ./gold.sh logs -f api
#   ./gold.sh exec postgres psql -U gold_app gold_platform
#   ./gold.sh run --rm --no-deps api node dist/scripts/confirm-sweep.js
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${GOLD_ENV_FILE:-/etc/gold-platform/prod.env}
PROXY_CONTAINER=${PROXY_CONTAINER:-nginx_proxy}

[ -r "$ENV_FILE" ] || { echo "gold.sh: cannot read $ENV_FILE (docs/DEPLOY.md section 1)" >&2; exit 1; }

if [ -z "${PROXY_NETWORK:-}" ]; then
    # first user-defined network of the proxy container (the default `bridge` has no DNS, so it cannot be used)
    PROXY_NETWORK=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$PROXY_CONTAINER" 2>/dev/null \
        | grep -v -x -e '' -e bridge -e host -e none | head -n 1 || true)
fi
[ -n "$PROXY_NETWORK" ] || {
    echo "gold.sh: found no user-defined docker network on container '$PROXY_CONTAINER'." >&2
    echo "         Set PROXY_NETWORK=<network> or PROXY_CONTAINER=<name> (docs/DEPLOY.md section 1)." >&2
    exit 1
}
export PROXY_NETWORK

exec docker compose --project-name gold-platform --project-directory "$DIR" \
    -f "$DIR/compose.yml" --env-file "$ENV_FILE" "$@"
