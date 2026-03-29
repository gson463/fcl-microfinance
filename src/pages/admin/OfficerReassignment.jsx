import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, ArrowRightLeft, UserCheck, RotateCw, Building, Users2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
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

const OfficerReassignment = () => {
  const { toast } = useToast();
  const [officers, setOfficers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [loadingResources, setLoadingResources] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  const [sourceOfficerId, setSourceOfficerId] = useState('');
  const [targetOfficerId, setTargetOfficerId] = useState('');
  
  const [selectedCenters, setSelectedCenters] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectAll, setSelectAll] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, branch_id, email')
        .eq('role', 'officer');

      if (usersError) throw usersError;

      const { data: branchesData, error: branchesError } = await supabase
        .from('branches')
        .select('id, name');
        
      if (branchesError) throw branchesError;

      setOfficers(usersData || []);
      setBranches(branchesData || []);

    } catch (error) {
      toast({ title: "Error fetching data", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch resources when source officer changes
  useEffect(() => {
    if (!sourceOfficerId) {
      setCenters([]);
      setGroups([]);
      return;
    }
    
    const fetchResources = async () => {
      setLoadingResources(true);
      try {
        const { data: centersData } = await supabase.from('centers').select('id, name').eq('loan_officer_id', sourceOfficerId);
        const { data: groupsData } = await supabase.from('groups').select('id, name, center_id').eq('loan_officer_id', sourceOfficerId);
        
        setCenters(centersData || []);
        setGroups(groupsData || []);
        
        // Reset selections when source changes, default to select all
        setSelectAll(true);
      } catch (error) {
         console.error(error);
         toast({ title: "Error", description: "Failed to fetch officer's data", variant: "destructive" });
      } finally {
        setLoadingResources(false);
      }
    };
    fetchResources();
  }, [sourceOfficerId, toast]);

  const getOfficerLabel = (officer) => {
    const branch = branches.find(b => b.id === officer.branch_id);
    return `${officer.full_name} (${branch?.name || 'No Branch'})`;
  };
  
  const handleSelectAllToggle = (checked) => {
    setSelectAll(checked);
    if (checked) {
        setSelectedCenters([]);
        setSelectedGroups([]);
    }
  };

  const toggleCenter = (centerId) => {
    setSelectAll(false);
    setSelectedCenters(prev => 
      prev.includes(centerId) ? prev.filter(id => id !== centerId) : [...prev, centerId]
    );
  };

  const toggleGroup = (groupId) => {
    setSelectAll(false);
    setSelectedGroups(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleReassignment = async () => {
    if (!sourceOfficerId || !targetOfficerId) {
      toast({ title: "Error", description: "Please select both source and target officers.", variant: "destructive" });
      return;
    }
    if (sourceOfficerId === targetOfficerId) {
      toast({ title: "Error", description: "Source and Target officers cannot be the same.", variant: "destructive" });
      return;
    }
    
    if (!selectAll && selectedCenters.length === 0 && selectedGroups.length === 0) {
        toast({ title: "Error", description: "Please select at least one Center or Group to transfer, or choose Select All.", variant: "destructive" });
        return;
    }

    setProcessing(true);
    try {
      // Call the partial reassignment function instead of the full reassignment one
      const { error } = await supabase.rpc('reassign_partial_officer_data', {
        p_old_officer_id: sourceOfficerId,
        p_new_officer_id: targetOfficerId,
        p_center_ids: selectedCenters,
        p_group_ids: selectedGroups,
        p_reassign_all: selectAll
      });

      if (error) throw error;

      toast({
        title: "Reassignment Successful",
        description: selectAll ? "All data transferred successfully." : "Selected items transferred successfully.",
      });
      
      // Reset
      setSourceOfficerId('');
      setTargetOfficerId('');
      setSelectAll(true);
      setSelectedCenters([]);
      setSelectedGroups([]);

    } catch (error) {
      console.error('Reassignment error:', error);
      toast({
        title: "Reassignment Failed",
        description: error.message || "An error occurred during the transfer.",
        variant: "destructive"
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <DashboardLayout title="Officer Reassignment">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="mb-6 flex items-start gap-4">
          <div className="rounded-full bg-brand-gold/15 p-3">
            <ArrowRightLeft className="h-8 w-8 text-brand-gold-deep" aria-hidden />
          </div>
          <p className="text-sm text-neutral-500">
            Transfer ownership of loans, borrowers, and groups from one officer to another.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {/* Source Officer Selection */}
             <Card>
                <CardHeader>
                    <CardTitle className="text-base text-gray-600">Source Officer (From)</CardTitle>
                </CardHeader>
                <CardContent>
                    <Select value={sourceOfficerId} onValueChange={setSourceOfficerId}>
                      <SelectTrigger className="h-12 border-red-200 bg-red-50 focus:ring-red-200">
                        <SelectValue placeholder="Select officer to transfer FROM" />
                      </SelectTrigger>
                      <SelectContent>
                        {officers.map(officer => (
                          <SelectItem key={officer.id} value={officer.id}>
                            {getOfficerLabel(officer)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                </CardContent>
             </Card>

             {/* Target Officer Selection */}
             <Card>
                <CardHeader>
                    <CardTitle className="text-base text-gray-600">Target Officer (To)</CardTitle>
                </CardHeader>
                <CardContent>
                    <Select value={targetOfficerId} onValueChange={setTargetOfficerId}>
                      <SelectTrigger className="h-12 border-green-200 bg-green-50 focus:ring-green-200">
                        <SelectValue placeholder="Select officer to transfer TO" />
                      </SelectTrigger>
                      <SelectContent>
                         {officers.filter(o => o.id !== sourceOfficerId).map(officer => (
                          <SelectItem key={officer.id} value={officer.id}>
                            {getOfficerLabel(officer)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                </CardContent>
             </Card>
        </div>

        {sourceOfficerId && (
            <Card className="border-orange-200 shadow-md">
            <CardHeader className="bg-orange-50 border-b border-orange-100">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-orange-800">
                        <Building className="h-5 w-5" />
                        <CardTitle>Select Data to Transfer</CardTitle>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Checkbox id="select-all" checked={selectAll} onCheckedChange={handleSelectAllToggle} />
                        <Label htmlFor="select-all" className="text-sm font-medium cursor-pointer">Transfer Everything</Label>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-6">
                {loadingResources ? (
                    <div className="flex justify-center py-10">
                        <RotateCw className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                ) : (
                    <div className="space-y-6">
                        {!selectAll && (
                            <div className="bg-blue-50 text-blue-800 p-3 rounded-md text-sm mb-4">
                                <span className="font-semibold">Note:</span> When you select a Center, all Groups inside it are automatically transferred.
                                When you select a Group, all Borrowers and Loans inside it are automatically transferred.
                            </div>
                        )}
                        
                        {/* Centers List */}
                        <div>
                            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Building className="h-4 w-4" /> Centers ({centers.length})</h3>
                            {centers.length === 0 ? <p className="text-sm text-gray-400 italic">No centers found.</p> : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {centers.map(center => (
                                        <div key={center.id} className={cn("flex items-center space-x-2 border p-3 rounded-md transition-colors", (selectedCenters.includes(center.id) || selectAll) ? "bg-green-50 border-green-200" : "bg-white")}>
                                            <Checkbox 
                                                id={`c-${center.id}`} 
                                                checked={selectAll || selectedCenters.includes(center.id)} 
                                                onCheckedChange={() => toggleCenter(center.id)}
                                                disabled={selectAll}
                                            />
                                            <Label htmlFor={`c-${center.id}`} className="cursor-pointer flex-1 truncate" title={center.name}>{center.name}</Label>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Groups List */}
                        <div>
                            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Users2 className="h-4 w-4" /> Groups ({groups.length})</h3>
                            {groups.length === 0 ? <p className="text-sm text-gray-400 italic">No groups found.</p> : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {groups.map(group => {
                                        const parentCenterSelected = selectAll || (group.center_id && selectedCenters.includes(group.center_id));
                                        return (
                                            <div key={group.id} className={cn("flex items-center space-x-2 border p-3 rounded-md transition-colors", (selectedGroups.includes(group.id) || parentCenterSelected) ? "bg-green-50 border-green-200" : "bg-white")}>
                                                <Checkbox 
                                                    id={`g-${group.id}`} 
                                                    checked={parentCenterSelected || selectedGroups.includes(group.id)} 
                                                    onCheckedChange={() => toggleGroup(group.id)}
                                                    disabled={parentCenterSelected} 
                                                />
                                                <div className="flex flex-col overflow-hidden">
                                                    <Label htmlFor={`g-${group.id}`} className="cursor-pointer truncate font-medium" title={group.name}>{group.name}</Label>
                                                    {group.center_id && <span className="text-xs text-gray-400 truncate"> via {centers.find(c => c.id === group.center_id)?.name || 'Unknown Center'}</span>}
                                                </div>
                                                {parentCenterSelected && !selectAll && <Badge variant="secondary" className="ml-auto text-[10px]">Auto</Badge>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex justify-end pt-8">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button 
                        size="lg" 
                        className="w-full md:w-auto min-w-[200px] bg-orange-600 hover:bg-orange-700 text-white"
                        disabled={!sourceOfficerId || !targetOfficerId || processing || (!selectAll && selectedCenters.length === 0 && selectedGroups.length === 0)}
                      >
                        {processing ? <RotateCw className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                        {processing ? 'Transferring...' : 'Confirm Transfer'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Reassignment</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to transfer the selected data?
                          <br/><br/>
                          <strong>Transfer Summary:</strong>
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            <li>From: {officers.find(o => o.id === sourceOfficerId)?.full_name}</li>
                            <li>To: {officers.find(o => o.id === targetOfficerId)?.full_name}</li>
                            <li>Scope: {selectAll ? "EVERYTHING (All Borrowers, Loans, Groups, Centers)" : `Selected items only (${selectedCenters.length} Centers, ${selectedGroups.length} Groups)`}</li>
                          </ul>
                          <br/>
                          This action is immediate and affects live data.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleReassignment} className="bg-orange-600 hover:bg-orange-700">
                          Yes, Transfer Data
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
            </CardContent>
            </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default OfficerReassignment;