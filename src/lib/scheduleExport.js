import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/customSupabaseClient';
import { DEFAULT_SYSTEM_NAME, DEFAULT_TAGLINE, resolveLogoUrl } from '@/lib/brand';

const EAT_TZ = 'Africa/Nairobi';

/** Public URL for fetch (browser): same-origin asset or full Supabase URL */
function absoluteLogoUrl(logoUrl) {
  const u = resolveLogoUrl(logoUrl);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (typeof window === 'undefined') return u;
  const origin = window.location.origin;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const path = u.startsWith('/') ? u : `/${u}`;
  return `${origin}${base === '' ? '' : base}${path}`;
}

/** Data URL for jsPDF addImage; null if CORS/network fails */
async function fetchImageAsDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(currency, n) {
  const v = Number(n) || 0;
  return `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDue(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { timeZone: EAT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return '—';
  }
}

async function resolveBranding(partial) {
  const { data } = await supabase
    .from('system_config')
    .select('key, value')
    .in('key', ['systemName', 'tagline', 'logoUrl']);
  const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return {
    systemName: map.systemName || partial?.systemName || DEFAULT_SYSTEM_NAME,
    tagline: map.tagline || partial?.tagline || DEFAULT_TAGLINE,
    logoUrl: resolveLogoUrl(map.logoUrl || partial?.logoUrl),
  };
}

/** Build export payload from a loan row (with borrowers, loan_products, groups, branches joined). */
export function scheduleExportMetaFromLoan(loan, currency, variant) {
  const b = loan?.borrowers;
  return {
    currency,
    variant,
    loan: {
      loan_id: loan?.loan_id,
      total_payable: loan?.total_payable,
      principal: loan?.principal,
      product_name: loan?.loan_products?.name,
      status: loan?.status,
      disbursement_date: loan?.disbursement_date,
      repayment_start_date: loan?.repayment_start_date,
    },
    borrower: {
      first_name: b?.first_name,
      surname: b?.surname,
      borrower_id: b?.borrower_id,
      phone_number: b?.phone_number,
      branch_name: b?.branches?.name,
      group_name: b?.groups?.name,
    },
    schedule: loan?.schedule,
  };
}

function safeFilePart(s) {
  return String(s || 'loan').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80);
}

/**
 * @param {object} meta
 * @param {string} [meta.systemName]
 * @param {string} meta.currency
 * @param {'full'|'simple'} meta.variant
 * @param {object} meta.loan — loan_id, total_payable, principal, status, disbursement_date, repayment_start_date, product_name
 * @param {object} [meta.borrower] — first_name, surname, borrower_id, phone_number, branch_name, group_name
 * @param {Array} meta.schedule — installment rows
 */
export async function exportRepaymentScheduleExcel(meta) {
  const { systemName, tagline } = await resolveBranding(meta);
  const { currency, variant, loan, borrower, schedule } = meta;
  const maxCol = variant === 'full' ? 6 : 4;
  const rows = [];
  const merges = [];

  const mergeRow = (text) => {
    const r = rows.length;
    rows.push([text]);
    merges.push({ s: { r, c: 0 }, e: { r, c: maxCol } });
  };

  mergeRow(systemName);
  mergeRow(tagline);
  rows.push([]);
  mergeRow('Loan repayment schedule — official extract');
  mergeRow(`Generated: ${new Date().toLocaleString('en-GB', { timeZone: EAT_TZ })}`);
  rows.push([]);
  mergeRow('BORROWER —');
  const bName = borrower ? `${borrower.first_name || ''} ${borrower.surname || ''}`.trim() : '';
  if (bName) rows.push(['Borrower', bName]);
  if (borrower?.borrower_id) rows.push(['Borrower ID', borrower.borrower_id]);
  if (borrower?.phone_number) rows.push(['Phone', String(borrower.phone_number)]);
  if (borrower?.branch_name) rows.push(['Branch', borrower.branch_name]);
  if (borrower?.group_name) rows.push(['Group', borrower.group_name]);
  rows.push([]);
  mergeRow('LOAN —');
  rows.push(['Loan ID', loan.loan_id || '—']);
  if (loan.product_name) rows.push(['Product', loan.product_name]);
  if (loan.status) rows.push(['Loan status', loan.status]);
  if (loan.principal != null) rows.push(['Principal', fmtMoney(currency, loan.principal)]);
  if (loan.total_payable != null) rows.push(['Total payable', fmtMoney(currency, loan.total_payable)]);
  if (loan.disbursement_date) rows.push(['Disbursement', fmtDue(loan.disbursement_date)]);
  if (loan.repayment_start_date) rows.push(['Repayment start', fmtDue(loan.repayment_start_date)]);
  rows.push([]);
  mergeRow('INSTALLMENTS —');
  if (variant === 'full') {
    rows.push(['#', 'Due date', 'Amount due', 'Principal paid', 'Interest paid', 'Total paid', 'Status']);
    (schedule || []).forEach((inst) => {
      rows.push([
        inst.installmentNumber,
        fmtDue(inst.dueDate),
        Number(inst.amount) || 0,
        Number(inst.principalPaid) || 0,
        Number(inst.interestPaid) || 0,
        Number(inst.paidAmount) || 0,
        inst.status || '',
      ]);
    });
  } else {
    rows.push(['#', 'Due date', 'Amount due', 'Paid', 'Status']);
    (schedule || []).forEach((inst) => {
      rows.push([
        inst.installmentNumber,
        fmtDue(inst.dueDate),
        Number(inst.amount) || 0,
        Number(inst.paidAmount) || 0,
        inst.status || '',
      ]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] =
    variant === 'full'
      ? [{ wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]
      : [{ wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
  const fn = `Repayment_schedule_${safeFilePart(loan.loan_id)}.xlsx`;
  XLSX.writeFile(wb, fn);
}

export async function exportRepaymentSchedulePdf(meta) {
  const { systemName, tagline, logoUrl } = await resolveBranding(meta);
  const { currency, variant, loan, borrower, schedule } = meta;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  const headerH = 34;
  const dataUrl = await fetchImageAsDataUrl(absoluteLogoUrl(logoUrl));

  doc.setFillColor(201, 162, 39);
  doc.rect(0, 0, pageW, headerH, 'F');

  let textLeft = margin;
  const logoMaxH = 20;
  const logoMaxW = 46;

  if (dataUrl) {
    try {
      const props = doc.getImageProperties(dataUrl);
      const ratio = props.width / props.height;
      let h = logoMaxH;
      let w = h * ratio;
      if (w > logoMaxW) {
        w = logoMaxW;
        h = w / ratio;
      }
      const yLogo = (headerH - h) / 2;
      const lower = String(dataUrl).toLowerCase();
      const imgFmt =
        lower.includes('image/jpeg') || lower.includes('image/jpg')
          ? 'JPEG'
          : lower.includes('image/png')
            ? 'PNG'
            : 'PNG';
      doc.addImage(dataUrl, imgFmt, margin, yLogo, w, h);
      textLeft = margin + w + 6;
    } catch {
      // ignore
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(systemName, textLeft, 12, { maxWidth: pageW - textLeft - margin });
  doc.setFontSize(9);
  doc.text(tagline, textLeft, 20, { maxWidth: pageW - textLeft - margin });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Repayment schedule', textLeft, 28, { maxWidth: pageW - textLeft - margin });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(33, 33, 33);

  const bName = borrower ? `${borrower.first_name || ''} ${borrower.surname || ''}`.trim() : '';
  const metaBody = [];
  if (bName) metaBody.push(['Borrower', bName]);
  if (borrower?.borrower_id) metaBody.push(['Borrower ID', borrower.borrower_id]);
  if (borrower?.phone_number) metaBody.push(['Phone', String(borrower.phone_number)]);
  if (borrower?.branch_name) metaBody.push(['Branch', borrower.branch_name]);
  if (borrower?.group_name) metaBody.push(['Group', borrower.group_name]);
  metaBody.push(['Loan ID', loan.loan_id || '—']);
  if (loan.product_name) metaBody.push(['Product', loan.product_name]);
  if (loan.status) metaBody.push(['Loan status', loan.status]);
  if (loan.principal != null) metaBody.push(['Principal', fmtMoney(currency, loan.principal)]);
  if (loan.total_payable != null) metaBody.push(['Total payable', fmtMoney(currency, loan.total_payable)]);
  if (loan.disbursement_date) metaBody.push(['Disbursement', fmtDue(loan.disbursement_date)]);
  if (loan.repayment_start_date) metaBody.push(['Repayment start', fmtDue(loan.repayment_start_date)]);
  metaBody.push(['Generated', new Date().toLocaleString('en-GB', { timeZone: EAT_TZ })]);

  doc.autoTable({
    startY: headerH + 6,
    head: [['Field', 'Details']],
    body: metaBody,
    theme: 'grid',
    headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8, cellPadding: 2.2 },
    columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: pageW - margin * 2 - 44 } },
    margin: { left: margin, right: margin },
  });

  let startY = doc.lastAutoTable.finalY + 8;
  if (startY > 250) {
    doc.addPage();
    startY = margin;
  }
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(55, 65, 81);
  doc.text('Installments', margin, startY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(33, 33, 33);
  startY += 5;

  const head =
    variant === 'full'
      ? [['#', 'Due', 'Due amt', 'Princ. paid', 'Int. paid', 'Paid', 'Status']]
      : [['#', 'Due', 'Due amt', 'Paid', 'Status']];

  const body = (schedule || []).map((inst) =>
    variant === 'full'
      ? [
          inst.installmentNumber,
          fmtDue(inst.dueDate),
          fmtMoney(currency, inst.amount),
          fmtMoney(currency, inst.principalPaid || 0),
          fmtMoney(currency, inst.interestPaid || 0),
          fmtMoney(currency, inst.paidAmount || 0),
          inst.status || '',
        ]
      : [
          inst.installmentNumber,
          fmtDue(inst.dueDate),
          fmtMoney(currency, inst.amount),
          fmtMoney(currency, inst.paidAmount || 0),
          inst.status || '',
        ]
  );

  doc.autoTable({
    startY: startY,
    head,
    body,
    theme: 'grid',
    headStyles: { fillColor: [228, 228, 228], textColor: [20, 20, 20], fontSize: 7 },
    styles: { fontSize: 7, cellPadding: 1.4 },
    alternateRowStyles: { fillColor: [247, 249, 251] },
    margin: { left: margin, right: margin },
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(`${systemName} — confidential`, margin, pageH - 6, { maxWidth: pageW - 2 * margin - 28 });
    doc.text(`Page ${i} / ${totalPages}`, pageW - margin - 22, pageH - 6);
  }

  doc.save(`Repayment_schedule_${safeFilePart(loan.loan_id)}.pdf`);
}

export async function printRepaymentSchedule(meta) {
  const { systemName, tagline, logoUrl } = await resolveBranding(meta);
  const { currency, variant, loan, borrower, schedule } = meta;
  const bName = borrower ? `${borrower.first_name || ''} ${borrower.surname || ''}`.trim() : '';
  const logoSrc = absoluteLogoUrl(logoUrl);

  const headCols =
    variant === 'full'
      ? ['#', 'Due date', 'Amount due', 'Principal paid', 'Interest paid', 'Total paid', 'Status']
      : ['#', 'Due date', 'Amount due', 'Paid', 'Status'];

  const bodyRows = (schedule || [])
    .map((inst) => {
      if (variant === 'full') {
        return `<tr>
          <td>${escapeHtml(inst.installmentNumber)}</td>
          <td>${escapeHtml(fmtDue(inst.dueDate))}</td>
          <td class="num">${escapeHtml(fmtMoney(currency, inst.amount))}</td>
          <td class="num">${escapeHtml(fmtMoney(currency, inst.principalPaid || 0))}</td>
          <td class="num">${escapeHtml(fmtMoney(currency, inst.interestPaid || 0))}</td>
          <td class="num">${escapeHtml(fmtMoney(currency, inst.paidAmount || 0))}</td>
          <td>${escapeHtml(inst.status)}</td>
        </tr>`;
      }
      return `<tr>
        <td>${escapeHtml(inst.installmentNumber)}</td>
        <td>${escapeHtml(fmtDue(inst.dueDate))}</td>
        <td class="num">${escapeHtml(fmtMoney(currency, inst.amount))}</td>
        <td class="num">${escapeHtml(fmtMoney(currency, inst.paidAmount || 0))}</td>
        <td>${escapeHtml(inst.status)}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(systemName)} — Schedule</title>
  <style>
    @page { margin: 14mm; size: A4 portrait; }
    body { font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; color: #111827; font-size: 11px; line-height: 1.45; }
    .letterhead { background: linear-gradient(90deg, #c9a227 0%, #9a7b1c 100%); color: #fff; margin: -8px -8px 18px -8px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 14px rgba(0,0,0,.12); }
    .letterhead-inner { display: flex; align-items: center; gap: 18px; padding: 16px 22px; }
    .letterhead-logo { height: 56px; width: auto; max-width: 150px; object-fit: contain; flex-shrink: 0; background: rgba(255,255,255,.14); border-radius: 8px; padding: 6px; }
    .letterhead-text { flex: 1; min-width: 0; }
    .letterhead-text h1 { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: 0.03em; text-shadow: 0 1px 1px rgba(0,0,0,.15); }
    .letterhead-text .tagline { margin: 5px 0 0; font-size: 10px; opacity: 0.96; }
    .letterhead-text .doc-title { margin: 10px 0 0; font-size: 11px; font-weight: 700; border-top: 1px solid rgba(255,255,255,.35); padding-top: 8px; }
    .section-label { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: #6b7280; text-transform: uppercase; margin: 0 0 6px 2px; }
    .meta { margin-bottom: 14px; border: 1px solid #d1d5db; border-radius: 8px; overflow: hidden; background: #fafafa; }
    .meta table { width: 100%; border-collapse: collapse; }
    .meta td { padding: 7px 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .meta tr:last-child td { border-bottom: none; }
    .meta td:first-child { width: 36%; background: #f3f4f6; font-weight: 600; color: #374151; }
    .schedule-wrap { overflow-x: auto; }
    table.grid { border-collapse: collapse; width: 100%; min-width: 560px; }
    table.grid th, table.grid td { border: 1px solid #c6c6c6; padding: 6px 8px; }
    table.grid th { background: linear-gradient(180deg, #ececec 0%, #e0e0e0 100%); font-weight: 700; text-align: left; font-size: 10px; color: #1f2937; }
    table.grid td.num { text-align: right; font-variant-numeric: tabular-nums; }
    table.grid tbody tr:nth-child(even) { background: #f7f9fb; }
    .foot { margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #6b7280; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="letterhead">
    <div class="letterhead-inner">
      <img class="letterhead-logo" src="${escapeHtml(logoSrc)}" alt="" crossorigin="anonymous" onerror="this.style.visibility='hidden';this.style.width='0';this.style.padding='0';" />
      <div class="letterhead-text">
        <h1>${escapeHtml(systemName)}</h1>
        <p class="tagline">${escapeHtml(tagline)}</p>
        <p class="doc-title">Repayment schedule — Loan ${escapeHtml(loan.loan_id || '')}</p>
      </div>
    </div>
  </div>
  <p class="section-label">Borrower &amp; loan summary</p>
  <div class="meta">
    <table>
      ${bName ? `<tr><td>Borrower</td><td>${escapeHtml(bName)}</td></tr>` : ''}
      ${borrower?.borrower_id ? `<tr><td>Borrower ID</td><td>${escapeHtml(borrower.borrower_id)}</td></tr>` : ''}
      ${borrower?.phone_number ? `<tr><td>Phone</td><td>${escapeHtml(String(borrower.phone_number))}</td></tr>` : ''}
      ${borrower?.branch_name ? `<tr><td>Branch</td><td>${escapeHtml(borrower.branch_name)}</td></tr>` : ''}
      ${borrower?.group_name ? `<tr><td>Group</td><td>${escapeHtml(borrower.group_name)}</td></tr>` : ''}
      ${loan.product_name ? `<tr><td>Product</td><td>${escapeHtml(loan.product_name)}</td></tr>` : ''}
      ${loan.status ? `<tr><td>Loan status</td><td>${escapeHtml(loan.status)}</td></tr>` : ''}
      ${loan.principal != null ? `<tr><td>Principal</td><td>${escapeHtml(fmtMoney(currency, loan.principal))}</td></tr>` : ''}
      ${loan.total_payable != null ? `<tr><td>Total payable</td><td>${escapeHtml(fmtMoney(currency, loan.total_payable))}</td></tr>` : ''}
      ${loan.disbursement_date ? `<tr><td>Disbursement</td><td>${escapeHtml(fmtDue(loan.disbursement_date))}</td></tr>` : ''}
      ${loan.repayment_start_date ? `<tr><td>Repayment start</td><td>${escapeHtml(fmtDue(loan.repayment_start_date))}</td></tr>` : ''}
      <tr><td>Generated</td><td>${escapeHtml(new Date().toLocaleString('en-GB', { timeZone: EAT_TZ }))}</td></tr>
    </table>
  </div>
  <p class="section-label">Installment schedule</p>
  <div class="schedule-wrap">
    <table class="grid">
      <thead><tr>${headCols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>
  <div class="foot"><span>${escapeHtml(systemName)} — confidential</span><span>${escapeHtml(new Date().toLocaleDateString('en-GB', { timeZone: EAT_TZ }))}</span></div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=960,height=720');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
