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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { PlusCircle, Edit, Trash2, Eye, Download, Upload, Users, UserCheck, UserX, UserPlus as UserPlusIcon, Loader2, FileSpreadsheet, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';
import { Checkbox } from '@/components/ui/checkbox';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { downloadBorrowersImportTemplate, downloadPreparedLoansTemplate } from '@/lib/excelImportTemplateDownloads';
import { cn } from '@/lib/utils';
import {
    NIDA_DIGIT_LENGTH,
    VOTERS_ID_MAX_INPUT_LENGTH,
    DRIVER_LICENSE_DIGIT_LENGTH,
    PHONE_DIGIT_LENGTH,
    normalizeNidaDigits,
    normalizeVotersIdInput,
    normalizeDriversLicenseDigits,
    normalizePhoneDigitsMax10,
    normalizePersonNameLettersOnly,
    validateNidaIdentificationNumber,
    validateVotersIdentificationNumber,
    validateDriversLicenseIdentificationNumber,
    validatePhoneNumberTenDigits,
    isNationalIdIdentificationType,
    isVotersIdIdentificationType,
    isDriversLicenseIdentificationType,
} from '@/lib/borrowerIdValidation';
import { borrowerMatchesCenter, borrowerMatchesGroup } from '@/lib/loanBorrowerLocationFilter';
import { getImportDataSheet, formatImportReportSummary } from '@/lib/bulkImportExcel';
import { ImportResultDialog } from '@/components/import/ImportResultDialog';

const OFFICER_BORROWER_STATUS_FILTER_OPTIONS = [
	{ value: 'eligible', label: 'Eligible' },
	{ value: 'pending', label: 'Pending re-loan (manager)' },
	{ value: 'active_loan', label: 'Active Loan' },
	{ value: 'defaulted', label: 'Defaulted' },
	{ value: 'paid_up', label: 'Paid Up' },
];

const PAGE_SIZE = 25;

function FieldRequired() {
    return <span className="text-destructive ml-0.5" aria-hidden>*</span>;
}

/** Match DB normalize_borrower_id_number for client-side checks */
function normalizeIdKey(p) {
    return String(p ?? '')
        .trim()
        .toLowerCase();
}

function getIdentificationNumberFieldLabel(identificationType) {
    switch (identificationType) {
        case 'national_id':
            return 'NIDA number';
        case 'passport':
            return 'Passport number';
        case 'drivers_license':
            return 'Driver\'s licence number';
        case 'voters_id':
            return 'Voter\'s ID number';
        default:
            return 'ID number';
    }
}

/** Canonical ID string for duplicate detection within import file */
function idKeyForImportDuplicateCheck(row) {
    if (isNationalIdIdentificationType(row.identification_type)) {
        return normalizeNidaDigits(row.identification_number);
    }
    if (isVotersIdIdentificationType(row.identification_type)) {
        const v = validateVotersIdentificationNumber(String(row.identification_number ?? ''));
        return v.ok ? v.value : String(row.identification_number ?? '');
    }
    if (isDriversLicenseIdentificationType(row.identification_type)) {
        return normalizeDriversLicenseDigits(row.identification_number);
    }
    return row.identification_number;
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
    const [centers, setCenters] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingBorrower, setEditingBorrower] = useState(null);
    const importFileRef = useRef(null);

    const [selectedBorrowers, setSelectedBorrowers] = useState(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [page, setPage] = useState(1);
    const [requestingApprovalId, setRequestingApprovalId] = useState(null);
    const [officerBranchId, setOfficerBranchId] = useState(null);
    const [importReportOpen, setImportReportOpen] = useState(false);
    const [importReportSummary, setImportReportSummary] = useState('');
    const [importReportDetails, setImportReportDetails] = useState('');

    const defaultFormState = {
        first_name: '',
        surname: '',
        gender: 'male',
        phone_number: '',
        address: '',
        business_name: '',
        business_location: '',
        group_id: null,
        center_id: null,
        identification_type: 'national_id',
        identification_number: '',
        borrower_type: 'group',
        guarantor_name: '',
        guarantor_phone: '',
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

        const { data: profileRow } = await supabase.from('users').select('branch_id').eq('id', user.id).maybeSingle();
        const branchId = profileRow?.branch_id ?? null;
        setOfficerBranchId(branchId);

        const { data: borrowersData, error: borrowersError } = await supabase
            .from('borrowers')
            .select('*, groups(id, center_id)')
            .eq('loan_officer_id', user.id);

        const { data: groupsData, error: groupsError } = await supabase
            .from('groups')
            .select('*')
            .eq('loan_officer_id', user.id);

        let centersQuery = supabase.from('centers').select('id, name').eq('loan_officer_id', user.id).order('name');
        if (branchId) {
            centersQuery = centersQuery.eq('branch_id', branchId);
        }
        const { data: centersData, error: centersError } = await centersQuery;

        const { data: productsData, error: productsError } = await supabase
            .from('loan_products').select('name').eq('status', 'active');

        if (borrowersError || groupsError || centersError || productsError) {
            toast({
                title: 'Error fetching data',
                description: borrowersError?.message || groupsError?.message || centersError?.message || productsError.message,
                variant: 'destructive',
            });
        } else {
            setBorrowers(borrowersData || []);
            setGroups(groupsData || []);
            setCenters(centersData || []);
            setLoanProducts(productsData || []);
        }
        setLoading(false);
    }, [user, toast]);

    const handleRequestReloanApproval = useCallback(
        async (borrowerId) => {
            setRequestingApprovalId(borrowerId);
            try {
                const { error } = await supabase
                    .from('borrowers')
                    .update({ status: 'pending' })
                    .eq('id', borrowerId)
                    .eq('loan_officer_id', user.id)
                    .eq('status', 'defaulted');
                if (error) throw error;
                toast({
                    title: 'Request sent',
                    description: 'Your branch manager will review this borrower for a new loan before you can disburse.',
                });
                fetchData();
            } catch (error) {
                console.error(error);
                toast({
                    title: 'Could not submit request',
                    description: error.message || 'Try again or contact support.',
                    variant: 'destructive',
                });
            } finally {
                setRequestingApprovalId(null);
            }
        },
        [user?.id, toast, fetchData]
    );
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (centerFilter === 'all') {
            setGroupFilter('all');
        }
    }, [centerFilter]);

    const groupsForListFilter = useMemo(() => {
        if (centerFilter === 'all') return [];
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    const borrowerListCenterOpts = useMemo(() => centers.map((c) => ({ value: c.id, label: c.name })), [centers]);
    const borrowerListGroupOpts = useMemo(() => groupsForListFilter.map((g) => ({ value: g.id, label: g.name })), [groupsForListFilter]);

    const filteredBorrowers = useMemo(() => {
        return borrowers.filter(b => {
            const query = searchQuery.toLowerCase();
            const matchesSearch = 
                b.first_name.toLowerCase().includes(query) ||
                b.surname.toLowerCase().includes(query) ||
                (b.borrower_id && b.borrower_id.toLowerCase().includes(query)) ||
                (b.phone_number && b.phone_number.includes(query)) ||
                (b.identification_number && b.identification_number.includes(query)) ||
                (b.guarantor_name && b.guarantor_name.toLowerCase().includes(query)) ||
                (b.guarantor_phone && String(b.guarantor_phone).includes(query));
            const matchesCenter = borrowerMatchesCenter(b, centerFilter);
            const matchesGroup = borrowerMatchesGroup(b, groupFilter);
            const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
            return matchesSearch && matchesCenter && matchesGroup && matchesStatus;
        });
    }, [borrowers, searchQuery, centerFilter, groupFilter, statusFilter]);

    useEffect(() => {
        setPage(1);
    }, [searchQuery, centerFilter, groupFilter, statusFilter]);

    const pagedBorrowers = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredBorrowers.slice(start, start + PAGE_SIZE);
    }, [filteredBorrowers, page]);

    const totalPages = Math.max(1, Math.ceil(filteredBorrowers.length / PAGE_SIZE));

    const groupsInSelectedCenter = useMemo(() => {
        if (!formData.center_id) return [];
        return groups.filter((g) => g.center_id === formData.center_id);
    }, [groups, formData.center_id]);

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
            { header: 'Guarantor name', accessor: (r) => r.guarantor_name ?? '' },
            { header: 'Guarantor phone', accessor: (r) => r.guarantor_phone ?? '' },
            { header: 'Status', accessor: 'status' },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} borrower(s) to CSV.` });
    };

    const handleGenerateLoanTemplate = async () => {
        if (selectedBorrowers.size === 0) {
            toast({ title: 'No Borrowers Selected', description: 'Please select at least one borrower to prepare loans.', variant: 'warning' });
            return;
        }
        if (!loanProducts.length) {
            toast({
                title: 'No loan products',
                description: 'Add at least one active loan product before downloading a prepared-loan template.',
                variant: 'destructive',
            });
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

        try {
            await downloadPreparedLoansTemplate({ rows: templateData, loanProducts });
            toast({ title: 'Template Generated', description: `Template for ${selectedBorrowers.size} borrower(s) has been downloaded.` });
            setSelectedBorrowers(new Set());
        } catch (err) {
            console.error(err);
            toast({
                title: 'Template error',
                description: err?.message ?? 'Could not build template.',
                variant: 'destructive',
            });
        }
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

    const borrowerTemplateDownloadBlocked = !officerBranchId || centers.length === 0 || groups.length === 0;
    const borrowerTemplateDownloadTitle = !officerBranchId
        ? 'Assign a branch to your profile first (User Management).'
        : centers.length === 0 || groups.length === 0
          ? 'Create at least one centre and one group under Centres & Groups first.'
          : undefined;

    const handleSave = async () => {
        setIsSaving(true);
        const { first_name, surname, phone_number, identification_number, group_id, borrower_type, center_id } = formData;
        const trim = (v) => String(v ?? '').trim();

        const missing = [];
        if (!trim(first_name)) missing.push('First name');
        if (!trim(surname)) missing.push('Surname');
        if (!formData.gender) missing.push('Gender');
        if (!trim(formData.address)) missing.push('Address');
        if (!trim(formData.business_name)) missing.push('Business name');
        if (!trim(formData.business_location)) missing.push('Business location');
        if (!trim(formData.guarantor_name)) missing.push('Guarantor name');
        if (!formData.identification_type) missing.push('ID type');
        if (!String(identification_number ?? '').trim()) missing.push('ID number');
        if (borrower_type === 'group') {
            if (!center_id) missing.push('Centre');
            if (!group_id) missing.push('Group');
        }

        if (missing.length > 0) {
            toast({
                title: 'Missing information',
                description: `Please complete: ${missing.join(', ')}.`,
                variant: 'destructive',
            });
            setIsSaving(false);
            return;
        }

        const phoneCheck = validatePhoneNumberTenDigits(phone_number);
        if (!phoneCheck.ok) {
            toast({ title: 'Invalid phone', description: phoneCheck.error, variant: 'destructive' });
            setIsSaving(false);
            return;
        }

        const guarantorPhoneCheck = validatePhoneNumberTenDigits(formData.guarantor_phone);
        if (!guarantorPhoneCheck.ok) {
            toast({ title: 'Invalid guarantor phone', description: guarantorPhoneCheck.error, variant: 'destructive' });
            setIsSaving(false);
            return;
        }

        if (borrower_type === 'group') {
            const g = groups.find((x) => x.id === group_id);
            if (!g || g.center_id !== center_id) {
                toast({ title: 'Error', description: 'The selected group must belong to the selected centre.', variant: 'destructive' });
                setIsSaving(false);
                return;
            }
        }

        let idNumberForSave = identification_number;
        if (isNationalIdIdentificationType(formData.identification_type)) {
            const nida = validateNidaIdentificationNumber(identification_number);
            if (!nida.ok) {
                toast({ title: 'Invalid National ID', description: nida.error, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
            idNumberForSave = nida.value;
        } else if (isVotersIdIdentificationType(formData.identification_type)) {
            const vid = validateVotersIdentificationNumber(identification_number);
            if (!vid.ok) {
                toast({ title: "Invalid Voter's ID", description: vid.error, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
            idNumberForSave = vid.value;
        } else if (isDriversLicenseIdentificationType(formData.identification_type)) {
            const dl = validateDriversLicenseIdentificationNumber(identification_number);
            if (!dl.ok) {
                toast({ title: "Invalid Driver's License", description: dl.error, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
            idNumberForSave = dl.value;
        } else if (formData.identification_type === 'passport') {
            idNumberForSave = String(identification_number).trim();
        }

        const dup = await fetchDuplicateBorrower(
            phoneCheck.value,
            idNumberForSave,
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

        const guarantorName = normalizePersonNameLettersOnly(formData.guarantor_name).trim();
        const guarantorPhone = guarantorPhoneCheck.value;

        const payload = {
            ...formData,
            first_name: normalizePersonNameLettersOnly(formData.first_name).trim(),
            surname: normalizePersonNameLettersOnly(formData.surname).trim(),
            phone_number: phoneCheck.value,
            identification_number: idNumberForSave,
            group_id: borrower_type === 'individual' ? null : group_id,
            center_id: borrower_type === 'group' ? center_id : null,
            guarantor_name: guarantorName,
            guarantor_phone: guarantorPhone,
            loan_officer_id: user.id,
            branch_id: officerBranchId ?? user.user_metadata.branch_id,
            status: editingBorrower ? editingBorrower.status : 'eligible',
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
        let center_id = borrower.center_id || null;
        const group_id = borrower.group_id || null;
        if (!center_id && group_id) {
            const g = groups.find((x) => x.id === group_id);
            if (g?.center_id) center_id = g.center_id;
        }
        let idNum = borrower.identification_number ?? '';
        if (borrower.identification_type === 'voters_id' && idNum.charAt(0) === 't') {
            idNum = `T${idNum.slice(1)}`;
        }
        setFormData({
            ...defaultFormState,
            ...borrower,
            identification_number: idNum,
            group_id,
            center_id,
            guarantor_name: borrower.guarantor_name ?? '',
            guarantor_phone: borrower.guarantor_phone ?? '',
        });
        setDialogOpen(true);
    };

    const handleDownloadTemplate = async () => {
        if (!officerBranchId) {
            toast({
                title: 'Branch not assigned',
                description:
                    'Your officer profile has no branch. Ask an admin to assign you in User Management, then sign out and sign in again.',
                variant: 'destructive',
            });
            return;
        }
        if (centers.length === 0 || groups.length === 0) {
            toast({
                title: 'Add centres and groups first',
                description:
                    'Create at least one centre and one group under Centres & Groups before downloading the borrower template (reference lists and group borrowers need them).',
                variant: 'destructive',
            });
            return;
        }
        try {
            await downloadBorrowersImportTemplate({ centers, groups });
        } catch (err) {
            console.error(err);
            toast({
                title: 'Template error',
                description: err?.message ?? 'Could not build template.',
                variant: 'destructive',
            });
        }
    };

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            const detailLines = [];
            let imported = 0;
            let skippedDuplicate = 0;
            let skippedInvalid = 0;
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = getImportDataSheet(workbook, ['Borrowers', 'borrowers']);
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet);
                const centersMap = new Map(centers.map((c) => [c.name.toLowerCase(), c.id]));
                const branchForInsert = officerBranchId ?? user.user_metadata?.branch_id ?? null;

                const seenInFile = new Set();
                for (let idx = 0; idx < json.length; idx++) {
                    const row = json[idx];
                    const rowNum = idx + 2;
                    if (!String(row.first_name ?? '').trim() && !String(row.phone_number ?? '').trim()) {
                        continue;
                    }

                    const pk = normalizePhoneDigitsMax10(String(row.phone_number ?? ''));
                    const idRaw = idKeyForImportDuplicateCheck(row);
                    const ik = normalizeIdKey(idRaw);
                    if (pk && seenInFile.has(`p:${pk}`)) {
                        skippedInvalid += 1;
                        detailLines.push(`Row ${rowNum}: duplicate phone in file (${row.phone_number})`);
                        continue;
                    }
                    if (ik && seenInFile.has(`i:${ik}`)) {
                        skippedInvalid += 1;
                        detailLines.push(`Row ${rowNum}: duplicate ID in file`);
                        continue;
                    }
                    if (pk) seenInFile.add(`p:${pk}`);
                    if (ik) seenInFile.add(`i:${ik}`);

                    let payload;
                    try {
                        const borrower_type = String(row.borrower_type ?? 'group').toLowerCase() || 'group';
                        let group_id = null;
                        let center_id = null;
                        if (borrower_type === 'group') {
                            const centerName = String(row.center_name ?? '').trim().toLowerCase();
                            const groupName = String(row.group_name ?? '').trim().toLowerCase();
                            if (!centerName || !centersMap.has(centerName)) {
                                throw new Error(
                                    `centre '${row.center_name || ''}' not found — use Reference_Centres names exactly`,
                                );
                            }
                            center_id = centersMap.get(centerName);
                            const match = groups.find(
                                (g) => g.center_id === center_id && g.name.toLowerCase() === groupName,
                            );
                            if (!groupName || !match) {
                                throw new Error(`group '${row.group_name || ''}' not found in that centre`);
                            }
                            group_id = match.id;
                        }

                        const phoneImp = validatePhoneNumberTenDigits(String(row.phone_number ?? ''));
                        if (!phoneImp.ok) throw new Error(phoneImp.error);
                        const guarantorPh = validatePhoneNumberTenDigits(String(row.guarantor_phone ?? ''));
                        if (!guarantorPh.ok) throw new Error(guarantorPh.error);
                        if (!String(row.address ?? '').trim()) throw new Error('address required');
                        if (!String(row.business_name ?? '').trim()) throw new Error('business_name required');
                        if (!String(row.business_location ?? '').trim()) throw new Error('business_location required');
                        if (!normalizePersonNameLettersOnly(String(row.guarantor_name ?? '')).trim()) {
                            throw new Error('guarantor_name required');
                        }

                        let idNum = String(row.identification_number ?? '');
                        if (isNationalIdIdentificationType(row.identification_type)) {
                            const nida = validateNidaIdentificationNumber(idNum);
                            if (!nida.ok) throw new Error(nida.error);
                            idNum = nida.value;
                        } else if (isVotersIdIdentificationType(row.identification_type)) {
                            const vid = validateVotersIdentificationNumber(idNum);
                            if (!vid.ok) throw new Error(vid.error);
                            idNum = vid.value;
                        } else if (isDriversLicenseIdentificationType(row.identification_type)) {
                            const dl = validateDriversLicenseIdentificationNumber(idNum);
                            if (!dl.ok) throw new Error(dl.error);
                            idNum = dl.value;
                        } else if (String(row.identification_type ?? '').toLowerCase() === 'passport') {
                            idNum = String(idNum).trim();
                            if (!idNum) throw new Error('passport number required');
                        }

                        const gName = normalizePersonNameLettersOnly(String(row.guarantor_name ?? '')).trim();
                        payload = {
                            first_name: normalizePersonNameLettersOnly(String(row.first_name ?? '')).trim(),
                            surname: normalizePersonNameLettersOnly(String(row.surname ?? '')).trim(),
                            gender: row.gender,
                            phone_number: phoneImp.value,
                            address: String(row.address ?? '').trim(),
                            business_name: String(row.business_name ?? '').trim(),
                            business_location: String(row.business_location ?? '').trim(),
                            identification_type: row.identification_type,
                            identification_number: idNum,
                            borrower_type,
                            group_id,
                            center_id,
                            guarantor_name: gName,
                            guarantor_phone: guarantorPh.value,
                            loan_officer_id: user.id,
                            branch_id: branchForInsert,
                            status: 'eligible',
                            borrower_id: `B-${Date.now().toString().slice(-6)}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
                        };
                    } catch (err) {
                        skippedInvalid += 1;
                        detailLines.push(`Row ${rowNum}: ${err.message}`);
                        continue;
                    }

                    const dup = await fetchDuplicateBorrower(payload.phone_number, payload.identification_number, null);
                    if (dup) {
                        skippedDuplicate += 1;
                        detailLines.push(`Row ${rowNum}: already exists (${dup.borrower_id})`);
                        continue;
                    }

                    const { error: insErr } = await supabase.from('borrowers').insert([payload]);
                    if (insErr) {
                        if (
                            insErr.message?.includes('idx_borrowers_phone_norm_unique') ||
                            insErr.message?.includes('idx_borrowers_ident_norm_unique')
                        ) {
                            skippedDuplicate += 1;
                            detailLines.push(`Row ${rowNum}: duplicate phone/ID in database`);
                        } else {
                            skippedInvalid += 1;
                            detailLines.push(`Row ${rowNum}: ${insErr.message}`);
                        }
                    } else {
                        imported += 1;
                    }
                }

                const { line } = formatImportReportSummary({
                    imported,
                    skippedDuplicate,
                    skippedInvalid,
                    failed: 0,
                });
                setImportReportSummary(line);
                setImportReportDetails(
                    detailLines.length ? detailLines.slice(0, 120).join('\n') + (detailLines.length > 120 ? '\n…' : '') : '',
                );
                setImportReportOpen(true);
                toast({
                    title: imported > 0 ? 'Import finished' : 'Import finished',
                    description: line,
                    variant: imported === 0 && skippedDuplicate + skippedInvalid > 0 ? 'destructive' : 'default',
                });
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
            'pending': 'Pending — re-loan approval',
            'active_loan': 'Active Loan',
            'defaulted': 'Defaulted',
            'paid_up': 'Paid Up',
        };
        return statusTextMap[status] || status;
    }


    if (loading) return <DashboardLayout title="Borrower Management"><div className="flex justify-center items-center h-full">Loading...</div></DashboardLayout>;

    const identificationNumberLabel = getIdentificationNumberFieldLabel(formData.identification_type);

    return (
        <DashboardLayout title="Borrower Management">
            <div className="space-y-6">
                <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={handleDownloadTemplate}
                            disabled={borrowerTemplateDownloadBlocked}
                            title={borrowerTemplateDownloadTitle}
                        >
                            <Download className="mr-2 h-4 w-4" /> Template
                        </Button>
                        <Button onClick={() => importFileRef.current.click()} disabled={isImporting}>
                            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Import
                        </Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        <Dialog open={dialogOpen} onOpenChange={(isOpen) => { if (!isOpen) { setEditingBorrower(null); setFormData(defaultFormState); } setDialogOpen(isOpen); }}>
                            <DialogTrigger asChild>
                                <Button onClick={() => { setFormData(defaultFormState); setEditingBorrower(null); }}><PlusCircle className="mr-2 h-4 w-4" /> Register</Button>
                            </DialogTrigger>
                            <DialogContent
                                className={cn(
                                    /* Base Dialog is mobile-safe; this form uses a fixed column layout + inner scroll */
                                    'flex max-w-3xl flex-col gap-0 overflow-hidden rounded-xl border bg-background p-0 shadow-xl',
                                    'h-[calc(100dvh-2rem)] sm:h-auto sm:max-h-[min(92vh,900px)]',
                                    'sm:w-full sm:p-6',
                                )}
                            >
                                <DialogHeader className="shrink-0 space-y-2 border-b px-4 pb-3 pt-4 text-left sm:border-0 sm:p-0 sm:pb-2">
                                    <DialogTitle className="text-base sm:text-lg">{editingBorrower ? 'Edit' : 'Register'} Borrower</DialogTitle>
                                    <DialogDescription className="text-xs leading-snug sm:text-sm">
                                        All fields are required. Phone and ID must be unique across the system — this prevents the same person registered twice, even across different officers.
                                        New borrowers are registered as <strong>Eligible</strong> and can be selected for a new loan.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch] sm:px-0 sm:py-2">
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                                    <div className="space-y-2"><Label>First name <FieldRequired /></Label><Input value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: normalizePersonNameLettersOnly(e.target.value) })} autoComplete="given-name" required /></div>
                                    <div className="space-y-2"><Label>Surname <FieldRequired /></Label><Input value={formData.surname} onChange={(e) => setFormData({ ...formData, surname: normalizePersonNameLettersOnly(e.target.value) })} autoComplete="family-name" required /></div>
                                    <div className="space-y-2"><Label>Gender <FieldRequired /></Label><Select value={formData.gender} onValueChange={(v) => setFormData({ ...formData, gender: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2">
                                        <Label>Phone ({PHONE_DIGIT_LENGTH} digits) <FieldRequired /></Label>
                                        <Input
                                            value={formData.phone_number}
                                            onChange={(e) => setFormData({ ...formData, phone_number: normalizePhoneDigitsMax10(e.target.value) })}
                                            inputMode="numeric"
                                            maxLength={PHONE_DIGIT_LENGTH}
                                            autoComplete="tel"
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2"><Label>ID type <FieldRequired /></Label><Select value={formData.identification_type} onValueChange={(v) => setFormData((prev) => ({
                                        ...prev,
                                        identification_type: v,
                                        ...(v === 'voters_id' && prev.identification_type !== 'voters_id'
                                            ? { identification_number: 'T' }
                                            : {}),
                                    }))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="national_id">National ID</SelectItem><SelectItem value="passport">Passport</SelectItem><SelectItem value="drivers_license">Driver's License</SelectItem><SelectItem value="voters_id">Voter's ID</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2">
                                        <Label>{identificationNumberLabel} <FieldRequired /></Label>
                                        <Input
                                            value={formData.identification_number}
                                            className={formData.identification_type === 'voters_id' ? 'font-semibold' : undefined}
                                            inputMode={
                                                formData.identification_type === 'national_id' ||
                                                formData.identification_type === 'drivers_license'
                                                    ? 'numeric'
                                                    : undefined
                                            }
                                            autoComplete="off"
                                            required
                                            maxLength={
                                                formData.identification_type === 'national_id'
                                                    ? NIDA_DIGIT_LENGTH
                                                    : formData.identification_type === 'voters_id'
                                                      ? VOTERS_ID_MAX_INPUT_LENGTH
                                                      : formData.identification_type === 'drivers_license'
                                                        ? DRIVER_LICENSE_DIGIT_LENGTH
                                                        : undefined
                                            }
                                            onChange={(e) => {
                                                let v = e.target.value;
                                                if (formData.identification_type === 'national_id') {
                                                    v = normalizeNidaDigits(e.target.value).slice(0, NIDA_DIGIT_LENGTH);
                                                } else if (formData.identification_type === 'voters_id') {
                                                    v = normalizeVotersIdInput(e.target.value);
                                                } else if (formData.identification_type === 'drivers_license') {
                                                    v = normalizeDriversLicenseDigits(e.target.value);
                                                }
                                                setFormData({ ...formData, identification_number: v });
                                            }}
                                        />
                                    </div>
                                    <div className="space-y-2 md:col-span-2"><Label>Address <FieldRequired /></Label><Input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} required /></div>
                                    <div className="space-y-2"><Label>Business name <FieldRequired /></Label><Input value={formData.business_name} onChange={e => setFormData({ ...formData, business_name: e.target.value })} required /></div>
                                    <div className="space-y-2"><Label>Business location <FieldRequired /></Label><Input value={formData.business_location} onChange={e => setFormData({ ...formData, business_location: e.target.value })} required /></div>
                                    <div className="space-y-2 md:col-span-2"><Label>Borrower type <FieldRequired /></Label><Select value={formData.borrower_type} onValueChange={(v) => setFormData({ ...formData, borrower_type: v, group_id: null, center_id: null })}><SelectTrigger><SelectValue placeholder="Select type"/></SelectTrigger><SelectContent><SelectItem value="individual">Individual Borrower</SelectItem><SelectItem value="group">Group Borrower</SelectItem></SelectContent></Select></div>
                                    {formData.borrower_type === 'group' && (
                                        <>
                                            <div className="space-y-2 md:col-span-2">
                                                <Label>Centre <FieldRequired /></Label>
                                                <Select
                                                    value={formData.center_id ?? undefined}
                                                    onValueChange={(v) => setFormData({ ...formData, center_id: v, group_id: null })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select centre" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {centers.map((c) => (
                                                            <SelectItem key={c.id} value={c.id}>
                                                                {c.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {centers.length === 0 && (
                                                    <p className="text-sm text-muted-foreground">No centres yet. Create a centre under Centers &amp; Groups first.</p>
                                                )}
                                            </div>
                                            <div className="space-y-2 md:col-span-2">
                                                <Label>Group <FieldRequired /></Label>
                                                <Select
                                                    value={formData.group_id ?? undefined}
                                                    onValueChange={(v) => setFormData({ ...formData, group_id: v })}
                                                    disabled={!formData.center_id || groupsInSelectedCenter.length === 0}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue
                                                            placeholder={
                                                                formData.center_id ? 'Select group' : 'Select centre first'
                                                            }
                                                        />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {groupsInSelectedCenter.map((g) => (
                                                            <SelectItem key={g.id} value={g.id}>
                                                                {g.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </>
                                    )}
                                    <div className="space-y-2 md:col-span-2 border-t pt-4 mt-2">
                                        <p className="text-sm font-medium text-muted-foreground">Guarantor <FieldRequired /></p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Guarantor name <FieldRequired /></Label>
                                                <Input
                                                    value={formData.guarantor_name}
                                                    onChange={(e) => setFormData({ ...formData, guarantor_name: normalizePersonNameLettersOnly(e.target.value) })}
                                                    autoComplete="off"
                                                    required
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Guarantor phone ({PHONE_DIGIT_LENGTH} digits) <FieldRequired /></Label>
                                                <Input
                                                    value={formData.guarantor_phone}
                                                    onChange={(e) => setFormData({ ...formData, guarantor_phone: normalizePhoneDigitsMax10(e.target.value) })}
                                                    inputMode="numeric"
                                                    maxLength={PHONE_DIGIT_LENGTH}
                                                    autoComplete="off"
                                                    required
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                </div>
                                <div className="flex shrink-0 justify-end border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4">
                                    <Button className="w-full sm:w-auto" onClick={handleSave} disabled={isSaving}>{isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : (editingBorrower ? 'Save Changes' : 'Register Borrower')}</Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatCard title="Total Borrowers" value={stats.total} icon={Users} color="text-blue-600" />
                    <StatCard title="Active Loans" value={stats.active} icon={UserCheck} color="text-yellow-600" />
                    <StatCard title="Eligible" value={stats.eligible} icon={UserPlusIcon} color="text-green-600" />
                    <StatCard title="Pending re-loan approval" value={stats.pending} icon={Clock} color="text-slate-500" />
                    <StatCard title="Defaulted" value={stats.defaulted} icon={UserX} color="text-red-600" />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                            <CardTitle>My Borrowers</CardTitle>
                             <div className="flex flex-wrap items-center gap-2">
                                <Input placeholder="Search ID, name, phone, guarantor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full min-w-[200px] md:w-64" />
                                <SearchableSelect
                                    value={centerFilter}
                                    onValueChange={(v) => {
                                        setCenterFilter(v);
                                        setGroupFilter('all');
                                    }}
                                    options={borrowerListCenterOpts}
                                    allLabel="All centers"
                                    allValue="all"
                                    placeholder="Center"
                                    searchPlaceholder="Search centers…"
                                    emptyText="No center found."
                                    triggerClassName="w-full min-w-[160px] md:w-[180px]"
                                />
                                <SearchableSelect
                                    value={groupFilter}
                                    onValueChange={setGroupFilter}
                                    disabled={centerFilter === 'all'}
                                    options={borrowerListGroupOpts}
                                    allLabel="All groups"
                                    allValue="all"
                                    placeholder={centerFilter === 'all' ? 'Pick center first' : 'Group'}
                                    searchPlaceholder="Search groups…"
                                    emptyText="No group found."
                                    triggerClassName="w-full min-w-[160px] md:w-[180px]"
                                />
                                <SearchableSelect
                                    value={statusFilter}
                                    onValueChange={setStatusFilter}
                                    options={OFFICER_BORROWER_STATUS_FILTER_OPTIONS}
                                    allLabel="All Statuses"
                                    allValue="all"
                                    placeholder="Filter by Status"
                                    searchPlaceholder="Search status…"
                                    emptyText="No match."
                                    triggerClassName="w-full md:w-[180px]"
                                />
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
                                    <Button
                                        onClick={handleGenerateLoanTemplate}
                                        disabled={!loanProducts.length}
                                        title={
                                            !loanProducts.length
                                                ? 'Add at least one active loan product before preparing loan rows.'
                                                : undefined
                                        }
                                    >
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
                                    <TableHead>Guarantor name</TableHead>
                                    <TableHead>Guarantor phone</TableHead>
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
                                        <TableCell className="max-w-[140px] truncate" title={b.guarantor_name || undefined}>
                                            {b.guarantor_name || '—'}
                                        </TableCell>
                                        <TableCell>{b.guarantor_phone || '—'}</TableCell>
                                        <TableCell>{b.borrower_type === 'group' ? getGroupName(b.group_id) : 'Individual'}</TableCell>
                                        <TableCell><Badge variant={getLoanStatusBadge(b.status)}>{getStatusText(b.status)}</Badge></TableCell>
                                        <TableCell className="space-x-2">
                                            {b.status === 'defaulted' && (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    className="mr-1 h-8"
                                                    disabled={requestingApprovalId === b.id}
                                                    onClick={() => handleRequestReloanApproval(b.id)}
                                                >
                                                    {requestingApprovalId === b.id ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        'Request re-loan approval'
                                                    )}
                                                </Button>
                                            )}
                                            <Button variant="outline" size="icon" onClick={() => navigate(`/officer/borrowers/${b.id}`)}><Eye className="h-4 w-4" /></Button>
                                            <Button variant="outline" size="icon" onClick={() => handleEdit(b)}><Edit className="h-4 w-4" /></Button>
                                            <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the borrower and related records.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(b.id)}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredBorrowers.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No borrowers match the current filters.</TableCell>
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
            <ImportResultDialog
                open={importReportOpen}
                onOpenChange={setImportReportOpen}
                summary={importReportSummary}
                details={importReportDetails}
            />
        </DashboardLayout>
    );
};

export default BorrowerManagement;