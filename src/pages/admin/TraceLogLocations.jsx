import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/use-toast';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { googleMapsUrl, formatGpsLabel } from '@/lib/geolocation';
import { Loader2, MapPin, ChevronLeft, ChevronRight, ExternalLink, Filter, RotateCcw } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const PAGE_SIZE = 50;

const EMPTY_FILTERS = {
	from: '',
	to: '',
	userId: '',
	branchId: '',
	userRole: '',
	includeAllGps: false,
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

function TraceMap({ rows, highlightId, onSelect }) {
	const containerRef = useRef(null);
	const mapRef = useRef(null);
	const markersRef = useRef([]);

	useEffect(() => {
		if (!containerRef.current || mapRef.current) return;
		let cancelled = false;

		void import('leaflet').then((L) => {
			if (cancelled || !containerRef.current) return;
			const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView([-6.7924, 39.2083], 6);
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '&copy; OpenStreetMap contributors',
			}).addTo(map);
			mapRef.current = map;
		});

		return () => {
			cancelled = true;
			if (mapRef.current) {
				mapRef.current.remove();
				mapRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;

		void import('leaflet').then((L) => {
			markersRef.current.forEach((m) => m.remove());
			markersRef.current = [];

			const valid = rows.filter(
				(r) => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)),
			);
			if (valid.length === 0) return;

			const bounds = [];
			valid.forEach((row) => {
				const lat = Number(row.latitude);
				const lng = Number(row.longitude);
				const marker = L.circleMarker([lat, lng], {
					radius: highlightId === row.id ? 9 : 6,
					color: highlightId === row.id ? '#b8923a' : '#2563eb',
					weight: 2,
					fillOpacity: 0.85,
				})
					.addTo(map)
					.bindPopup(
						`<strong>${row.user_full_name ?? 'User'}</strong><br/>${safeFormatDate(row.created_at)}<br/>${formatGpsLabel(lat, lng, row.location_accuracy_m) ?? ''}`,
					);
				marker.on('click', () => onSelect?.(row.id));
				markersRef.current.push(marker);
				bounds.push([lat, lng]);
			});

			if (bounds.length === 1) {
				map.setView(bounds[0], 14);
			} else {
				map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
			}
		});
	}, [rows, highlightId, onSelect]);

	return (
		<div
			ref={containerRef}
			className="h-[min(420px,50vh)] w-full rounded-lg border bg-muted/30"
			aria-label="Login locations map"
		/>
	);
}

const TraceLogLocations = () => {
	const { toast } = useToast();
	const [rows, setRows] = useState([]);
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState(null);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [branches, setBranches] = useState([]);
	const [usersList, setUsersList] = useState([]);
	const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
	const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
	const [highlightId, setHighlightId] = useState(null);

	const branchOptions = useMemo(() => branches.map((b) => ({ value: b.id, label: b.name })), [branches]);
	const userOptions = useMemo(
		() => usersList.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` })),
		[usersList],
	);
	const roleOptions = useMemo(
		() => [
			{ value: 'admin', label: 'admin' },
			{ value: 'manager', label: 'manager' },
			{ value: 'officer', label: 'officer' },
		],
		[],
	);

	useEffect(() => {
		void (async () => {
			const [{ data: b }, { data: u }] = await Promise.all([
				supabase.from('branches').select('id, name').order('name'),
				supabase.from('users').select('id, full_name, email').order('full_name'),
			]);
			setBranches(b ?? []);
			setUsersList(u ?? []);
		})();
	}, []);

	const fetchRows = useCallback(async () => {
		setLoading(true);
		setFetchError(null);
		const args = {
			p_limit: PAGE_SIZE,
			p_offset: (page - 1) * PAGE_SIZE,
			p_from: toIsoOrNull(appliedFilters.from),
			p_to: toIsoOrNull(appliedFilters.to),
			p_user_id: appliedFilters.userId?.trim() || null,
			p_branch_id: appliedFilters.branchId?.trim() || null,
			p_user_role: appliedFilters.userRole?.trim() || null,
			p_action: appliedFilters.includeAllGps ? null : 'auth.login',
			p_include_all_gps: appliedFilters.includeAllGps,
		};
		const { data, error } = await supabase.rpc('get_login_location_traces_admin', args);
		if (error) {
			setFetchError(error.message || 'Could not load trace data.');
			setRows([]);
			setTotal(0);
		} else {
			const payload = data ?? {};
			setRows(Array.isArray(payload.rows) ? payload.rows : []);
			setTotal(Number(payload.total) || 0);
		}
		setLoading(false);
	}, [page, appliedFilters]);

	useEffect(() => {
		void fetchRows();
	}, [fetchRows]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const exportCsv = () => {
		if (rows.length === 0) {
			toast({ title: 'Nothing to export', description: 'Apply filters with results first.', variant: 'destructive' });
			return;
		}
		exportObjectsToCsv(`trace_locations_${Date.now()}.csv`, [
			{ header: 'Time', accessor: (r) => safeFormatDate(r.created_at) },
			{ header: 'User', accessor: (r) => String(r.user_full_name ?? '') },
			{ header: 'Email', accessor: (r) => String(r.user_email ?? '') },
			{ header: 'Branch', accessor: (r) => String(r.branch_name ?? '') },
			{ header: 'Role', accessor: (r) => String(r.user_role ?? '') },
			{ header: 'Action', accessor: (r) => String(r.action ?? '') },
			{ header: 'Latitude', accessor: (r) => String(r.latitude ?? '') },
			{ header: 'Longitude', accessor: (r) => String(r.longitude ?? '') },
			{ header: 'Accuracy (m)', accessor: (r) => String(r.location_accuracy_m ?? '') },
			{ header: 'Device', accessor: (r) => String(r.device_summary ?? '') },
			{ header: 'IP', accessor: (r) => String(r.ip_address ?? '') },
		], rows);
		toast({ title: 'Exported', description: `${rows.length} row(s) on this page.` });
	};

	return (
		<DashboardLayout title="Trace log locations">
			<div className="space-y-6">
				<div className="flex items-start gap-4">
					<MapPin className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
					<div>
						<p className="text-sm text-neutral-600 max-w-2xl">
							Map and table of sign-in coordinates recorded for staff (GPS captured once per session at login).
							Exempt internal accounts are not listed.
						</p>
					</div>
				</div>

				{fetchError && (
					<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						{fetchError}
					</div>
				)}

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Filters</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<div className="space-y-2">
							<Label htmlFor="trace-from">From</Label>
							<Input
								id="trace-from"
								type="datetime-local"
								value={draftFilters.from}
								onChange={(e) => setDraftFilters((p) => ({ ...p, from: e.target.value }))}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="trace-to">To</Label>
							<Input
								id="trace-to"
								type="datetime-local"
								value={draftFilters.to}
								onChange={(e) => setDraftFilters((p) => ({ ...p, to: e.target.value }))}
							/>
						</div>
						<div className="space-y-2">
							<Label>User</Label>
							<SearchableSelect
								value={draftFilters.userId}
								onValueChange={(v) => setDraftFilters((p) => ({ ...p, userId: v }))}
								options={userOptions}
								placeholder="Any user"
							/>
						</div>
						<div className="space-y-2">
							<Label>Branch</Label>
							<SearchableSelect
								value={draftFilters.branchId}
								onValueChange={(v) => setDraftFilters((p) => ({ ...p, branchId: v }))}
								options={branchOptions}
								placeholder="Any branch"
							/>
						</div>
						<div className="space-y-2">
							<Label>Role</Label>
							<SearchableSelect
								value={draftFilters.userRole}
								onValueChange={(v) => setDraftFilters((p) => ({ ...p, userRole: v }))}
								options={roleOptions}
								placeholder="Any role"
							/>
						</div>
						<div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={draftFilters.includeAllGps}
									onChange={(e) =>
										setDraftFilters((p) => ({ ...p, includeAllGps: e.target.checked }))
									}
								/>
								Include all GPS audit events (not just login)
							</label>
							<Button
								type="button"
								onClick={() => {
									setAppliedFilters({ ...draftFilters });
									setPage(1);
								}}
							>
								<Filter className="mr-2 h-4 w-4" />
								Apply
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setDraftFilters(EMPTY_FILTERS);
									setAppliedFilters(EMPTY_FILTERS);
									setPage(1);
								}}
							>
								<RotateCcw className="mr-2 h-4 w-4" />
								Reset
							</Button>
							<Button type="button" variant="secondary" onClick={exportCsv}>
								Export CSV
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Map</CardTitle>
						<CardDescription>Markers for rows on the current page ({rows.length})</CardDescription>
					</CardHeader>
					<CardContent>
						{loading ? (
							<div className="flex h-[280px] items-center justify-center">
								<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
							</div>
						) : rows.length === 0 ? (
							<p className="py-8 text-center text-sm text-muted-foreground">No GPS traces for these filters.</p>
						) : (
							<TraceMap rows={rows} highlightId={highlightId} onSelect={setHighlightId} />
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Trace log</CardTitle>
						<CardDescription>Newest first</CardDescription>
					</CardHeader>
					<CardContent>
						{loading ? (
							<div className="flex justify-center py-12">
								<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
							</div>
						) : (
							<>
								<div className="overflow-x-auto rounded-md border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Time</TableHead>
												<TableHead>User</TableHead>
												<TableHead>Branch</TableHead>
												<TableHead>Action</TableHead>
												<TableHead>GPS</TableHead>
												<TableHead>Device</TableHead>
												<TableHead className="w-[100px]">Maps</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{rows.length === 0 ? (
												<TableRow>
													<TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
														No entries.
													</TableCell>
												</TableRow>
											) : (
												rows.map((row) => {
													const mapsUrl = googleMapsUrl(
														Number(row.latitude),
														Number(row.longitude),
													);
													const gpsLabel = formatGpsLabel(
														Number(row.latitude),
														Number(row.longitude),
														row.location_accuracy_m,
													);
													return (
														<TableRow
															key={row.id}
															className={highlightId === row.id ? 'bg-muted/60' : undefined}
															onClick={() => setHighlightId(row.id)}
														>
															<TableCell className="whitespace-nowrap text-sm">
																{safeFormatDate(row.created_at)}
															</TableCell>
															<TableCell className="text-sm">
																<div className="font-medium">{row.user_full_name ?? '—'}</div>
																<div className="text-xs text-muted-foreground">{row.user_email ?? ''}</div>
															</TableCell>
															<TableCell className="text-sm">{row.branch_name ?? '—'}</TableCell>
															<TableCell className="font-mono text-xs">{row.action}</TableCell>
															<TableCell className="font-mono text-xs">{gpsLabel ?? '—'}</TableCell>
															<TableCell className="text-xs max-w-[140px] truncate">
																{row.device_summary ?? '—'}
															</TableCell>
															<TableCell>
																{mapsUrl ? (
																	<a
																		href={mapsUrl}
																		target="_blank"
																		rel="noopener noreferrer"
																		className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
																		onClick={(e) => e.stopPropagation()}
																	>
																		Open
																		<ExternalLink className="h-3 w-3" />
																	</a>
																) : (
																	'—'
																)}
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
											Page {page} / {totalPages} — {total} total
										</p>
										<div className="flex items-center gap-2">
											<Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
												<ChevronLeft className="h-4 w-4" />
											</Button>
											<Button
												variant="outline"
												size="sm"
												disabled={page >= totalPages}
												onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
											>
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

export default TraceLogLocations;
