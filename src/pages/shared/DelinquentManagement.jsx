import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { differenceInDays } from 'date-fns';
import { updateLoanStatuses } from '@/utils/loanUtils';

const DelinquentManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [delinquentLoans, setDelinquentLoans] = useState([]);
  const [borrowers, setBorrowers] = useState([]);
  const [currency, setCurrency] = useState('TZS');

  useEffect(() => {
    updateLoanStatuses();
    let allLoans = JSON.parse(localStorage.getItem('loans') || '[]');
    let allBorrowers = JSON.parse(localStorage.getItem('borrowers') || '[]');
    const config = JSON.parse(localStorage.getItem('systemConfig') || '{}');
    setCurrency(config.currency || 'TZS');

    if (user?.role === 'manager') {
      const officerIds = JSON.parse(localStorage.getItem('users') || '[]').filter(u => u.branchId === user.branchId).map(u => u.id);
      const branchBorrowerIds = allBorrowers.filter(b => officerIds.includes(b.loanOfficerId)).map(b => b.id);
      allLoans = allLoans.filter(l => branchBorrowerIds.includes(l.borrowerId));
      allBorrowers = allBorrowers.filter(b => branchBorrowerIds.includes(b.id));
    } else if (user?.role === 'officer') {
      const officerBorrowerIds = allBorrowers.filter(b => b.loanOfficerId === user.id).map(b => b.id);
      allLoans = allLoans.filter(l => officerBorrowerIds.includes(l.borrowerId));
      allBorrowers = allBorrowers.filter(b => officerBorrowerIds.includes(b.id));
    }
    
    setDelinquentLoans(allLoans.filter(l => l.status === 'delinquent'));
    setBorrowers(allBorrowers);
  }, [user]);

  const getBorrowerName = (id) => {
      const borrower = borrowers.find(b => b.id === id);
      return borrower ? `${borrower.firstName} ${borrower.surname}` : 'N/A';
  };

  const getDaysOverdue = (loan) => {
    const firstPending = loan.schedule?.find(inst => new Date(inst.dueDate) < new Date() && inst.status !== 'paid');
    if (!firstPending) return 0;
    const days = differenceInDays(new Date(), new Date(firstPending.dueDate));
    return days > 0 ? days : 0;
  };

  const loanIds = useMemo(() => delinquentLoans.map((l) => l.id), [delinquentLoans]);
  const bulk = useBulkSelection(loanIds);

  const exportDelinquentCsv = () => {
    const rows = delinquentLoans.filter((l) => bulk.isSelected(l.id));
    if (rows.length === 0) {
      toast({ title: 'Nothing selected', description: 'Select one or more rows first.', variant: 'destructive' });
      return;
    }
    exportObjectsToCsv(`delinquent_${Date.now()}.csv`, [
      { header: 'Loan ID', accessor: 'loanId' },
      { header: 'Borrower', accessor: (r) => getBorrowerName(r.borrowerId) },
      { header: 'Balance', accessor: (r) => String(r.balance ?? '') },
      { header: 'Days overdue', accessor: (r) => String(getDaysOverdue(r)) },
      { header: 'Status', accessor: () => 'delinquent' },
    ], rows);
    toast({ title: 'Exported', description: `${rows.length} row(s) to CSV.` });
  };

  return (
    <DashboardLayout title="Delinquent Loans">
      <Card>
        <CardHeader><CardTitle>Loans with Overdue Payments (1-30 Days)</CardTitle></CardHeader>
        <CardContent>
          <BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportDelinquentCsv} />
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
                  onCheckedChange={() => bulk.toggleAll()}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Loan ID</TableHead><TableHead>Borrower</TableHead><TableHead>Balance</TableHead><TableHead>Days Overdue</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {delinquentLoans.map(l => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Checkbox
                      checked={bulk.isSelected(l.id)}
                      onCheckedChange={() => bulk.toggle(l.id)}
                      aria-label="Select row"
                    />
                  </TableCell>
                  <TableCell>{l.loanId}</TableCell>
                  <TableCell>{getBorrowerName(l.borrowerId)}</TableCell>
                  <TableCell>{currency} {l.balance.toLocaleString()}</TableCell>
                  <TableCell>{getDaysOverdue(l)}</TableCell>
                  <TableCell><Badge variant="warning">Delinquent</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default DelinquentManagement;