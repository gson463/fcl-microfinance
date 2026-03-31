import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Track selected row ids for the current page/list. Clears ids that disappear from `allIds`.
 */
export function useBulkSelection(allIds) {
	const idList = useMemo(() => (Array.isArray(allIds) ? allIds.filter(Boolean) : []), [allIds]);

	const [selected, setSelected] = useState(() => new Set());

	useEffect(() => {
		setSelected((prev) => {
			const allowed = new Set(idList);
			const next = new Set();
			prev.forEach((id) => {
				if (allowed.has(id)) next.add(id);
			});
			return next;
		});
	}, [idList]);

	const toggle = useCallback((id) => {
		if (id == null) return;
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const toggleAll = useCallback(() => {
		setSelected((prev) => {
			if (idList.length === 0) return new Set();
			const allOn = idList.every((id) => prev.has(id));
			if (allOn) return new Set();
			return new Set(idList);
		});
	}, [idList]);

	const clear = useCallback(() => setSelected(new Set()), []);

	const selectedIds = useMemo(() => Array.from(selected), [selected]);
	const count = selected.size;
	const allSelected = idList.length > 0 && idList.every((id) => selected.has(id));
	const someSelected = count > 0;

	return {
		selected,
		selectedIds,
		toggle,
		toggleAll,
		clear,
		count,
		allSelected,
		someSelected,
		isSelected: (id) => (id != null ? selected.has(id) : false),
	};
}
