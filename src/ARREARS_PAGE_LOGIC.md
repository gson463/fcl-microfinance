# Arrears Page Logic Breakdown

This document details the filtering, calculation, and display logic used in the Arrears Management page (`src/pages/shared/ArrearsManagement.jsx`).

## 1. Data Fetching & Filtering

### Primary Source
- **Table**: `loans`
- **Relations**: Fetches `borrowers` (name, surname) for display.

### Filters Applied
The system applies three layers of filtering to determine which loans appear on this page:

1.  **Role-Based Scope**:
    - **Loan Officer**: Only sees loans where `officer_id` matches their User ID.
    - **Branch Manager**: Sees loans for all officers within their `branch_id`.
    - **Admin**: Sees all loans in the system.

2.  **Loan Status Filter**:
    - The query strictly fetches loans where the top-level status is:
      - `'delinquent'`
      - `'defaulted'`
    - *Note: Active loans with a missed payment that hasn't yet triggered a status change to 'delinquent' in the database will not appear here until the system status update runs.*

3.  **Calculated Balance Filter** (Frontend):
    - After fetching, the page calculates the total arrears amount.
    - Loans with `arrearsAmount <= 0.01` are hidden from the view.

## 2. Arrears Calculation (Display Logic)

The "Amount in Arrears" and "Days in Arrears" columns are calculated dynamically on the frontend to ensure accuracy relative to the current viewing date.

### Calculation Algorithm
For each fetched loan, the system iterates through its `schedule` array:

1.  **Date Normalization**: 
    - Converts `currentDate` and installment `dueDate` to `Africa/Nairobi` timezone.
    - Resets time to midnight (00:00:00) to ensure accurate date-only comparison.

2.  **Arrears Identification Condition**:
    An installment is counted as an arrear if:
    - **Date Condition**: `dueDate < today` (Strictly in the past).
    - **Balance Condition**: `(amount - paidAmount) > 0.01` (Not fully paid).

3.  **Metrics Derivation**:
    - **Arrears Amount**: Sum of `(amount - paidAmount)` for all installments meeting the condition above.
    - **Days in Arrears**: 
        - Finds the *oldest* `dueDate` among the identified arrears installments.
        - Calculates the difference in days between `today` and that `oldestDueDate`.

## 3. Critical Dependencies
- **Database Status**: The page relies on the `loans.status` column being up-to-date (`delinquent` or `defaulted`).
- **RPC Function**: The page calls `update_all_loan_statuses` on load to attempt to refresh these statuses, but this RPC depends on the JSON schedule data being accurate.