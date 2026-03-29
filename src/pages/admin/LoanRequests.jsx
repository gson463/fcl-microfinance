import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, FileQuestion, RotateCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/customSupabaseClient';

const PAGE_SIZE = 25;

const AdminLoanRequests = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('loans')
      .select(`
        *,
        borrowers (first_name, surname),
        users (full_name)
      `)
      .eq('status', 'delete_approved_manager');

    if (error) {
      toast({ title: 'Error', description: 'Could not fetch loan deletion requests.', variant: 'destructive' });
    } else {
      setRequests(data);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [requests.length]);

  const pagedRequests = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return requests.slice(start, start + PAGE_SIZE);
  }, [requests, page]);

  const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));

  const handleFinalApprove = async (loanId) => {
    const { error } = await supabase.from('loans').delete().eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: `Failed to delete loan: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Loan has been permanently deleted.' });
      fetchData();
    }
  };

  return (
    <DashboardLayout title="Loan Deletion Requests">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <FileQuestion className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
          <p className="text-sm text-neutral-500">
            Review and finalize loan deletion requests approved by managers.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending Final Approval</CardTitle>
            <CardDescription>These loans have been approved for deletion by a Branch Manager.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Requests...</span>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loan ID</TableHead>
                    <TableHead>Borrower</TableHead>
                    <TableHead>Loan Officer</TableHead>
                    <TableHead>Principal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.length > 0 ? pagedRequests.map(loan => (
                    <TableRow key={loan.id}>
                      <TableCell>{loan.loan_id}</TableCell>
                      <TableCell>{loan.borrowers ? `${loan.borrowers.first_name} ${loan.borrowers.surname}` : 'N/A'}</TableCell>
                      <TableCell>{loan.users ? loan.users.full_name : 'N/A'}</TableCell>
                      <TableCell>TZS {loan.principal.toLocaleString()}</TableCell>
                      <TableCell><Badge variant="warning">Manager Approved</Badge></TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm">
                              <CheckCircle className="mr-2 h-4 w-4" /> Finalize Deletion
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action is irreversible. The loan and all its associated data will be permanently deleted from the system.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleFinalApprove(loan.id)}>Yes, Delete Permanently</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-gray-500">
                        No pending requests found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            {!isLoading && requests.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
                <p className="text-sm text-neutral-600">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, requests.length)} of {requests.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-neutral-600">Page {page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminLoanRequests;