import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ChevronLeft, ChevronRight, ScrollText, Filter, RotateCcw } from 'lucide-react';

const PAGE_SIZE = 50;

const EMPTY_FILTERS = {
	from: '',
	to: '',
	userId: '',
	branchId: '',
	userRole: '',
	action: '',
	entityType: '',
	entityId: '',
	ip: '',
	location: '',
	device: '',
	metadata: '',
};

function safeFormatDate(iso) {
	if (iso == null || iso === '') return '—';
	try {
		const d = typeof iso === 'string' ? parseISO(iso) : new Date(iso);
		if (!isValid(d)) return '—';
		return format(d, 'yyyy-MM-dd HH:mm:ss');
	} catch {
		return '—';
	}
}

function toIsoOrNull(localDatetime) {
	if (localDatetime == null || String(localDatetime).trim() === '') return null;
	const d = new Date(localDatetime);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildRpcArgs(applied, page) {
	const o = (s) => (s != null && String(s).trim() !== '' ? String(s).trim() : null);
	return {
		p_limit: PAGE_SIZE,
		p_offset: (page - 1) * PAGE_SIZE,
		p_from: toIsoOrNull(applied.from),
		p_to: toIsoOrNull(applied.to),
		p_user_id: o(applied.userId),
		p_branch_id: o(applied.branchId),
		p_user_role: o(applied.userRole),
		p_action: o(applied.action),
		p_entity_type: o(applied.entityType),
		p_entity_id: o(applied.entityId),
		p_ip: o(applied.ip),
		p_location: o(applied.location),
		p_device: o(applied.device),
		p_metadata: o(applied.metadata),
	};
}

const AuditLogs = () => {
	const { toast } = useToast();
	const [rows, setRows] = useState([]);
	const [userMap, setUserMap] = useState({});
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState(null);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [branches, setBranches] = useState([]);
	const [usersList, setUsersList] = useState([]);
	const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
	const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const [brRes, uRes] = await Promise.all([
				supabase.from('branches').select('id, name').order('name'),
				supabase.from('users').select('id, full_name, email').order('full_name'),
			]);
			if (cancelled) return;
			if (!brRes.error) setBranches(brRes.data || []);
			if (!uRes.error) setUsersList(uRes.data || []);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const fetchRows = useCallback(async () => {
		setLoading(true);
		setFetchError(null);

		const args = buildRpcArgs(appliedFilters, page);
		const { data, error } = await supabase.rpc('get_audit_logs_admin', args);

		if (error) {
			console.error(error);
			setRows([]);
			setUserMap({});
			setTotal(0);
			setFetchError(error.message || 'Could not load audit log.');
			setLoading(false);
			return;
		}

		let payload = data;
		if (typeof payload === 'string') {
			try {
				payload = JSON.parse(payload);
			} catch {
				payload = {};
			}
		}
		const list = Array.isArray(payload?.rows) ? payload.rows : [];
		const count = typeof payload?.total === 'number' ? payload.total : list.length;
		setRows(list);
		setTotal(count);

		const ids = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
		if (ids.length === 0) {
			setUserMap({});
			setLoading(false);
			return;
		}

		const { data: usersData, error: usersErr } = await supabase
			.from('users')
			.select('id, full_name, email')
			.in('id', ids);

		if (usersErr) {
			console.warn(usersErr);
			setUserMap({});
		} else {
			const map = {};
			(usersData || []).forEach((u) => {
				map[u.id] = u;
			});
			setUserMap(map);
		}
		setLoading(false);
	}, [page, appliedFilters]);

	useEffect(() => {
		fetchRows();
	}, [fetchRows]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
	const bulk = useBulkSelection(rowIds);

	const fmtMeta = useMemo(
		() => (m) => {
			if (m == null) return '—';
			if (typeof m !== 'object') return '—';
			try {
				return JSON.stringify(m);
			} catch {
				return '—';
			}
		},
		[]
	);

	const exportAuditCsv = () => {
		const selected = rows.filter((r) => bulk.isSelected(r.id));
		if (selected.length === 0) {
			toast({ title: 'Nothing selected', description: 'Select one or more rows first.', variant: 'destructive' });
			return;
		}
		exportObjectsToCsv(`audit_log_${Date.now()}.csv`, [
			{ header: 'Time', accessor: (r) => safeFormatDate(r.created_at) },
			{ header: 'User ID', accessor: (r) => String(r.user_id ?? '') },
			{ header: 'Action', accessor: (r) => String(r.action ?? '') },
			{ header: 'Entity type', accessor: (r) => String(r.entity_type ?? '') },
			{ header: 'Entity ID', accessor: (r) => String(r.entity_id ?? '') },
			{ header: 'IP', accessor: (r) => String(r.ip_address ?? '') },
			{ header: 'Location', accessor: (r) => String(r.location_label ?? '') },
			{ header: 'Device', accessor: (r) => String(r.device_summary ?? (r.user_agent ? String(r.user_agent).slice(0, 120) : '') ?? '') },
			{ header: 'Metadata', accessor: (r) => fmtMeta(r.metadata) },
		], selected);
		toast({ title: 'Exported', description: `${selected.length} row(s) to CSV.` });
	};

	const updateDraft = (key, value) => {
		setDraftFilters((prev) => ({ ...prev, [key]: value }));
	};

	const handleApplyFilters = () => {
		setAppliedFilters({ ...draftFilters });
		setPage(1);
	};

	const handleClearFilters = () => {
		setDraftFilters(EMPTY_FILTERS);
		setAppliedFilters(EMPTY_FILTERS);
		setPage(1);
	};

	return (
		<DashboardLayout title="Activity log">
			<div className="space-y-6">
				<div className="flex items-start gap-4">
					<ScrollText className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
					<div>
						<p className="text-sm text-neutral-600 max-w-2xl">
							Audit trail of sign-ins and other recorded actions (IP, approximate location from IP, device summary).
							Only administrators can view this page.
						</p>
					</div>
				</div>

				{fetchError && (
					<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						<strong className="font-semibold">Error:</strong> {fetchError}
						<p className="mt-1 text-xs text-destructive/90">
							Confirm the audit_logs migration and <code className="text-xs">get_audit_logs_admin</code> RPC are applied, and you are logged in as an admin.
						</p>
					</div>
				)}

				<Card>
					<CardHeader className="pb-3">
						<div className="flex flex-wrap items-center gap-2">
							<Filter className="h-5 w-5 text-muted-foreground" aria-hidden />
							<CardTitle className="text-base">Filters</CardTitle>
						</div>
						<CardDescription>Set criteria and click Apply. Pagination uses the applied filters.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							<div className="space-y-2">
								<Label htmlFor="audit-from">From (date and time)</Label>
								<Input
									id="audit-from"
									type="datetime-local"
									value={draftFilters.from}
									onChange={(e) => updateDraft('from', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-to">To (date and time)</Label>
								<Input
									id="audit-to"
									type="datetime-local"
									value={draftFilters.to}
									onChange={(e) => updateDraft('to', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>User</Label>
								<Select value={draftFilters.userId || '__any__'} onValueChange={(v) => updateDraft('userId', v === '__any__' ? '' : v)}>
									<SelectTrigger>
										<SelectValue placeholder="Any user" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="__any__">Any user</SelectItem>
										{usersList.map((u) => (
											<SelectItem key={u.id} value={u.id}>
												{u.full_name} ({u.email})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>Branch</Label>
								<Select value={draftFilters.branchId || '__any__'} onValueChange={(v) => updateDraft('branchId', v === '__any__' ? '' : v)}>
									<SelectTrigger>
										<SelectValue placeholder="Any branch" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="__any__">Any branch</SelectItem>
										{branches.map((b) => (
											<SelectItem key={b.id} value={b.id}>
												{b.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>Role</Label>
								<Select value={draftFilters.userRole || '__any__'} onValueChange={(v) => updateDraft('userRole', v === '__any__' ? '' : v)}>
									<SelectTrigger>
										<SelectValue placeholder="Any role" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="__any__">Any role</SelectItem>
										<SelectItem value="admin">admin</SelectItem>
										<SelectItem value="manager">manager</SelectItem>
										<SelectItem value="officer">officer</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-action">Action</Label>
								<Input
									id="audit-action"
									placeholder="Substring match"
									value={draftFilters.action}
									onChange={(e) => updateDraft('action', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-entity-type">Entity type</Label>
								<Input
									id="audit-entity-type"
									placeholder="Substring match"
									value={draftFilters.entityType}
									onChange={(e) => updateDraft('entityType', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-entity-id">Entity ID</Label>
								<Input
									id="audit-entity-id"
									placeholder="Substring match"
									value={draftFilters.entityId}
									onChange={(e) => updateDraft('entityId', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-ip">IP address</Label>
								<Input
									id="audit-ip"
									placeholder="Substring match"
									value={draftFilters.ip}
									onChange={(e) => updateDraft('ip', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-location">Location</Label>
								<Input
									id="audit-location"
									placeholder="Substring match"
									value={draftFilters.location}
									onChange={(e) => updateDraft('location', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-device">Device</Label>
								<Input
									id="audit-device"
									placeholder="Device summary or user agent"
									value={draftFilters.device}
									onChange={(e) => updateDraft('device', e.target.value)}
								/>
							</div>
							<div className="space-y-2 sm:col-span-2">
								<Label htmlFor="audit-metadata">Metadata</Label>
								<Input
									id="audit-metadata"
									placeholder="Search inside JSON (substring)"
									value={draftFilters.metadata}
									onChange={(e) => updateDraft('metadata', e.target.value)}
								/>
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button type="button" onClick={handleApplyFilters}>
								Apply filters
							</Button>
							<Button type="button" variant="outline" onClick={handleClearFilters}>
								<RotateCcw className="mr-2 h-4 w-4" />
								Clear
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Audit log</CardTitle>
						<CardDescription>Newest first. Location is derived from IP when available.</CardDescription>
					</CardHeader>
					<CardContent>
						{loading ? (
							<div className="flex justify-center py-12">
								<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
							</div>
						) : (
							<>
								<BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportAuditCsv} />
								<div className="overflow-x-auto rounded-md border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead className="w-10">
													<Checkbox
														checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
														onCheckedChange={() => bulk.toggleAll()}
														aria-label="Select page"
													/>
												</TableHead>
												<TableHead className="whitespace-nowrap">Time</TableHead>
												<TableHead>User</TableHead>
												<TableHead>Action</TableHead>
												<TableHead>Entity</TableHead>
												<TableHead>IP</TableHead>
												<TableHead>Location</TableHead>
												<TableHead>Device</TableHead>
												<TableHead className="max-w-[200px]">Details</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{rows.length === 0 ? (
												<TableRow>
													<TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
														No audit entries yet.
													</TableCell>
												</TableRow>
											) : (
												rows.map((row) => {
													const u = row.user_id ? userMap[row.user_id] : null;
													return (
														<TableRow key={row.id}>
															<TableCell>
																<Checkbox
																	checked={bulk.isSelected(row.id)}
																	onCheckedChange={() => bulk.toggle(row.id)}
																	aria-label="Select row"
																/>
															</TableCell>
															<TableCell className="whitespace-nowrap text-sm">{safeFormatDate(row.created_at)}</TableCell>
															<TableCell className="text-sm">
																<div className="font-medium">{u?.full_name ?? '—'}</div>
																<div className="text-xs text-muted-foreground">{u?.email ?? row.user_id ?? ''}</div>
															</TableCell>
															<TableCell className="font-mono text-xs">{row.action}</TableCell>
															<TableCell className="text-xs">
																{row.entity_type || '—'}
																{row.entity_id ? (
																	<span className="block text-muted-foreground truncate max-w-[120px]" title={String(row.entity_id)}>
																		{String(row.entity_id)}
																	</span>
																) : null}
															</TableCell>
															<TableCell className="font-mono text-xs">{row.ip_address ?? '—'}</TableCell>
															<TableCell className="text-xs max-w-[160px]">{row.location_label ?? '—'}</TableCell>
															<TableCell className="text-xs max-w-[140px]">
																{row.device_summary ?? (row.user_agent ? String(row.user_agent).slice(0, 48) : null) ?? '—'}
															</TableCell>
															<TableCell className="text-xs font-mono truncate max-w-[200px]" title={fmtMeta(row.metadata)}>
																{fmtMeta(row.metadata)}
															</TableCell>
														</TableRow>
													);
												})
											)}
										</TableBody>
									</Table>
								</div>
								{total > 0 && (
									<div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
										<p className="text-sm text-muted-foreground">
											Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
										</p>
										<div className="flex items-center gap-2">
											<Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
												<ChevronLeft className="h-4 w-4" />
											</Button>
											<span className="text-sm text-muted-foreground">
												Page {page} / {totalPages}
											</span>
											<Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
												<ChevronRight className="h-4 w-4" />
											</Button>
										</div>
									</div>
								)}
							</>
						)}
					</CardContent>
				</Card>
			</div>
		</DashboardLayout>
	);
};

export default AuditLogs;
