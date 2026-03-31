/** Escape CSV cell */
function escCell(v) {
	const s = v == null ? '' : String(v);
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

/**
 * @param {string} filename
 * @param {string[]} headers
 * @param {string[][]} rows
 */
export function exportRowsToCsv(filename, headers, rows) {
	const lines = [headers.map(escCell).join(',')];
	rows.forEach((r) => lines.push(r.map(escCell).join(',')));
	const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
	a.click();
	URL.revokeObjectURL(a.href);
}

/**
 * @param {string} filename
 * @param {Array<{ header: string, accessor: string | ((row: object) => string | number | null | undefined)>}>} columns
 * @param {object[]} rows
 */
export function exportObjectsToCsv(filename, columns, rows) {
	const headers = columns.map((c) => c.header);
	const data = rows.map((row) =>
		columns.map((c) => {
			const v = typeof c.accessor === 'function' ? c.accessor(row) : row[c.accessor];
			return v == null ? '' : v;
		})
	);
	exportRowsToCsv(filename, headers, data);
}
