#!/usr/bin/env bash
# Deploy Edge Functions tu (baada ya: supabase link)
set -euo pipefail
cd "$(dirname "$0")/.."

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
  echo ">>> Deploying $name ..."
  supabase functions deploy "$name"
done

echo ">>> Done."
