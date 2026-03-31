/**
 * Seeds demo data for Centre Attendance + loan-increase eligibility testing.
 *
 * Requires:
 *   - VITE_SUPABASE_URL or SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (Settings → API → service_role — never commit or expose in client)
 *   - DEMO_OFFICER_EMAIL — email of an existing public.users row with role = officer
 *
 * Usage:
 *   DEMO_OFFICER_EMAIL=officer@example.com node scripts/seed-attendance-demo.mjs
 *   npm run seed:demo-attendance
 *
 * Without a service role key, run scripts/seed-attendance-demo.sql in the Supabase SQL Editor instead.
 *
 * Safe to re-run: removes previous rows tagged as this demo (same centre name + officer).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

loadDotenv();

const DEMO_CENTER = 'Demo Centre — Attendance';
const DEMO_TAG = 'demo_seed';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let officerEmail = process.env.DEMO_OFFICER_EMAIL || process.argv.find((a) => a.startsWith('--email='))?.split('=')[1];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!url || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL (or SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY in environment / .env');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!officerEmail) {
    const { data: firstOff } = await supabase.from('users').select('email').eq('role', 'officer').limit(1).maybeSingle();
    if (firstOff?.email) {
      officerEmail = firstOff.email;
      console.warn('Using first officer in DB:', officerEmail, '(set DEMO_OFFICER_EMAIL to pick a specific user)');
    }
  }

  if (!officerEmail) {
    console.error('No officer found. Set DEMO_OFFICER_EMAIL or pass --email=officer@example.com');
    process.exit(1);
  }

  const { data: officer, error: uErr } = await supabase
    .from('users')
    .select('id, branch_id, email, role')
    .eq('email', officerEmail.trim().toLowerCase())
    .maybeSingle();

  if (uErr || !officer) {
    console.error('No public.users row for email:', officerEmail, uErr?.message || '');
    process.exit(1);
  }
  if (officer.role !== 'officer') {
    console.error('User must have role officer, got:', officer.role);
    process.exit(1);
  }

  const officerId = officer.id;
  const branchId = officer.branch_id;

  const { data: product } = await supabase.from('loan_products').select('id, interest_rate, loan_period, loan_period_unit, repayment_frequency').eq('status', 'active').limit(1).maybeSingle();

  if (!product) {
    console.error('No active loan_products row — add a product in admin first.');
    process.exit(1);
  }

  // --- cleanup previous demo for this officer ---
  const { data: oldCenter } = await supabase
    .from('centers')
    .select('id')
    .eq('loan_officer_id', officerId)
    .eq('name', DEMO_CENTER)
    .maybeSingle();

  if (oldCenter?.id) {
    const { data: meetings } = await supabase.from('centre_meetings').select('id').eq('centre_id', oldCenter.id);
    const mids = (meetings || []).map((m) => m.id);
    if (mids.length) {
      await supabase.from('attendance_records').delete().in('centre_meeting_id', mids);
    }
    await supabase.from('centre_meetings').delete().eq('centre_id', oldCenter.id);

    const { data: demoBorrowers } = await supabase.from('borrowers').select('id').eq('loan_officer_id', officerId).like('borrower_id', 'DEMO-ATT-%');
    const bids = (demoBorrowers || []).map((b) => b.id);
    if (bids.length) {
      await supabase.from('loans').delete().in('borrower_id', bids);
      await supabase.from('borrowers').delete().in('id', bids);
    }

    await supabase.from('groups').delete().eq('center_id', oldCenter.id);
    await supabase.from('centers').delete().eq('id', oldCenter.id);
    console.log('Removed previous demo data for this officer.');
  }

  // --- insert centre & groups ---
  const { data: center, error: cErr } = await supabase
    .from('centers')
    .insert({
      name: DEMO_CENTER,
      location: 'Demo (seed)',
      loan_officer_id: officerId,
      branch_id: branchId,
    })
    .select('id')
    .single();

  if (cErr) {
    console.error('Insert center failed:', cErr.message);
    process.exit(1);
  }

  const { data: groups, error: gErr } = await supabase
    .from('groups')
    .insert([
      { name: 'Demo Group Alpha', center_id: center.id, loan_officer_id: officerId },
      { name: 'Demo Group Beta', center_id: center.id, loan_officer_id: officerId },
    ])
    .select('id, name');

  if (gErr || !groups?.length) {
    console.error('Insert groups failed:', gErr?.message);
    process.exit(1);
  }

  const gAlpha = groups.find((g) => g.name === 'Demo Group Alpha');
  const gBeta = groups.find((g) => g.name === 'Demo Group Beta');

  const borrowerRows = [
    { borrower_id: 'DEMO-ATT-001', first_name: 'Asha', surname: 'Eligible', group_id: gAlpha.id, status: 'paid_up' },
    { borrower_id: 'DEMO-ATT-002', first_name: 'Baraka', surname: 'Defaulted', group_id: gAlpha.id, status: 'eligible' },
    { borrower_id: 'DEMO-ATT-003', first_name: 'Chausiku', surname: 'NoPriorLoan', group_id: gAlpha.id, status: 'eligible' },
    { borrower_id: 'DEMO-ATT-004', first_name: 'David', surname: 'LowAttendance', group_id: gBeta.id, status: 'eligible' },
    { borrower_id: 'DEMO-ATT-005', first_name: 'Ester', surname: 'GroupBeta', group_id: gBeta.id, status: 'eligible' },
    { borrower_id: 'DEMO-ATT-006', first_name: 'Fatma', surname: 'AbsentTwice', group_id: gBeta.id, status: 'eligible' },
  ].map((b) => ({
    ...b,
    loan_officer_id: officerId,
    branch_id: branchId,
    phone_number: '+255700000001',
    gender: 'female',
  }));

  const { data: insertedBorrowers, error: bErr } = await supabase.from('borrowers').insert(borrowerRows).select('id, borrower_id, first_name, surname');

  if (bErr || !insertedBorrowers?.length) {
    console.error('Insert borrowers failed:', bErr?.message);
    process.exit(1);
  }

  const byCode = Object.fromEntries(insertedBorrowers.map((b) => [b.borrower_id, b]));

  // --- 6 meetings (weekly-ish) ---
  const meetingDates = [daysAgo(42), daysAgo(35), daysAgo(28), daysAgo(21), daysAgo(14), daysAgo(7)];
  const { data: meetingRows, error: mErr } = await supabase
    .from('centre_meetings')
    .insert(
      meetingDates.map((meeting_date) => ({
        centre_id: center.id,
        meeting_date,
        loan_officer_id: officerId,
        notes: DEMO_TAG,
      }))
    )
    .select('id, meeting_date');

  if (mErr || !meetingRows?.length) {
    console.error('Insert meetings failed:', mErr?.message);
    process.exit(1);
  }

  const attendanceAbsent = {
    [byCode['DEMO-ATT-006'].id]: new Set([0, 1]),
    [byCode['DEMO-ATT-004'].id]: new Set([0, 1, 2, 3, 4]),
  };

  const att = [];
  for (let mi = 0; mi < meetingRows.length; mi++) {
    const mid = meetingRows[mi].id;
    for (const br of insertedBorrowers) {
      const absentSet = attendanceAbsent[br.id];
      const present = !(absentSet && absentSet.has(mi));
      const g = borrowerRows.find((x) => x.borrower_id === br.borrower_id);
      att.push({
        centre_meeting_id: mid,
        borrower_id: br.id,
        group_id: g.group_id,
        present,
      });
    }
  }

  const { error: aErr } = await supabase.from('attendance_records').insert(att);
  if (aErr) {
    console.error('Insert attendance failed:', aErr.message);
    process.exit(1);
  }

  // --- loans: paid prior for 001 (eligibility path), defaulted for 002 ---
  const ir = Number(product.interest_rate);
  const principal = 500000;
  const totalPayable = principal * (1 + ir / 100);
  const loanBase = {
    product_id: product.id,
    officer_id: officerId,
    principal,
    interest_rate: ir,
    total_payable: totalPayable,
    repayment_frequency: product.repayment_frequency,
    period: product.loan_period,
    period_unit: product.loan_period_unit,
    disbursement_date: daysAgo(400),
    repayment_start_date: daysAgo(390),
  };

  const paidLoan = {
    ...loanBase,
    loan_id: 'DEMO-ATT-LN-PAID',
    borrower_id: byCode['DEMO-ATT-001'].id,
    balance: 0,
    outstanding_interest: 0,
    status: 'paid',
  };

  const defLoan = {
    ...loanBase,
    loan_id: 'DEMO-ATT-LN-DEF',
    borrower_id: byCode['DEMO-ATT-002'].id,
    principal: 300000,
    total_payable: 300000 * (1 + ir / 100),
    balance: 150000,
    outstanding_interest: 0,
    status: 'defaulted',
  };

  const { error: lErr } = await supabase.from('loans').insert([paidLoan, defLoan]);
  if (lErr) {
    console.error('Insert loans failed:', lErr.message);
    process.exit(1);
  }

  console.log('');
  console.log('Demo attendance data seeded for officer:', officerEmail);
  console.log('  Centre:', DEMO_CENTER);
  console.log('  Meetings:', meetingRows.length, 'dates →', meetingDates.join(', '));
  console.log('  Borrowers: DEMO-ATT-001 … DEMO-ATT-006');
  console.log('  Asha Eligible (001): prior paid loan + 6/6 attendance → use Disburse Loan to see green eligibility.');
  console.log('  Baraka Defaulted (002): defaulted loan → manager approval banner.');
  console.log('  David LowAttendance (004): 2/6 meetings present → below threshold.');
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
