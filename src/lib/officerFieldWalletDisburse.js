import { supabase } from '@/lib/customSupabaseClient';

/**
 * Field wallet net for one calendar day (same formula as Field wallet / officer_wallet_balance_for_period).
 * Call BEFORE inserting a new loan for that day — balance does not include the new disbursement yet.
 *
 * @returns {{ ok: boolean, balanceBefore: number, projectedAfter: number, fee: number }}
 */
export async function checkDisbursementAgainstFieldWallet({
  officerId,
  disbursementDateYyyyMmDd,
  principalAmount,
  applicationFeePerDisbursement,
}) {
  const fee = Number(applicationFeePerDisbursement) || 0;
  const principal = Number(principalAmount) || 0;

  const { data, error } = await supabase.rpc('officer_wallet_balance_for_period', {
    p_officer_id: officerId,
    p_from: disbursementDateYyyyMmDd,
    p_to: disbursementDateYyyyMmDd,
  });

  if (error) {
    return { ok: false, error, balanceBefore: 0, projectedAfter: 0, fee };
  }

  const balanceBefore = Number(data) || 0;
  const raw = balanceBefore + fee - principal;
  const projectedAfter = Number(raw.toFixed(2));
  const ok = projectedAfter >= 0;

  return { ok, balanceBefore, projectedAfter, fee, error: null };
}
