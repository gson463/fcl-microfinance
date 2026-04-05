import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileQuestion, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

const HISTORY_PAGE_SIZE = 15;

const OfficerRequests = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loanRequests, setLoanRequests] = useState([]);
  const [pendingIncreases, setPendingIncreases] = useState([]);
  const [increaseHistory, setIncreaseHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    const { data: loanData, error: loanErr } = await supabase
      .from('loans')
      .select(`id, loan_id, status, principal, created_at, borrowers(first_name, surname)`)
      .eq('officer_id', user.id)
      .in('status', ['delete_requested', 'edit_requested'])
      .order('created_at', { ascending: false });

    if (loanErr) {
      toast({ title: 'Error', description: loanErr.message, variant: 'destructive' });
      setLoanRequests([]);
    } else {
      setLoanRequests(loanData || []);
    }

    const { data: pendData, error: pendErr } = await supabase
      .from('loan_increase_exception_requests')
      .select(
        `id, status, officer_notes, created_at, borrowers(first_name, surname, borrower_id)`
      )
      .eq('officer_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (pendErr) {
      console.error(pendErr);
      setPendingIncreases([]);
    } else {
      setPendingIncreases(pendData || []);
    }

    const { data: histData, error: histErr } = await supabase
      .from('loan_increase_exception_requests')
      .select(
        `id, status, officer_notes, manager_notes, created_at, resolved_at, approved_at, consumed_at, consumed_at_loan_id,
         borrowers(first_name, surname, borrower_id),
         manager:users!manager_id(full_name)`
      )
      .eq('officer_id', user.id)
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200);

    if (histErr) {
      console.error(histErr);
      setIncreaseHistory([]);
    } else {
      setIncreaseHistory(histData || []);
    }

    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setHistoryPage(1);
  }, [increaseHistory.length]);

  const pagedHistory = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return increaseHistory.slice(start, start + HISTORY_PAGE_SIZE);
  }, [increaseHistory, historyPage]);

  const historyTotalPages = Math.max(1, Math.ceil(increaseHistory.length / HISTORY_PAGE_SIZE));

  const pendingLoanCount = loanRequests.length;
  const pendingIncreaseCount = pendingIncreases.length;
  const totalPending = pendingLoanCount + pendingIncreaseCount;

  if (loading) {
    return (
      <DashboardLayout title="Requests">
        <div className="flex items-center justify-center h-full">Loading requests…</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Requests">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <FileQuestion className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
          <div className="text-sm text-neutral-500 space-y-1">
            <p>
              Track every request you have submitted: loan edits, deletions, and loan increase approvals. Pending items
              need your manager’s decision; history shows resolved loan increase requests.
            </p>
            <p>
              <Link to="/officer/loans" className="text-brand-blue underline-offset-4 hover:underline">
                Open Loans &amp; Disbursements
              </Link>{' '}
              to submit or change requests.
            </p>
          </div>
        </div>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="flex w-full flex-wrap justify-start gap-1 sm:w-auto">
            <TabsTrigger value="pending">
              Pending
              {totalPending > 0 ? (
                <Badge variant="secondary" className="ml-2 tabular-nums">
                  {totalPending}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="history">
              Loan increase history
              {increaseHistory.length > 0 ? (
                <Badge variant="outline" className="ml-2 tabular-nums">
                  {increaseHistory.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-6 mt-4">
            <div className="flex flex-wrap gap-3 text-sm text-neutral-600">
              <span>
                <strong className="text-foreground">{pendingLoanCount}</strong> loan edit / delete
              </span>
              <span className="text-neutral-400">·</span>
              <span>
                <strong className="text-foreground">{pendingIncreaseCount}</strong> loan increase approval
              </span>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Loan edit &amp; deletion</CardTitle>
                <CardDescription>
                  Waiting for your branch manager to approve or reject. You cannot edit the loan here until the request
                  is resolved.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Loan ID</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Request</TableHead>
                      <TableHead>Principal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loanRequests.length > 0 ? (
                      loanRequests.map((loan) => (
                        <TableRow key={loan.id}>
                          <TableCell className="font-mono text-sm">{loan.loan_id}</TableCell>
                          <TableCell>
                            {loan.borrowers
                              ? `${loan.borrowers.first_name} ${loan.borrowers.surname}`.trim()
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={loan.status === 'edit_requested' ? 'warning' : 'destructive'}>
                              {loan.status.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {loan.principal != null ? Number(loan.principal).toLocaleString() : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No pending loan edit or deletion requests.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Loan increase approval</CardTitle>
                <CardDescription>
                  Manager must approve before you can disburse a new loan for borrowers who finished a prior loan.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Your notes</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingIncreases.length > 0 ? (
                      pendingIncreases.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            {row.borrowers
                              ? `${row.borrowers.first_name} ${row.borrowers.surname}`.trim()
                              : '—'}
                            {row.borrowers?.borrower_id ? (
                              <span className="block text-xs text-muted-foreground">ID: {row.borrowers.borrower_id}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="max-w-md whitespace-pre-wrap text-sm text-neutral-700">
                            {row.officer_notes || '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.created_at
                              ? new Date(row.created_at).toLocaleString(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">pending</Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No pending loan increase approvals.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Resolved loan increase requests</CardTitle>
                <CardDescription>
                  Approved, rejected, or already used at disburse (manager decision and timestamps on record).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Resolved</TableHead>
                      <TableHead>Used at disburse</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedHistory.length > 0 ? (
                      pagedHistory.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Badge
                              variant={
                                row.status === 'approved'
                                  ? 'default'
                                  : row.status === 'rejected'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {row.borrowers ? `${row.borrowers.first_name} ${row.borrowers.surname}`.trim() : '—'}
                            {row.borrowers?.borrower_id ? (
                              <span className="block text-xs text-muted-foreground">ID: {row.borrowers.borrower_id}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.created_at
                              ? new Date(row.created_at).toLocaleString(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm">{row.manager?.full_name ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.resolved_at
                              ? new Date(row.resolved_at).toLocaleString(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.consumed_at
                              ? new Date(row.consumed_at).toLocaleString(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No resolved loan increase requests yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {increaseHistory.length > HISTORY_PAGE_SIZE && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t px-2 pt-4">
                    <p className="text-sm text-neutral-600">
                      Showing {(historyPage - 1) * HISTORY_PAGE_SIZE + 1}–
                      {Math.min(historyPage * HISTORY_PAGE_SIZE, increaseHistory.length)} of {increaseHistory.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={historyPage <= 1}
                        onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-neutral-600">
                        Page {historyPage} / {historyTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={historyPage >= historyTotalPages}
                        onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                <details className="mt-4 rounded-md border border-neutral-200 bg-neutral-50/80 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40">
                  <summary className="cursor-pointer font-medium text-neutral-800 dark:text-neutral-200">
                    Notes (expand)
                  </summary>
                  <div className="mt-3 space-y-3">
                    {pagedHistory.map((row) => (
                      <div
                        key={`${row.id}-notes`}
                        className="rounded border border-neutral-200/80 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-950/50"
                      >
                        <p className="text-xs font-semibold text-neutral-500">
                          {row.borrowers?.borrower_id ?? row.id} · {row.status}
                        </p>
                        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                          <span className="font-medium">You:</span> {row.officer_notes || '—'}
                        </p>
                        {row.manager_notes ? (
                          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                            <span className="font-medium">Manager:</span> {row.manager_notes}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </details>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default OfficerRequests;
