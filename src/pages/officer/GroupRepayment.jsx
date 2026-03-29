import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { Coins as HandCoins, Search, Calendar as CalendarIcon, Ban, Loader2, Copy, ArrowDownToLine, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format as formatDate, isSunday, startOfDay, isToday, isBefore, isEqual } from 'date-fns';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

const GroupRepayment = () => {
    const { user, session } = useAuth();
    const { toast } = useToast();
    const [currency, setCurrency] = useState('TZS');
    const [myGroups, setMyGroups] = useState([]);
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [groupMembers, setGroupMembers] = useState([]);
    const [repaymentAmounts, setRepaymentAmounts] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [memberPage, setMemberPage] = useState(1);

    const isHoliday = (date) => {
        const formattedYYYYMMDD = formatDate(date, 'yyyy-MM-dd');
        return holidays.some(h => h.date === formattedYYYYMMDD);
    };

    const isForbiddenDate = isSunday(selectedDate) || isHoliday(selectedDate);
    
    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        
        const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        setCurrency(configData?.value || 'TZS');

        const { data: holidaysData } = await supabase.from('holidays').select('date');
        setHolidays(holidaysData || []);
        
        const { data: groupsData, error } = await supabase.from('groups').select('*').eq('loan_officer_id', user.id);
        if (error) {
            toast({ title: 'Error fetching groups', description: error.message, variant: 'destructive' });
        } else {
            setMyGroups(groupsData || []);
        }
        setLoading(false);
    }, [user, toast]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleGroupSelection = useCallback(async (groupId) => {
        setSelectedGroupId(groupId);
        if (isForbiddenDate) {
            setGroupMembers([]);
            return;
        }
        setLoading(true);

        const { data: loans, error: loansError } = await supabase
            .from('loans')
            .select('id, loan_id, borrower_id, schedule, borrowers(id, first_name, surname, group_id)')
            .eq('officer_id', user.id)
            .in('status', ['active', 'delinquent']);

        if (loansError) {
            toast({ title: 'Error fetching loans', description: loansError.message, variant: 'destructive' });
            setLoading(false);
            return;
        }

        const loansInGroup = loans.filter(l => l.borrowers?.group_id === groupId);

        const selectedD = startOfDay(selectedDate);
        
        const memberPromises = loansInGroup
            .map(async (loan) => {
                let pastDueAmount = 0;
                let amountDueToday = 0;
                let hasAnyDueInstallment = false;
                
                loan.schedule?.forEach(inst => {
                    const instDueDate = toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE);
                    const instStartOfDay = startOfDay(instDueDate);

                    if (inst.status !== 'paid') {
                        const unpaidAmount = (inst.amount || 0) - (inst.paidAmount || 0);
                        if (unpaidAmount > 0.01) {
                            if (isBefore(instStartOfDay, selectedD)) {
                                pastDueAmount += unpaidAmount;
                                hasAnyDueInstallment = true;
                            } else if (isEqual(instStartOfDay, selectedD)) {
                                amountDueToday += unpaidAmount;
                                hasAnyDueInstallment = true;
                            }
                        }
                    }
                });

                if (!hasAnyDueInstallment) return null;
                
                return {
                    borrowerId: loan.borrower_id,
                    name: `${loan.borrowers.first_name} ${loan.borrowers.surname}`,
                    loanId: loan.id,
                    pastDueAmount,
                    amountDueToday,
                    totalDue: pastDueAmount + amountDueToday,
                };
            });
            
        let membersWithDueInstallments = (await Promise.all(memberPromises)).filter(m => m && m.totalDue > 0);

        setGroupMembers(membersWithDueInstallments);
        
        const initialAmounts = {};
        membersWithDueInstallments.forEach(m => {
            initialAmounts[m.borrowerId] = '';
        });
        setRepaymentAmounts(initialAmounts);
        setLoading(false);
    }, [user, selectedDate, isForbiddenDate, toast]);
    
    useEffect(() => {
        if(selectedGroupId) handleGroupSelection(selectedGroupId);
    }, [selectedDate, selectedGroupId, handleGroupSelection]);

    const filteredGroups = useMemo(() => {
        if (!searchQuery) return myGroups;
        return myGroups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [myGroups, searchQuery]);
    
    useEffect(() => {
        setMemberPage(1);
    }, [groupMembers, selectedGroupId]);

    const pagedGroupMembers = useMemo(() => {
        const start = (memberPage - 1) * PAGE_SIZE;
        return groupMembers.slice(start, start + PAGE_SIZE);
    }, [groupMembers, memberPage]);

    const memberTotalPages = Math.max(1, Math.ceil(groupMembers.length / PAGE_SIZE));

    const totals = useMemo(() => {
        return groupMembers.reduce((acc, member) => {
            acc.pastDue += member.pastDueAmount;
            acc.dueToday += member.amountDueToday;
            acc.totalDue += member.totalDue;
            
            const paid = parseFloat(repaymentAmounts[member.borrowerId]) || 0;
            acc.totalPaid += paid;
            
            return acc;
        }, { pastDue: 0, dueToday: 0, totalDue: 0, totalPaid: 0 });
    }, [groupMembers, repaymentAmounts]);


    const handleAmountChange = (borrowerId, amount) => {
        setRepaymentAmounts(prev => ({ ...prev, [borrowerId]: amount }));
    };
    
    const handleCopyAmount = (borrowerId, amount) => {
        setRepaymentAmounts(prev => ({ ...prev, [borrowerId]: amount.toString() }));
        toast({
            title: "Amount Copied",
            description: `Copied ${currency} ${amount.toLocaleString()} to payment field.`,
            duration: 1500,
        });
    };

    const handleCopyAllAmounts = () => {
        const newAmounts = { ...repaymentAmounts };
        let count = 0;
        groupMembers.forEach(member => {
            if (member.totalDue > 0) {
                newAmounts[member.borrowerId] = member.totalDue.toString();
                count++;
            }
        });
        setRepaymentAmounts(newAmounts);
        toast({
            title: "Bulk Copy Successful",
            description: `Copied total due for ${count} members.`,
        });
    };

    const handleSaveRepayments = async () => {
        if (isForbiddenDate) {
            toast({ title: 'Invalid Date', description: "Repayments cannot be on Sundays or holidays.", variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        const actualPaymentDate = formatTZ(selectedDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });
        
        let successCount = 0;
        let errorCount = 0;

        const repaymentPromises = groupMembers.map(async (member) => {
            const amount = parseFloat(repaymentAmounts[member.borrowerId]);
            if (isNaN(amount) || amount <= 0) return;

            const { error } = await invokeEdgeFunction(
                'record-repayment',
                {
                    body: {
                        loan_id: member.loanId,
                        amount: amount,
                        officer_id: user.id,
                        actual_payment_date: actualPaymentDate,
                    },
                },
                session?.access_token,
            );

            if (error) {
                console.error(`Failed to save repayment for ${member.name}:`, error);
                errorCount++;
            } else {
                successCount++;
            }
        });
        
        await Promise.all(repaymentPromises);

        if (successCount > 0) {
             toast({ title: 'Success', description: `Recorded ${successCount} repayments for ${formatDate(selectedDate, 'PPP')}.` });
        }
        if (errorCount > 0) {
            toast({ title: 'Errors Occurred', description: `${errorCount} repayments failed to save.`, variant: 'destructive' });
        }
        if (successCount === 0 && errorCount === 0){
             toast({ title: 'Info', description: 'No valid repayments were entered.' });
        }

        setIsSaving(false);
        handleGroupSelection(selectedGroupId); // Refresh data
    };
    
    const selectedGroupName = useMemo(() => myGroups.find(g => g.id === selectedGroupId)?.name || '', [myGroups, selectedGroupId]);

    return (
        <DashboardLayout title="Group Repayments">
             <TooltipProvider>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle>My Groups</CardTitle>
                             <div className="relative mt-2">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search groups..." className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                            </div>
                        </CardHeader>
                        <CardContent className="max-h-[60vh] overflow-y-auto">
                            <div className="flex flex-col gap-2">
                                {filteredGroups.map(group => (
                                    <Button key={group.id} variant={selectedGroupId === group.id ? 'default' : 'outline'} onClick={() => handleGroupSelection(group.id)} className="w-full justify-start">
                                        {group.name}
                                    </Button>
                                ))}
                                {filteredGroups.length === 0 && <p className="text-center text-sm text-gray-500 py-4">No groups found.</p>}
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Record Repayments for: {selectedGroupName}</CardTitle>
                            <div className="flex justify-between items-center mt-2">
                                <CardDescription>Select a date to record repayments.</CardDescription>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={'outline'} className={`w-[240px] justify-start text-left font-normal ${isForbiddenDate ? 'border-red-500 text-red-500' : ''}`}>
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {selectedDate ? formatDate(selectedDate, 'PPP') : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="end">
                                        <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} initialFocus disabled={(date) => isSunday(date) || isHoliday(date)} />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </CardHeader>
                        <CardContent>
                             {!selectedGroupId ? (
                                <div className="text-center py-10 text-gray-500">Please select a group from the list to start.</div>
                             ) : isForbiddenDate ? (
                                <div className="text-center py-10 text-red-500 flex flex-col items-center gap-2"><Ban className="h-10 w-10" /><p>Repayments are not allowed on Sundays or public holidays. Please select a working day.</p></div>
                             ) : loading ? (
                                <div className="text-center py-10 text-gray-500"><Loader2 className="h-8 w-8 animate-spin" /></div>
                             ) : groupMembers.length > 0 ? (
                                <>
                                    <div className="flex justify-between items-center mb-4">
                                        <p className="text-sm text-muted-foreground">Showing due amounts for {formatDate(selectedDate, 'PPP')}.</p>
                                        <Button size="sm" variant="outline" onClick={handleCopyAllAmounts} className="text-blue-600 border-blue-200 hover:bg-blue-50">
                                            <ArrowDownToLine className="mr-2 h-4 w-4" />
                                            Copy All Total Due
                                        </Button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>No.</TableHead> {/* Moved to first position */}
                                                    <TableHead>Client Name</TableHead>
                                                    <TableHead>Past Due</TableHead>
                                                    <TableHead>Due Today</TableHead>
                                                    <TableHead>Total Due</TableHead>
                                                    <TableHead className="w-48">Amount Paid</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {pagedGroupMembers.map((member, index) => (
                                                    <TableRow key={member.borrowerId}>
                                                        <TableCell>{(memberPage - 1) * PAGE_SIZE + index + 1}</TableCell>
                                                        <TableCell>{member.name}</TableCell>
                                                        <TableCell>{currency} {member.pastDueAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                        <TableCell>{currency} {member.amountDueToday.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2 font-semibold">
                                                                <span>{currency} {member.totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-blue-600" onClick={() => handleCopyAmount(member.borrowerId, member.totalDue)}>
                                                                            <Copy className="h-3 w-3" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent><p>Copy total due</p></TooltipContent>
                                                                </Tooltip>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Input type="number" placeholder="0.00" value={repaymentAmounts[member.borrowerId]} onChange={(e) => handleAmountChange(member.borrowerId, e.target.value)} />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                            <TableFooter>
                                                <TableRow>
                                                    <TableCell className="font-bold text-lg">Total</TableCell> {/* No. column */}
                                                    <TableCell className="font-bold text-lg">{groupMembers.length}</TableCell> {/* Total for No. column */}
                                                    <TableCell className="font-bold text-lg">{currency} {totals.pastDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    <TableCell className="font-bold text-lg">{currency} {totals.dueToday.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    <TableCell className="font-bold text-lg">{currency} {totals.totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    <TableCell className="font-bold text-lg">{currency} {totals.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                </TableRow>
                                            </TableFooter>
                                        </Table>
                                    </div>
                                    {groupMembers.length > 0 && (
                                        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                            <p className="text-sm text-muted-foreground">
                                                Showing {(memberPage - 1) * PAGE_SIZE + 1}–{Math.min(memberPage * PAGE_SIZE, groupMembers.length)} of {groupMembers.length} members
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" size="sm" disabled={memberPage <= 1} onClick={() => setMemberPage((p) => Math.max(1, p - 1))}>
                                                    <ChevronLeft className="h-4 w-4" />
                                                </Button>
                                                <span className="text-sm text-muted-foreground">Page {memberPage} / {memberTotalPages}</span>
                                                <Button variant="outline" size="sm" disabled={memberPage >= memberTotalPages} onClick={() => setMemberPage((p) => Math.min(memberTotalPages, p + 1))}>
                                                    <ChevronRight className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                    <Button onClick={handleSaveRepayments} className="mt-4" disabled={isSaving}>
                                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HandCoins className="mr-2 h-4 w-4" />}
                                        Save All Repayments
                                    </Button>
                                </>
                                ) : (
                                    <div className="text-center py-10 text-gray-500">No scheduled repayments found for this group for {formatDate(selectedDate, 'PPP')}.</div>
                                )
                            }
                        </CardContent>
                    </Card>
                </div>
            </div>
            </TooltipProvider>
        </DashboardLayout>
    );
};

export default GroupRepayment;