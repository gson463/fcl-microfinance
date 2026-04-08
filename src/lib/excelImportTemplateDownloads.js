/**
 * Excel bulk-import templates with Data Validation (dropdowns) via ExcelJS.
 * Import parsers still use SheetJS (xlsx) to read uploads — sheet names unchanged.
 */
import ExcelJS from 'exceljs';

export const DATA_ENTRY_MAX_ROW = 500;

/** @param {string[]} values */
export function inlineListFormula(values) {
  return `"${values.join(',')}"`;
}

/** Excel formula for a column range on another sheet, e.g. =Sheet!$A$2:$A$10 */
export function sheetColumnRangeFormula(sheetName, colLetter, startRow, endRow) {
  const safe = /^[A-Za-z0-9_]+$/.test(sheetName)
    ? sheetName
    : `'${String(sheetName).replace(/'/g, "''")}'`;
  return `=${safe}!$${colLetter}$${startRow}:$${colLetter}$${endRow}`;
}

const GENDERS = ['male', 'female'];
const ID_TYPES = ['national_id', 'voters_id', 'drivers_license', 'passport'];
const BORROWER_TYPES = ['group', 'individual'];

function listValidation(formulae, errorText) {
  return {
    type: 'list',
    allowBlank: true,
    formulae,
    showErrorMessage: true,
    errorStyle: 'information',
    errorTitle: 'Choose from list',
    error: errorText || 'Pick a value from the dropdown (or type an exact match).',
  };
}

export function triggerExcelDownload(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function addInstructionsSheet(wb, rows) {
  const ws = wb.addWorksheet('Instructions', {
    views: [{ showGridLines: true }],
  });
  ws.getColumn(1).width = 90;
  rows.forEach((line) => {
    ws.addRow([line]);
  });
}

/** @param {{ centers: Array<{ id: string, name: string }>, groups: Array<{ id: string, name: string, center_id: string }>, centersForGroups?: Array<{ id: string, name: string }> }} p */
export async function downloadBorrowersImportTemplate({ centers, groups, centersForGroups }) {
  const centerList = centers || [];
  const groupRows = groups || [];
  const centersLookup = centersForGroups ?? centerList;

  const exampleCenter = centerList.length > 0 ? centerList[0].name : 'My Centre Name';
  const exampleGroup = groupRows.length > 0 ? groupRows[0].name : 'Upendo Group';

  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet('Borrowers', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const headers = [
    'first_name',
    'surname',
    'gender',
    'phone_number',
    'address',
    'business_name',
    'business_location',
    'identification_type',
    'identification_number',
    'borrower_type',
    'center_name',
    'group_name',
    'guarantor_name',
    'guarantor_phone',
  ];
  data.addRow(headers);
  data.getRow(1).font = { bold: true };
  data.addRow([
    'John',
    'Doe',
    'male',
    '0712345678',
    '123 Main St, Dar es Salaam',
    'Johns Store',
    'Kariakoo',
    'national_id',
    '19901234567890123456',
    'group',
    exampleCenter,
    exampleGroup,
    'Jane Doe',
    '0755123456',
  ]);
  data.addRow(headers.map(() => ''));

  [18, 18, 12, 14, 28, 18, 18, 18, 22, 14, 22, 22, 18, 14].forEach((w, i) => {
    data.getColumn(i + 1).width = w;
  });

  const refC = wb.addWorksheet('Reference_Centres', { views: [{ showGridLines: true }] });
  refC.addRow(['center_name']);
  refC.getRow(1).font = { bold: true };
  if (centerList.length) {
    centerList.forEach((c) => refC.addRow([c.name]));
  } else {
    refC.addRow(['(Add centres first)']);
  }
  refC.getColumn(1).width = 36;

  const refG = wb.addWorksheet('Reference_Groups', { views: [{ showGridLines: true }] });
  refG.addRow(['center_name', 'group_name']);
  refG.getRow(1).font = { bold: true };
  if (groupRows.length) {
    groupRows.forEach((g) => {
      const cn = centersLookup.find((c) => c.id === g.center_id)?.name ?? '';
      refG.addRow([cn, g.name]);
    });
  } else {
    refG.addRow(['', '(Add groups first)']);
  }
  refG.getColumn(1).width = 28;
  refG.getColumn(2).width = 28;

  const lastCenterRow = Math.max(2, refC.rowCount);
  const lastGroupRow = Math.max(2, refG.rowCount);

  data.dataValidations.add(`C2:C${DATA_ENTRY_MAX_ROW}`, listValidation([inlineListFormula(GENDERS)], 'Select male or female.'));
  data.dataValidations.add(`H2:H${DATA_ENTRY_MAX_ROW}`, listValidation([inlineListFormula(ID_TYPES)], 'Select an ID type.'));
  data.dataValidations.add(`J2:J${DATA_ENTRY_MAX_ROW}`, listValidation([inlineListFormula(BORROWER_TYPES)], 'Select group or individual.'));
  data.dataValidations.add(
    `K2:K${DATA_ENTRY_MAX_ROW}`,
    listValidation([sheetColumnRangeFormula('Reference_Centres', 'A', 2, lastCenterRow)], 'Pick a centre name from your branch (see Reference_Centres).'),
  );
  data.dataValidations.add(
    `L2:L${DATA_ENTRY_MAX_ROW}`,
    listValidation([sheetColumnRangeFormula('Reference_Groups', 'B', 2, lastGroupRow)], 'Pick a group for the selected centre (see Reference_Groups).'),
  );

  addInstructionsSheet(wb, [
    'Borrowers bulk import',
    '',
    'Use sheet "Borrowers" for data. Gender, ID type, borrower type, centre, and group have dropdowns — pick values to avoid typos.',
    '',
    'column — required — notes',
    'first_name — yes — letters only',
    'surname — yes',
    'gender — yes — male or female',
    'phone_number — yes — 10 digits (e.g. 07XXXXXXXX)',
    'address — yes',
    'business_name — yes',
    'business_location — yes',
    'identification_type — yes — national_id | voters_id | drivers_license | passport',
    'identification_number — yes — format per ID type',
    'borrower_type — yes — group or individual',
    'center_name — if group — must match a centre in Reference_Centres',
    'group_name — if group — must match a group for that centre in Reference_Groups',
    'guarantor_name — yes',
    'guarantor_phone — yes — 10 digits',
    '',
    'Import rules:',
    '- Rows with duplicate phone or ID in the file are skipped.',
    '- Rows matching an existing borrower (phone or ID) are skipped.',
    '- Invalid rows are skipped with a reason in the report.',
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  triggerExcelDownload(buffer, 'Borrowers_Import_Template.xlsx');
}

/**
 * @param {{ rows: Array<Record<string, unknown>>, loanProducts: Array<{ name: string }> }} p
 */
export async function downloadPreparedLoansTemplate({ rows, loanProducts }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Prepared Loans', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });
  const headerFixed = [
    'borrower_id',
    'borrower_name',
    'loan_product_name',
    'principal',
    'disbursement_date',
    'repayment_start_date',
  ];
  ws.addRow(headerFixed);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow([
      r.borrower_id,
      r.borrower_name,
      r.loan_product_name ?? '',
      r.principal ?? '',
      r.disbursement_date ?? '',
      r.repayment_start_date ?? '',
    ]);
  }

  [14, 28, 28, 14, 18, 20].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const prod = wb.addWorksheet('Valid Loan Products', { views: [{ showGridLines: true }] });
  prod.addRow(['Product Name']);
  prod.getRow(1).font = { bold: true };
  const products = loanProducts || [];
  if (products.length) {
    products.forEach((p) => prod.addRow([p.name]));
  } else {
    prod.addRow(['(No products — add loan products first)']);
  }
  const lastProdRow = Math.max(2, prod.rowCount);

  ws.dataValidations.add(
    `C2:C${DATA_ENTRY_MAX_ROW}`,
    listValidation([sheetColumnRangeFormula('Valid Loan Products', 'A', 2, lastProdRow)], 'Select a product from Valid Loan Products.'),
  );

  addInstructionsSheet(wb, [
    'Column Name — Description — Example',
    'borrower_id — DO NOT CHANGE. Unique ID of the borrower. — B-123456',
    'borrower_name — DO NOT CHANGE. Reference only. — John Doe',
    'loan_product_name — use dropdown — exact active product name',
    'principal — loan amount — no currency symbols — 500000',
    'disbursement_date — YYYY-MM-DD — 2025-11-09',
    'repayment_start_date — YYYY-MM-DD — 2025-12-09',
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  triggerExcelDownload(buffer, 'Prepared_Loans_Template.xlsx');
}

/**
 * @param {{
 *   validBorrowers: Array<{ borrower_id: string, name: string }>,
 *   loanProducts: Array<{ name: string, interest_rate?: unknown, period?: unknown, unit?: unknown }>,
 *   exampleProductName?: string,
 * }} p
 */
export async function downloadLoansImportTemplate({ validBorrowers, loanProducts, exampleProductName }) {
  const wb = new ExcelJS.Workbook();
  const loans = wb.addWorksheet('Loans Import', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });
  const exProd = exampleProductName || loanProducts[0]?.name || 'Your Product Name';
  loans.addRow(['borrower_id', 'loan_product_name', 'principal', 'disbursement_date', 'repayment_start_date']);
  loans.getRow(1).font = { bold: true };
  loans.addRow(['B-000001', exProd, 500000, 'YYYY-MM-DD', 'YYYY-MM-DD']);
  loans.addRow(['', '', '', '', '']);
  [14, 30, 14, 18, 22].forEach((w, i) => {
    loans.getColumn(i + 1).width = w;
  });

  const vb = wb.addWorksheet('Valid Borrowers', { views: [{ showGridLines: true }] });
  vb.addRow(['borrower_id', 'name']);
  vb.getRow(1).font = { bold: true };
  if (validBorrowers.length) {
    validBorrowers.forEach((b) => vb.addRow([b.borrower_id, b.name]));
  } else {
    vb.addRow(['(no eligible borrowers)', '']);
  }
  const lastB = Math.max(2, vb.rowCount);

  const vp = wb.addWorksheet('Valid Loan Products', { views: [{ showGridLines: true }] });
  vp.addRow(['product_name', 'interest_rate', 'period', 'unit']);
  vp.getRow(1).font = { bold: true };
  const prods = loanProducts || [];
  if (prods.length) {
    prods.forEach((p) =>
      vp.addRow([
        p.name,
        p.interest_rate ?? '',
        p.loan_period ?? p.period ?? '',
        p.loan_period_unit ?? p.unit ?? '',
      ]),
    );
  } else {
    vp.addRow(['(no products)', '', '', '']);
  }
  const lastP = Math.max(2, vp.rowCount);

  loans.dataValidations.add(
    `A2:A${DATA_ENTRY_MAX_ROW}`,
    listValidation([sheetColumnRangeFormula('Valid Borrowers', 'A', 2, lastB)], 'Pick borrower_id from Valid Borrowers.'),
  );
  loans.dataValidations.add(
    `B2:B${DATA_ENTRY_MAX_ROW}`,
    listValidation([sheetColumnRangeFormula('Valid Loan Products', 'A', 2, lastP)], 'Pick product name from Valid Loan Products (case-insensitive on import).'),
  );

  addInstructionsSheet(wb, [
    'Loans bulk import (officer)',
    '',
    'Sheet "Loans Import" — columns (required):',
    'borrower_id — from Valid Borrowers (eligible / paid up, no outstanding loan).',
    'loan_product_name — dropdown matches Valid Loan Products (import is case-insensitive).',
    'principal — number only.',
    'disbursement_date — YYYY-MM-DD; working day.',
    'repayment_start_date — YYYY-MM-DD; working day.',
    '',
    'Rules:',
    '- One row per new loan. Duplicate borrower_id in the same file is skipped.',
    '- Borrowers with outstanding loans or wrong status are skipped.',
    '- Field wallet must cover principal + fee per disbursement date.',
    '- Import only on working days.',
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  triggerExcelDownload(buffer, 'Loans_Import_Template.xlsx');
}

export async function downloadCentersImportTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Centers', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });
  ws.addRow(['name', 'location']);
  ws.getRow(1).font = { bold: true };
  ws.addRow(['Example Centre', 'Dar es Salaam']);
  ws.addRow(['', '']);
  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 36;

  addInstructionsSheet(wb, [
    'Centers bulk import',
    '',
    'Sheet "Centers" — required columns:',
    'name — centre name (unique among your centres).',
    'location — location / address.',
    '',
    'Rules:',
    '- One row per centre. Empty rows are skipped.',
    '- Duplicate centre name (same spelling, case ignored) is skipped on import.',
    '- Your account must have a branch assigned.',
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  triggerExcelDownload(buffer, 'Centers_Import_Template.xlsx');
}

/** @param {{ centers: Array<{ name: string }> }} p */
export async function downloadGroupsImportTemplate({ centers }) {
  const list = centers || [];
  const exampleCenter = list.length > 0 ? list[0].name : 'Example Centre';

  const wb = new ExcelJS.Workbook();
  const grp = wb.addWorksheet('Groups', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });
  grp.addRow(['group_name', 'center_name']);
  grp.getRow(1).font = { bold: true };
  grp.addRow(['Upendo', exampleCenter]);
  grp.addRow(['', '']);
  grp.getColumn(1).width = 28;
  grp.getColumn(2).width = 32;

  const ref = wb.addWorksheet('Reference_Centres', { views: [{ showGridLines: true }] });
  ref.addRow(['center_name']);
  ref.getRow(1).font = { bold: true };
  if (list.length) {
    list.forEach((c) => ref.addRow([c.name]));
  } else {
    ref.addRow(['(Create centres first)']);
  }
  const lastR = Math.max(2, ref.rowCount);

  grp.dataValidations.add(
    `B2:B${DATA_ENTRY_MAX_ROW}`,
    listValidation([sheetColumnRangeFormula('Reference_Centres', 'A', 2, lastR)], 'Pick centre_name from Reference_Centres (create centres first).'),
  );

  addInstructionsSheet(wb, [
    'Groups bulk import',
    '',
    'Sheet "Groups" — required columns:',
    'group_name — unique per centre.',
    'center_name — dropdown: must match a centre (see Reference_Centres).',
    '',
    'Rules:',
    '- Duplicate group name in the same centre is skipped.',
    '- Create centres before importing groups.',
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  triggerExcelDownload(buffer, 'Groups_Import_Template.xlsx');
}

/** Template for branch managers: bulk register loan officers (same branch as manager). */
export async function downloadLoanOfficersImportTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Loan Officers', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });
  ws.addRow(['full_name', 'email', 'password']);
  ws.getRow(1).font = { bold: true };
  ws.addRow(['Jane Officer', 'jane.officer@example.com', 'ChangeMe123!']);
  ws.addRow(['', '', '']);
  [28, 36, 18].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  addInstructionsSheet(wb, [
    'Loan officers — bulk registration (manager)',
    '',
    'Sheet "Loan Officers" — one row per new officer. Columns:',
    'full_name — full name (required).',
    'email — login email, unique in the system (required).',
    'password — initial password; officers should change after first login (required).',
    '',
    'Rules:',
    '- All officers are assigned to YOUR branch automatically (no branch column).',
    '- Empty rows are skipped.',
    '- Duplicate email in the file or already registered in your branch is skipped.',
    '- Use strong passwords; minimum length enforced on import.',
    '- After import, officers appear in this list — you can reset passwords per user if needed.',
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  triggerExcelDownload(buffer, 'Loan_Officers_Import_Template.xlsx');
}
