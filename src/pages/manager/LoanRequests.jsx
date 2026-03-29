import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, FileQuestion, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateSchedule } from '@/utils/loanUtils';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

const LoanRequests = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loanProducts, setLoanProducts] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [currency, setCurrency] = useState('TZS');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
    if (config) setCurrency(config.value);

    const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*');
    if (productsError) {
      toast({ title: "Error", description: productsError.message, variant: "destructive" });
    } else {
      setLoanProducts(productsData || []);
    }
    
    const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('*');
    if (holidaysError) {
        toast({ title: 'Error fetching holidays', description: holidaysError.message, variant: 'destructive' });
    } else {
        setHolidays(holidaysData || []);
    }

    const { data: requestsData, error: requestsError } = await supabase
      .from('loans')
      .select(`*, borrowers(first_name, surname), officer:users!officer_id(full_name)`)
      .in('status', ['delete_requested', 'edit_requested']);

    if (requestsError) {
      toast({ title: "Error", description: requestsError.message, variant: "destructive" });
    } else {
      setRequests(requestsData || []);
    }
    setLoading(false);
  }, [user, toast]);

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

  const handleApproveDeletion = async (loanId) => {
    const { error } = await supabase.from('loans').update({ status: 'delete_approved_manager' }).eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchData();
      toast({ title: 'Success', description: 'Deletion request approved and sent to Admin for final review.' });
    }
  };

  const handleApproveEdit = async (loan) => {
    const { edit_request } = loan;
    const product = loanProducts.find(p => p.id === edit_request.productId);
    
    if (!product) {
        toast({ title: 'Error', description: 'Loan product for the edit not found.', variant: 'destructive' });
        return;
    }

    const principal = parseFloat(edit_request.principal);
    const interest = principal * (parseFloat(product.interest_rate) / 100);
    const totalPayable = principal + interest;
    
    // Recalculate balance based on what was paid
    const paidAmount = loan.total_payable - loan.balance;
    const newBalance = Math.max(0, totalPayable - paidAmount);
    
    // Recalculate outstanding interest
    const originalInterest = loan.total_payable - loan.principal;
    const paidTowardsOriginalPrincipal = Math.max(0, paidAmount - originalInterest);
    const paidTowardsOriginalInterest = paidAmount - paidTowardsOriginalPrincipal;
    const newOutstandingInterest = Math.max(0, interest - paidTowardsOriginalInterest);

    const formattedRepaymentStartDate = formatTZ(toZonedTime(edit_request.repaymentStartDate, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

    const updatedLoan = {
      product_id: edit_request.productId,
      disbursement_date: formatTZ(toZonedTime(edit_request.disbursementDate, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
      repayment_start_date: formattedRepaymentStartDate,
      principal: principal,
      interest_rate: product.interest_rate,
      repayment_frequency: product.repayment_frequency,
      period: product.loan_period,
      period_unit: product.loan_period_unit,
      total_payable: totalPayable,
      balance: newBalance,
      outstanding_interest: newOutstandingInterest,
      status: 'active',
      schedule: generateSchedule(totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, formattedRepaymentStartDate, holidays),
      edit_request: null,
    };
    
    const { error } = await supabase.from('loans').update(updatedLoan).eq('id', loan.id);
    if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
        fetchData();
        toast({ title: 'Success', description: 'Loan edit approved and updated.' });
    }
  };

  const handleRejectRequest = async (loanId) => {
    const { error } = await supabase.from('loans').update({ status: 'active', edit_request: null }).eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchData();
      toast({ title: 'Rejected', description: 'The request has been rejected.' });
    }
  };

  const renderRequestDetails = (loan) => {
    if (loan.status === 'edit_requested' && loan.edit_request) {
      const { edit_request } = loan;
      const newProduct = loanProducts.find(p => p.id === edit_request.productId);
      return (
        <div className="text-xs text-gray-500 space-y-1 mt-1">
          <p><strong>New Principal:</strong> {currency} {Number(edit_request.principal).toLocaleString()}</p>
          <p><strong>New Product:</strong> {newProduct?.name}</p>
          <p><strong>New Disbursement:</strong> {edit_request.disbursementDate}</p>
          <p><strong>New Repayment Start:</strong> {edit_request.repaymentStartDate}</p>
        </div>
      );
    }
    return null;
  };
  
  if (loading) return <DashboardLayout title="Loan Requests"><div className="flex items-center justify-center h-full">Loading Requests...</div></DashboardLayout>;

  return (
    <DashboardLayout title="Loan Requests">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <FileQuestion className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
          <p className="text-sm text-neutral-500">
            Review and approve loan edit or deletion requests from your loan officers.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending Your Approval</CardTitle>
            <CardDescription>These loans have been requested for modification or deletion by a Loan Officer.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loan ID</TableHead>
                  <TableHead>Borrower</TableHead>
                  <TableHead>Loan Officer</TableHead>
                  <TableHead>Request Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length > 0 ? pagedRequests.map(loan => (
                  <TableRow key={loan.id}>
                    <TableCell>{loan.loan_id}</TableCell>
                    <TableCell>{loan.borrowers.first_name} {loan.borrowers.surname}</TableCell>
                    <TableCell>{loan.officer.full_name}</TableCell>
                    <TableCell>
                      <Badge variant={loan.status === 'edit_requested' ? 'warning' : 'destructive'}>
                        {loan.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p>{currency} {Number(loan.principal).toLocaleString()}</p>
                      {renderRequestDetails(loan)}
                    </TableCell>
                    <TableCell className="space-x-2">
                      {loan.status === 'delete_requested' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="sm" variant="outline"><CheckCircle className="mr-2 h-4 w-4" /> Approve</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Approve Deletion Request?</AlertDialogTitle><AlertDialogDescription>This forwards the request to Admin for final approval.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleApproveDeletion(loan.id)}>Yes, Approve</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                       {loan.status === 'edit_requested' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="sm" variant="outline"><CheckCircle className="mr-2 h-4 w-4" /> Approve</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Approve Loan Edit?</AlertDialogTitle><AlertDialogDescription>This will apply the requested changes to the loan.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleApproveEdit(loan)}>Yes, Approve</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="sm" variant="destructive"><XCircle className="mr-2 h-4 w-4" /> Reject</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Reject Request?</AlertDialogTitle><AlertDialogDescription>This will reject the request and revert the loan status.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleRejectRequest(loan.id)}>Yes, Reject</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">No pending requests from your officers.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {requests.length > 0 && (
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

export default LoanRequests;