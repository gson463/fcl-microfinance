import React, { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Edit, Trash2, Download, Upload, Users } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as XLSX from 'xlsx';

/** Single spaces, trimmed — used for duplicate checks and saving. */
function normalizeGroupName(name) {
    return String(name ?? '').trim().replace(/\s+/g, ' ');
}

const CenterGroupManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centerDialogOpen, setCenterDialogOpen] = useState(false);
    const [groupDialogOpen, setGroupDialogOpen] = useState(false);
    const [editingCenter, setEditingCenter] = useState(null);
    const [editingGroup, setEditingGroup] = useState(null);
    const [centerFormData, setCenterFormData] = useState({ name: '', location: '' });
    const [groupFormData, setGroupFormData] = useState({ name: '', center_id: '' });
    const [loading, setLoading] = useState(true);
    const importFileRef = useRef(null);
    const [activeTab, setActiveTab] = useState('centers');
    const [groupMemberCounts, setGroupMemberCounts] = useState({});
    /** From public.users — JWT user_metadata.branch_id is often missing or stale after recovery. */
    const [officerBranchId, setOfficerBranchId] = useState(null);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data: profileRow, error: profileError } = await supabase
                .from('users')
                .select('branch_id')
                .eq('id', user.id)
                .maybeSingle();
            if (profileError) throw profileError;
            setOfficerBranchId(profileRow?.branch_id ?? null);

            const { data: centersData, error: centersError } = await supabase.from('centers').select('*').eq('loan_officer_id', user.id);
            if (centersError) throw centersError;
            setCenters(centersData || []);

            const { data: groupsData, error: groupsError } = await supabase.from('groups').select('*').eq('loan_officer_id', user.id);
            if (groupsError) throw groupsError;
            setGroups(groupsData || []);
            
            // Fetch member counts for each group
            if (groupsData && groupsData.length > 0) {
                const groupIds = groupsData.map(g => g.id);
                const { data: counts, error: countError } = await supabase
                    .from('borrowers')
                    .select('group_id')
                    .in('group_id', groupIds);
                if (countError) throw countError;

                const memberCounts = counts.reduce((acc, { group_id }) => {
                    acc[group_id] = (acc[group_id] || 0) + 1;
                    return acc;
                }, {});
                setGroupMemberCounts(memberCounts);
            }
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleCenterSave = async () => {
        if (!centerFormData.name || !centerFormData.location) {
            toast({ title: 'Error', description: 'Please fill all fields for the center.', variant: 'destructive' });
            return;
        }

        let result;
        if (editingCenter) {
            result = await supabase.from('centers').update({ ...centerFormData }).eq('id', editingCenter.id);
        } else {
            if (!officerBranchId) {
                toast({
                    title: 'Branch not assigned',
                    description:
                        'Your officer profile has no branch in the database. Ask an admin to assign you to a branch in User Management, then sign out and sign in again.',
                    variant: 'destructive',
                });
                return;
            }
            result = await supabase
                .from('centers')
                .insert({ ...centerFormData, loan_officer_id: user.id, branch_id: officerBranchId });
        }

        if (result.error) {
            toast({ title: 'Error', description: result.error.message, variant: 'destructive' });
        } else {
            fetchData();
            setCenterDialogOpen(false);
            setEditingCenter(null);
            setCenterFormData({ name: '', location: '' });
            toast({ title: 'Success', description: `Center ${editingCenter ? 'updated' : 'created'}.` });
        }
    };

    const handleGroupSave = async () => {
        if (!groupFormData.name || !groupFormData.center_id) {
            toast({ title: 'Error', description: 'Please fill all fields for the group.', variant: 'destructive' });
            return;
        }

        const nameNorm = normalizeGroupName(groupFormData.name);
        if (!nameNorm) {
            toast({ title: 'Error', description: 'Enter a valid group name.', variant: 'destructive' });
            return;
        }

        const nameKey = nameNorm.toLowerCase();
        const duplicate = groups.some(
            (g) =>
                g.center_id === groupFormData.center_id &&
                (!editingGroup || g.id !== editingGroup.id) &&
                normalizeGroupName(g.name).toLowerCase() === nameKey,
        );
        if (duplicate) {
            toast({
                title: 'Duplicate group name',
                description: 'A group with this name already exists in this center. Use a different name.',
                variant: 'destructive',
            });
            return;
        }

        const payload = { name: nameNorm, center_id: groupFormData.center_id };

        let result;
        if (editingGroup) {
            result = await supabase.from('groups').update(payload).eq('id', editingGroup.id);
        } else {
            result = await supabase.from('groups').insert({ ...payload, loan_officer_id: user.id });
        }

        if (result.error) {
            const desc =
                result.error.code === '23505'
                    ? 'A group with this name already exists in this center.'
                    : result.error.message;
            toast({ title: 'Error', description: desc, variant: 'destructive' });
        } else {
            fetchData();
            setGroupDialogOpen(false);
            setEditingGroup(null);
            setGroupFormData({ name: '', center_id: '' });
            toast({ title: 'Success', description: `Group ${editingGroup ? 'updated' : 'created'}.` });
        }
    };
    
    const handleDelete = async (id, type) => {
        const tableName = type === 'center' ? 'centers' : 'groups';
        const { error } = await supabase.from(tableName).delete().eq('id', id);
        
        if (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } else {
            fetchData();
            toast({ title: 'Success', description: `${type.charAt(0).toUpperCase() + type.slice(1)} deleted.` });
        }
    };

    const handleDownloadTemplate = () => {
        let templateData, fileName;
        if (activeTab === 'centers') {
            templateData = [{ name: 'Kijitonyama Center', location: 'Dar es Salaam' }];
            fileName = 'Centers_Import_Template.xlsx';
        } else {
            const centerExample = centers.length > 0 ? centers[0].name : 'Kijitonyama Center';
            templateData = [{ name: 'Upendo Group', centerName: centerExample }];
            fileName = 'Groups_Import_Template.xlsx';
        }
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
        XLSX.writeFile(workbook, fileName);
    };

    const handleImport = (event) => {
        toast({ title: 'In Progress', description: 'Import feature is being updated for database integration.' });
        event.target.value = null;
    };
    
    const getCenterName = (centerId) => centers.find(c => c.id === centerId)?.name || 'N/A';
    
    if (loading) return <DashboardLayout title="Centers & Groups"><div className="flex items-center justify-center h-full">Loading...</div></DashboardLayout>;

    return (
        <DashboardLayout title="Centers & Groups">
            {!officerBranchId && (
                <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                    Your officer account has no branch assigned in the database. You cannot create centers until an admin assigns a branch in User Management, then you sign out and sign in again.
                </div>
            )}
            <Tabs defaultValue="centers" onValueChange={setActiveTab}>
                <div className="flex justify-between items-center mb-4">
                    <TabsList>
                        <TabsTrigger value="centers">Centers</TabsTrigger>
                        <TabsTrigger value="groups">Groups</TabsTrigger>
                    </TabsList>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handleDownloadTemplate}><Download className="mr-2 h-4 w-4" /> Template</Button>
                        <Button onClick={() => importFileRef.current.click()}><Upload className="mr-2 h-4 w-4" /> Import</Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        <Dialog open={centerDialogOpen} onOpenChange={setCenterDialogOpen}>
                            <DialogTrigger asChild>
                                <Button
                                    disabled={!officerBranchId}
                                    onClick={() => {
                                        setEditingCenter(null);
                                        setCenterFormData({ name: '', location: '' });
                                    }}
                                >
                                    <PlusCircle className="mr-2 h-4 w-4" /> Add Center
                                </Button>
                            </DialogTrigger>
                             <DialogContent>
                                <DialogHeader><DialogTitle>{editingCenter ? 'Edit' : 'New'} Center</DialogTitle></DialogHeader>
                                <div className="space-y-4 py-4">
                                    <Input placeholder="Center Name" value={centerFormData.name} onChange={e => setCenterFormData({ ...centerFormData, name: e.target.value })} />
                                    <Input placeholder="Location" value={centerFormData.location} onChange={e => setCenterFormData({ ...centerFormData, location: e.target.value })} />
                                    <Button onClick={handleCenterSave} className="w-full">{editingCenter ? 'Save Changes' : 'Create Center'}</Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                        <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
                            <DialogTrigger asChild><Button onClick={() => { setEditingGroup(null); setGroupFormData({ name: '', center_id: '' }); }}><PlusCircle className="mr-2 h-4 w-4" /> Add Group</Button></DialogTrigger>
                            <DialogContent>
                                <DialogHeader><DialogTitle>{editingGroup ? 'Edit' : 'New'} Group</DialogTitle></DialogHeader>
                                 <div className="space-y-4 py-4">
                                     <Input placeholder="Group Name" value={groupFormData.name} onChange={e => setGroupFormData({ ...groupFormData, name: e.target.value })} />
                                     <Select value={groupFormData.center_id} onValueChange={(v) => setGroupFormData({ ...groupFormData, center_id: v })}>
                                        <SelectTrigger className="w-full"><SelectValue placeholder="Select Center" /></SelectTrigger>
                                        <SelectContent>
                                            {centers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                     </Select>
                                     <Button onClick={handleGroupSave} className="w-full">{editingGroup ? 'Save Changes' : 'Create Group'}</Button>
                                 </div>
                             </DialogContent>
                        </Dialog>
                    </div>
                </div>

                <TabsContent value="centers">
                    <Card>
                        <CardHeader><CardTitle>My Centers</CardTitle></CardHeader>
                        <CardContent><Table>
                            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Location</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                            <TableBody>{centers.map(c => (<TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell>{c.location}</TableCell><TableCell className="space-x-2"><Button variant="outline" size="icon" onClick={() => { setEditingCenter(c); setCenterFormData({ name: c.name, location: c.location }); setCenterDialogOpen(true); }}><Edit className="h-4 w-4" /></Button><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the center.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(c.id, 'center')}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></TableCell></TableRow>))}</TableBody>
                        </Table></CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="groups">
                     <Card>
                        <CardHeader><CardTitle>My Groups</CardTitle></CardHeader>
                        <CardContent><Table>
                            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Center</TableHead><TableHead>Members</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                            <TableBody>{groups.map(g => (<TableRow key={g.id}><TableCell>{g.name}</TableCell><TableCell>{getCenterName(g.center_id)}</TableCell><TableCell className="flex items-center gap-2"><Users className="h-4 w-4 text-gray-500" />{groupMemberCounts[g.id] || 0}</TableCell><TableCell className="space-x-2"><Button variant="outline" size="icon" onClick={() => { setEditingGroup(g); setGroupFormData({ name: g.name, center_id: g.center_id }); setGroupDialogOpen(true); }}><Edit className="h-4 w-4" /></Button><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the group.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(g.id, 'group')}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></TableCell></TableRow>))}</TableBody>
                        </Table></CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </DashboardLayout>
    );
};

export default CenterGroupManagement;