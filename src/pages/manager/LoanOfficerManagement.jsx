import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { getEdgeInvokeFailure } from '@/lib/edgeInvokeError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Loader2, Trash2, Edit, ChevronLeft, ChevronRight, Download, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ALL } from '@/lib/hierarchyFilterUtils';
import * as XLSX from 'xlsx';
import { getImportDataSheet, formatImportReportSummary } from '@/lib/bulkImportExcel';
import { downloadLoanOfficersImportTemplate } from '@/lib/excelImportTemplateDownloads';
import { ImportResultDialog } from '@/components/import/ImportResultDialog';

const PAGE_SIZE = 25;

const MIN_OFFICER_PASSWORD_LEN = 6;

function parseOfficerImportRow(row) {
  const fullName = String(row.full_name ?? row['Full Name'] ?? row.name ?? '').trim();
  const email = String(row.email ?? row.Email ?? '').trim().toLowerCase();
  const password = String(row.password ?? row.Password ?? '').trim();
  return { fullName, email, password };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function parseCreateUserInvokeError(err) {
  if (!err) return 'Unknown error';
  if (err.context && typeof err.context.json === 'function') {
    try {
      const j = await err.context.json();
      return j.error || err.message;
    } catch {
      return err.message;
    }
  }
  return err.message;
}

const LoanOfficerManagement = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  
  const [officers, setOfficers] = useState([]);
  /** From public.users — source of truth (JWT user_metadata.branch_id is often missing or stale). */
  const [managerBranchId, setManagerBranchId] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState(null);
  const [formData, setFormData] = useState({ full_name: '', email: '', password: '' });
  const [page, setPage] = useState(1);
  const [centers, setCenters] = useState([]);
  const [filterActive, setFilterActive] = useState('all');
  const [centerFilterId, setCenterFilterId] = useState(ALL);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const importFileRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importReportOpen, setImportReportOpen] = useState(false);
  const [importReportSummary, setImportReportSummary] = useState('');
  const [importReportDetails, setImportReportDetails] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [filterActive, centerFilterId, debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    if (!managerBranchId) {
      setCenters([]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('centers')
        .select('id, name')
        .eq('branch_id', managerBranchId)
        .order('name');
      if (cancelled) return;
      if (error) {
        console.error(error);
        setCenters([]);
        return;
      }
      setCenters(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [managerBranchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProfileLoading(true);
      if (!user?.id) {
        setManagerBranchId(null);
        setProfileLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('users')
        .select('branch_id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error(error);
        setManagerBranchId(null);
        setProfileLoading(false);
        return;
      }
      if (data?.role !== 'manager') {
        setManagerBranchId(null);
        setProfileLoading(false);
        return;
      }
      setManagerBranchId(data.branch_id ?? null);
      setProfileLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const centerFilterOptions = useMemo(
    () => [
      { value: ALL, label: 'All centers' },
      ...centers.map((c) => ({ value: c.id, label: c.name })),
    ],
    [centers],
  );

  const clearListFilters = () => {
    setFilterActive('all');
    setCenterFilterId(ALL);
    setSearchInput('');
    setDebouncedSearch('');
  };

  const fetchOfficers = useCallback(async () => {
    if (!user) {
      setOfficers([]);
      setLoading(false);
      return;
    }
    if (profileLoading) return;
    if (!managerBranchId) {
      setOfficers([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    let officerIdFilter = null;
    if (centerFilterId !== ALL) {
      const [{ data: cenRow }, { data: grpRows }] = await Promise.all([
        supabase.from('centers').select('loan_officer_id').eq('id', centerFilterId).maybeSingle(),
        supabase.from('groups').select('loan_officer_id').eq('center_id', centerFilterId),
      ]);
      const ids = new Set();
      if (cenRow?.loan_officer_id) ids.add(cenRow.loan_officer_id);
      (grpRows || []).forEach((g) => {
        if (g.loan_officer_id) ids.add(g.loan_officer_id);
      });
      officerIdFilter = [...ids];
      if (officerIdFilter.length === 0) {
        setOfficers([]);
        setLoading(false);
        return;
      }
    }

    let query = supabase
      .from('users')
      .select('*')
      .eq('role', 'officer')
      .eq('branch_id', managerBranchId)
      .order('full_name', { ascending: true });

    if (officerIdFilter) {
      query = query.in('id', officerIdFilter);
    }
    if (filterActive === 'active') {
      query = query.eq('is_active', true);
    } else if (filterActive === 'inactive') {
      query = query.eq('is_active', false);
    }
    if (debouncedSearch) {
      const s = debouncedSearch.replace(/%/g, '\\%');
      query = query.or(`full_name.ilike.%${s}%,email.ilike.%${s}%`);
    }

    const { data, error } = await query;

    if (error) {
      toast({ title: 'Error', description: 'Failed to fetch loan officers.', variant: 'destructive' });
      console.error(error);
      setOfficers([]);
    } else {
      setOfficers(data || []);
    }
    setLoading(false);
  }, [
    user,
    managerBranchId,
    profileLoading,
    toast,
    filterActive,
    centerFilterId,
    debouncedSearch,
  ]);

  useEffect(() => {
    fetchOfficers();
  }, [fetchOfficers]);

  const pagedOfficers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return officers.slice(start, start + PAGE_SIZE);
  }, [officers, page]);

  const totalPages = Math.max(1, Math.ceil(officers.length / PAGE_SIZE));

  const officerIds = useMemo(() => officers.map((o) => o.id), [officers]);
  const bulk = useBulkSelection(officerIds);

  const exportOfficersCsv = () => {
    const rows = officers.filter((o) => bulk.isSelected(o.id));
    if (rows.length === 0) {
      toast({ title: 'Nothing selected', description: 'Select one or more officers first.', variant: 'destructive' });
      return;
    }
    exportObjectsToCsv(`loan_officers_${Date.now()}.csv`, [
      { header: 'Name', accessor: 'full_name' },
      { header: 'Email', accessor: 'email' },
      { header: 'Active', accessor: (r) => (r.is_active ? 'yes' : 'no') },
    ], rows);
    toast({ title: 'Exported', description: `${rows.length} officer(s) to CSV.` });
  };

  const handleOpenDialog = (officer = null) => {
    if (officer) {
      setEditingOfficer(officer);
      setFormData({
        full_name: officer.full_name,
        email: officer.email,
        password: '', // Clear password for reset
      });
    } else {
      setEditingOfficer(null);
      setFormData({ full_name: '', email: '', password: '' });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    let error;

    if (editingOfficer) {
      const nameChanged = formData.full_name.trim() !== (editingOfficer.full_name || '').trim();
      const emailChanged = formData.email.trim().toLowerCase() !== (editingOfficer.email || '').trim().toLowerCase();
      const hasPassword = !!formData.password?.trim();
      if (!nameChanged && !emailChanged && !hasPassword) {
        toast({ title: 'Nothing to save', description: 'Change name or email, or enter a new password.', variant: 'destructive' });
        setSaving(false);
        return;
      }
      if (!formData.full_name?.trim() || !formData.email?.trim()) {
        toast({ title: 'Error', description: 'Name and email are required.', variant: 'destructive' });
        setSaving(false);
        return;
      }
      const body = { userId: editingOfficer.id };
      if (nameChanged) body.full_name = formData.full_name.trim();
      if (emailChanged) body.email = formData.email.trim().toLowerCase();
      if (hasPassword) body.password = formData.password;
      const { error: invokeError } = await invokeEdgeFunction(
        'update-user',
        { body },
        session?.access_token,
      );
      error = invokeError;
    } else { // Creating a new user
      if (!formData.full_name || !formData.email || !formData.password) {
        toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
        setSaving(false);
        return;
      }
      if (!managerBranchId) {
        toast({
          title: 'Branch missing',
          description: 'Your account has no branch assigned yet. Ask an admin to assign a branch, then sign out and sign in again.',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      const { error: invokeError } = await invokeEdgeFunction(
        'create-user',
        {
          body: {
            full_name: formData.full_name.trim(),
            email: formData.email.trim().toLowerCase(),
            password: formData.password,
            role: 'officer',
            branch_id: managerBranchId,
          },
        },
        session?.access_token,
      );
      error = invokeError;
    }

    setSaving(false);
    if (error) {
      const errorData = error.context ? await error.context.json() : { error: error.message };
      toast({ title: `Error ${editingOfficer ? 'updating' : 'creating'} officer`, description: errorData.error, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Officer ${editingOfficer ? 'updated' : 'registered'} successfully.` });
      setDialogOpen(false);
      fetchOfficers();
    }
  };

  const handleDownloadLoanOfficersTemplate = async () => {
    if (!managerBranchId) {
      toast({
        title: 'Branch missing',
        description: 'Assign a branch to your manager profile before using the template.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await downloadLoanOfficersImportTemplate();
    } catch (err) {
      console.error(err);
      toast({
        title: 'Template error',
        description: err?.message ?? 'Could not build template.',
        variant: 'destructive',
      });
    }
  };

  const handleImportLoanOfficers = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!managerBranchId) {
      toast({
        title: 'Branch missing',
        description:
          'Your account has no branch assigned yet. Ask an admin to assign a branch, then sign out and sign in again.',
        variant: 'destructive',
      });
      event.target.value = null;
      return;
    }
    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const detailLines = [];
      let imported = 0;
      let skippedDuplicate = 0;
      let skippedInvalid = 0;
      let failed = 0;
      const sampleFailures = [];
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = getImportDataSheet(workbook, ['Loan Officers', 'Officers', 'officers']);
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          throw new Error(`No worksheet found (expected "Loan Officers" or similar).`);
        }
        const rows = XLSX.utils.sheet_to_json(worksheet);
        const existingEmails = new Set(
          (officers || []).map((o) => String(o.email ?? '').trim().toLowerCase()).filter(Boolean),
        );
        const batchEmails = new Set();

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const { fullName, email, password } = parseOfficerImportRow(row);
          if (!fullName && !email && !password) continue;
          const rowLabel = `Row ${i + 2}`;
          if (!fullName || !email || !password) {
            skippedInvalid += 1;
            detailLines.push(`${rowLabel}: missing full_name, email, or password`);
            continue;
          }
          if (!isValidEmail(email)) {
            skippedInvalid += 1;
            detailLines.push(`${rowLabel}: invalid email "${email}"`);
            continue;
          }
          if (password.length < MIN_OFFICER_PASSWORD_LEN) {
            skippedInvalid += 1;
            detailLines.push(
              `${rowLabel}: password must be at least ${MIN_OFFICER_PASSWORD_LEN} characters`,
            );
            continue;
          }
          if (existingEmails.has(email) || batchEmails.has(email)) {
            skippedDuplicate += 1;
            detailLines.push(`${rowLabel}: duplicate or existing email "${email}"`);
            continue;
          }

          const { error: invokeError } = await invokeEdgeFunction(
            'create-user',
            {
              body: {
                full_name: fullName,
                email,
                password,
                role: 'officer',
                branch_id: managerBranchId,
              },
            },
            session?.access_token,
          );
          if (invokeError) {
            failed += 1;
            const msg = await parseCreateUserInvokeError(invokeError);
            detailLines.push(`${rowLabel}: ${msg}`);
            if (sampleFailures.length < 8) sampleFailures.push(`${rowLabel}: ${msg}`);
          } else {
            imported += 1;
            batchEmails.add(email);
            existingEmails.add(email);
          }
        }

        await fetchOfficers();
        const { line } = formatImportReportSummary({
          imported,
          skippedDuplicate,
          skippedInvalid,
          failed,
          sampleFailures,
        });
        setImportReportSummary(line);
        setImportReportDetails(
          detailLines.length
            ? detailLines.slice(0, 80).join('\n') + (detailLines.length > 80 ? '\n…' : '')
            : '',
        );
        setImportReportOpen(true);
        toast({ title: 'Import finished', description: line });
      } catch (err) {
        toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
      } finally {
        setIsImporting(false);
        event.target.value = null;
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDelete = async (officerId) => {
    const result = await invokeEdgeFunction('delete-user', { body: { userId: officerId } }, session?.access_token);
    const fail = await getEdgeInvokeFailure(result);
    if (fail) {
      const { error: auditErr } = await supabase.rpc('log_audit_event', {
        p_action: 'loan_officer.delete.failed',
        p_entity_type: 'user',
        p_entity_id: String(officerId),
        p_metadata: { stage: fail.stage || null, error: fail.message },
      });
      if (auditErr) console.debug('[audit]', auditErr.message);
      toast({
        title: 'Could not delete loan officer',
        description: fail.message,
        variant: 'destructive',
      });
      return;
    }
    const { error: auditOkErr } = await supabase.rpc('log_audit_event', {
      p_action: 'loan_officer.delete.success',
      p_entity_type: 'user',
      p_entity_id: String(officerId),
      p_metadata: {},
    });
    if (auditOkErr) console.debug('[audit]', auditOkErr.message);
    toast({ title: 'Success', description: 'Loan Officer deleted successfully.' });
    fetchOfficers();
  };
  
  const getBadgeVariant = (isActive) => {
    return isActive ? 'success' : 'destructive';
  }

  const isCreateFlow = !editingOfficer;

  return (
    <DashboardLayout title="Loan Officer Management">
      {!profileLoading && user && !managerBranchId && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          Your manager account has no branch assigned in the system. An admin must set your branch in User Management, then you should sign out and sign in again before registering officers.
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadLoanOfficersTemplate}
          disabled={!managerBranchId}
          title={!managerBranchId ? 'Assign a branch before downloading the template.' : undefined}
        >
          <Download className="mr-2 h-4 w-4" /> Template
        </Button>
        <Button
          type="button"
          disabled={isImporting || !managerBranchId}
          onClick={() => importFileRef.current?.click()}
          title={!managerBranchId ? 'Assign a branch before importing.' : undefined}
        >
          {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Import
        </Button>
        <input
          type="file"
          ref={importFileRef}
          className="hidden"
          accept=".csv,.xlsx,.xls"
          onChange={handleImportLoanOfficers}
        />
        <Button onClick={() => handleOpenDialog()} disabled={!managerBranchId}>
          <PlusCircle className="mr-2 h-4 w-4" /> Register Officer
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingOfficer ? `Edit Officer: ${editingOfficer.full_name}` : 'Register New Loan Officer'}</DialogTitle>
            {editingOfficer && (
              <CardDescription>
                Update name or email. Their portfolio stays on this account. Password is optional. To swap branches and
                portfolios with another officer, ask an admin to use Territory swap.
              </CardDescription>
            )}
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="officer-name">Name</Label>
              <Input id="officer-name" placeholder="John Doe" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="officer-email">Email</Label>
              <Input id="officer-email" type="email" placeholder="officer@example.com" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="officer-password">Password</Label>
              <Input id="officer-password" type="password" placeholder={editingOfficer ? 'Leave blank to keep current password' : '••••••••'} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingOfficer ? 'Save changes' : 'Register Officer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader><CardTitle>Your Loan Officers</CardTitle></CardHeader>
        <CardContent>
            {loading ? <div className="text-center p-8">Loading officers...</div> :
            <>
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={filterActive} onValueChange={setFilterActive}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Center</Label>
                <SearchableSelect
                  value={centerFilterId}
                  onValueChange={setCenterFilterId}
                  options={centerFilterOptions}
                  placeholder="All centers"
                  searchPlaceholder="Search centers…"
                  emptyText="No center found."
                  disabled={centers.length === 0}
                  triggerClassName="w-[220px]"
                />
              </div>
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label htmlFor="officer-search" className="text-xs">
                  Search name or email
                </Label>
                <Input
                  id="officer-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Type to filter…"
                  className="max-w-md"
                />
              </div>
              <Button type="button" variant="outline" size="sm" className="mb-0.5" onClick={clearListFilters}>
                Clear filters
              </Button>
            </div>
            <BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportOfficersCsv} />
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
                        onCheckedChange={() => bulk.toggleAll()}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {officers.length > 0 ? pagedOfficers.map(officer => (
                    <TableRow key={officer.id}>
                      <TableCell>
                        <Checkbox
                          checked={bulk.isSelected(officer.id)}
                          onCheckedChange={() => bulk.toggle(officer.id)}
                          aria-label="Select row"
                        />
                      </TableCell>
                      <TableCell>{officer.full_name}</TableCell>
                      <TableCell>{officer.email}</TableCell>
                      <TableCell><Badge variant={getBadgeVariant(officer.is_active)}>{officer.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                      <TableCell className="space-x-2">
                        <Button variant="outline" size="icon" onClick={() => handleOpenDialog(officer)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the loan officer. Make sure they have no associated data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(officer.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                )) : (
                    <TableRow>
                        <TableCell colSpan={5} className="text-center">No loan officers found for this branch.</TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
            {officers.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, officers.length)} of {officers.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            </>
            }
        </CardContent>
      </Card>
      <ImportResultDialog
        open={importReportOpen}
        onOpenChange={setImportReportOpen}
        title="Loan officers import"
        summary={importReportSummary}
        details={importReportDetails}
      />
    </DashboardLayout>
  );
};

export default LoanOfficerManagement;