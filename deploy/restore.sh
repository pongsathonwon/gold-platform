#!/bin/sh
# Replace the gold_platform database on this host with a pg_dump custom-format file (-Fc).
#
# Used for two things, and it is the same operation both times:
#   - the one-time import of the Cloud SQL data at cutover (docs/DEPLOY.md section 3)
#   - recovery from a nightly backup (docs/DEPLOY.md section 4)
#
#   ./restore.sh /path/to/file.dump          asks for confirmation
#   ./restore.sh /path/to/file.dump --yes    does not
#
# It stops web + api (nobody can write mid-restore), drops and recreates the database, restores,
# runs the migrations of the current image (a no-op unless the dump is older than the code), and
# starts api + web again. Take a fresh backup first if the current data might still matter.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
GOLD="$DIR/gold.sh"
DUMP=${1:?usage: restore.sh FILE.dump [--yes]}
[ -r "$DUMP" ] || { echo "cannot read $DUMP" >&2; exit 1; }

"$GOLD" up -d postgres >/dev/null
"$GOLD" exec -T postgres pg_restore --list < "$DUMP" > /dev/null \
    || { echo "$DUMP is not a pg_dump custom-format (-Fc) file" >&2; exit 1; }

if [ "${2:-}" != "--yes" ]; then
    printf 'This REPLACES database gold_platform on %s with %s.\nType RESTORE to continue: ' "$(hostname)" "$DUMP"
    read -r answer
    [ "$answer" = RESTORE ] || { echo "cancelled"; exit 1; }
fi

"$GOLD" stop web api
"$GOLD" exec -T postgres dropdb -U gold_app --if-exists --force gold_platform
"$GOLD" exec -T postgres createdb -U gold_app gold_platform

# --no-owner / --no-acl: the source roles (Cloud SQL's cloudsqlsuperuser and friends) do not exist here;
# everything ends up owned by gold_app. Not --exit-on-error: stop afterwards instead, so every error is listed.
if ! "$GOLD" exec -T postgres pg_restore -U gold_app -d gold_platform --no-owner --no-acl < "$DUMP"; then
    echo
    echo "pg_restore reported errors (above). api and web are still STOPPED."
    echo "If they are only about roles, ownership or grants the data is fine: start with"
    echo "  $GOLD run --rm --no-deps api node dist/scripts/migrate.js && $GOLD up -d api web"
    exit 1
fi

"$GOLD" run --rm --no-deps api node dist/scripts/migrate.js
"$GOLD" up -d api web
echo "restored $DUMP into gold_platform; api and web started"
