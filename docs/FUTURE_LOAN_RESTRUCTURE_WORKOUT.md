# Future implementation: loan restructure / workout schedule

**Status:** Not implemented — specification for a future feature.  
**Related today:** `generateSchedule` (`src/utils/loanUtils.js`), `recalculate_loan_schedule` (Supabase), loan edit approval (`LoanRequests.jsx`), admin schedule regeneration (`loanScheduleRegeneration.js`).

---

## 1. Business scenario

A borrower cannot follow the original contract (e.g. distress, “amelemewa”). After partial payments, the institution agrees to a **new** plan:

- Take the **remaining obligation** (principal + interest policy TBD).
- Agree on a **recurring payment amount** (e.g. 2,000 or 3,000 TZS **per day**).
- **Extend** the repayment horizon by dividing the remainder by that amount so the **schedule** reflects the new promise (not only ad-hoc collections).

**Example:** 120,000 total payable in 30 days; 36,000 paid by day 9; remainder **84,000**; borrower commits to **3,000/day** → about **28** daily installments from the restructure effective date (ceil(84,000 / 3,000), subject to product rules).

---

## 2. What the system does today (limits)

| Capability | Behavior |
|------------|----------|
| **Repayments** | Stored in `repayments`; totals feed `recalculate_loan_schedule`, which allocates to the **existing** JSON `schedule`. |
| **Schedule shape** | Built at disburse / edit approval via `generateSchedule`: fixed term, frequency, equal split of `total_payable` over N installments. |
| **Recalculate** | Does **not** change installment count, dates, or amounts; only redistributes **paid** amounts across **current** rows. |
| **Holiday / admin regenerate** | Rebuilds due dates from **same** loan terms + holidays; does **not** compute “remainder ÷ daily pledge”. |

There is **no** workflow that derives a **new** schedule from **outstanding balance ÷ agreed installment**.

---

## 3. Proposed feature (high level)

**Working name:** “Restructure” or “Workout agreement”.

**Core idea:** Authorized user (e.g. manager) records a **restructure event** that:

1. Snapshots **outstanding balance** (and policy for interest: capitalize, freeze, waive — **product decision**).
2. Takes **agreed installment amount** and **frequency** (e.g. daily) and **start date** for the new plan.
3. Computes **number of installments** (e.g. `ceil(remaining / installment_amount)`), optionally caps max term.
4. Generates a **new** `schedule` JSON (reuse or extend `generateSchedule` / a sibling function that supports **fixed installment amount** and **variable count** if current helper is only equal-split).
5. Updates loan row: `total_payable`, `balance`, `repayment_start_date` / metadata as needed, `schedule`.
6. Calls **`recalculate_loan_schedule`** so existing **`repayments`** map correctly onto the new rows.
7. Persists **audit**: reason, officer, approver, timestamp, optional link to prior schedule snapshot.

---

## 4. Functional requirements (draft)

- **Eligibility:** e.g. only `active` / `delinquent` loans; exclude `paid` unless product allows reopening (unlikely).
- **Validation:** agreed installment > 0; remaining > 0; start date not in the past (or allow with flag).
- **Approval:** optional two-step (officer proposes, manager approves) aligned with existing `edit_requested` patterns.
- **Reporting:** flag “restructured” loans for portfolio and PAR metrics.

---

## 5. Technical notes

- **Schedule generation:** Today’s `generateSchedule` divides `total_payable` evenly by **count** derived from **period × frequency**. A restructure may need either:
  - **Option A:** Derive **count** from `ceil(outstanding / agreed_installment)` and build rows with **fixed** `amount` per row (last row adjust for rounding), or  
  - **Option B:** New helper `generateRestructureSchedule({ outstanding, installmentAmount, frequency, startDate, holidays })`.

- **Interest:** Decide whether remainder is **principal only**, full **outstanding contractual** amount, or **new** interest on remainder — affects `total_payable` and legal docs.

- **Idempotency:** Restructure should be versioned or single-active “workout” to avoid double-apply.

- **Concurrency:** Same as loan edit — update loan then `recalculate_loan_schedule` with retry (see `loanScheduleRegeneration.js`).

---

## 6. Open questions (product / legal)

- Write-off vs reschedule vs interest waiver.
- Max extension length; regulatory caps.
- Customer communication and contract amendment tracking.
- Effect on **loan increase** / **new loan** eligibility for same borrower.

---

## 7. References in codebase

- `src/utils/loanUtils.js` — `generateSchedule`, `getNextWorkingDay`
- `src/lib/loanScheduleRegeneration.js` — replace schedule + recalculate
- `src/pages/manager/LoanRequests.jsx` — approve edit pattern
- `supabase/migrations/*recalculate_prepayment_backward.sql` — allocation rules

---

*Last updated: 2026-03-30 — scenario and gap analysis from product discussion.*
