#!/usr/bin/env bash
# Deploy migrations + Edge Functions via Supabase CLI
#
# Requirements:
#   1. supabase login   (account that owns the project in .env)
#   2. Database password: Project Settings → Database → Database password
#
# Usage:
#   cd /path/to/FCL
#   export SUPABASE_DB_PASSWORD='your-database-password'
#   ./scripts/supabase-deploy-all.sh
#
# Or link yourself first:
#   supabase link --project-ref <REF> -p '<db-password>'
#   ./scripts/supabase-deploy-all.sh --skip-link

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_LINK=false
for arg in "$@"; do
  [[ "$arg" == "--skip-link" ]] && SKIP_LINK=true
done

if [[ ! -f .env ]]; then
  echo "No .env file — add VITE_SUPABASE_URL"
  exit 1
fi

REF=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | sed -E 's|https?://([^.]+)\.supabase\.co.*|\1|')
if [[ -z "$REF" ]]; then
  echo "Could not read project ref from VITE_SUPABASE_URL"
  exit 1
fi

echo "==> Project ref: $REF"

# Ensure the CLI account can see this project (otherwise link will fail)
if ! supabase projects list 2>/dev/null | grep -q "$REF"; then
  echo ""
  echo "NOTE: The account from 'supabase login' does not see project $REF."
  echo "Try: supabase logout && supabase login  (use the project owner's email)"
  echo ""
  echo "Plan B (without CLI):"
  echo "  1) Dashboard → SQL Editor → paste supabase/ALL_MIGRATIONS_ONE_FILE.sql → Run"
  echo "  2) Edge Functions → deploy after correct login: npm run supabase:functions"
  echo ""
  exit 1
fi

if [[ "$SKIP_LINK" != true ]]; then
  if [[ ! -f .supabase/config.toml ]]; then
    if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
      echo ""
      echo "No .supabase/config.toml and SUPABASE_DB_PASSWORD is not set."
      echo "Do one of:"
      echo "  export SUPABASE_DB_PASSWORD='...'   # from Dashboard → Settings → Database"
      echo "  ./scripts/supabase-deploy-all.sh"
      echo ""
      echo "Or link manually:"
      echo "  supabase link --project-ref $REF -p 'DATABASE_PASSWORD'"
      exit 1
    fi
    echo "==> supabase link ..."
    supabase link --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD" --yes
  else
    echo "==> Already linked (.supabase/config.toml present)"
  fi
fi

echo "==> supabase db push (migrations) ..."
supabase db push --yes

echo "==> supabase functions deploy ..."
FUNCS=(
  create-user
  update-user
  delete-user
  delete-all-other-users
  create-admin-user
  record-repayment
  log-audit
)
for name in "${FUNCS[@]}"; do
  echo "    >>> $name"
  supabase functions deploy "$name"
done

echo ""
echo "==> Done: migrations + Edge Functions."
