#!/usr/bin/env bash
# Deploy migrations + Edge Functions kwa Supabase CLI
#
# Mahitaji:
#   1. supabase login   (akaunti inayomiliki project inayoonekana kwenye .env)
#   2. Nenosiri la Database: Project Settings → Database → Database password
#
# Matumizi:
#   cd /path/to/FCL
#   export SUPABASE_DB_PASSWORD='nenosiri-lako-la-database'
#   ./scripts/supabase-deploy-all.sh
#
# Au link mwenyewe kwanza:
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
  echo "Hakuna .env — ongeza VITE_SUPABASE_URL"
  exit 1
fi

REF=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | sed -E 's|https?://([^.]+)\.supabase\.co.*|\1|')
if [[ -z "$REF" ]]; then
  echo "Siwezi kusoma project ref kutoka VITE_SUPABASE_URL"
  exit 1
fi

echo "==> Project ref: $REF"

# Hakikisha akaunti ya CLI ina ruhusa ya project hii (sivyo link itashindwa)
if ! supabase projects list 2>/dev/null | grep -q "$REF"; then
  echo ""
  echo "HATUA: Akaunti uliyoingia na 'supabase login' HAIONI project $REF."
  echo "Fanya: supabase logout && supabase login  (tumia barua pepe ya mmiliki wa project hiyo)"
  echo ""
  echo "Mpango B (bila CLI):"
  echo "  1) Dashboard → SQL Editor → bandika faili: supabase/ALL_MIGRATIONS_ONE_FILE.sql → Run"
  echo "  2) Edge Functions → deploy baada ya login sahihi: npm run supabase:functions"
  echo ""
  exit 1
fi

if [[ "$SKIP_LINK" != true ]]; then
  if [[ ! -f .supabase/config.toml ]]; then
    if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
      echo ""
      echo "Hakuna .supabase/config.toml na SUPABASE_DB_PASSWORD haijawekwa."
      echo "Fanya moja ya hizi:"
      echo "  export SUPABASE_DB_PASSWORD='...'   # kutoka: Dashboard → Settings → Database"
      echo "  ./scripts/supabase-deploy-all.sh"
      echo ""
      echo "Au link mwenyewe:"
      echo "  supabase link --project-ref $REF -p 'DATABASE_PASSWORD'"
      exit 1
    fi
    echo "==> supabase link ..."
    supabase link --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD" --yes
  else
    echo "==> Tayari linked (.supabase/config.toml ipo)"
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
echo "==> Imemaliza: migrations + Edge Functions."
