/**
 * Rebuild loan.schedule from stored terms + repayment_start_date + current holidays,
 * then run recalculate_loan_schedule (re-applies repayments).
 *
 * Requires in .env:
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/regenerate-single-loan-schedule.mjs LN-1778521107023
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { generateSchedule } from '../src/utils/loanUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EAT = 'Africa/Nairobi';

function loadDotenv() {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function repaymentStartDateString(loan) {
  if (!loan?.repayment_start_date) return null;
  const d = loan.repayment_start_date;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  try {
    return formatTZ(toZonedTime(new Date(d), EAT), 'yyyy-MM-dd', { timeZone: EAT });
  } catch {
    return null;
  }
}

loadDotenv();

const publicLoanId = process.argv[2] || 'LN-1778521107023';
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!url || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL (or SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: loan, error: loanErr } = await supabase
    .from('loans')
    .select(
      'id, loan_id, principal, interest_rate, total_payable, period, period_unit, repayment_frequency, repayment_start_date, status',
    )
    .eq('loan_id', publicLoanId)
    .maybeSingle();

  if (loanErr) {
    console.error('Loan fetch error:', loanErr.message);
    process.exit(1);
  }
  if (!loan) {
    console.error('No loan found with loan_id:', publicLoanId);
    process.exit(1);
  }

  const { data: holidaysRows, error: hErr } = await supabase.from('holidays').select('date');
  if (hErr) {
    console.error('Holidays fetch error:', hErr.message);
    process.exit(1);
  }
  const holidays = holidaysRows || [];

  const startStr = repaymentStartDateString(loan);
  if (!startStr) {
    console.error('Missing repayment_start_date');
    process.exit(1);
  }

  const principal = Number(loan.principal);
  const totalPayable = Number(loan.total_payable);
  const interestRate = loan.interest_rate;
  if (!Number.isFinite(principal) || !Number.isFinite(totalPayable)) {
    console.error('Invalid principal / total_payable');
    process.exit(1);
  }

  const schedule = generateSchedule(
    principal,
    interestRate,
    totalPayable,
    loan.period,
    loan.period_unit,
    loan.repayment_frequency,
    startStr,
    holidays,
  );

  if (!Array.isArray(schedule) || schedule.length === 0) {
    console.error('Generated schedule is empty');
    process.exit(1);
  }

  const { error: uErr } = await supabase.from('loans').update({ schedule }).eq('id', loan.id);
  if (uErr) {
    console.error('Schedule update failed:', uErr.message);
    process.exit(1);
  }

  let rErr = (await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id })).error;
  if (rErr) {
    await new Promise((r) => setTimeout(r, 400));
    rErr = (await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id })).error;
  }
  if (rErr) {
    console.error('recalculate_loan_schedule failed:', rErr.message);
    process.exit(1);
  }

  console.log('OK — regenerated schedule + recalculated repayments for', publicLoanId, `(${schedule.length} installments).`);
  console.log('First 8 due dates:', schedule.slice(0, 8).map((s) => s.dueDate).join(', '));
}

main();
