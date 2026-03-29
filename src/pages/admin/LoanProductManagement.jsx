import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Edit, Trash2, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
} from "@/components/ui/alert-dialog";
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';

const LoanProductManagement = () => {
  const [products, setProducts] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [currency, setCurrency] = useState('TZS');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    interest_rate: '',
    repayment_frequency: 'weekly',
    loan_period: '',
    loan_period_unit: 'months',
    min_amount: '',
    max_amount: '',
    status: 'active',
  });
  const { toast } = useToast();

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('loan_products').select('*').order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Error', description: 'Could not fetch loan products.', variant: 'destructive' });
    } else {
      setProducts(data);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchProducts();
    // Fetch currency from system_config
    const fetchCurrency = async () => {
        const { data, error } = await supabase
            .from('system_config')
            .select('value')
            .eq('key', 'currency')
            .single();
        if (data && data.value) {
            setCurrency(data.value);
        }
    };
    fetchCurrency();
  }, [fetchProducts]);

  const handleSave = async () => {
    const { name, interest_rate, repayment_frequency, loan_period, min_amount, max_amount } = formData;
    if (!name || !interest_rate || !repayment_frequency || !loan_period || !min_amount || !max_amount) {
      toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);

    let result;
    if (editingProduct) {
      result = await supabase.from('loan_products').update(formData).eq('id', editingProduct.id);
    } else {
      result = await supabase.from('loan_products').insert([formData]);
    }

    if (result.error) {
      toast({ title: 'Error', description: `Failed to save product: ${result.error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Loan product ${editingProduct ? 'updated' : 'created'}.` });
      setDialogOpen(false);
      setEditingProduct(null);
      fetchProducts();
    }
    setIsSaving(false);
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      interest_rate: product.interest_rate,
      repayment_frequency: product.repayment_frequency,
      loan_period: product.loan_period,
      loan_period_unit: product.loan_period_unit,
      min_amount: product.min_amount,
      max_amount: product.max_amount,
      status: product.status,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (productId) => {
    const { error } = await supabase.from('loan_products').delete().eq('id', productId);
    if (error) {
      toast({ title: 'Error', description: `Failed to delete product: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Loan product deleted.' });
      fetchProducts();
    }
  };

  const getBadgeVariant = (status) => {
    if (status === 'active') return 'success';
    if (status === 'inactive') return 'secondary';
    return 'default';
  };

  const filteredProducts = products.filter(p => {
    if (filterStatus === 'all') return true;
    return p.status === filterStatus;
  });

  const resetForm = () => {
    setFormData({
      name: '',
      interest_rate: '',
      repayment_frequency: 'weekly',
      loan_period: '',
      loan_period_unit: 'months',
      min_amount: '',
      max_amount: '',
      status: 'active',
    });
  };

  return (
    <DashboardLayout title="Loan Products">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mb-6 flex justify-end">
          <Dialog open={dialogOpen} onOpenChange={(isOpen) => {
            if (!isOpen) {
              setEditingProduct(null);
              resetForm();
            }
            setDialogOpen(isOpen);
          }}>
            <DialogTrigger asChild>
              <Button onClick={() => { setEditingProduct(null); resetForm(); }}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add Product
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingProduct ? 'Edit' : 'New'} Loan Product</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <Input placeholder="Product Name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                <Input type="number" placeholder="Interest Rate (%)" value={formData.interest_rate} onChange={e => setFormData({ ...formData, interest_rate: e.target.value })} />
                <Select value={formData.repayment_frequency} onValueChange={value => setFormData({ ...formData, repayment_frequency: value })}>
                  <SelectTrigger><SelectValue placeholder="Repayment Frequency" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input type="number" placeholder="Loan Period" value={formData.loan_period} onChange={e => setFormData({ ...formData, loan_period: e.target.value })} />
                  <Select value={formData.loan_period_unit} onValueChange={value => setFormData({ ...formData, loan_period_unit: value })}>
                    <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="months">Months</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Input type="number" placeholder={`Min Amount (${currency})`} value={formData.min_amount} onChange={e => setFormData({ ...formData, min_amount: e.target.value })} />
                  <Input type="number" placeholder={`Max Amount (${currency})`} value={formData.max_amount} onChange={e => setFormData({ ...formData, max_amount: e.target.value })} />
                </div>
                <Select value={formData.status} onValueChange={value => setFormData({ ...formData, status: value })}>
                  <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleSave} className="w-full" disabled={isSaving}>
                  {isSaving ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : (editingProduct ? 'Save Changes' : 'Create Product')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mb-4">
          <Label>Filter by Status:</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px] mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Loan Products</CardTitle>
            <CardDescription>A list of all loan products available in the system.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Products...</span>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Interest (%)</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Amount Range ({currency})</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.interest_rate}%</TableCell>
                      <TableCell className="capitalize">{p.loan_period} {p.loan_period_unit}</TableCell>
                      <TableCell>{p.min_amount} - {p.max_amount}</TableCell>
                      <TableCell>
                        <Badge variant={getBadgeVariant(p.status)}>{p.status}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button variant="outline" size="icon" onClick={() => handleEdit(p)}><Edit className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the loan product. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(p.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!isLoading && filteredProducts.length === 0 && (
              <div className="text-center py-10 text-gray-500">
                No loan products found. Start by adding a new product.
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
};

export default LoanProductManagement;