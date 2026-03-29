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
import { motion } from 'framer-motion';
import { PlusCircle, Edit, Trash2, RotateCw } from 'lucide-react';
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

const BranchManagement = () => {
  const [branches, setBranches] = useState([]);
  const [managers, setManagers] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [formData, setFormData] = useState({ name: '', location: '' });
  const [assignedManager, setAssignedManager] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const fetchBranchesAndManagers = useCallback(async () => {
    setIsLoading(true);
    const { data: branchesData, error: branchesError } = await supabase
      .from('branches')
      .select('*, users(id, full_name, role)'); // Select role to filter managers
      
    if (branchesError) {
      toast({ title: 'Error', description: 'Could not fetch branches.', variant: 'destructive' });
    } else {
      setBranches(branchesData);
    }
    
    const { data: managersData, error: managersError } = await supabase
      .from('users')
      .select('id, full_name, branch_id')
      .eq('role', 'manager');

    if (managersError) {
      toast({ title: 'Error', description: 'Could not fetch managers.', variant: 'destructive' });
    } else {
      setManagers(managersData);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchBranchesAndManagers();
  }, [fetchBranchesAndManagers]);

  const handleOpenDialog = (branch = null) => {
    if (branch) {
      setEditingBranch(branch);
      setFormData({ name: branch.name, location: branch.location });
      const manager = branch.users.find(u => u.role === 'manager');
      setAssignedManager(manager ? manager.id : 'unassigned'); // Use 'unassigned' for no manager
    } else {
      setEditingBranch(null);
      setFormData({ name: '', location: '' });
      setAssignedManager('unassigned'); // Use 'unassigned' for no manager
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.location) {
      toast({ title: 'Error', description: 'Please fill all required fields.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    
    let branchId;

    if (editingBranch) {
      const { data, error } = await supabase
        .from('branches')
        .update({ name: formData.name, location: formData.location })
        .eq('id', editingBranch.id)
        .select()
        .single();
      if (error) {
        toast({ title: 'Error', description: `Failed to update branch: ${error.message}`, variant: 'destructive' });
        setIsSaving(false);
        return;
      }
      branchId = data.id;
    } else {
      const { data, error } = await supabase
        .from('branches')
        .insert({ name: formData.name, location: formData.location })
        .select()
        .single();
      if (error) {
        toast({ title: 'Error', description: `Failed to create branch: ${error.message}`, variant: 'destructive' });
        setIsSaving(false);
        return;
      }
      branchId = data.id;
    }
    
    // Get current manager for the branch
    const currentBranchManager = managers.find(m => m.branch_id === branchId);
    const currentManagerId = currentBranchManager ? currentBranchManager.id : null;
    
    // If a manager was previously assigned to this branch and is now different or unassigned
    if (currentManagerId && currentManagerId !== assignedManager) {
        await supabase.from('users').update({ branch_id: null }).eq('id', currentManagerId);
    }

    // Assign new manager if one is selected
    if (assignedManager !== 'unassigned' && assignedManager !== currentManagerId) {
       await supabase.from('users').update({ branch_id: branchId }).eq('id', assignedManager);
    }

    toast({ title: 'Success', description: `Branch ${editingBranch ? 'updated' : 'created'} successfully.` });
    setIsSaving(false);
    setDialogOpen(false);
    fetchBranchesAndManagers();
  };

  const handleDelete = async (branchId) => {
    // Check if branch has users
    const { data: users, error: usersError } = await supabase.from('users').select('id').eq('branch_id', branchId);
    if(usersError || users.length > 0) {
        toast({ title: 'Error', description: 'Cannot delete branch. It has users assigned to it.', variant: 'destructive' });
        return;
    }

    const { error } = await supabase.from('branches').delete().eq('id', branchId);
    if (error) {
      toast({ title: 'Error', description: `Failed to delete branch: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Branch deleted successfully.' });
      fetchBranchesAndManagers();
    }
  };

  const getManagerName = (branch) => {
    const manager = managers.find(m => m.branch_id === branch.id);
    return manager ? manager.full_name : 'Not Assigned';
  };
  
  // Filter managers: only show managers not assigned to any branch, or the one currently assigned to the editing branch
  const availableManagers = managers.filter(m => !m.branch_id || (editingBranch && m.branch_id === editingBranch.id) );

  return (
    <DashboardLayout title="Branch Management">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mb-6 flex justify-end">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add Branch
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingBranch ? 'Edit Branch' : 'Add New Branch'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Branch Name</Label>
                  <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manager">Assign Manager</Label>
                  <Select value={assignedManager} onValueChange={setAssignedManager}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a manager" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Not Assigned</SelectItem> {/* Changed value to "unassigned" */}
                      {availableManagers.map(manager => (
                        <SelectItem key={manager.id} value={manager.id}>{manager.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleSave} className="w-full" disabled={isSaving}>
                  {isSaving ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : (editingBranch ? 'Save Changes' : 'Create Branch')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Branches</CardTitle>
            <CardDescription>A list of all branches in the system.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Branches...</span>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map(branch => (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium">{branch.name}</TableCell>
                      <TableCell>{branch.location}</TableCell>
                      <TableCell>{getManagerName(branch)}</TableCell>
                      <TableCell className="space-x-2">
                        <Button variant="outline" size="icon" onClick={() => handleOpenDialog(branch)}><Edit className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the branch.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(branch.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!isLoading && branches.length === 0 && (
              <div className="text-center py-10 text-gray-500">
                No branches found. Start by adding a new branch.
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
};

export default BranchManagement;