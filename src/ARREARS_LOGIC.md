# Arrears Calculation Logic

This document outlines the system logic for converting repayments into arrears.

## 1. Definition of Arrears
In this system, an "Arrear" is defined as a scheduled installment that is **past its due date** and **not fully paid**.

- **Timezone Reference**: All date calculations use `Africa/Nairobi` time.
- **Strict Past Due**: A payment due *today* is considered `pending`. It only becomes an `arrear` if it remains unpaid by tomorrow (i.e., when `DueDate < CurrentDate`).

## 2. Source of Truth (Backend)
The logic is enforced by the PostgreSQL database function `recalculate_loan_schedule(p_loan_id uuid)`.

### Logic Flow:
1.  The system iterates through every installment in the `schedule` JSON array.
2.  It checks two conditions for each installment:
    *   **Payment Condition**: Is `paidAmount` < `amount`? (Is there a balance remaining?)
    *   **Date Condition**: Is `dueDate` < `TODAY`? (Is the date strictly in the past?)
3.  **Status Assignment**:
    *   If **Paid**: Status = `'paid'`
    *   If **Unpaid** AND **Past Due**: Status = `'arrears'`
    *   If **Unpaid** AND **Future/Today**: Status = `'pending'`

### SQL Logic Snippet: