import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, ChevronLeft, ChevronRight, RefreshCw, Trash2, Pencil, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format as formatDate } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FREQUENCY_OPTIONS, isDueNow, frequencyLabel, nextDueLabel } from '@/lib/expenseDefaults';

const PAGE_SIZE = 25;

const emptyDefaultForm = () => ({
  expense_type: 'transport',
  amount: '',
  description: '',
  frequency: 'monthly',
  is_active: true,
});

const ExpenseManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [expenses, setExpenses] = useState([]);
  const [defaults, setDefaults] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultDialogOpen, setDefaultDialogOpen] = useState(false);
  const [editingDefault, setEditingDefault] = useState(null);
  const [currency, setCurrency] = useState('TZS');
  const [loading, setLoading] = useState(true);
  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [postingDue, setPostingDue] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [page, setPage] = useState(1);
  const [formData, setFormData] = useState({
    expense_type: 'transport',
    amount: '',
    description: '',
    expense_date: formatDate(new Date(), 'yyyy-MM-dd'),
  });
  const [defaultForm, setDefaultForm] = useState(emptyDefaultForm);

  const fetchExpenses = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
    setCurrency(configData?.value || 'TZS');

    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('officer_id', user.id)
      .order('expense_date', { ascending: false });

    if (error) {
      toast({ title: 'Error fetching expenses', description: error.message, variant: 'destructive' });
    } else {
      setExpenses(data || []);
    }
    setLoading(false);
  }, [user, toast]);

  const fetchDefaults = useCallback(async () => {
    if (!user) return;
    setLoadingDefaults(true);
    const { data, error } = await supabase
      .from('expense_defaults')
      .select('*')
      .eq('officer_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Error loading defaults', description: error.message, variant: 'destructive' });
      setDefaults([]);
    } else {
      setDefaults(data || []);
    }
    setLoadingDefaults(false);
  }, [user, toast]);

  useEffect(() => {
    fetchExpenses();
    fetchDefaults();
  }, [fetchExpenses, fetchDefaults]);

  useEffect(() => {
    setPage(1);
  }, [expenses.length]);

  const pagedExpenses = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return expenses.slice(start, start + PAGE_SIZE);
  }, [expenses, page]);

  const totalPages = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));

  const expenseIds = useMemo(() => expenses.map((e) => e.id), [expenses]);
  const bulk = useBulkSelection(expenseIds);

  const dueDefaults = useMemo(
    () => defaults.filter((d) => d.is_active && isDueNow(d.last_applied_at, d.frequency)),
    [defaults]
  );

  const exportExpensesCsv = () => {
    const rows = expenses.filter((e) => bulk.isSelected(e.id));
    if (rows.length === 0) {
      toast({ title: 'Nothing selected', description: 'Select one or more expenses first.', variant: 'destructive' });
      return;
    }
    exportObjectsToCsv(`expenses_${Date.now()}.csv`, [
      { header: 'Date', accessor: (r) => formatDate(new Date(r.expense_date), 'yyyy-MM-dd') },
      { header: 'Type', accessor: 'expense_type' },
      { header: 'Amount', accessor: (r) => String(r.amount ?? '') },
      { header: 'Description', accessor: (r) => r.description ?? '' },
    ], rows);
    toast({ title: 'Exported', description: `${rows.length} expense(s) to CSV.` });
  };

  const handleSubmitExpense = async (e) => {
    e.preventDefault();
    if (!formData.expense_type || !formData.amount || !formData.description || !formData.expense_date) {
      toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
      return;
    }

    const newExpense = {
      ...formData,
      amount: parseFloat(formData.amount),
      officer_id: user.id,
    };

    const { error } = await supabase.from('expenses').insert(newExpense);

    if (error) {
      toast({ title: 'Error', description: `Failed to submit expense. ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Expense submitted successfully.' });
      fetchExpenses();
      setDialogOpen(false);
    }
  };

  const openNewDefault = () => {
    setEditingDefault(null);
    setDefaultForm(emptyDefaultForm());
    setDefaultDialogOpen(true);
  };

  const openEditDefault = (row) => {
    setEditingDefault(row);
    setDefaultForm({
      expense_type: row.expense_type,
      amount: String(row.amount),
      description: row.description || '',
      frequency: row.frequency,
      is_active: row.is_active,
    });
    setDefaultDialogOpen(true);
  };

  const saveDefault = async (e) => {
    e.preventDefault();
    if (!defaultForm.expense_type || !defaultForm.amount || !defaultForm.frequency) {
      toast({ title: 'Error', description: 'Fill type, amount, and frequency.', variant: 'destructive' });
      return;
    }
    const amt = parseFloat(defaultForm.amount);
    if (Number.isNaN(amt) || amt < 0) {
      toast({ title: 'Invalid amount', variant: 'destructive' });
      return;
    }

    setSavingDefault(true);
    const payload = {
      officer_id: user.id,
      expense_type: defaultForm.expense_type,
      amount: amt,
      description: defaultForm.description?.trim() || null,
      frequency: defaultForm.frequency,
      is_active: defaultForm.is_active,
    };

    let error;
    if (editingDefault) {
      ({ error } = await supabase.from('expense_defaults').update(payload).eq('id', editingDefault.id));
    } else {
      ({ error } = await supabase.from('expense_defaults').insert(payload));
    }

    setSavingDefault(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Saved', description: editingDefault ? 'Default updated.' : 'Recurring default added.' });
      setDefaultDialogOpen(false);
      fetchDefaults();
    }
  };

  const deleteDefault = async (id) => {
    const { error } = await supabase.from('expense_defaults').delete().eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Removed', description: 'Recurring default deleted.' });
      fetchDefaults();
    }
  };

  const postDueExpenses = async () => {
    const toPost = defaults.filter((d) => d.is_active && isDueNow(d.last_applied_at, d.frequency));
    if (toPost.length === 0) {
      toast({ title: 'Nothing due', description: 'No active recurring rules are due for posting yet.', variant: 'destructive' });
      return;
    }
    setPostingDue(true);
    let ok = 0;
    const nowIso = new Date().toISOString();
    const todayStr = formatDate(new Date(), 'yyyy-MM-dd');

    for (const d of toPost) {
      const desc = d.description?.trim()
        ? `${d.description.trim()} (recurring · ${frequencyLabel(d.frequency)})`
        : `Recurring expense · ${frequencyLabel(d.frequency)}`;

      const { error: insErr } = await supabase.from('expenses').insert({
        officer_id: user.id,
        expense_type: d.expense_type,
        amount: d.amount,
        description: desc,
        expense_date: todayStr,
      });

      if (insErr) {
        toast({ title: 'Insert failed', description: insErr.message, variant: 'destructive' });
        break;
      }

      const { error: upErr } = await supabase.from('expense_defaults').update({ last_applied_at: nowIso }).eq('id', d.id);
      if (upErr) {
        toast({ title: 'Warning', description: `Expense saved but could not update schedule: ${upErr.message}`, variant: 'destructive' });
        break;
      }
      ok += 1;
    }

    setPostingDue(false);
    if (ok > 0) {
      toast({ title: 'Posted', description: `${ok} recurring expense(s) added to My Expenses.` });
      fetchExpenses();
      fetchDefaults();
    }
  };

  return (
    <DashboardLayout title="Expense Management">
      <div className="mb-6 flex flex-wrap justify-end gap-2">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              onClick={() =>
                setFormData({
                  expense_type: 'transport',
                  amount: '',
                  description: '',
                  expense_date: formatDate(new Date(), 'yyyy-MM-dd'),
                })
              }
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Submit Expense
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Submit New Expense</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmitExpense} className="space-y-4 py-4">
              <Select value={formData.expense_type} onValueChange={(value) => setFormData({ ...formData, expense_type: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select expense type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transport">Transport</SelectItem>
                  <SelectItem value="office">Office Supplies</SelectItem>
                  <SelectItem value="communication">Communication</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder={`Amount (${currency})`}
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
              <Input
                type="date"
                value={formData.expense_date}
                onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                required
              />
              <Textarea
                placeholder="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
              />
              <Button type="submit" className="w-full">
                Submit
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Default / recurring expenses</CardTitle>
            <CardDescription>
              Set fixed amounts and how often they should appear. Use <strong>Post due expenses</strong> to copy each due rule into
              &quot;My Expenses&quot; for today. The next post is allowed after one full period (daily / weekly / 2 weeks / monthly) from
              the last post.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={openNewDefault}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add default
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={postDueExpenses}
              disabled={postingDue || dueDefaults.length === 0}
            >
              {postingDue ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Post due expenses
              {dueDefaults.length > 0 ? (
                <Badge variant="secondary" className="ml-2">
                  {dueDefaults.length}
                </Badge>
              ) : null}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingDefaults ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : defaults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recurring defaults yet. Add one to automate repeated costs.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Last posted</TableHead>
                    <TableHead>Next due (approx.)</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {defaults.map((d) => {
                    const due = d.is_active && isDueNow(d.last_applied_at, d.frequency);
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="capitalize">{d.expense_type}</TableCell>
                        <TableCell>
                          {currency} {Number(d.amount).toLocaleString()}
                        </TableCell>
                        <TableCell>{frequencyLabel(d.frequency)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {d.last_applied_at ? formatDate(new Date(d.last_applied_at), 'PPp') : 'Never'}
                        </TableCell>
                        <TableCell className="text-sm">{nextDueLabel(d.last_applied_at, d.frequency)}</TableCell>
                        <TableCell>
                          {d.is_active ? (
                            <Badge variant="default">Yes</Badge>
                          ) : (
                            <Badge variant="secondary">No</Badge>
                          )}
                          {due && d.is_active ? (
                            <Badge variant="outline" className="ml-2 border-amber-500 text-amber-800">
                              Due
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button type="button" variant="ghost" size="icon" onClick={() => openEditDefault(d)} aria-label="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label="Delete">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this default?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This only removes the recurring rule. Past expenses in the list below stay unchanged.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteDefault(d.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={defaultDialogOpen} onOpenChange={setDefaultDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingDefault ? 'Edit recurring default' : 'New recurring default'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveDefault} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={defaultForm.expense_type}
                onValueChange={(value) => setDefaultForm({ ...defaultForm, expense_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transport">Transport</SelectItem>
                  <SelectItem value="office">Office Supplies</SelectItem>
                  <SelectItem value="communication">Communication</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount ({currency})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={defaultForm.amount}
                onChange={(e) => setDefaultForm({ ...defaultForm, amount: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={defaultForm.frequency}
                onValueChange={(value) => setDefaultForm({ ...defaultForm, frequency: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                value={defaultForm.description}
                onChange={(e) => setDefaultForm({ ...defaultForm, description: e.target.value })}
                placeholder="e.g. Field visit transport allowance"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="def-active"
                checked={defaultForm.is_active}
                onCheckedChange={(v) => setDefaultForm({ ...defaultForm, is_active: v === true })}
              />
              <Label htmlFor="def-active" className="font-normal cursor-pointer">
                Active (inactive rules are not posted)
              </Label>
            </div>
            <Button type="submit" className="w-full" disabled={savingDefault}>
              {savingDefault ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingDefault ? 'Save changes' : 'Create default'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>My Expenses</CardTitle>
          <CardDescription>All posted expenses, including manual entries and recurring posts.</CardDescription>
        </CardHeader>
        <CardContent>
          {!loading && expenses.length > 0 && (
            <BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportExpensesCsv} />
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {!loading && expenses.length > 0 && (
                      <Checkbox
                        checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
                        onCheckedChange={() => bulk.toggleAll()}
                        aria-label="Select all"
                      />
                    )}
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : expenses.length > 0 ? (
                  pagedExpenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Checkbox
                          checked={bulk.isSelected(e.id)}
                          onCheckedChange={() => bulk.toggle(e.id)}
                          aria-label="Select row"
                        />
                      </TableCell>
                      <TableCell>{formatDate(new Date(e.expense_date), 'PPP')}</TableCell>
                      <TableCell className="capitalize">{e.expense_type}</TableCell>
                      <TableCell>
                        {currency} {Number(e.amount).toLocaleString()}
                      </TableCell>
                      <TableCell>{e.description}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      No expenses found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {!loading && expenses.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4 border-t px-2 py-4 sm:px-6">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, expenses.length)} of {expenses.length}
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
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default ExpenseManagement;
