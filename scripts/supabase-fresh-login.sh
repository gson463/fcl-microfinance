#!/usr/bin/env bash
# Ondoa token ya zamani na anzisha upya (haitumii nenosiri kwenye faili)
set -euo pipefail
echo ">>> Logout ya Supabase CLI..."
yes | supabase logout 2>/dev/null || true
echo ">>> Imemaliza. Sasa fanya mwenyewe:"
echo "    supabase login"
echo "    cd $(cd "$(dirname "$0")/.." && pwd) && export SUPABASE_DB_PASSWORD='...' && npm run supabase:deploy"
echo ""
echo "    (SUPABASE_DB_PASSWORD = Settings → Database → database password)"
