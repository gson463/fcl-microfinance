# Software Delivery & Acceptance

**Document reference:** [Insert reference number, e.g. FCL-DEL-2026-001]  
**Version of software delivered:** v1.0 (login/app branding label; align with your release tag if different)  
**Leaf code prefix:** `LC` (see **Appendix A — Leaf code register**)

---

## LC-1 · Parties

### LC-1.1 · Supplier (developer / vendor) — full details

The **Supplier** delivering this Software is:

| Field | Detail |
|-------|--------|
| **Legal name** | Plusnology Company Limited |
| **Country / jurisdiction** | United Republic of Tanzania |
| **Registered office / postal address** | *[Insert full address from Supplier company records or letterhead.]* |
| **Website** | https://plusnology.tech |
| **Primary professional email** | develop@plusnology.tech |
| **Phone** | +255 785 059 140 |
| **WhatsApp** | +255 748 847 367 |
| **Company registration / TIN** | *[Insert if required for your contract.]* |

These contacts are the same as shown to end users on the **login** screen for product support (where configured).

### LC-1.2 · Security partner

| Field | Detail |
|-------|--------|
| **Organisation** | Vogu Ethics Limited |
| **Website** | https://voguethics.org |
| **Address** | *[Insert if required.]* |

*Role in this project:* security / ethics partner as referenced in product branding (not a signatory to this delivery unless separately agreed).

### LC-1.3 · Client (recipient)

| Field | Detail |
|-------|--------|
| **Legal name** | Fahari Credits Limited |
| **Address** | *[Insert client registered address.]* |
| **Default product name in application** | FAHARI CREDIT LIMITED / Fahari Credits (configurable in system settings) |
| **Default tagline (branding)** | Your Financial Friends. *(configurable)* |

---

## LC-2 · Description of delivered software

The Supplier has developed and is delivering to the Client the following software (the **“Software”**):

**Working title:** Microfinance Management System  

**LC-2.0 — Summary.** A single system for microfinance operations spanning branches, loan officers, loans, repayments, arrears, reporting, and governance of users and products. What each user sees depends on their **role** (Administrator, Branch Manager, or Loan Officer) and on **organisation settings**.

**LC-2.0 — Scope note.** The list below describes the **functional scope** implemented in this delivery. Commercial terms, service levels, and any items outside this list remain subject to the **statement of work or main contract** referenced in Section 5.

### LC-2.1 · Access, profile, and organisation branding

- **LC-2.1.01** — Secure sign-in; access controlled by user role (administrator, branch manager, loan officer).  
- **LC-2.1.02** — Configurable organisation **name** and **logo** for the application.  
- **LC-2.1.03** — **User profile:** name, email, phone, password change; **profile photo** where enabled for the role.  
- **LC-2.1.04** — Display preferences (for example light/dark **theme** and sidebar styling / palette).  
- **LC-2.1.05** — Flow for **initial administrator account** registration where this is enabled in deployment (`/admin-signup` or equivalent).  
- **LC-2.1.06** — Login page: support contacts (phone, WhatsApp, email), links to Supplier and security partner websites, application version display, clock and network status indicators for users.  

### LC-2.2 · Administrator features

- **LC-2.2.01** — **Dashboard** with portfolio and operations indicators (including active and defaulted portfolio, disbursements, interest, collections, outstanding and default amounts, expected collections, daily activity, field wallet snapshot, borrower counts, loans nearing completion, and related drill-down lists).  
- **LC-2.2.02** — Dashboard **filters** by date range, branch, and loan officer where applicable.  
- **LC-2.2.03** — **Branches:** create and maintain branch records.  
- **LC-2.2.04** — **Users:** create and manage staff accounts and roles.  
- **LC-2.2.05** — **Borrowers:** search and view borrower records across the organisation.  
- **LC-2.2.06** — **Loans and disbursements:** manage loans and disbursement-related actions in line with configured loan products.  
- **LC-2.2.07** — **Officer transfer (reassignment):** move borrowers (and related scope) between loan officers via admin workflow.  
- **LC-2.2.08** — **Loan products:** define and maintain loan products.  
- **LC-2.2.09** — **History and audit:** archived deleted loans, archived deleted repayments, loan increase approval history, activity preview; **full activity log** screen.  
- **LC-2.2.10** — **Prepayments:** manage repayments recorded ahead of the normal schedule (admin scope).  
- **LC-2.2.11** — **Field wallet trace:** oversight of field wallet movements and balances across officers.  
- **LC-2.2.12** — **Arrears** and **defaulters:** portfolio views for follow-up.  
- **LC-2.2.13** — **Holidays:** public and business holidays used in schedules and officer workflows.  
- **LC-2.2.14** — **System settings:** organisation-wide configuration (including currency, fees, branding, tagline, and related options).  

### LC-2.3 · Branch Manager features

- **LC-2.3.01** — **Dashboard** with branch-level KPIs and drill-downs, subject to visibility rules (for example some interest detail may be restricted).  
- **LC-2.3.02** — **Loan officers:** manage loan officers assigned to the branch.  
- **LC-2.3.03** — **Borrowers** and **loans and disbursements** for the branch.  
- **LC-2.3.04** — **Loan requests:** review and action requests that require manager approval.  
- **LC-2.3.05** — **Prepayments** for the branch.  
- **LC-2.3.06** — **Arrears** and **defaulters** for the branch.  
- **LC-2.3.07** — **Settings** relevant to the branch manager role.  

### LC-2.4 · Loan Officer features

- **LC-2.4.01** — **Dashboard** with officer-scoped KPIs and drill-downs (portfolio, collections, registrations, and related metrics).  
- **LC-2.4.02** — **Daily field cash (float):** on working days, confirmation of cash taken into the field before full use of the app; simplified flow on Sundays and configured public holidays.  
- **LC-2.4.03** — **Field wallet & cash flow:** daily wallet view, repayments, disbursements, expenses, taken (float), **withdraw-to-bank** confirmation where applicable; **CSV / Excel / PDF** export of the field wallet report (officer × centre).  
- **LC-2.4.04** — **Centres and groups:** maintain centre and group structure used for borrowers and meetings.  
- **LC-2.4.05** — **Borrowers:** register and edit borrowers; **bulk import** from spreadsheets where used; duplicate checks on phone and ID; guarantor details; **export selected rows to CSV**; **prepared loan template** download for selected borrowers; request re-loan approval for defaulted borrowers where applicable.  
- **LC-2.4.06** — **Borrower details:** full view of a borrower’s record and related loans; export borrower/loan statement (e.g. PDF/Excel) where available.  
- **LC-2.4.07** — **Loans and disbursements:** originate loans, schedules, and disbursements according to configured products.  
- **LC-2.4.08** — **Requests:** submit and track requests (for example loan increases) that follow approval workflows.  
- **LC-2.4.09** — **Group prepayments** and **prepayments** (scheduled and advance repayments).  
- **LC-2.4.10** — **Expenses:** officer expense recording.  
- **LC-2.4.11** — **Attendance:** centre meeting attendance.  
- **LC-2.4.12** — **Arrears** and **defaulters** for the officer’s portfolio.  
- **LC-2.4.13** — **Transfer centre / group (same officer):** move a **group** borrower to another **centre** and **group** within the same loan officer’s portfolio (single borrower action).  
- **LC-2.4.14** — **Bulk transfer centre / group:** move **multiple selected group borrowers** to one chosen **centre** and **group** in a single operation (same officer).  
- **LC-2.4.15** — **Additional float (taken):** after the first **taken** amount is saved for the business day, add **more cash taken from the office** later the same day via **Field wallet** (updates the same day’s total taken).  

### LC-2.5 · Reports, arrears, and defaulters (scope varies by role)

- **LC-2.5.01** — **Reports:** operational analytics with summary figures (for example total portfolio, principal disbursed in the selected period, repayments collected, prepayments, active loans, borrowers, portfolio at risk). **Administrators** see organisation-wide data; **branch managers** see their branch; **loan officers** see their own portfolio.  
- **LC-2.5.02** — **Date presets** (today, this week, this month, this year) and **custom date ranges**; **filters** by branch, product, centre, group, and loan status, and by officer—only where the role allows (officers do not filter other officers’ data).  
- **LC-2.5.03** — **Charts** (trends and breakdowns) and **export** of report tables to spreadsheet format.  
- **LC-2.5.04** — **Branch-level** performance comparison on Reports: **administrators** only. **Officer-level** performance comparison: **administrators** and **branch managers**.  
- **LC-2.5.05** — **Arrears management** and **defaulters management** in the navigation, with lists scoped to the user’s role and branch rules.  

### LC-2.6 · General behaviours

- **LC-2.6.01** — **Repayment schedules** and recording of repayments, including principal and interest split where the product rules require it.  
- **LC-2.6.02** — **Printed and exportable** documents (for example schedules and borrower summaries) from relevant screens.  
- **LC-2.6.03** — **Audit logging** of important actions for accountability.  
- **LC-2.6.04** — **Role-based access control** and **row-level security** aligned to branch and officer scope in the deployed backend.  
- **LC-2.6.05** — **Data export** in common formats (CSV, Excel, PDF) from modules listed above where the screen provides an export control.  

**LC-2.6.06** — Some labels, workflows, or metrics may depend on **configuration** and **data** in the live environment. If a feature is tied to a specific contract deliverable, that deliverable should be cross-checked against the main agreement.

---

## LC-3 · Deliverables included in this handover

The Supplier confirms that the following are delivered to the Client (tick or amend as applicable):

- **LC-3.01** — [ ] The Software and access or deployment arrangements as agreed with the Client  
- **LC-3.02** — [ ] User-facing documentation or training materials, if included in the agreement  
- **LC-3.03** — [ ] Any other agreed items: [free text]

---

## LC-4 · Client review period

**LC-4.01** — The Client may test the Software against the agreed requirements for a review period of **[number] calendar days** from the date of this document (or from first access to production, if different: **[specify]**).

**LC-4.02** — During this period, the Client may report **material defects** (failure to meet agreed written requirements) through **email** (develop@plusnology.tech), **phone** (+255 785 059 140), or **WhatsApp** (+255 748 847 367), unless another channel is agreed in writing. Remedies (fixes, exclusions, or change requests) follow the agreement between the parties.

---

## LC-5 · Intellectual property and licensing

**LC-5.01** — The rights to the Software (including licence to use, modify, and deploy) are governed by **[the contract / SOW / licence agreement dated [date]]**. If nothing is attached, the parties should attach or sign a separate licence or assignment before relying on this section.

---

## LC-6 · Warranties and support (optional — align with your contract)

**LC-6.01** — **As per separate agreement:** [e.g. “90-day warranty on material defects per SOW clause X” / “best effort support via the contacts in Section LC-1.1” / “none beyond statutory rights”].

---

## LC-7 · Acceptance

By signing below, the **Client** confirms that:

- **LC-7.01** — They have received the deliverables listed in Section 3 (as ticked or amended).  
- **LC-7.02** — They accept the Software for the purpose agreed in the underlying contract, **subject to** any open items or review period stated in Section 4 and in **[annex / email / ticket list]**.

By signing below, the **Supplier** confirms that:

- **LC-7.03** — They have supplied the deliverables listed in Section 3 in accordance with the agreement between the parties.  
- **LC-7.04** — They are authorised to make this delivery on behalf of **Plusnology Company Limited**, the Supplier named in Section LC-1.1.

---

## LC-8 · Signatures

**LC-8.01** — This document may be executed in counterparts (including scanned or electronic signatures) with the same effect as originals.

### LC-8A · Signature block — Supplier (Plusnology Company Limited)

| | |
|---|---|
| **Name (print)** | |
| **Title** | |
| **Organisation** | Plusnology Company Limited |
| **Signature** | |
| **Date** | |

### LC-8B · Signature block — Client (Fahari Credits Limited)

| | |
|---|---|
| **Name (print)** | |
| **Title** | |
| **Organisation** | Fahari Credits Limited |
| **Signature** | |
| **Date** | |

---

## Appendix A — Leaf code register

Use **leaf codes** to refer to exact clauses (for example in emails: “We confirm acceptance of **LC-7.01**–**LC-7.02**”).

| Leaf code | Short description |
|-----------|-------------------|
| LC-1.1 | Supplier (Plusnology) full vendor details |
| LC-1.2 | Security partner (Vogu Ethics) |
| LC-1.3 | Client (Fahari Credits) |
| LC-2 | Description of software (section) |
| LC-2.0 | Summary and scope note |
| LC-2.1.01–LC-2.1.06 | Access, profile, branding, login UX |
| LC-2.2.01–LC-2.2.14 | Administrator features |
| LC-2.3.01–LC-2.3.07 | Branch Manager features |
| LC-2.4.01–LC-2.4.15 | Loan Officer features (incl. centre transfer, bulk transfer, extra float) |
| LC-2.5.01–LC-2.5.05 | Reports, arrears, defaulters (cross-role) |
| LC-2.6.01–LC-2.6.06 | General behaviours, exports, configuration note |
| LC-3.01–LC-3.03 | Deliverables checklist |
| LC-4.01–LC-4.02 | Review period and defect reporting |
| LC-5.01 | Intellectual property and licensing |
| LC-6.01 | Warranties and support |
| LC-7.01–LC-7.04 | Acceptance statements |
| LC-8.01 | Counterparts / execution |
| LC-8A | Supplier signature block |
| LC-8B | Client signature block |

---

*End of document.*
