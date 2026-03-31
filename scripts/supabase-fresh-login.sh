#!/usr/bin/env bash
# Remove old Supabase CLI token and start fresh (does not store passwords in files)
set -euo pipefail
echo ">>> Supabase CLI logout..."
yes | supabase logout 2>/dev/null || true
echo ">>> Done. Next steps:"
echo "    supabase login"
echo "    cd $(cd "$(dirname "$0")/.." && pwd) && export SUPABASE_DB_PASSWORD='...' && npm run supabase:deploy"
echo ""
echo "    (SUPABASE_DB_PASSWORD = Settings → Database → database password)"
