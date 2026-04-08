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
import { format as formatDate, startOfDay, isBefore, isEqual, subDays } from 'date-fns';
import { format as formatTZ, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const EAT_TIMEZONE = 'Africa/Nairobi';

/** Calendar “today” in Nairobi (avoids timezone off-by-one). */
function getTodayEATDateForForm() {
    const s = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function isSundayInTimeZone(date, timeZone) {
    const w = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone }).format(date);
    return w === 'Sunday';
}
import { cn } from '@/lib/utils';
import {
    getInstallmentUnitFromSchedule,
    isValidRepaymentAmount,
    smallestMultipleOfUnitAtLeast,
    repaymentAmountValidationMessage,
    REPAYMENT_AMOUNT_INVALID_FALLBACK,
} from '@/lib/repaymentInstallmentUnit.js';
import { scheduledDueRpcName, normalizeWalletPrepaymentSplitMode, WALLET_PREPAYMENT_ARREARS_ONLY } from '@/lib/walletPrepaymentSplitMode';

const PAGE_SIZE = 25;
const PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS = 90;

function memberRepaymentAmountError(amountRaw, member, currencyLabel) {
    if (amountRaw == null || String(amountRaw).trim() === '') return '';
    const amount = parseFloat(String(amountRaw).replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return '';
    if (isValidRepaymentAmount(amount, member.scheduledDue, member.installmentUnit)) return '';
    return (
        repaymentAmountValidationMessage(amount, member.scheduledDue, member.installmentUnit, currencyLabel) ||
        REPAYMENT_AMOUNT_INVALID_FALLBACK
    );
}

const GroupRepayment = () => {
    const { user, session } = useAuth();
    const { toast } = useToast();
    const [currency, setCurrency] = useState('TZS');
    const [myCenters, setMyCenters] = useState([]);
    const [myGroups, setMyGroups] = useState([]);
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [centerSearchQuery, setCenterSearchQuery] = useState('');
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [groupMembers, setGroupMembers] = useState([]);
    const [repaymentAmounts, setRepaymentAmounts] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDate, setSelectedDate] = useState(() => getTodayEATDateForForm());
    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [memberPage, setMemberPage] = useState(1);
    const [walletPrepaymentSplitMode, setWalletPrepaymentSplitMode] = useState(WALLET_PREPAYMENT_ARREARS_ONLY);

    const isHoliday = (date) => {
        const formattedYYYYMMDD = formatInTimeZone(date, EAT_TIMEZONE, 'yyyy-MM-dd');
        return holidays.some((h) => h.date === formattedYYYYMMDD);
    };

    const isForbiddenDate =
        isSundayInTimeZone(selectedDate, EAT_TIMEZONE) || isHoliday(selectedDate);
    
    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        
        const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        setCurrency(configData?.value || 'TZS');

        const { data: splitRow } = await supabase
            .from('system_config')
            .select('value')
            .eq('key', 'walletPrepaymentSplitMode')
            .maybeSingle();
        setWalletPrepaymentSplitMode(normalizeWalletPrepaymentSplitMode(splitRow?.value));

        const { data: holidaysData } = await supabase.from('holidays').select('date');
        setHolidays(holidaysData || []);
        
        const { data: centersData, error: centersError } = await supabase.from('centers').select('*').eq('loan_officer_id', user.id).order('name');
        if (centersError) {
            toast({ title: 'Error fetching centers', description: centersError.message, variant: 'destructive' });
            setMyCenters([]);
        } else {
            setMyCenters(centersData || []);
        }

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

    useEffect(() => {
        setSelectedGroupId('');
        setGroupMembers([]);
        setRepaymentAmounts({});
        setMemberPage(1);
    }, [selectedCenterId]);

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
        const payStr = formatTZ(selectedDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

        const dueRpc = scheduledDueRpcName(walletPrepaymentSplitMode);

        const memberPromises = loansInGroup
            .map(async (loan) => {
                let pastDueAmount = 0;
                let amountDueToday = 0;
                let hasAnyDueInstallment = false;

                const { data: dueRaw, error: dueRpcErr } = await supabase.rpc(dueRpc, {
                    p_schedule: loan.schedule ?? null,
                    p_payment_date: payStr,
                });
                if (dueRpcErr) {
                    console.error(dueRpcErr);
                }
                const scheduledDue = Number(dueRaw ?? 0);
                const installmentUnit = getInstallmentUnitFromSchedule(loan.schedule);

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
                    scheduledDue,
                    installmentUnit,
                };
            });
            
        let membersWithDueInstallments = (await Promise.all(memberPromises)).filter(m => m && m.totalDue > 0);

        setGroupMembers(membersWithDueInstallments);
        
        const initialAmounts = {};
        membersWithDueInstallments.forEach((m) => {
            initialAmounts[m.borrowerId] = '';
        });
        setRepaymentAmounts(initialAmounts);
        setLoading(false);
    }, [user, selectedDate, isForbiddenDate, toast, walletPrepaymentSplitMode]);
    
    useEffect(() => {
        if(selectedGroupId) handleGroupSelection(selectedGroupId);
    }, [selectedDate, selectedGroupId, handleGroupSelection]);

    const filteredCenters = useMemo(() => {
        if (!centerSearchQuery) return myCenters;
        return myCenters.filter((c) => c.name.toLowerCase().includes(centerSearchQuery.toLowerCase()));
    }, [myCenters, centerSearchQuery]);

    const filteredGroups = useMemo(() => {
        if (!selectedCenterId) return [];
        const inCenter = myGroups.filter((g) => g.center_id === selectedCenterId);
        if (!searchQuery) return inCenter;
        return inCenter.filter((g) => g.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [myGroups, selectedCenterId, searchQuery]);
    
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
    
    const handleCopyAmount = (borrowerId, totalDue, installmentUnit) => {
        const rounded =
            installmentUnit != null && smallestMultipleOfUnitAtLeast(totalDue, installmentUnit) != null
                ? smallestMultipleOfUnitAtLeast(totalDue, installmentUnit)
                : totalDue;
        setRepaymentAmounts((prev) => ({ ...prev, [borrowerId]: rounded.toString() }));
        toast({
            title: "Amount Copied",
            description: `Copied ${currency} ${rounded.toLocaleString()} to the payment field (valid installment multiple).`,
            duration: 1500,
        });
    };

    const handleCopyAllAmounts = () => {
        const newAmounts = { ...repaymentAmounts };
        let count = 0;
        groupMembers.forEach((member) => {
            if (member.totalDue > 0) {
                const rounded =
                    member.installmentUnit != null &&
                    smallestMultipleOfUnitAtLeast(member.totalDue, member.installmentUnit) != null
                        ? smallestMultipleOfUnitAtLeast(member.totalDue, member.installmentUnit)
                        : member.totalDue;
                newAmounts[member.borrowerId] = rounded.toString();
                count++;
            }
        });
        setRepaymentAmounts(newAmounts);
        toast({
            title: "Bulk Copy Successful",
            description: `Copied total collections for ${count} members.`,
        });
    };

    const handleSaveRepayments = async () => {
        const payStr = formatInTimeZone(selectedDate, EAT_TIMEZONE, 'yyyy-MM-dd');
        const todayStr = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
        const minStr = formatInTimeZone(
            subDays(getTodayEATDateForForm(), PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS),
            EAT_TIMEZONE,
            'yyyy-MM-dd'
        );
        if (payStr > todayStr) {
            toast({
                title: 'Invalid date',
                description: 'Payment date cannot be in the future.',
                variant: 'destructive',
            });
            return;
        }
        if (payStr < minStr) {
            toast({
                title: 'Invalid date',
                description: `Payment date cannot be more than ${PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS} days ago.`,
                variant: 'destructive',
            });
            return;
        }
        if (isForbiddenDate) {
            toast({ title: 'Invalid Date', description: "Repayments cannot be on Sundays or holidays.", variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        const actualPaymentDate = formatTZ(selectedDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

        const validationErrors = [];
        for (const member of groupMembers) {
            const amount = parseFloat(repaymentAmounts[member.borrowerId]);
            if (isNaN(amount) || amount <= 0) continue;
            if (
                !isValidRepaymentAmount(amount, member.scheduledDue, member.installmentUnit)
            ) {
                const msg =
                    repaymentAmountValidationMessage(
                        amount,
                        member.scheduledDue,
                        member.installmentUnit,
                        currency,
                    ) || REPAYMENT_AMOUNT_INVALID_FALLBACK;
                validationErrors.push(`${member.name}: ${msg}`);
            }
        }
        if (validationErrors.length > 0) {
            toast({
                title: 'Invalid amount',
                description:
                    validationErrors.length === 1
                        ? validationErrors[0]
                        : `These amounts are not valid: ${validationErrors.join('; ')}`,
                variant: 'destructive',
            });
            setIsSaving(false);
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        const failureLines = [];

        const repaymentPromises = groupMembers.map(async (member) => {
            const amount = parseFloat(repaymentAmounts[member.borrowerId]);
            if (isNaN(amount) || amount <= 0) return;

            const { data, error } = await invokeEdgeFunction(
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

            const bodyError =
                data && typeof data === 'object' && data !== null && 'error' in data && data.error != null
                    ? String(data.error)
                    : null;
            const httpMsg =
                error?.context && typeof error.context === 'object' && error.context.body
                    ? (() => {
                          try {
                              const j = JSON.parse(String(error.context.body));
                              return j?.error ? String(j.error) : null;
                          } catch {
                              return null;
                          }
                      })()
                    : null;
            const description = bodyError || httpMsg || error?.message || null;

            if (error || bodyError) {
                console.error(`Failed to save repayment for ${member.name}:`, error || bodyError);
                errorCount++;
                if (description) failureLines.push(`${member.name}: ${description}`);
            } else {
                successCount++;
            }
        });
        
        await Promise.all(repaymentPromises);

        const firstErrorMessage = failureLines[0] ?? null;

        if (successCount > 0) {
             toast({ title: 'Success', description: `Recorded ${successCount} repayments for ${formatDate(selectedDate, 'PPP')}.` });
        }
        if (errorCount > 0) {
            toast({
                title: 'Some repayments failed',
                description:
                    firstErrorMessage ||
                    `${errorCount} repayment(s) could not be saved. Check loan status, amount, and date; ensure you are logged in.`,
                variant: 'destructive',
            });
        }
        if (successCount === 0 && errorCount === 0) {
            toast({
                title: 'Nothing to save',
                description:
                    'Enter an amount greater than zero for at least one member, or use Copy All Total Collections. Empty rows are skipped.',
            });
        }

        setIsSaving(false);
        handleGroupSelection(selectedGroupId); // Refresh data
    };
    
    const selectedGroupName = useMemo(() => myGroups.find(g => g.id === selectedGroupId)?.name || '', [myGroups, selectedGroupId]);
    const selectedCenterName = useMemo(() => myCenters.find((c) => c.id === selectedCenterId)?.name || '', [myCenters, selectedCenterId]);

    return (
        <DashboardLayout title="Group Collections">
             <TooltipProvider>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 flex flex-col gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>1. Center</CardTitle>
                            <CardDescription className="text-xs">Choose a center first.</CardDescription>
                            <div className="relative mt-2">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search centers..." className="pl-8" value={centerSearchQuery} onChange={(e) => setCenterSearchQuery(e.target.value)} />
                            </div>
                        </CardHeader>
                        <CardContent className="max-h-[28vh] overflow-y-auto">
                            <div className="flex flex-col gap-2">
                                {filteredCenters.map((center) => (
                                    <Button
                                        key={center.id}
                                        type="button"
                                        variant={selectedCenterId === center.id ? 'default' : 'outline'}
                                        onClick={() => setSelectedCenterId(center.id)}
                                        className="w-full justify-start"
                                    >
                                        {center.name}
                                    </Button>
                                ))}
                                {filteredCenters.length === 0 && (
                                    <p className="text-center text-sm text-muted-foreground py-4">No centers found. Add centers under Centers and groups.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    <Card className={!selectedCenterId ? 'opacity-80' : ''}>
                        <CardHeader>
                            <CardTitle>2. Group</CardTitle>
                            <CardDescription className="text-xs">
                                {selectedCenterId ? `Groups in ${selectedCenterName || 'this center'}.` : 'Select a center to list groups.'}
                            </CardDescription>
                            <div className="relative mt-2">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search groups..."
                                    className="pl-8"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    disabled={!selectedCenterId}
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="max-h-[32vh] overflow-y-auto">
                            <div className="flex flex-col gap-2">
                                {selectedCenterId &&
                                    filteredGroups.map((group) => (
                                        <Button
                                            key={group.id}
                                            type="button"
                                            variant={selectedGroupId === group.id ? 'default' : 'outline'}
                                            onClick={() => handleGroupSelection(group.id)}
                                            className="w-full justify-start"
                                        >
                                            {group.name}
                                        </Button>
                                    ))}
                                {selectedCenterId && filteredGroups.length === 0 && (
                                    <p className="text-center text-sm text-muted-foreground py-4">No groups in this center.</p>
                                )}
                                {!selectedCenterId && (
                                    <p className="text-center text-sm text-muted-foreground py-4">Select a center first.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                3. Record Collections
                                {selectedGroupName ? (
                                    <span className="block text-base font-normal text-muted-foreground mt-1">
                                        {selectedCenterName && `${selectedCenterName} · `}
                                        {selectedGroupName}
                                    </span>
                                ) : (
                                    <span className="block text-base font-normal text-muted-foreground mt-1">Select a center, then a group</span>
                                )}
                            </CardTitle>
                            <div className="flex justify-between items-center mt-2">
                                <CardDescription>
                                    Choose the <strong>actual payment date</strong> (last {PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS} days,
                                    Africa/Nairobi). Due amounts and prepayment use this date. Sundays and holidays are blocked.
                                </CardDescription>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={'outline'} className={`w-[240px] justify-start text-left font-normal ${isForbiddenDate ? 'border-red-500 text-red-500' : ''}`}>
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {selectedDate ? formatDate(selectedDate, 'PPP') : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="end">
                                        <Calendar
                                            mode="single"
                                            selected={selectedDate}
                                            onSelect={(d) => d && setSelectedDate(d)}
                                            initialFocus
                                            disabled={(date) => {
                                                const d = formatInTimeZone(date, EAT_TIMEZONE, 'yyyy-MM-dd');
                                                const today = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
                                                const minD = formatInTimeZone(
                                                    subDays(getTodayEATDateForForm(), PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS),
                                                    EAT_TIMEZONE,
                                                    'yyyy-MM-dd'
                                                );
                                                if (d > today) return true;
                                                if (d < minD) return true;
                                                return isSundayInTimeZone(date, EAT_TIMEZONE) || isHoliday(date);
                                            }}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </CardHeader>
                        <CardContent>
                             {!selectedCenterId ? (
                                <div className="text-center py-10 text-muted-foreground">Select a <strong>center</strong> on the left, then a <strong>group</strong> to record repayments.</div>
                             ) : !selectedGroupId ? (
                                <div className="text-center py-10 text-muted-foreground">Select a <strong>group</strong> under this center to continue.</div>
                             ) : isForbiddenDate ? (
                                <div className="text-center py-10 text-red-500 flex flex-col items-center gap-2"><Ban className="h-10 w-10" /><p>Repayments are not allowed on Sundays or public holidays. Please select a working day.</p></div>
                             ) : loading ? (
                                <div className="text-center py-10 text-gray-500"><Loader2 className="h-8 w-8 animate-spin" /></div>
                             ) : groupMembers.length > 0 ? (
                                <>
                                    <div className="flex justify-between items-center mb-4">
                                        <p className="text-sm text-muted-foreground">
                                            Showing due amounts for {formatDate(selectedDate, 'PPP')}. Payments must be
                                            multiples of the installment amount; minimum is one installment.
                                        </p>
                                        <Button size="sm" variant="outline" onClick={handleCopyAllAmounts} className="text-blue-600 border-blue-200 hover:bg-blue-50">
                                            <ArrowDownToLine className="mr-2 h-4 w-4" />
                                            Copy All Total Collections
                                        </Button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    {[
                                                        <TableHead key="no">No.</TableHead>,
                                                        <TableHead key="name">Client Name</TableHead>,
                                                        <TableHead key="past">Arears</TableHead>,
                                                        <TableHead key="today">Today Collection</TableHead>,
                                                        <TableHead key="total">Total Collections</TableHead>,
                                                        <TableHead key="paid" className="w-48">
                                                            Amount Paid
                                                        </TableHead>,
                                                    ]}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {pagedGroupMembers.map((member, index) => {
                                                    const rowErr = memberRepaymentAmountError(
                                                        repaymentAmounts[member.borrowerId],
                                                        member,
                                                        currency,
                                                    );
                                                    return (
                                                        <TableRow key={member.borrowerId}>
                                                            <TableCell>{(memberPage - 1) * PAGE_SIZE + index + 1}</TableCell>
                                                            <TableCell>{member.name}</TableCell>
                                                            <TableCell>
                                                                {currency}{' '}
                                                                {member.pastDueAmount.toLocaleString(undefined, {
                                                                    minimumFractionDigits: 2,
                                                                    maximumFractionDigits: 2,
                                                                })}
                                                            </TableCell>
                                                            <TableCell>
                                                                {currency}{' '}
                                                                {member.amountDueToday.toLocaleString(undefined, {
                                                                    minimumFractionDigits: 2,
                                                                    maximumFractionDigits: 2,
                                                                })}
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-2 font-semibold">
                                                                    <span>
                                                                        {currency}{' '}
                                                                        {member.totalDue.toLocaleString(undefined, {
                                                                            minimumFractionDigits: 2,
                                                                            maximumFractionDigits: 2,
                                                                        })}
                                                                    </span>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-6 w-6 text-gray-400 hover:text-blue-600"
                                                                                onClick={() =>
                                                                                    handleCopyAmount(
                                                                                        member.borrowerId,
                                                                                        member.totalDue,
                                                                                        member.installmentUnit,
                                                                                    )
                                                                                }
                                                                            >
                                                                                <Copy className="h-3 w-3" />
                                                                            </Button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>
                                                                            <p>Copy total collections</p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="space-y-1 min-w-[10rem]">
                                                                    <Input
                                                                        type="number"
                                                                        step="0.01"
                                                                        min="0.01"
                                                                        placeholder="0.00"
                                                                        value={repaymentAmounts[member.borrowerId] ?? ''}
                                                                        aria-invalid={rowErr ? true : undefined}
                                                                        className={cn(rowErr && 'border-destructive')}
                                                                        onChange={(e) =>
                                                                            handleAmountChange(member.borrowerId, e.target.value)
                                                                        }
                                                                    />
                                                                    {rowErr ? (
                                                                        <p
                                                                            className="text-xs text-destructive leading-snug"
                                                                            role="alert"
                                                                        >
                                                                            {rowErr}
                                                                        </p>
                                                                    ) : null}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                            <TableFooter>
                                                <TableRow>
                                                    {[
                                                        <TableCell key="ft1" className="font-bold text-lg">
                                                            Total
                                                        </TableCell>,
                                                        <TableCell key="ft2" className="font-bold text-lg">
                                                            {groupMembers.length}
                                                        </TableCell>,
                                                        <TableCell key="ft3" className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.pastDue.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>,
                                                        <TableCell key="ft4" className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.dueToday.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>,
                                                        <TableCell key="ft5" className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.totalDue.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>,
                                                        <TableCell key="ft6" className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.totalPaid.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>,
                                                    ]}
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