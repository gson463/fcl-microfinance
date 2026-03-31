import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { resolveLogoUrl, DEFAULT_TAGLINE } from '@/lib/brand';

const EAT_TZ = 'Africa/Nairobi';

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

function fmtMoney(currency, n) {
  if (n === '' || n == null) return '';
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const HEAD = [
  'Taken',
  'Centre',
  'Disb.',
  '# disb',
  'Coll.−prep',
  'App fee',
  'Prepay.',
  '# prep',
  'Pen.',
  'Transp.',
  'Exp (1)',
  'Exp (2)',
  'DEPOSIT',
];

/**
 * @param {object} p
 * @param {string} p.systemName
 * @param {string} [p.tagline]
 * @param {string} [p.logoUrl] - raw config value or null (uses default logo)
 * @param {string} p.branchLabel
 * @param {string} p.dateRangeLabel
 * @param {string} p.currency
 * @param {Array} p.blocks - from buildOfficerCenterBlocks
 */
export async function downloadFieldWalletPdf({
  systemName,
  tagline = DEFAULT_TAGLINE,
  logoUrl = null,
  branchLabel,
  dateRangeLabel,
  currency,
  blocks,
}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  const headerH = 28;
  const dataUrl = await fetchImageAsDataUrl(absoluteLogoUrl(logoUrl));

  doc.setFillColor(201, 162, 39);
  doc.rect(0, 0, pageW, headerH, 'F');

  let textLeft = margin;
  const logoMaxH = 18;
  const logoMaxW = 40;

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
      textLeft = margin + w + 5;
    } catch {
      /* ignore */
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(systemName || 'Field wallet report', textLeft, 10, { maxWidth: pageW - textLeft - margin });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  if (tagline) doc.text(tagline, textLeft, 16, { maxWidth: pageW - textLeft - margin });
  doc.setFontSize(8);
  doc.text(branchLabel, textLeft, tagline ? 21 : 18, { maxWidth: pageW - textLeft - margin });
  doc.text(dateRangeLabel, textLeft, tagline ? 25 : 22, { maxWidth: pageW - textLeft - margin });
  doc.setTextColor(33, 33, 33);
  doc.setFont('helvetica', 'normal');

  let y = headerH + 8;

  const head = [HEAD];

  const drawBlock = (block) => {
    if (y > pageH - 45) {
      doc.addPage();
      y = margin;
    }

    const officerName = block.officer?.full_name || 'Officer';

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(55, 65, 81);
    doc.text(`Officer: ${officerName}`, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(33, 33, 33);
    y += 5;

    const body = [];
    if (block.centerRows && block.centerRows.length > 0) {
      for (const cr of block.centerRows) {
        body.push([
          '',
          cr.centerName,
          fmtMoney(currency, cr.disbursement),
          cr.disbursedClients,
          fmtMoney(currency, cr.collectionWithoutPrepayment),
          fmtMoney(currency, cr.applicationFee),
          fmtMoney(currency, cr.prepayment),
          cr.prepaidClients,
          fmtMoney(currency, cr.penalty),
          '',
          '',
          '',
          '',
        ]);
      }
    } else {
      body.push(['', '— No data —', '', '', '', '', '', '', '', '', '', '', '']);
    }

    const t = block.totals;
    body.push([
      '',
      'TOTAL',
      fmtMoney(currency, t.disbursement),
      t.disbursedClients,
      fmtMoney(currency, t.collectionWithoutPrepayment),
      fmtMoney(currency, t.applicationFee),
      fmtMoney(currency, t.prepayment),
      t.prepaidClients,
      fmtMoney(currency, t.penalty),
      fmtMoney(currency, t.transport),
      fmtMoney(currency, t.expense1),
      fmtMoney(currency, t.expense2),
      fmtMoney(currency, t.deposit),
    ]);

    const totalRowIndex = body.length - 1;

    doc.autoTable({
      startY: y,
      head,
      body,
      theme: 'grid',
      headStyles: { fillColor: [217, 217, 217], textColor: [20, 20, 20], fontSize: 7 },
      styles: { fontSize: 6.5, cellPadding: 1.2 },
      columnStyles: {
        0: { cellWidth: 14 },
        1: { cellWidth: 28 },
        2: { cellWidth: 22 },
        3: { cellWidth: 10 },
        4: { cellWidth: 22 },
        5: { cellWidth: 18 },
        6: { cellWidth: 18 },
        7: { cellWidth: 10 },
        8: { cellWidth: 16 },
        9: { cellWidth: 18 },
        10: { cellWidth: 16 },
        11: { cellWidth: 16 },
        12: { cellWidth: 22 },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalRowIndex) {
          data.cell.styles.fillColor = [255, 255, 153];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    y = doc.lastAutoTable.finalY + 10;
  };

  for (const block of blocks) {
    drawBlock(block);
  }

  if (blocks.length === 0) {
    doc.setFontSize(9);
    doc.text('No officer data in this period.', margin, y);
  }

  const totalPages = doc.internal.getNumberOfPages();
  const gen = new Date().toLocaleString('en-GB', { timeZone: EAT_TZ });
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 100);
    doc.text(`${systemName} — confidential · ${gen}`, margin, pageH - 4, { maxWidth: pageW - margin - 36 });
    doc.text(`Page ${i} / ${totalPages}`, pageW - margin - 18, pageH - 4);
  }

  doc.save(`field_wallet_${Date.now()}.pdf`);
}
