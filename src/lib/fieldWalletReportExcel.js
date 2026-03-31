import ExcelJS from 'exceljs';

const COLS = [
  'Officers Name',
  'Amount Taken',
  'Centers',
  'Disbursement',
  'No. of disbursed clients',
  'Collection without Prepayment',
  'Application Fee',
  'Prepayment',
  'No. of prepaid clients',
  'Penalty',
  'Transport',
  'Expenses (1)',
  'Expenses (2)',
  'DEPOSIT',
];

function fmt(n, currency) {
  if (n === '' || n === null || n === undefined) return '';
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return `${currency} ${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function thinBorder() {
  return {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
}

/**
 * @param {object} p
 * @param {string} p.systemName
 * @param {string} p.branchLabel
 * @param {string} p.dateRangeLabel
 * @param {ArrayBuffer | null} p.logoBuffer
 * @param {string} p.logoExtension
 * @param {string} p.currency
 * @param {Array} p.blocks - from buildOfficerCenterBlocks
 */
export async function downloadFieldWalletExcel({
  systemName,
  branchLabel,
  dateRangeLabel,
  logoBuffer,
  logoExtension = 'png',
  currency,
  blocks,
}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Field wallet', {
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: true }],
  });

  [14, 14, 22, 14, 12, 18, 14, 14, 12, 10, 12, 12, 12, 14].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  let r = 1;

  if (logoBuffer && logoBuffer.byteLength > 0) {
    const imgId = wb.addImage({
      buffer: logoBuffer,
      extension: logoExtension === 'jpeg' || logoExtension === 'jpg' ? 'jpeg' : 'png',
    });
    ws.addImage(imgId, {
      tl: { col: 0, row: 0 },
      ext: { width: 160, height: 48 },
    });
    r = 4;
  }

  ws.mergeCells(r, 1, r, 14);
  const titleCell = ws.getCell(r, 1);
  titleCell.value = systemName || 'Field wallet report';
  titleCell.font = { bold: true, size: 16 };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  r += 1;

  ws.mergeCells(r, 1, r, 14);
  ws.getCell(r, 1).value = branchLabel;
  ws.getCell(r, 1).alignment = { horizontal: 'center' };
  r += 1;

  ws.mergeCells(r, 1, r, 14);
  ws.getCell(r, 1).value = dateRangeLabel;
  ws.getCell(r, 1).alignment = { horizontal: 'center' };
  r += 2;

  const grey = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };

  for (const block of blocks) {
    const officerName = block.officer?.full_name || 'Officer';

    const hr = ws.getRow(r);
    COLS.forEach((name, i) => {
      const c = hr.getCell(i + 1);
      c.value = name;
      c.font = { bold: true };
      c.fill = grey;
      c.border = thinBorder();
    });
    r += 1;

    const blockStart = r;

    if (!block.centerRows || block.centerRows.length === 0) {
      const row = ws.getRow(r);
      row.getCell(3).value = '— No data for this officer —';
      for (let i = 1; i <= 14; i += 1) row.getCell(i).border = thinBorder();
      r += 1;
    } else {
      for (const cr of block.centerRows) {
        const row = ws.getRow(r);
        const vals = [
          '',
          '',
          cr.centerName,
          fmt(cr.disbursement, currency),
          cr.disbursedClients,
          fmt(cr.collectionWithoutPrepayment, currency),
          fmt(cr.applicationFee, currency),
          fmt(cr.prepayment, currency),
          cr.prepaidClients,
          fmt(cr.penalty, currency),
          '',
          '',
          '',
          '',
        ];
        vals.forEach((v, i) => {
          row.getCell(i + 1).value = v;
          row.getCell(i + 1).border = thinBorder();
        });
        r += 1;
      }
    }

    const t = block.totals;
    const tr = ws.getRow(r);
    const tvals = [
      '',
      '',
      'TOTAL',
      fmt(t.disbursement, currency),
      t.disbursedClients,
      fmt(t.collectionWithoutPrepayment, currency),
      fmt(t.applicationFee, currency),
      fmt(t.prepayment, currency),
      t.prepaidClients,
      fmt(t.penalty, currency),
      fmt(t.transport, currency),
      fmt(t.expense1, currency),
      fmt(t.expense2, currency),
      fmt(t.deposit, currency),
    ];
    tvals.forEach((v, i) => {
      const c = tr.getCell(i + 1);
      c.value = v;
      c.font = { bold: true };
      c.fill = yellow;
      c.border = thinBorder();
    });
    r += 1;

    const blockEnd = r - 1;
    if (blockEnd >= blockStart) {
      ws.mergeCells(blockStart, 1, blockEnd, 1);
      const ac = ws.getCell(blockStart, 1);
      ac.value = officerName;
      ac.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90 };
      ac.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ac.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    }

    r += 1;
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `field_wallet_${Date.now()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchLogoBufferFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ext = url.split('?')[0].toLowerCase().endsWith('.jpg') || url.includes('jpeg') ? 'jpeg' : 'png';
    return { buffer: buf, extension: ext };
  } catch {
    return null;
  }
}
