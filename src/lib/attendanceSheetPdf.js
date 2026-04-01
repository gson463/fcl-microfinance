import jsPDF from 'jspdf';
import 'jspdf-autotable';

/** FCL brand (match tailwind.config.js brand.gold / gold-deep) */
const BRAND_GOLD = [212, 175, 55];
const BRAND_GOLD_DEEP = [184, 134, 11];
const BRAND_GOLD_MUTED = [201, 169, 97];
const NEUTRAL_700 = [55, 65, 81];
const NEUTRAL_500 = [100, 116, 139];

async function loadLogoDataUrl(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;
  const trimmed = logoUrl.trim();
  if (!trimmed) return null;
  try {
    const abs = trimmed.startsWith('http')
      ? trimmed
      : `${typeof window !== 'undefined' ? window.location.origin : ''}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
    const res = await fetch(abs);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Shared branded header (logo strip, logo, titles).
 * @returns {{ y: number, pageW: number, margin: number, orientation: string }}
 */
async function populateBrandedHeader(doc, opts, pageW, margin, { mainTitle, badgeRight }) {
  doc.setFillColor(BRAND_GOLD[0], BRAND_GOLD[1], BRAND_GOLD[2]);
  doc.rect(0, 0, pageW, 2.2, 'F');

  let y = margin + 2;
  const logoDataUrl = await loadLogoDataUrl(opts.logoUrl);
  const logoW = 22;
  const logoH = 12;
  const headerTop = y;

  if (logoDataUrl) {
    const fmt = String(logoDataUrl).includes('image/jpeg') || String(logoDataUrl).startsWith('data:image/jpeg')
      ? 'JPEG'
      : 'PNG';
    try {
      doc.addImage(logoDataUrl, fmt, margin, headerTop, logoW, logoH);
    } catch {
      // ignore
    }
  }

  const textX = logoDataUrl ? margin + logoW + 3 : margin;
  const titleRight = pageW - margin;

  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(BRAND_GOLD_DEEP[0], BRAND_GOLD_DEEP[1], BRAND_GOLD_DEEP[2]);
  doc.text(mainTitle, textX, headerTop + 6);

  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
  doc.text(String(opts.systemName || 'Microfinance'), textX, headerTop + 12);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(NEUTRAL_500[0], NEUTRAL_500[1], NEUTRAL_500[2]);
  if (opts.tagline) {
    doc.text(String(opts.tagline), textX, headerTop + 16);
  }

  doc.setFontSize(7);
  doc.setTextColor(BRAND_GOLD_MUTED[0], BRAND_GOLD_MUTED[1], BRAND_GOLD_MUTED[2]);
  doc.text(badgeRight, titleRight, headerTop + 6, { align: 'right' });

  y = headerTop + Math.max(logoH, 18) + 3;

  doc.setDrawColor(BRAND_GOLD[0], BRAND_GOLD[1], BRAND_GOLD[2]);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  return { y, pageW, margin, headerTop, textX, logoH };
}

/**
 * Printable group-wise attendance sheet (empty boxes for manual marks).
 * @param {object} opts
 * @param {string} opts.systemName
 * @param {string} [opts.logoUrl]
 * @param {string} [opts.tagline]
 * @param {string} opts.centreName
 * @param {string} opts.officerName
 * @param {string} [opts.meetingDate]
 * @param {Array<{ groupName: string, rows: Array<{ sn: number, name: string }> }>} opts.groups
 * @param {number} [opts.numBoxes=12]
 * @param {string} [opts.fileName]
 */
export async function downloadAttendanceSheetPdf(opts) {
  const numBoxes = Math.min(40, Math.max(1, Number(opts.numBoxes) || 12));
  /** Portrait (A4 kusimama) by default; landscape only when many manual mark columns need width. */
  const orientation = numBoxes > 30 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 10;

  let y = (
    await populateBrandedHeader(doc, opts, pageW, margin, {
      mainTitle: 'Centre attendance sheet',
      badgeRight: 'Official attendance register',
    })
  ).y;

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
  doc.text(`Centre: ${opts.centreName || '—'}`, margin, y);
  y += 5;
  doc.text(`Loan officer: ${opts.officerName || '—'}`, margin, y);
  y += 5;
  if (opts.meetingDate) {
    doc.text(`Printed for: ${opts.meetingDate}`, margin, y);
    y += 5;
  }
  y += 4;

  const boxColW = numBoxes > 20 ? 6 : numBoxes > 14 ? 7 : 8;
  const nameColW = orientation === 'landscape' ? 55 : 50;
  const snColW = 12;

  const head = ['s/n', 'Name', ...Array.from({ length: numBoxes }, (_, i) => `${i + 1}`)];
  const groups = opts.groups || [];

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (y > (orientation === 'landscape' ? 180 : 250)) {
      doc.addPage();
      y = 14;
    }

    doc.setFillColor(BRAND_GOLD_DEEP[0], BRAND_GOLD_DEEP[1], BRAND_GOLD_DEEP[2]);
    doc.rect(margin, y - 1, pageW - 2 * margin, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(String(g.groupName || `Group ${gi + 1}`), margin + 2, y + 3.5);
    doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
    doc.setFont(undefined, 'normal');
    y += 10;

    const body = (g.rows || []).map((r) => [
      String(r.sn),
      String(r.name),
      ...Array.from({ length: numBoxes }, () => ''),
    ]);

    const columnStyles = { 0: { cellWidth: snColW, halign: 'center' }, 1: { cellWidth: nameColW } };
    for (let c = 0; c < numBoxes; c++) {
      columnStyles[c + 2] = { cellWidth: boxColW, halign: 'center' };
    }

    doc.autoTable({
      startY: y,
      head: [head],
      body,
      theme: 'grid',
      styles: { fontSize: numBoxes > 24 ? 5 : 6, cellPadding: 0.8, minCellHeight: 5 },
      headStyles: {
        fillColor: [245, 238, 220],
        textColor: BRAND_GOLD_DEEP,
        fontStyle: 'bold',
        fontSize: 6,
      },
      columnStyles,
      margin: { left: margin, right: margin },
    });

    y = doc.lastAutoTable.finalY + 10;
  }

  const safeName = String(opts.fileName || `attendance_${opts.centreName || 'centre'}`).replace(/[^\w\-]+/g, '_');
  doc.save(`${safeName}.pdf`);
}

/**
 * PDF of digitally recorded attendance (Present / Absent per borrower).
 * @param {object} opts — same branding keys as downloadAttendanceSheetPdf
 * @param {string} opts.centreName
 * @param {string} opts.officerName
 * @param {string} opts.meetingDate — meeting session date (YYYY-MM-DD)
 * @param {string} [opts.generatedAt] — print timestamp label
 * @param {Array<{ groupName: string, rows: Array<{ sn: number, name: string, borrowerId: string, status: 'present'|'absent'|'ruhusa' }> }>} opts.groups
 * @param {string} [opts.fileName]
 */
export async function downloadRecordedAttendancePdf(opts) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 10;

  let y = (
    await populateBrandedHeader(doc, opts, pageW, margin, {
      mainTitle: 'Recorded attendance',
      badgeRight: 'Digital record',
    })
  ).y;

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(BRAND_GOLD_DEEP[0], BRAND_GOLD_DEEP[1], BRAND_GOLD_DEEP[2]);
  doc.text(`Meeting date: ${opts.meetingDate || '—'}`, margin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
  doc.text(`Centre: ${opts.centreName || '—'}`, margin, y);
  y += 5;
  doc.text(`Loan officer: ${opts.officerName || '—'}`, margin, y);
  y += 5;
  const gen = opts.generatedAt || new Date().toISOString().slice(0, 16).replace('T', ' ');
  doc.setFontSize(8);
  doc.setTextColor(NEUTRAL_500[0], NEUTRAL_500[1], NEUTRAL_500[2]);
  doc.text(`Printed: ${gen}`, margin, y);
  y += 6;

  let presentN = 0;
  let absentN = 0;
  let ruhusaN = 0;
  for (const g of opts.groups || []) {
    for (const r of g.rows || []) {
      const st = r.status || (r.present === true ? 'present' : r.present === false ? 'absent' : 'present');
      if (st === 'present') presentN += 1;
      else if (st === 'ruhusa') ruhusaN += 1;
      else absentN += 1;
    }
  }
  const total = presentN + absentN + ruhusaN;
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
  doc.text(
    `Summary: Present ${presentN}  ·  Absent ${absentN}  ·  Ruhusa ${ruhusaN}  ·  Total ${total}`,
    margin,
    y
  );
  y += 8;

  const head = ['s/n', 'Name', 'Borrower ID', 'Status'];
  const groups = opts.groups || [];

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (y > 240) {
      doc.addPage();
      y = 14;
    }

    doc.setFillColor(BRAND_GOLD_DEEP[0], BRAND_GOLD_DEEP[1], BRAND_GOLD_DEEP[2]);
    doc.rect(margin, y - 1, pageW - 2 * margin, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(String(g.groupName || `Group ${gi + 1}`), margin + 2, y + 3.5);
    doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
    doc.setFont(undefined, 'normal');
    y += 10;

    const body = (g.rows || []).map((r) => {
      const st = r.status || (r.present === true ? 'present' : r.present === false ? 'absent' : 'present');
      const label = st === 'absent' ? 'Absent' : st === 'ruhusa' ? 'Ruhusa' : 'Present';
      return [String(r.sn), String(r.name), String(r.borrowerId || '—'), label];
    });

    doc.autoTable({
      startY: y,
      head: [head],
      body,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.2, minCellHeight: 6 },
      headStyles: {
        fillColor: [245, 238, 220],
        textColor: BRAND_GOLD_DEEP,
        fontStyle: 'bold',
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 14, halign: 'center' },
        1: { cellWidth: 58 },
        2: { cellWidth: 32 },
        3: { cellWidth: 28, halign: 'center', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) {
          const raw = data.cell.raw;
          if (raw === 'Present') {
            data.cell.styles.fillColor = [220, 252, 231];
            data.cell.styles.textColor = [22, 101, 52];
          } else if (raw === 'Absent') {
            data.cell.styles.fillColor = [254, 226, 226];
            data.cell.styles.textColor = [153, 27, 27];
          } else if (raw === 'Ruhusa') {
            data.cell.styles.fillColor = [254, 243, 199];
            data.cell.styles.textColor = [146, 64, 14];
          }
        }
      },
    });

    y = doc.lastAutoTable.finalY + 10;
  }

  const safeName = String(opts.fileName || `attendance_recorded_${opts.centreName || 'centre'}`).replace(/[^\w\-]+/g, '_');
  doc.save(`${safeName}.pdf`);
}

/**
 * One PDF compiling saved attendance across multiple meetings (matrix: P / A / — per date).
 * @param {object} opts
 * @param {string} opts.systemName
 * @param {string} [opts.logoUrl]
 * @param {string} [opts.tagline]
 * @param {string} opts.officerName
 * @param {string} [opts.generatedAt]
 * @param {string} [opts.fileName]
 * @param {Array<{
 *   centreName: string;
 *   meetings: Array<{ id: string; dateLabel: string; shortLabel: string }>;
 *   groups: Array<{
 *     groupName: string;
 *     rows: Array<{
 *       sn: number;
 *       name: string;
 *       borrowerId: string;
 *       presence: Array<'present'|'absent'|'ruhusa'|null|boolean>;
 *       totalPresent: number;
 *     }>;
 *   }>;
 * }>} opts.sections — meetings sorted ascending per centre
 */
export async function downloadCompiledAttendancePdf(opts) {
  const sections = opts.sections || [];
  const maxMeetings = Math.max(0, ...sections.map((s) => s.meetings?.length || 0));
  const orientation = maxMeetings > 5 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 10;

  let y = (
    await populateBrandedHeader(doc, opts, pageW, margin, {
      mainTitle: 'Compiled attendance',
      badgeRight: 'Multi-meeting report',
    })
  ).y;

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
  doc.text(`Loan officer: ${opts.officerName || '—'}`, margin, y);
  y += 5;
  const gen = opts.generatedAt || new Date().toISOString().slice(0, 16).replace('T', ' ');
  doc.setFontSize(8);
  doc.setTextColor(NEUTRAL_500[0], NEUTRAL_500[1], NEUTRAL_500[2]);
  doc.text(`Printed: ${gen}`, margin, y);
  y += 4;
  doc.setFontSize(8);
  doc.text(`Meetings in this report: ${maxMeetings}`, margin, y);
  y += 8;

  for (let si = 0; si < sections.length; si++) {
    if (si > 0) {
      doc.addPage();
      y = margin;
    }

    const sec = sections[si];
    const mlist = sec.meetings || [];
    const nM = mlist.length;
    if (!nM) continue;

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(BRAND_GOLD_DEEP[0], BRAND_GOLD_DEEP[1], BRAND_GOLD_DEEP[2]);
    doc.text(`Centre: ${sec.centreName || '—'}`, margin, y);
    y += 5;
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(NEUTRAL_500[0], NEUTRAL_500[1], NEUTRAL_500[2]);
    doc.text(`Meeting dates: ${mlist.map((m) => m.dateLabel).join(' · ')}`, margin, y);
    y += 8;

    const groups = sec.groups || [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      if (y > (orientation === 'landscape' ? 180 : 250)) {
        doc.addPage();
        y = margin;
      }

      doc.setFillColor(BRAND_GOLD_DEEP[0], BRAND_GOLD_DEEP[1], BRAND_GOLD_DEEP[2]);
      doc.rect(margin, y - 1, pageW - 2 * margin, 6, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.text(String(g.groupName || `Group ${gi + 1}`), margin + 2, y + 3.5);
      doc.setTextColor(NEUTRAL_700[0], NEUTRAL_700[1], NEUTRAL_700[2]);
      doc.setFont(undefined, 'normal');
      y += 10;

      const head = ['s/n', 'Name', 'Borrower ID', ...mlist.map((m) => m.shortLabel || m.dateLabel), 'Σ P'];
      const body = (g.rows || []).map((r) => {
        const cells = (r.presence || []).map((p) => {
          if (p === true || p === 'present') return 'P';
          if (p === 'ruhusa') return 'R';
          if (p === false || p === 'absent') return 'A';
          return '—';
        });
        while (cells.length < nM) cells.push('—');
        return [String(r.sn), String(r.name), String(r.borrowerId || '—'), ...cells, String(r.totalPresent ?? 0)];
      });

      const snW = 11;
      const nameW = orientation === 'landscape' ? 42 : 36;
      const idW = 22;
      const totalW = 12;
      const inner = pageW - 2 * margin - snW - nameW - idW - totalW;
      const markW = Math.max(7, nM > 0 ? inner / nM : 7);

      const columnStyles = {
        0: { cellWidth: snW, halign: 'center' },
        1: { cellWidth: nameW },
        2: { cellWidth: idW, fontSize: 6 },
      };
      for (let c = 0; c < nM; c++) {
        columnStyles[c + 3] = { cellWidth: markW, halign: 'center', fontStyle: 'bold', fontSize: nM > 10 ? 6 : 7 };
      }
      columnStyles[3 + nM] = { cellWidth: totalW, halign: 'center', fontStyle: 'bold' };

      const fontSize = nM > 12 ? 6 : nM > 8 ? 7 : 8;

      doc.autoTable({
        startY: y,
        head: [head],
        body,
        theme: 'grid',
        styles: { fontSize, cellPadding: 0.6, minCellHeight: 5 },
        headStyles: {
          fillColor: [245, 238, 220],
          textColor: BRAND_GOLD_DEEP,
          fontStyle: 'bold',
          fontSize: Math.max(5, fontSize - 1),
        },
        columnStyles,
        margin: { left: margin, right: margin },
        didParseCell: (data) => {
          if (data.section !== 'body') return;
          const col = data.column.index;
          if (col >= 3 && col < 3 + nM) {
            const raw = data.cell.raw;
            if (raw === 'P') {
              data.cell.styles.fillColor = [220, 252, 231];
              data.cell.styles.textColor = [22, 101, 52];
            } else if (raw === 'A') {
              data.cell.styles.fillColor = [254, 226, 226];
              data.cell.styles.textColor = [153, 27, 27];
            } else if (raw === 'R') {
              data.cell.styles.fillColor = [254, 243, 199];
              data.cell.styles.textColor = [146, 64, 14];
            } else {
              data.cell.styles.fillColor = [248, 250, 252];
              data.cell.styles.textColor = [100, 116, 139];
            }
          }
        },
      });

      y = doc.lastAutoTable.finalY + 10;
    }
  }

  const safeName = String(opts.fileName || 'attendance_compiled').replace(/[^\w\-]+/g, '_');
  doc.save(`${safeName}.pdf`);
}
