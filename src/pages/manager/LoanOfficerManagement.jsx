import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Loader2, Trash2, Edit, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

const PAGE_SIZE = 25;

const LoanOfficerManagement = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  
  const [officers, setOfficers] = useState([]);
  /** From public.users — source of truth (JWT user_metadata.branch_id is often missing or stale). */
  const [managerBranchId, setManagerBranchId] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState(null);
  const [formData, setFormData] = useState({ full_name: '', email: '', password: '' });
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProfileLoading(true);
      if (!user?.id) {
        setManagerBranchId(null);
        setProfileLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('users')
        .select('branch_id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error(error);
        setManagerBranchId(null);
        setProfileLoading(false);
        return;
      }
      if (data?.role !== 'manager') {
        setManagerBranchId(null);
        setProfileLoading(false);
        return;
      }
      setManagerBranchId(data.branch_id ?? null);
      setProfileLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const fetchOfficers = useCallback(async () => {
    if (!user) {
      setOfficers([]);
      setLoading(false);
      return;
    }
    if (profileLoading) return;
    if (!managerBranchId) {
      setOfficers([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'officer')
      .eq('branch_id', managerBranchId);

    if (error) {
      toast({ title: 'Error', description: 'Failed to fetch loan officers.', variant: 'destructive' });
      console.error(error);
    } else {
      setOfficers(data);
    }
    setLoading(false);
  }, [user, managerBranchId, profileLoading, toast]);

  useEffect(() => {
    fetchOfficers();
  }, [fetchOfficers]);

  useEffect(() => {
    setPage(1);
  }, [officers.length]);

  const pagedOfficers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return officers.slice(start, start + PAGE_SIZE);
  }, [officers, page]);

  const totalPages = Math.max(1, Math.ceil(officers.length / PAGE_SIZE));

  const handleOpenDialog = (officer = null) => {
    if (officer) {
      setEditingOfficer(officer);
      setFormData({
        full_name: officer.full_name,
        email: officer.email,
        password: '', // Clear password for reset
      });
    } else {
      setEditingOfficer(null);
      setFormData({ full_name: '', email: '', password: '' });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    let error;

    if (editingOfficer) {
      if (!formData.password) {
        toast({ title: 'Error', description: 'Please enter a new password to reset.', variant: 'destructive' });
        setSaving(false);
        return;
      }
      const { error: invokeError } = await invokeEdgeFunction(
        'update-user',
        {
          body: {
            userId: editingOfficer.id,
            password: formData.password,
          },
        },
        session?.access_token,
      );
      error = invokeError;
    } else { // Creating a new user
      if (!formData.full_name || !formData.email || !formData.password) {
        toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
        setSaving(false);
        return;
      }
      if (!managerBranchId) {
        toast({
          title: 'Branch missing',
          description: 'Your account has no branch in the database. Ask an admin to assign a branch, then sign out and sign in again.',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      const { error: invokeError } = await invokeEdgeFunction(
        'create-user',
        {
          body: {
            full_name: formData.full_name.trim(),
            email: formData.email.trim().toLowerCase(),
            password: formData.password,
            role: 'officer',
            branch_id: managerBranchId,
          },
        },
        session?.access_token,
      );
      error = invokeError;
    }

    setSaving(false);
    if (error) {
      const errorData = error.context ? await error.context.json() : { error: error.message };
      toast({ title: `Error ${editingOfficer ? 'updating' : 'creating'} officer`, description: errorData.error, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Officer ${editingOfficer ? 'password reset' : 'registered'} successfully.` });
      setDialogOpen(false);
      fetchOfficers();
    }
  };

  const handleDelete = async (officerId) => {
    const { error } = await invokeEdgeFunction('delete-user', { body: { userId: officerId } }, session?.access_token);
    
    if (error) {
      const errorData = error.context ? await error.context.json() : { error: error.message };
      toast({ title: 'Error', description: `Failed to delete officer: ${errorData.error}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Loan Officer deleted successfully.' });
      fetchOfficers();
    }
  };
  
  const getBadgeVariant = (isActive) => {
    return isActive ? 'success' : 'destructive';
  }

  const isCreateFlow = !editingOfficer;

  return (
    <DashboardLayout title="Loan Officer Management">
      {!profileLoading && user && !managerBranchId && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          Your manager account has no branch assigned in the system. An admin must set your branch in User Management, then you should sign out and sign in again before registering officers.
        </div>
      )}
      <div className="mb-6 flex justify-end">
        <Button onClick={() => handleOpenDialog()} disabled={!managerBranchId}>
          <PlusCircle className="mr-2 h-4 w-4" /> Register Officer
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingOfficer ? `Edit Officer: ${editingOfficer.full_name}` : 'Register New Loan Officer'}</DialogTitle>
            {editingOfficer && <CardDescription>You can only reset the password for this user.</CardDescription>}
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="officer-name">Name</Label>
              <Input id="officer-name" placeholder="John Doe" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} disabled={!isCreateFlow} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="officer-email">Email</Label>
              <Input id="officer-email" type="email" placeholder="officer@example.com" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={!isCreateFlow} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="officer-password">Password</Label>
              <Input id="officer-password" type="password" placeholder={editingOfficer ? 'Enter new password to reset' : '••••••••'} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingOfficer ? 'Reset Password' : 'Register Officer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader><CardTitle>Your Loan Officers</CardTitle></CardHeader>
        <CardContent>
            {loading ? <div className="text-center p-8">Loading officers...</div> :
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {officers.length > 0 ? pagedOfficers.map(officer => (
                    <TableRow key={officer.id}>
                      <TableCell>{officer.full_name}</TableCell>
                      <TableCell>{officer.email}</TableCell>
                      <TableCell><Badge variant={getBadgeVariant(officer.is_active)}>{officer.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                      <TableCell className="space-x-2">
                        <Button variant="outline" size="icon" onClick={() => handleOpenDialog(officer)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the loan officer. Make sure they have no associated data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(officer.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                )) : (
                    <TableRow>
                        <TableCell colSpan={4} className="text-center">No loan officers found for this branch.</TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
            }
            {!loading && officers.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, officers.length)} of {officers.length}
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

export default LoanOfficerManagement;