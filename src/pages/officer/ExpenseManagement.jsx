import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format as formatDate } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PAGE_SIZE = 25;

const ExpenseManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [expenses, setExpenses] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [formData, setFormData] = useState({
        expense_type: 'transport',
        amount: '',
        description: '',
        expense_date: formatDate(new Date(), 'yyyy-MM-dd')
    });

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

    useEffect(() => {
        fetchExpenses();
    }, [fetchExpenses]);

    useEffect(() => {
        setPage(1);
    }, [expenses.length]);

    const pagedExpenses = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return expenses.slice(start, start + PAGE_SIZE);
    }, [expenses, page]);

    const totalPages = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));
    
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
    
    const getStatusBadge = (status) => {
        // The 'status' column is not in the 'expenses' table schema provided.
        // This is a placeholder for future implementation.
        return 'default'; 
    };

    return (
        <DashboardLayout title="Expense Management">
            <div className="mb-6 flex justify-end">
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button onClick={() => setFormData({ expense_type: 'transport', amount: '', description: '', expense_date: formatDate(new Date(), 'yyyy-MM-dd') })}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Submit Expense
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Submit New Expense</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmitExpense} className="space-y-4 py-4">
                             <Select value={formData.expense_type} onValueChange={value => setFormData({ ...formData, expense_type: value })}>
                                <SelectTrigger><SelectValue placeholder="Select expense type" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="transport">Transport</SelectItem>
                                    <SelectItem value="office">Office Supplies</SelectItem>
                                    <SelectItem value="communication">Communication</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                            <Input type="number" placeholder={`Amount (${currency})`} value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} required />
                            <Input type="date" value={formData.expense_date} onChange={e => setFormData({ ...formData, expense_date: e.target.value })} required />
                            <Textarea placeholder="Description" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} required />
                            <Button type="submit" className="w-full">Submit</Button>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>
            <Card>
                <CardHeader><CardTitle>My Expenses</CardTitle></CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Description</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan="4" className="text-center">Loading...</TableCell></TableRow>
                            ) : expenses.length > 0 ? (
                                pagedExpenses.map(e => (
                                    <TableRow key={e.id}>
                                        <TableCell>{formatDate(new Date(e.expense_date), 'PPP')}</TableCell>
                                        <TableCell className="capitalize">{e.expense_type}</TableCell>
                                        <TableCell>{currency} {e.amount.toLocaleString()}</TableCell>
                                        <TableCell>{e.description}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow><TableCell colSpan="4" className="text-center">No expenses found.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                    {!loading && expenses.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
                            <p className="text-sm text-muted-foreground">
                                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, expenses.length)} of {expenses.length}
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
                </CardContent>
            </Card>
        </DashboardLayout>
    );
};

export default ExpenseManagement;