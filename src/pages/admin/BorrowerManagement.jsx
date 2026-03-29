import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Edit, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const PAGE_SIZE = 25;

const AdminBorrowerManagement = () => {
    const { toast } = useToast();
    const [borrowers, setBorrowers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [editingBorrower, setEditingBorrower] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [page, setPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
        return () => clearTimeout(t);
    }, [searchQuery]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, statusFilter]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let q = supabase
            .from('borrowers')
            .select('*, users (full_name), branches (name), groups (name)', { count: 'exact' });

        if (statusFilter !== 'all') {
            q = q.eq('status', statusFilter);
        }

        if (debouncedSearch) {
            const s = debouncedSearch.replace(/%/g, '\\%').replace(/,/g, '\\,');
            q = q.or(
                `first_name.ilike.%${s}%,surname.ilike.%${s}%,borrower_id.ilike.%${s}%,phone_number.ilike.%${s}%`
            );
        }

        const { data, error, count } = await q
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            toast({ title: 'Error fetching borrowers', description: error.message, variant: 'destructive' });
            setBorrowers([]);
            setTotalCount(0);
        } else {
            setBorrowers(data || []);
            setTotalCount(count ?? 0);
        }
        setLoading(false);
    }, [toast, page, debouncedSearch, statusFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleEditStatus = (borrower) => {
        setEditingBorrower(borrower);
    };

    const handleUpdateStatus = async (newStatus) => {
        if (!editingBorrower) return;
        setIsSaving(true);
        
        const { error } = await supabase
            .from('borrowers')
            .update({ status: newStatus })
            .eq('id', editingBorrower.id);

        setIsSaving(false);
        if (error) {
            toast({ title: 'Error updating status', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Success', description: 'Borrower status updated.' });
            setEditingBorrower(null);
            fetchData();
        }
    };
    
    const getLoanStatusBadge = (status) => {
        const statusMap = {
            'eligible': 'success',
            'active': 'default',
            'active_loan': 'warning',
            'defaulted': 'destructive',
            'paid_up': 'default',
        };
        return statusMap[status] || 'secondary';
    };

    const getStatusText = (status) => {
        const statusTextMap = {
            'eligible': 'Eligible',
            'active': 'Active',
            'active_loan': 'Active Loan',
            'defaulted': 'Defaulted',
            'paid_up': 'Paid Up',
        };
        return statusTextMap[status] || status;
    };

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    if (loading && borrowers.length === 0) {
        return (
            <DashboardLayout title="All Borrowers">
                <div className="flex justify-center items-center h-full py-24">
                    <Loader2 className="h-8 w-8 animate-spin text-brand-gold" />
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout title="All Borrowers">
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                        <CardTitle>All System Borrowers ({totalCount.toLocaleString()})</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                            <Input 
                                placeholder="Search by name, ID, phone..." 
                                value={searchQuery} 
                                onChange={(e) => setSearchQuery(e.target.value)} 
                                className="w-full md:w-80" 
                            />
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by Status" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Statuses</SelectItem>
                                    <SelectItem value="eligible">Eligible</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="active_loan">Active Loan</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="paid_up">Paid Up</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading && (
                        <div className="flex justify-center py-6">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    )}
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Borrower ID</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Branch</TableHead>
                                <TableHead>Loan Officer</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {borrowers.map(b => (
                                <TableRow key={b.id}>
                                    <TableCell>{b.borrower_id}</TableCell>
                                    <TableCell>{b.first_name} {b.surname}</TableCell>
                                    <TableCell>{b.branches?.name || 'N/A'}</TableCell>
                                    <TableCell>{b.users?.full_name || 'N/A'}</TableCell>
                                    <TableCell><Badge variant={getLoanStatusBadge(b.status)}>{getStatusText(b.status)}</Badge></TableCell>
                                    <TableCell>
                                        <Button variant="outline" size="icon" onClick={() => handleEditStatus(b)}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>

                    {totalCount > 0 && (
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                            <p className="text-sm text-neutral-600">
                                Page {page} of {totalPages} · {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!editingBorrower} onOpenChange={(isOpen) => !isOpen && setEditingBorrower(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Update Borrower Status</DialogTitle>
                        <DialogDescription>
                            Manually change the status for {editingBorrower?.first_name} {editingBorrower?.surname}. Use with caution.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="status-select" className="text-right">Status</Label>
                            <Select
                                id="status-select"
                                defaultValue={editingBorrower?.status}
                                onValueChange={(newStatus) => handleUpdateStatus(newStatus)}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select a status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="eligible">Eligible</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="active_loan">Active Loan</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="paid_up">Paid Up</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                     {isSaving && <div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin"/></div>}
                </DialogContent>
            </Dialog>

        </DashboardLayout>
    );
};

export default AdminBorrowerManagement;
