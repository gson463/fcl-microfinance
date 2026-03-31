import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { PlusCircle, Edit, Trash2, RotateCw, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { getEdgeInvokeFailure } from '@/lib/edgeInvokeError';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const PAGE_SIZE = 25;

const UserManagement = () => {
  const { session } = useAuth();
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(1);
  const [branches, setBranches] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ full_name: '', email: '', password: '', role: '', branch_id: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data: usersData, error: usersError, count } = await supabase
      .from('users')
      .select(
        'id, full_name, email, role, branch_id, phone_number, is_active, created_at, branches(name)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);
      
    if (usersError) {
      toast({ title: 'Error', description: 'Could not fetch users.', variant: 'destructive' });
      setUsers([]);
      setTotalUsers(0);
    } else {
      setUsers(usersData || []);
      setTotalUsers(count ?? 0);
    }
    
    const { data: branchesData, error: branchesError } = await supabase
      .from('branches')
      .select('id, name');

    if (branchesError) {
      toast({ title: 'Error', description: 'Could not fetch branches.', variant: 'destructive' });
    } else {
      setBranches(branchesData);
    }
    setIsLoading(false);
  }, [toast, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenDialog = (user = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({ 
        full_name: user.full_name, 
        email: user.email, 
        password: '', // Reset password field
        role: user.role, 
        branch_id: user.branch_id || '' 
      });
    } else { // For creating a new user
      setEditingUser(null);
      setFormData({ full_name: '', email: '', password: '', role: '', branch_id: '' });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    let error;

    if (editingUser) {
        if (!formData.password) {
            toast({ title: 'Error', description: 'Please enter a new password to reset.', variant: 'destructive' });
            setIsSaving(false);
            return;
        }
        const { error: invokeError } = await invokeEdgeFunction(
          'update-user',
          {
            body: {
              userId: editingUser.id,
              password: formData.password,
            },
          },
          session?.access_token,
        );
        error = invokeError;

    } else { // Creating a new user
        if (!formData.full_name || !formData.email || !formData.role ) {
          toast({ title: 'Error', description: 'Please fill name, email and role.', variant: 'destructive' });
           setIsSaving(false);
          return;
        }
        if (formData.role !== 'admin' && !formData.branch_id) {
          toast({ title: 'Error', description: 'Please assign a branch for non-admin users.', variant: 'destructive' });
           setIsSaving(false);
          return;
        }
        if (!formData.password) {
            toast({ title: 'Error', description: 'Password is required for new users.', variant: 'destructive' });
             setIsSaving(false);
            return;
        }
       const { error: invokeError } = await invokeEdgeFunction(
        'create-user',
        {
          body: {
            full_name: formData.full_name.trim(),
            email: formData.email.trim().toLowerCase(),
            password: formData.password,
            role: formData.role,
            branch_id: formData.role === 'admin' ? null : formData.branch_id,
          },
        },
        session?.access_token,
      );
      error = invokeError;
    }

    if (error) {
        const errorData = error.context ? await error.context.json() : { error: error.message };
        toast({ title: `Error ${editingUser ? 'updating' : 'creating'} user`, description: errorData.error, variant: 'destructive' });
    } else {
        toast({ title: 'Success', description: `User ${editingUser ? 'updated' : 'created'} successfully.` });
        setDialogOpen(false);
        fetchData();
    }

    setIsSaving(false);
  };

  const handleDelete = async (userId) => {
    const result = await invokeEdgeFunction('delete-user', { body: { userId } }, session?.access_token);
    const fail = await getEdgeInvokeFailure(result);
    if (fail) {
      const { error: auditErr } = await supabase.rpc('log_audit_event', {
        p_action: 'user.delete.failed',
        p_entity_type: 'user',
        p_entity_id: String(userId),
        p_metadata: {
          stage: fail.stage || null,
          error: fail.message,
        },
      });
      if (auditErr) console.debug('[audit]', auditErr.message);
      toast({
        title: 'Could not delete user',
        description: fail.message,
        variant: 'destructive',
      });
      return;
    }
    const { error: auditOkErr } = await supabase.rpc('log_audit_event', {
      p_action: 'user.delete.success',
      p_entity_type: 'user',
      p_entity_id: String(userId),
      p_metadata: {},
    });
    if (auditOkErr) console.debug('[audit]', auditOkErr.message);
    toast({ title: 'Success', description: 'User deleted successfully.' });
    fetchData();
  };

  const handleDeleteAllOtherUsers = async () => {
    const { data, error } = await invokeEdgeFunction('delete-all-other-users', {}, session?.access_token);

    if (error) {
        toast({
            title: 'Error Deleting Users',
            description: error.message || 'An unexpected error occurred.',
            variant: 'destructive',
        });
    } else {
        const deleted = data?.deleted_count ?? 0;
        const skipData = data?.skipped_associated ?? 0;
        const skipAdmin = data?.skipped_admin ?? 0;
        const parts = [`${deleted} user(s) deleted.`];
        if (skipData > 0) parts.push(`${skipData} skipped (still linked to loans, borrowers, or other records).`);
        if (skipAdmin > 0) parts.push(`${skipAdmin} admin account(s) skipped.`);
        toast({
            title: 'Action complete',
            description: parts.join(' '),
        });
        fetchData(); // Refresh the user list
    }
    setDeleteConfirmation('');
  };


  const userIds = useMemo(() => users.map((u) => u.id), [users]);
  const bulk = useBulkSelection(userIds);

  const exportSelectedCsv = () => {
    const rows = users.filter((u) => bulk.isSelected(u.id));
    if (rows.length === 0) return;
    exportObjectsToCsv(`users_${Date.now()}.csv`, [
      { header: 'Name', accessor: 'full_name' },
      { header: 'Email', accessor: 'email' },
      { header: 'Role', accessor: 'role' },
      { header: 'Branch', accessor: (r) => r.branches?.name || '' },
    ], rows);
    toast({ title: 'Exported', description: `${rows.length} user(s) to CSV.` });
  };

  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case 'admin': return 'destructive';
      case 'manager': return 'success';
      case 'officer': return 'warning';
      default: return 'secondary';
    }
  };
  
  const isEditDisabled = (user) => {
    return user.role === 'admin';
  };
  
  const isCreateFlow = !editingUser;

  return (
    <DashboardLayout title="User Management">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete All Other Users
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center">
                    <ShieldAlert className="text-red-500 mr-2 h-6 w-6" />
                    EXTREME DANGER: Are you absolutely sure?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This is a highly destructive and irreversible action. It will permanently delete ALL users except for <strong>admin@mukwanoloans.com</strong>. All associated data for the deleted users (loans, borrowers, etc.) will also be removed by database triggers.
                    <br /><br />
                    To confirm, please type <strong>DELETE</strong> in the box below.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                    id="delete-confirm"
                    value={deleteConfirmation}
                    onChange={(e) => setDeleteConfirmation(e.target.value)}
                    placeholder='Type DELETE to confirm'
                    className="mt-4"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAllOtherUsers}
                    disabled={deleteConfirmation !== 'DELETE'}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Yes, Delete All Other Users
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenDialog()}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Add User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingUser ? `Edit User: ${editingUser.full_name}` : 'Add New User'}</DialogTitle>
                  <DialogDescription className="sr-only">
                    Create a new user or reset an existing user password. Assign role and branch where applicable.
                  </DialogDescription>
                  {editingUser && <CardDescription>You can only reset the password for this user. Role and branch are shown for reference.</CardDescription>}
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name</Label>
                    <Input id="full_name" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} disabled={!isCreateFlow}/>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} disabled={!isCreateFlow} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" placeholder={editingUser ? 'Enter new password to reset' : ''} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                  </div>
                  {!isCreateFlow && editingUser ? (
                    <>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                          <Badge variant={getRoleBadgeVariant(editingUser.role)} className="capitalize">
                            {editingUser.role || '—'}
                          </Badge>
                          <span className="text-xs text-muted-foreground">Loan officers are managed from the branch manager&apos;s screen.</span>
                        </div>
                      </div>
                      {editingUser.role && editingUser.role !== 'admin' && (
                        <div className="space-y-2">
                          <Label>Branch</Label>
                          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                            {editingUser.branches?.name || '—'}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value, branch_id: value === 'admin' ? '' : formData.branch_id })} disabled={!isCreateFlow}>
                          <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {formData.role && formData.role !== 'admin' && (
                        <div className="space-y-2">
                          <Label htmlFor="branch">Assign Branch</Label>
                          <Select value={formData.branch_id} onValueChange={(value) => setFormData({ ...formData, branch_id: value })} disabled={!isCreateFlow}>
                            <SelectTrigger><SelectValue placeholder="Select a branch" /></SelectTrigger>
                            <SelectContent>
                              {branches.map(branch => (
                                <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </>
                  )}
                  <Button onClick={handleSave} className="w-full" disabled={isSaving}>
                    {isSaving ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : (editingUser ? 'Reset Password' : 'Create User')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Users ({totalUsers.toLocaleString()})</CardTitle>
            <CardDescription>A list of all users in the system.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Users...</span>
              </div>
            ) : (
              <>
              <BulkDataTableToolbar
                selectedCount={bulk.count}
                onClear={bulk.clear}
                onExportCsv={exportSelectedCsv}
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
                        onCheckedChange={() => bulk.toggleAll()}
                        aria-label="Select all on this page"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(user => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Checkbox
                          checked={bulk.isSelected(user.id)}
                          onCheckedChange={() => bulk.toggle(user.id)}
                          aria-label={`Select ${user.full_name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{user.full_name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell><Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge></TableCell>
                      <TableCell>{user.branches?.name || 'N/A'}</TableCell>
                      <TableCell className="space-x-2">
                        <Button variant="outline" size="icon" onClick={() => handleOpenDialog(user)} disabled={isEditDisabled(user)}><Edit className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon" disabled={user.role === 'admin'}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the user.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(user.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </>
            )}
            {!isLoading && users.length === 0 && (
              <div className="text-center py-10 text-gray-500">
                No users found. Start by adding a new user.
              </div>
            )}
            {!isLoading && totalUsers > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                <p className="text-sm text-neutral-600">
                  Page {page} of {Math.max(1, Math.ceil(totalUsers / PAGE_SIZE))} · {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalUsers)} of {totalUsers}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= Math.max(1, Math.ceil(totalUsers / PAGE_SIZE))}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
};

export default UserManagement;