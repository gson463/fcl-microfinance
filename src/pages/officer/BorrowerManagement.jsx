import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Edit, Trash2, Eye, Download, Upload, Users, UserCheck, UserX, UserPlus as UserPlusIcon, Loader2, FileSpreadsheet, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';
import { Checkbox } from '@/components/ui/checkbox';
import { exportObjectsToCsv } from '@/lib/tableExport';

const PAGE_SIZE = 25;

/** Match DB normalize_borrower_phone / normalize_borrower_id_number for client-side checks */
function normalizePhoneKey(p) {
    return String(p ?? '')
        .replace(/\s/g, '')
        .toLowerCase()
        .trim();
}
function normalizeIdKey(p) {
    return String(p ?? '')
        .trim()
        .toLowerCase();
}

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        <Icon className={`h-5 w-5 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
);

const BorrowerManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const navigate = useNavigate();
    const [borrowers, setBorrowers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingBorrower, setEditingBorrower] = useState(null);
    const importFileRef = useRef(null);

    const [selectedBorrowers, setSelectedBorrowers] = useState(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [page, setPage] = useState(1);

    const defaultFormState = {
        first_name: '', surname: '', gender: 'male', phone_number: '', address: '', business_name: '', business_location: '', group_id: null, identification_type: 'national_id', identification_number: '', borrower_type: 'individual'
    };

    const [formData, setFormData] = useState(defaultFormState);

    const fetchDuplicateBorrower = useCallback(async (phone, idNumber, excludeBorrowerId) => {
        const { data, error } = await supabase.rpc('find_duplicate_borrower', {
            p_phone: phone ?? '',
            p_identification_number: idNumber ?? '',
            p_exclude_borrower_id: excludeBorrowerId ?? null,
        });
        if (error) {
            console.error(error);
            return null;
        }
        if (data == null) return null;
        const row = Array.isArray(data) ? data[0] : data;
        return row && row.id ? row : null;
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        const { data: borrowersData, error: borrowersError } = await supabase
            .from('borrowers')
            .select('*')
            .eq('loan_officer_id', user.id);

        const { data: groupsData, error: groupsError } = await supabase
            .from('groups')
            .select('*')
            .eq('loan_officer_id', user.id);

        const { data: productsData, error: productsError } = await supabase
            .from('loan_products').select('name').eq('status', 'active');

        if (borrowersError || groupsError || productsError) {
            toast({ title: 'Error fetching data', description: borrowersError?.message || groupsError?.message || productsError.message, variant: 'destructive' });
        } else {
            setBorrowers(borrowersData || []);
            setGroups(groupsData || []);
            setLoanProducts(productsData || []);
        }
        setLoading(false);
    }, [user, toast]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredBorrowers = useMemo(() => {
        return borrowers.filter(b => {
            const query = searchQuery.toLowerCase();
            const matchesSearch = 
                b.first_name.toLowerCase().includes(query) ||
                b.surname.toLowerCase().includes(query) ||
                (b.borrower_id && b.borrower_id.toLowerCase().includes(query)) ||
                (b.phone_number && b.phone_number.includes(query)) ||
                (b.identification_number && b.identification_number.includes(query));
            const matchesGroup = groupFilter === 'all' || b.group_id === groupFilter;
            const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
            return matchesSearch && matchesGroup && matchesStatus;
        });
    }, [borrowers, searchQuery, groupFilter, statusFilter]);

    useEffect(() => {
        setPage(1);
    }, [searchQuery, groupFilter, statusFilter]);

    const pagedBorrowers = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredBorrowers.slice(start, start + PAGE_SIZE);
    }, [filteredBorrowers, page]);

    const totalPages = Math.max(1, Math.ceil(filteredBorrowers.length / PAGE_SIZE));

    const handleSelectBorrower = (borrowerId, isSelected) => {
        const newSelection = new Set(selectedBorrowers);
        if (isSelected) {
            newSelection.add(borrowerId);
        } else {
            newSelection.delete(borrowerId);
        }
        setSelectedBorrowers(newSelection);
    };

    const handleSelectAll = (isSelected) => {
        const pageIds = pagedBorrowers.map((b) => b.id);
        if (isSelected) {
            setSelectedBorrowers((prev) => new Set([...prev, ...pageIds]));
        } else {
            setSelectedBorrowers((prev) => {
                const next = new Set(prev);
                pageIds.forEach((id) => next.delete(id));
                return next;
            });
        }
    };
    
    const handleExportBorrowersCsv = () => {
        if (selectedBorrowers.size === 0) {
            toast({ title: 'No borrowers selected', description: 'Select at least one row.', variant: 'destructive' });
            return;
        }
        const rows = borrowers.filter((b) => selectedBorrowers.has(b.id));
        exportObjectsToCsv(`borrowers_selected_${Date.now()}.csv`, [
            { header: 'Borrower ID', accessor: 'borrower_id' },
            { header: 'First name', accessor: 'first_name' },
            { header: 'Surname', accessor: 'surname' },
            { header: 'Phone', accessor: (r) => r.phone_number ?? '' },
            { header: 'ID number', accessor: (r) => r.identification_number ?? '' },
            { header: 'Status', accessor: 'status' },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} borrower(s) to CSV.` });
    };

    const handleGenerateLoanTemplate = () => {
        if (selectedBorrowers.size === 0) {
            toast({ title: 'No Borrowers Selected', description: 'Please select at least one borrower to prepare loans.', variant: 'warning' });
            return;
        }

        const selectedBorrowerData = borrowers.filter(b => selectedBorrowers.has(b.id));

        const templateData = selectedBorrowerData.map(b => ({
            borrower_id: b.borrower_id,
            borrower_name: `${b.first_name} ${b.surname}`,
            loan_product_name: '',
            principal: '',
            disbursement_date: '',
            repayment_start_date: '',
        }));
        
        const loansSheet = XLSX.utils.json_to_sheet(templateData);
        
        const instructions = [
            ['Column Name', 'Description', 'Example'],
            ['borrower_id', 'DO NOT CHANGE. This is the unique ID of the borrower.', 'BRW-12345'],
            ['borrower_name', 'DO NOT CHANGE. Name of the borrower for reference.', 'John Doe'],
            ['loan_product_name', 'The exact name of an active loan product.', 'Personal Loan'],
            ['principal', 'The loan amount without currency symbols.', '500000'],
            ['disbursement_date', 'Date the loan is given. Format: YYYY-MM-DD.', '2025-11-09'],
            ['repayment_start_date', 'Date repayments begin. Format: YYYY-MM-DD.', '2025-12-09']
        ];
        const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
        
        const validProducts = loanProducts.map(p => ({ 'Product Name': p.name }));
        const productsSheet = XLSX.utils.json_to_sheet(validProducts);
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, loansSheet, 'Prepared Loans');
        XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
        XLSX.utils.book_append_sheet(workbook, productsSheet, 'Valid Loan Products');
        
        XLSX.writeFile(workbook, 'Prepared_Loans_Template.xlsx');
        toast({ title: 'Template Generated', description: `Template for ${selectedBorrowers.size} borrower(s) has been downloaded.` });
        setSelectedBorrowers(new Set());
    };

    const stats = useMemo(() => {
        return {
            total: borrowers.length,
            active: borrowers.filter(b => b.status === 'active_loan').length,
            eligible: borrowers.filter(b => b.status === 'eligible').length,
            pending: borrowers.filter(b => b.status === 'pending').length,
            defaulted: borrowers.filter(b => b.status === 'defaulted').length,
        };
    }, [borrowers]);

    const handleSave = async () => {
        setIsSaving(true);
        const { first_name, surname, phone_number, identification_number, group_id, borrower_type } = formData;
        if (!first_name || !surname || !phone_number || !identification_number || (borrower_type === 'group' && !group_id)) {
            toast({ title: 'Error', description: 'Please fill all required fields.', variant: 'destructive' });
            setIsSaving(false);
            return;
        }

        const dup = await fetchDuplicateBorrower(
            phone_number,
            identification_number,
            editingBorrower ? editingBorrower.id : null
        );
        if (dup) {
            const { data: off } = await supabase
                .from('users')
                .select('full_name')
                .eq('id', dup.loan_officer_id)
                .maybeSingle();
            setIsSaving(false);
            toast({
                title: 'Already in the system',
                description: `Phone or ID is already used by ${dup.first_name} ${dup.surname} (${dup.borrower_id}).${
                    off?.full_name ? ` Borrower is assigned to officer: ${off.full_name}.` : ''
                } The same person cannot be registered twice.`,
                variant: 'destructive',
            });
            return;
        }

        const payload = {
            ...formData,
            group_id: borrower_type === 'individual' ? null : group_id,
            loan_officer_id: user.id,
            branch_id: user.user_metadata.branch_id,
            status: editingBorrower ? editingBorrower.status : 'pending',
        };

        let result;
        if (editingBorrower) {
            result = await supabase.from('borrowers').update(payload).eq('id', editingBorrower.id);
        } else {
            const borrower_id = `B-${Date.now().toString().slice(-6)}`;
            result = await supabase.from('borrowers').insert({ ...payload, borrower_id });
        }

        setIsSaving(false);
        if (result.error) {
            const msg = result.error.message || '';
            if (msg.includes('idx_borrowers_phone_norm_unique') || msg.includes('idx_borrowers_ident_norm_unique')) {
                toast({
                    title: 'Duplicate',
                    description:
                        'Phone or ID is already registered (possibly by another officer). Fix the values or use the existing record.',
                    variant: 'destructive',
                });
            } else {
                toast({ title: 'Error saving borrower', description: msg, variant: 'destructive' });
            }
        } else {
            fetchData();
            setDialogOpen(false);
            setEditingBorrower(null);
            toast({ title: 'Success', description: `Borrower ${editingBorrower ? 'updated' : 'registered'}.` });
        }
    };

    const handleDelete = async (borrowerId) => {
        const { error } = await supabase.from('borrowers').delete().eq('id', borrowerId);
        if (error) {
            toast({ title: 'Error deleting borrower', description: error.message, variant: 'destructive' });
        } else {
            fetchData();
            toast({ title: 'Success', description: 'Borrower deleted.' });
        }
    };
    
    const handleEdit = (borrower) => {
        setEditingBorrower(borrower);
        setFormData({ ...defaultFormState, ...borrower, group_id: borrower.group_id || null });
        setDialogOpen(true);
    };

    const handleDownloadTemplate = () => {
        const templateData = [{
            first_name: 'John',
            surname: 'Doe',
            gender: 'male',
            phone_number: '0712345678',
            address: '123 Main St, Dar es Salaam',
            business_name: 'Johns Store',
            business_location: 'Kariakoo',
            identification_type: 'national_id',
            identification_number: '12345678901234567890',
            borrower_type: 'group', // or 'individual'
            group_name: 'Upendo Group' // Required if borrower_type is 'group'
        }];
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Borrowers");
        XLSX.writeFile(workbook, 'Borrowers_Import_Template.xlsx');
    };

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet);

                const groupsMap = new Map(groups.map(g => [g.name.toLowerCase(), g.id]));

                const seenInFile = new Set();
                for (const row of json) {
                    const pk = normalizePhoneKey(row.phone_number);
                    const ik = normalizeIdKey(row.identification_number);
                    if (pk && seenInFile.has(`p:${pk}`)) {
                        throw new Error(`File has duplicate phone number: ${row.phone_number}`);
                    }
                    if (ik && seenInFile.has(`i:${ik}`)) {
                        throw new Error(`File has duplicate identification number: ${row.identification_number}`);
                    }
                    if (pk) seenInFile.add(`p:${pk}`);
                    if (ik) seenInFile.add(`i:${ik}`);
                }

                const newBorrowers = json.map((row, idx) => {
                    const borrower_type = row.borrower_type?.toLowerCase() || 'individual';
                    let group_id = null;
                    if (borrower_type === 'group') {
                        const groupName = row.group_name?.toLowerCase();
                        if (!groupName || !groupsMap.has(groupName)) {
                            throw new Error(`Group '${row.group_name}' not found for borrower ${row.first_name}. Please create the group first.`);
                        }
                        group_id = groupsMap.get(groupName);
                    }

                    return {
                        first_name: row.first_name,
                        surname: row.surname,
                        gender: row.gender,
                        phone_number: String(row.phone_number),
                        address: row.address,
                        business_name: row.business_name,
                        business_location: row.business_location,
                        identification_type: row.identification_type,
                        identification_number: String(row.identification_number),
                        borrower_type: borrower_type,
                        group_id: group_id,
                        loan_officer_id: user.id,
                        branch_id: user.user_metadata.branch_id,
                        status: 'pending',
                        borrower_id: `B-${Date.now().toString().slice(-6)}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
                    };
                });
                
                if (newBorrowers.length === 0) {
                    toast({ title: 'Warning', description: 'No borrowers found in the file.', variant: 'default' });
                    return;
                }

                let imported = 0;
                const skipped = [];
                for (const row of newBorrowers) {
                    const dup = await fetchDuplicateBorrower(row.phone_number, row.identification_number, null);
                    if (dup) {
                        skipped.push(`${row.first_name} ${row.surname} (duplicate: ${dup.borrower_id})`);
                        continue;
                    }
                    const { error: insErr } = await supabase.from('borrowers').insert([row]);
                    if (insErr) {
                        if (
                            insErr.message?.includes('idx_borrowers_phone_norm_unique') ||
                            insErr.message?.includes('idx_borrowers_ident_norm_unique')
                        ) {
                            skipped.push(`${row.first_name} ${row.surname} (duplicate phone/ID)`);
                        } else {
                            throw insErr;
                        }
                    } else {
                        imported += 1;
                    }
                }

                if (imported > 0) {
                    toast({
                        title: 'Import completed',
                        description: `${imported} imported.${skipped.length ? ` ${skipped.length} skipped: ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? '…' : ''}` : ''}`,
                    });
                } else {
                    toast({
                        title: 'Nothing imported',
                        description:
                            skipped.length > 0
                                ? `All rows were duplicates: ${skipped.slice(0, 3).join('; ')}`
                                : 'No records in file.',
                        variant: 'destructive',
                    });
                }
                fetchData();

            } catch (err) {
                toast({ title: 'Import Error', description: err.message, variant: 'destructive' });
            } finally {
                setIsImporting(false);
                event.target.value = null;
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const getGroupName = (groupId) => groups.find(g => g.id === groupId)?.name || 'N/A';
    
    const getLoanStatusBadge = (status) => {
      const statusMap = {
        'eligible': 'success',
        'pending': 'secondary',
        'active_loan': 'warning',
        'defaulted': 'destructive',
        'paid_up': 'default',
      };
      return statusMap[status] || 'default';
    };

    const getStatusText = (status) => {
        const statusTextMap = {
            'eligible': 'Eligible',
            'pending': 'Pending (manager)',
            'active_loan': 'Active Loan',
            'defaulted': 'Defaulted',
            'paid_up': 'Paid Up',
        };
        return statusTextMap[status] || status;
    }


    if (loading) return <DashboardLayout title="Borrower Management"><div className="flex justify-center items-center h-full">Loading...</div></DashboardLayout>;

    return (
        <DashboardLayout title="Borrower Management">
            <div className="space-y-6">
                <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="outline" onClick={handleDownloadTemplate}><Download className="mr-2 h-4 w-4" /> Template</Button>
                        <Button onClick={() => importFileRef.current.click()} disabled={isImporting}>
                            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Import
                        </Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        <Dialog open={dialogOpen} onOpenChange={(isOpen) => { if (!isOpen) { setEditingBorrower(null); setFormData(defaultFormState); } setDialogOpen(isOpen); }}>
                            <DialogTrigger asChild>
                                <Button onClick={() => { setFormData(defaultFormState); setEditingBorrower(null); }}><PlusCircle className="mr-2 h-4 w-4" /> Register</Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-3xl">
                                <DialogHeader>
                                    <DialogTitle>{editingBorrower ? 'Edit' : 'Register'} Borrower</DialogTitle>
                                    <DialogDescription>
                                        Phone and ID must be unique across the system — this prevents the same person registered twice, even across different officers.
                                        New borrowers start as <strong>Pending</strong>; only a <strong>branch manager</strong> can mark them <strong>Eligible</strong> for a new loan.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4 max-h-[80vh] overflow-y-auto px-1">
                                    <div className="space-y-2"><Label>First Name</Label><Input value={formData.first_name} onChange={e => setFormData({ ...formData, first_name: e.target.value })} /></div>
                                    <div className="space-y-2"><Label>Surname</Label><Input value={formData.surname} onChange={e => setFormData({ ...formData, surname: e.target.value })} /></div>
                                    <div className="space-y-2"><Label>Gender</Label><Select value={formData.gender} onValueChange={(v) => setFormData({ ...formData, gender: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2"><Label>Phone</Label><Input value={formData.phone_number} onChange={e => setFormData({ ...formData, phone_number: e.target.value })} /></div>
                                    <div className="space-y-2"><Label>ID Type</Label><Select value={formData.identification_type} onValueChange={(v) => setFormData({...formData, identification_type:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="national_id">National ID</SelectItem><SelectItem value="passport">Passport</SelectItem><SelectItem value="drivers_license">Driver's License</SelectItem><SelectItem value="voters_id">Voter's ID</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2"><Label>ID Number</Label><Input value={formData.identification_number} onChange={e => setFormData({ ...formData, identification_number: e.target.value })} /></div>
                                    <div className="space-y-2 md:col-span-2"><Label>Address</Label><Input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} /></div>
                                    <div className="space-y-2"><Label>Business Name</Label><Input value={formData.business_name} onChange={e => setFormData({ ...formData, business_name: e.target.value })} /></div>
                                    <div className="space-y-2"><Label>Business Location</Label><Input value={formData.business_location} onChange={e => setFormData({ ...formData, business_location: e.target.value })} /></div>
                                    <div className="space-y-2 md:col-span-2"><Label>Borrower Type</Label><Select value={formData.borrower_type} onValueChange={(v) => setFormData({...formData, borrower_type: v, group_id: null })}><SelectTrigger><SelectValue placeholder="Select Type"/></SelectTrigger><SelectContent><SelectItem value="individual">Individual Borrower</SelectItem><SelectItem value="group">Group Borrower</SelectItem></SelectContent></Select></div>
                                    {formData.borrower_type === 'group' && (
                                        <div className="space-y-2 md:col-span-2"><Label>Group</Label><Select value={formData.group_id || ''} onValueChange={(v) => setFormData({...formData, group_id:v})}><SelectTrigger><SelectValue placeholder="Select Group"/></SelectTrigger><SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select></div>
                                    )}
                                </div>
                                <div className="flex justify-end pt-4"><Button onClick={handleSave} disabled={isSaving}>{isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : (editingBorrower ? 'Save Changes' : 'Register Borrower')}</Button></div>
                            </DialogContent>
                        </Dialog>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatCard title="Total Borrowers" value={stats.total} icon={Users} color="text-blue-600" />
                    <StatCard title="Active Loans" value={stats.active} icon={UserCheck} color="text-yellow-600" />
                    <StatCard title="Eligible" value={stats.eligible} icon={UserPlusIcon} color="text-green-600" />
                    <StatCard title="Pending approval" value={stats.pending} icon={Clock} color="text-slate-500" />
                    <StatCard title="Defaulted" value={stats.defaulted} icon={UserX} color="text-red-600" />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                            <CardTitle>My Borrowers</CardTitle>
                             <div className="flex items-center gap-2">
                                <Input placeholder="Search by ID, name, phone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full md:w-64" />
                                <Select value={groupFilter} onValueChange={setGroupFilter}>
                                    <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by Group" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Groups</SelectItem>
                                        {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by Status" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        <SelectItem value="eligible">Eligible</SelectItem>
                                        <SelectItem value="pending">Pending (manager)</SelectItem>
                                        <SelectItem value="active_loan">Active Loan</SelectItem>
                                        <SelectItem value="defaulted">Defaulted</SelectItem>
                                        <SelectItem value="paid_up">Paid Up</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                       {selectedBorrowers.size > 0 && (
                            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4 rounded-r-lg flex justify-between items-center">
                                <p className="font-medium text-blue-800">{selectedBorrowers.size} borrower(s) selected.</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button type="button" variant="outline" onClick={handleExportBorrowersCsv}>
                                        <Download className="mr-2 h-4 w-4"/>
                                        Export CSV
                                    </Button>
                                    <Button onClick={handleGenerateLoanTemplate}>
                                        <FileSpreadsheet className="mr-2 h-4 w-4"/>
                                        Prepare Loans
                                    </Button>
                                </div>
                            </div>
                        )}
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12">
                                        <Checkbox 
                                          checked={pagedBorrowers.length > 0 && pagedBorrowers.every((b) => selectedBorrowers.has(b.id))}
                                          onCheckedChange={handleSelectAll}
                                        />
                                    </TableHead>
                                    <TableHead>Borrower ID</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Group</TableHead>
                                    <TableHead>Loan Status</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedBorrowers.map(b => (
                                    <TableRow key={b.id} data-state={selectedBorrowers.has(b.id) && "selected"}>
                                        <TableCell>
                                           <Checkbox
                                                checked={selectedBorrowers.has(b.id)}
                                                onCheckedChange={(checked) => handleSelectBorrower(b.id, checked)}
                                           />
                                        </TableCell>
                                        <TableCell>{b.borrower_id}</TableCell>
                                        <TableCell>{b.first_name} {b.surname}</TableCell>
                                        <TableCell>{b.phone_number}</TableCell>
                                        <TableCell>{b.borrower_type === 'group' ? getGroupName(b.group_id) : 'Individual'}</TableCell>
                                        <TableCell><Badge variant={getLoanStatusBadge(b.status)}>{getStatusText(b.status)}</Badge></TableCell>
                                        <TableCell className="space-x-2">
                                            <Button variant="outline" size="icon" onClick={() => navigate(`/officer/borrowers/${b.id}`)}><Eye className="h-4 w-4" /></Button>
                                            <Button variant="outline" size="icon" onClick={() => handleEdit(b)}><Edit className="h-4 w-4" /></Button>
                                            <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the borrower and related records.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(b.id)}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredBorrowers.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No borrowers match the current filters.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        {filteredBorrowers.length > 0 && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                <p className="text-sm text-muted-foreground">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredBorrowers.length)} of {filteredBorrowers.length}
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
            </div>
        </DashboardLayout>
    );
};

export default BorrowerManagement;