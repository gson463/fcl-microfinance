import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, UserCircle, Calendar, Eye, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SCHEDULE_DIALOG_CONTENT, SCHEDULE_DIALOG_SCROLL } from '@/lib/dialogLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useDate } from '@/contexts/DateContext';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { DEFAULT_SYSTEM_NAME } from '@/lib/brand';
import { borrowerPublicId } from '@/lib/borrowerPublicId';

const DetailItem = ({ label, value, isBadge = false, badgeVariant = 'default' }) => (
    <div className="flex justify-between py-2 border-b">
        <span className="text-muted-foreground">{label}</span>
        {isBadge ? <Badge variant={badgeVariant}>{value}</Badge> : <span className="font-medium text-right">{value || 'N/A'}</span>}
    </div>
);

const BorrowerDetails = () => {
  const { borrowerId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { serverDate } = useDate();

  const [loading, setLoading] = useState(true);
  const [borrower, setBorrower] = useState(null);
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [group, setGroup] = useState(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [currency, setCurrency] = useState('TZS');
  const [isExporting, setIsExporting] = useState(false);
  const [systemName, setSystemName] = useState(DEFAULT_SYSTEM_NAME);

  const fetchData = useCallback(async () => {
    if (!borrowerId || !user) return;
    setLoading(true);

    try {
        const { data: borrowerData, error: borrowerError } = await supabase
            .from('borrowers')
            .select('*, branches(name), centers(name)')
            .eq('id', borrowerId)
            .single();
        if (borrowerError || !borrowerData) throw new Error(borrowerError?.message || 'Borrower not found.');
        setBorrower(borrowerData);

        const { data: loansData, error: loansError } = await supabase
            .from('loans').select('*, loan_products(name)').eq('borrower_id', borrowerId);
        if (loansError) throw loansError;
        setLoans(loansData || []);

        const { data: repaymentsData, error: repaymentsError } = await supabase
            .from('repayments').select('*').eq('borrower_id', borrowerId);
        if (repaymentsError) throw repaymentsError;
        setRepayments(repaymentsData || []);

        if (borrowerData.group_id) {
            const { data: groupData, error: groupError } = await supabase
                .from('groups').select('name').eq('id', borrowerData.group_id).single();
            if (groupError) throw groupError;
            setGroup(groupData);
        }
        
        const { data: configData, error: configError } = await supabase
            .from('system_config').select('*');
        if (!configError && configData) {
            const config = configData.reduce((acc, item) => ({...acc, [item.key]: item.value}), {});
            setCurrency(config.currency || 'TZS');
            setSystemName(config.systemName || DEFAULT_SYSTEM_NAME);
        }

    } catch (error) {
        toast({ title: 'Error fetching details', description: error.message, variant: 'destructive' });
        navigate('/officer/borrowers');
    } finally {
        setLoading(false);
    }
  }, [borrowerId, user, toast, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = (type) => {
    setIsExporting(true);
    if (type === 'pdf') {
        generatePdf();
    } else if (type === 'excel') {
        generateExcel();
    }
    setIsExporting(false);
  };

  const generatePdf = () => {
    const doc = new jsPDF();
    const idTypeMap = { 'national_id': 'National ID', 'passport': 'Passport', 'drivers_license': "Driver's License", 'voters_id': "Voter's ID" };

    doc.setFontSize(20);
    doc.text(`${systemName}`, 14, 22);
    doc.setFontSize(14);
    doc.text("Borrower Loan Statement", 14, 30);

    const borrowerDetails = [
        ["Borrower Name:", `${borrower.first_name} ${borrower.surname}`],
        ["Borrower ID:", borrower.borrower_id],
        ["Phone:", borrower.phone_number],
        ["Address:", borrower.address],
        ["ID Type:", idTypeMap[borrower.identification_type]],
        ["ID Number:", borrower.identification_number],
        ...(borrower.centers?.name ? [["Centre:", borrower.centers.name]] : []),
        ...(borrower.guarantor_name ? [['Guarantor:', borrower.guarantor_name]] : []),
        ...(borrower.guarantor_phone ? [['Guarantor phone:', borrower.guarantor_phone]] : []),
        ["Report Date:", new Date(serverDate).toLocaleDateString()],
    ];

    doc.autoTable({
        startY: 35,
        head: [['Borrower Details', '']],
        body: borrowerDetails,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] }
    });

    let finalY = doc.lastAutoTable.finalY || 60;

    loans.forEach((loan, index) => {
        const loanRepayments = repayments.filter(r => r.loan_id === loan.id);
        const totalPaid = loanRepayments.reduce((sum, r) => sum + Number(r.amount), 0);
        
        doc.autoTable({
            startY: finalY + 10,
            head: [[`Loan #${index + 1}: ${loan.loan_products.name} (${loan.loan_id})`, '']],
            body: [
                ["Status:", loan.status],
                ["Principal:", `${currency} ${Number(loan.principal).toLocaleString()}`],
                ["Total Payable:", `${currency} ${Number(loan.total_payable).toLocaleString()}`],
                ["Total Paid:", `${currency} ${totalPaid.toLocaleString()}`],
                ["Balance:", `${currency} ${Number(loan.balance).toLocaleString()}`],
                ["Disbursed Date:", new Date(loan.disbursement_date).toLocaleDateString()],
            ],
            theme: 'grid',
            headStyles: { fillColor: [39, 174, 96] },
        });

        finalY = doc.lastAutoTable.finalY;
        
        if (loanRepayments.length > 0) {
            doc.text("Repayment History", 14, finalY + 8);
            doc.autoTable({
                startY: finalY + 10,
                head: [['Date', 'Amount Paid']],
                body: loanRepayments.map(r => [new Date(r.payment_date).toLocaleDateString(), `${currency} ${Number(r.amount).toLocaleString()}`]),
                theme: 'striped',
            });
            finalY = doc.lastAutoTable.finalY;
        } else {
             doc.text("No repayments made for this loan.", 14, finalY + 8);
             finalY += 8;
        }
    });

    doc.save(`Loan_Statement_${borrower.first_name}_${borrower.surname}.pdf`);
    toast({ title: 'Success', description: 'PDF statement generated.' });
  };
  
  const generateExcel = () => {
    const wb = XLSX.utils.book_new();
    const idTypeMap = { 'national_id': 'National ID', 'passport': 'Passport', 'drivers_license': "Driver's License", 'voters_id': "Voter's ID" };

    // Summary Sheet
    const summaryData = [
        [`${systemName} - Borrower Loan Statement`],
        [],
        ["Borrower Name", `${borrower.first_name} ${borrower.surname}`],
        ["Borrower ID", borrower.borrower_id],
        ["Phone", borrower.phone_number],
        ["Address", borrower.address],
        ["ID Type", idTypeMap[borrower.identification_type]],
        ["ID Number", borrower.identification_number],
        ...(borrower.centers?.name ? [["Centre", borrower.centers.name]] : []),
        ...(borrower.guarantor_name ? [['Guarantor', borrower.guarantor_name]] : []),
        ...(borrower.guarantor_phone ? [['Guarantor phone', borrower.guarantor_phone]] : []),
        ["Report Date", new Date(serverDate).toLocaleDateString()],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    // Loans and Repayments
    loans.forEach((loan, index) => {
        const loanRepayments = repayments.filter(r => r.loan_id === loan.id);
        const totalPaid = loanRepayments.reduce((sum, r) => sum + Number(r.amount), 0);
        
        const loanData = [
            [`Loan #${index + 1}: ${loan.loan_products.name} (${loan.loan_id})`],
            [],
            ["Status", loan.status],
            ["Principal", `${currency} ${Number(loan.principal).toLocaleString()}`],
            ["Total Payable", `${currency} ${Number(loan.total_payable).toLocaleString()}`],
            ["Total Paid", `${currency} ${totalPaid.toLocaleString()}`],
            ["Balance", `${currency} ${Number(loan.balance).toLocaleString()}`],
            ["Disbursed Date", new Date(loan.disbursement_date).toLocaleDateString()],
            [],
            ["Repayment History"],
            ["Payment Date", "Amount Paid"]
        ];

        loanRepayments.forEach(r => {
            loanData.push([new Date(r.payment_date).toLocaleDateString(), `${currency} ${Number(r.amount).toLocaleString()}`]);
        });
        
        const wsLoan = XLSX.utils.aoa_to_sheet(loanData);
        XLSX.utils.book_append_sheet(wb, wsLoan, `Loan ${index + 1}`);
    });

    XLSX.writeFile(wb, `Loan_Statement_${borrower.first_name}_${borrower.surname}.xlsx`);
    toast({ title: 'Success', description: 'Excel statement generated.' });
  };


  const viewSchedule = (loan) => {
    setSelectedLoan(loan);
    setScheduleDialogOpen(true);
  };

  const getLoanStatusBadge = (status) => {
      const statusMap = { 'active': 'success', 'paid': 'default', 'delinquent': 'warning', 'defaulted': 'destructive' };
      return statusMap[status] || 'secondary';
  };

  const getBorrowerStatusBadge = (status) => {
    const statusMap = {
      eligible: 'default',
      pending: 'secondary',
      active_loan: 'default',
      defaulted: 'destructive',
      paid_up: 'outline',
    };
    return statusMap[status] || 'secondary';
  };

  const getBorrowerStatusText = (status) => {
    const statusTextMap = {
      eligible: 'Eligible',
      pending: 'Pending (manager approval)',
      active_loan: 'Active Loan',
      defaulted: 'Defaulted',
      paid_up: 'Paid',
    };
    return statusTextMap[status] || status;
  };
  
  if (loading) {
    return (
      <DashboardLayout title="Loading..."><div className="text-center">Loading borrower details...</div></DashboardLayout>
    );
  }

  if (!borrower) {
    return (
      <DashboardLayout title="Error"><div className="text-center text-red-500">Could not find borrower data.</div></DashboardLayout>
    );
  }

  const idTypeMap = { 'national_id': 'National ID', 'passport': 'Passport', 'drivers_license': "Driver's License", 'voters_id': "Voter's ID" };

  return (
    <DashboardLayout title={`Borrower: ${borrower.first_name} ${borrower.surname}`}>
      <div className="mb-6 flex justify-between items-center">
        <Button variant="outline" onClick={() => navigate('/officer/borrowers')}><ArrowLeft className="mr-2 h-4 w-4" />Back to Borrowers</Button>
        <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleExport('pdf')} disabled={isExporting}>
              {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileDown className="mr-2 h-4 w-4" />}PDF
            </Button>
            <Button variant="outline" onClick={() => handleExport('excel')} disabled={isExporting}>
              {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Excel
            </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
            <Card>
                <CardHeader className="items-center text-center">
                    <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                         <UserCircle className="w-16 h-16 text-gray-400" />
                    </div>
                    <CardTitle>{borrower.first_name} {borrower.surname}</CardTitle>
                    {borrowerPublicId(borrower) ? (
                      <CardDescription>{borrowerPublicId(borrower)}</CardDescription>
                    ) : null}
                </CardHeader>
                <CardContent className="space-y-1">
                    <DetailItem label="Loan Status" value={getBorrowerStatusText(borrower.status)} isBadge badgeVariant={getBorrowerStatusBadge(borrower.status)} />
                    <DetailItem label="Registration Date" value={new Date(borrower.created_at).toLocaleDateString()} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                    <DetailItem label="Gender" value={borrower.gender} />
                    <DetailItem label="Phone" value={borrower.phone_number} />
                    <DetailItem label="Address" value={borrower.address} />
                    <DetailItem label="ID Type" value={idTypeMap[borrower.identification_type]} />
                    <DetailItem label="ID Number" value={borrower.identification_number} />
                </CardContent>
            </Card>

             <Card>
                <CardHeader><CardTitle>Business & Group Information</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                    <DetailItem label="Business Name" value={borrower.business_name} />
                    <DetailItem label="Business Location" value={borrower.business_location} />
                    <DetailItem label="Type" value={borrower.borrower_type} />
                    {borrower.centers?.name && <DetailItem label="Centre" value={borrower.centers.name} />}
                    {borrower.borrower_type === 'group' && <DetailItem label="Group" value={group?.name} />}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Guarantor</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                    <DetailItem label="Name" value={borrower.guarantor_name} />
                    <DetailItem label="Phone" value={borrower.guarantor_phone} />
                </CardContent>
            </Card>
        </div>
        
        <div className="lg:col-span-2">
             <Card>
                <CardHeader>
                    <CardTitle>Loan History</CardTitle>
                    <CardDescription>A summary of all past and current loans.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loans.length > 0 ? loans.map(loan => (
                        <Card key={loan.id} className="bg-gray-50">
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-lg">{loan.loan_products?.name || 'N/A'}</CardTitle>
                                        <CardDescription>{loan.loan_id}</CardDescription>
                                    </div>
                                    <Badge variant={getLoanStatusBadge(loan.status)}>{loan.status}</Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-4">
                                    <div><p className="text-muted-foreground">Principal</p><p className="font-semibold">{currency} {Number(loan.principal).toLocaleString()}</p></div>
                                    <div><p className="text-muted-foreground">Balance</p><p className="font-semibold text-red-600">{currency} {Number(loan.balance).toLocaleString()}</p></div>
                                    <div><p className="text-muted-foreground">Disbursed</p><p className="font-semibold">{new Date(loan.disbursement_date).toLocaleDateString()}</p></div>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => viewSchedule(loan)}><Eye className="mr-2 h-4 w-4" /> View Schedule</Button>
                            </CardContent>
                        </Card>
                    )) : (
                        <div className="text-center py-12 text-gray-500">
                            <Calendar className="mx-auto h-12 w-12 text-gray-400" />
                            <h3 className="mt-2 text-sm font-medium">No loan history</h3>
                            <p className="mt-1 text-sm">This borrower has not taken any loans yet.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
      </div>

      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
          <DialogContent className={SCHEDULE_DIALOG_CONTENT}>
              <DialogHeader className="shrink-0">
                  <DialogTitle>Repayment Schedule for {selectedLoan?.loan_id}</DialogTitle>
                  <DialogDescription>
                      Borrower: {borrower.first_name} {borrower.surname} <br/>
                      Total Payable: {currency} {Number(selectedLoan?.total_payable).toLocaleString()}
                  </DialogDescription>
              </DialogHeader>
              <div className={SCHEDULE_DIALOG_SCROLL}>
              <RepaymentScheduleGrid
                schedule={selectedLoan?.schedule}
                currency={currency}
                variant="simple"
                statusBadgeFn={(inst) => (
                  <Badge
                    variant={
                      inst.status === 'paid'
                        ? 'success'
                        : inst.status === 'pending' && new Date(inst.dueDate) < new Date(serverDate)
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {inst.status}
                  </Badge>
                )}
                exportMeta={
                  selectedLoan && borrower
                    ? scheduleExportMetaFromLoan(
                        {
                          ...selectedLoan,
                          borrowers: {
                            ...borrower,
                            groups: group ? { name: group.name } : undefined,
                          },
                        },
                        currency,
                        'simple'
                      )
                    : undefined
                }
              />
              </div>
          </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default BorrowerDetails;