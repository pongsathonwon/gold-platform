#!/usr/bin/env bash
# The Verify stage of ../Jenkinsfile, run inside a node:22 container as the agent's uid.
# Kept in a file rather than inline in the Jenkinsfile so it needs no Groovy/shell quoting.
#
# Without `set -euo pipefail` only the last command decides the exit code, so a failing type-check
# followed by passing tests would report success. That shipped a revision once under Cloud Build.
set -euo pipefail

# corepack cannot write its shims to /usr/local/bin as a non-root user, so they go under $HOME
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export TURBO_TELEMETRY_DISABLED=1
mkdir -p "$HOME/bin"
corepack enable --install-directory "$HOME/bin"
export PATH="$HOME/bin:$PATH"

node -v
pnpm -v
pnpm config set store-dir "${PNPM_STORE_DIR:-$HOME/.pnpm-store}"
pnpm install --frozen-lockfile
pnpm type-check
pnpm test
