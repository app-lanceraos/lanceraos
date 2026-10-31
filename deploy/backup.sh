#!/usr/bin/env bash
# deploy/backup.sh
#
# Dumps the running stack's Postgres database (pg_dump custom format, compressed)
# to a timestamped file OUTSIDE the repo and keeps only the newest 14.
#
#   deploy/backup.sh                      # real stack (deploy/.env)
#   ENV_FILE=deploy/.env.test deploy/backup.sh
#   BACKUP_DIR=/mnt/usb/lanceraos deploy/backup.sh
#
# A backup that lives only on the machine it protects dies with that machine:
# copy the file elsewhere too (DEPLOYMENT.md Appendix D, "Getting a backup off
# the machine"). The dump contains personal and financial data, so it is created
# readable by you only (umask 077). Reading the DB credentials from inside the
# db container (POSTGRES_USER/POSTGRES_DB) means this script never parses or
# prints the env file.
#
# Restore recipe (tested; see DEPLOYMENT.md): create an empty database, then
#   docker compose exec -T db pg_restore -U "$DB_USER" -d <target_db> --no-owner < FILE
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${ENV_FILE:-$here/.env}"
backup_dir="${BACKUP_DIR:-$HOME/lanceraos-backups}"
keep=14

[[ -f "$env_file" ]] || { echo "Env file not found: $env_file (set ENV_FILE=...)" >&2; exit 1; }
compose=(docker compose -f "$here/docker-compose.yml" --env-file "$env_file")

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
final="$backup_dir/lanceraos-$stamp.dump"
partial="$final.partial"

umask 077
# -T: no TTY, so the binary dump is not mangled. Written to .partial first so a
# crash or a full disk never leaves a truncated file that looks like a backup.
if ! "${compose[@]}" exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$partial"; then
  rm -f "$partial"; echo "pg_dump failed - no backup written." >&2; exit 1
fi

# Prove the file is a readable archive before trusting it.
if ! "${compose[@]}" exec -T db pg_restore --list < "$partial" > /dev/null; then
  rm -f "$partial"; echo "Dump is not a valid archive - discarded." >&2; exit 1
fi
mv "$partial" "$final"
echo "Backup written: $final ($(du -h "$final" | cut -f1))"

# Retention: delete everything but the newest $keep dumps (only our own files).
ls -1t "$backup_dir"/lanceraos-*.dump 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do
  rm -f -- "$old"; echo "Removed old backup: $old"
done
