#!/usr/bin/env bash
# Restores the disposable Supabase mirror (mv-mirror, see
# docker-compose.mirror.yml) from the production dump.
#
# Usage:
#   docker compose -f docker-compose.mirror.yml up -d
#   ./scripts/import/restore-mirror.sh
#
# The dump directory can be overridden:
#   DUMP_DIR=/path/to/dump ./scripts/import/restore-mirror.sh
#
# The dump itself is never copied into the repo and never written to; it is
# referenced by path and stays read-only and external.

set -euo pipefail

CONTAINER="mv-mirror"
DB_USER="mirror"
DB_NAME="supabase_mirror"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_SQL="$SCRIPT_DIR/mirror-bootstrap.sql"

DUMP_DIR="${DUMP_DIR:-C:/Users/ariov/Desktop/projetos/BACKUP_SUPABASE/mvabrigos-supabase-database-backup/prisma/backups/04-09-2026}"

echo "Waiting for $CONTAINER to be ready..."
until docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 1
done

echo "1/3 Applying bootstrap (extensions + auth schema/table)..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$BOOTSTRAP_SQL"

echo "2/3 Restoring schema.sql (Supabase-role/extension errors expected, ON_ERROR_STOP=0)..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 < "$DUMP_DIR/schema.sql"

echo "3/3 Restoring data.sql (storage/auth-extra errors expected, ON_ERROR_STOP=0)..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 < "$DUMP_DIR/data.sql"

echo "Done. Verify with:"
echo "  docker exec -i $CONTAINER psql -U $DB_USER -d $DB_NAME -c \"SELECT 'auth.users' t, count(*) FROM auth.users UNION ALL SELECT 'profiles', count(*) FROM public.profiles UNION ALL SELECT 'shelters', count(*) FROM public.shelters UNION ALL SELECT 'shelter_dynamics', count(*) FROM public.shelter_dynamics UNION ALL SELECT 'wp_users_legacy', count(*) FROM public.wp_users_legacy;\""
