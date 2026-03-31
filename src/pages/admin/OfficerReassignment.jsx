import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, ArrowRightLeft, UserCheck, RotateCw, Building, Users2, User } from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';

const OfficerReassignment = () => {
  const { toast } = useToast();
  const [officers, setOfficers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [borrowers, setBorrowers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingResources, setLoadingResources] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [sourceOfficerId, setSourceOfficerId] = useState('');
  const [targetOfficerId, setTargetOfficerId] = useState('');

  const [transferEverything, setTransferEverything] = useState(true);
  const [selectedCenterIds, setSelectedCenterIds] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [selectedBorrowerIds, setSelectedBorrowerIds] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, branch_id, email')
        .eq('role', 'officer');

      if (usersError) throw usersError;

      const { data: branchesData, error: branchesError } = await supabase.from('branches').select('id, name');

      if (branchesError) throw branchesError;

      setOfficers(usersData || []);
      setBranches(branchesData || []);
    } catch (error) {
      toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!sourceOfficerId) {
      setCenters([]);
      setGroups([]);
      setBorrowers([]);
      return;
    }

    const fetchResources = async () => {
      setLoadingResources(true);
      try {
        const [{ data: centersData }, { data: groupsData }, { data: borrowersData }] = await Promise.all([
          supabase.from('centers').select('id, name').eq('loan_officer_id', sourceOfficerId),
          supabase.from('groups').select('id, name, center_id').eq('loan_officer_id', sourceOfficerId),
          supabase
            .from('borrowers')
            .select('id, borrower_id, first_name, surname, group_id')
            .eq('loan_officer_id', sourceOfficerId),
        ]);

        setCenters(centersData || []);
        setGroups(groupsData || []);
        setBorrowers(borrowersData || []);

        setTransferEverything(true);
        setSelectedCenterIds([]);
        setSelectedGroupIds([]);
        setSelectedBorrowerIds([]);
      } catch (error) {
        console.error(error);
        toast({ title: 'Error', description: "Failed to fetch officer's data", variant: 'destructive' });
      } finally {
        setLoadingResources(false);
      }
    };
    fetchResources();
  }, [sourceOfficerId, toast]);

  const getOfficerLabel = (officer) => {
    const branch = branches.find((b) => b.id === officer.branch_id);
    return `${officer.full_name} (${branch?.name || 'No Branch'})`;
  };

  const groupsByCenterId = useMemo(() => {
    const m = new Map();
    for (const g of groups) {
      const cid = g.center_id || '_none';
      if (!m.has(cid)) m.set(cid, []);
      m.get(cid).push(g);
    }
    return m;
  }, [groups]);

  const borrowersByGroupId = useMemo(() => {
    const m = new Map();
    for (const b of borrowers) {
      if (!b.group_id) continue;
      if (!m.has(b.group_id)) m.set(b.group_id, []);
      m.get(b.group_id).push(b);
    }
    return m;
  }, [borrowers]);

  const individualBorrowers = useMemo(() => borrowers.filter((b) => !b.group_id), [borrowers]);

  const isCenterSelected = (centerId) => transferEverything || selectedCenterIds.includes(centerId);

  const isGroupCoveredBySelectedCenter = (group) =>
    !!(group?.center_id && selectedCenterIds.includes(group.center_id));

  const isGroupSelected = (groupId) =>
    transferEverything || selectedGroupIds.includes(groupId) || isGroupCoveredBySelectedCenter(groups.find((g) => g.id === groupId));

  const isBorrowerCoveredByScope = useCallback(
    (b) => {
      if (transferEverything) return true;
      if (!b.group_id) return false;
      const g = groups.find((x) => x.id === b.group_id);
      if (!g) return false;
      if (g.center_id && selectedCenterIds.includes(g.center_id)) return true;
      if (selectedGroupIds.includes(b.group_id)) return true;
      return false;
    },
    [transferEverything, groups, selectedCenterIds, selectedGroupIds]
  );

  /** Borrower IDs that need reassign_borrowers_by_ids (not already moved by centre/group RPC) */
  const borrowerIdsForGranularRpc = useMemo(() => {
    return selectedBorrowerIds.filter((id) => {
      const b = borrowers.find((x) => x.id === id);
      if (!b) return false;
      return !isBorrowerCoveredByScope(b);
    });
  }, [selectedBorrowerIds, borrowers, isBorrowerCoveredByScope]);

  const groupIdsForRpc = useMemo(() => {
    return selectedGroupIds.filter((gid) => {
      const g = groups.find((x) => x.id === gid);
      if (!g || !g.center_id) return true;
      if (selectedCenterIds.includes(g.center_id)) return false;
      return true;
    });
  }, [selectedGroupIds, selectedCenterIds, groups]);

  const setTransferEverythingToggle = (checked) => {
    setTransferEverything(!!checked);
    if (checked) {
      setSelectedCenterIds([]);
      setSelectedGroupIds([]);
      setSelectedBorrowerIds([]);
    }
  };

  const toggleCenter = (centerId) => {
    setTransferEverything(false);
    setSelectedCenterIds((prev) =>
      prev.includes(centerId) ? prev.filter((id) => id !== centerId) : [...prev, centerId]
    );
  };

  const toggleGroup = (groupId) => {
    const g = groups.find((x) => x.id === groupId);
    if (g && g.center_id && selectedCenterIds.includes(g.center_id)) return;
    setTransferEverything(false);
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleBorrower = (borrowerId) => {
    if (transferEverything) return;
    const b = borrowers.find((x) => x.id === borrowerId);
    if (b && isBorrowerCoveredByScope(b)) return;
    setSelectedBorrowerIds((prev) =>
      prev.includes(borrowerId) ? prev.filter((id) => id !== borrowerId) : [...prev, borrowerId]
    );
  };

  const selectAllCenters = () => {
    setTransferEverything(false);
    setSelectedCenterIds(centers.map((c) => c.id));
    setSelectedGroupIds([]);
    setSelectedBorrowerIds([]);
  };

  const selectAllGroupsGlobal = () => {
    setTransferEverything(false);
    setSelectedCenterIds([]);
    setSelectedGroupIds(groups.map((g) => g.id));
    setSelectedBorrowerIds([]);
  };

  const selectAllBorrowersInGroup = (groupId) => {
    const g = groups.find((x) => x.id === groupId);
    if (g && g.center_id && selectedCenterIds.includes(g.center_id)) return;
    if (selectedGroupIds.includes(groupId)) return;
    const list = borrowersByGroupId.get(groupId) || [];
    setTransferEverything(false);
    setSelectedBorrowerIds((prev) => {
      const set = new Set(prev);
      for (const b of list) set.add(b.id);
      return [...set];
    });
  };

  const selectAllIndividuals = () => {
    setTransferEverything(false);
    setSelectedBorrowerIds(individualBorrowers.map((b) => b.id));
  };

  const hasSelection =
    transferEverything ||
    selectedCenterIds.length > 0 ||
    groupIdsForRpc.length > 0 ||
    borrowerIdsForGranularRpc.length > 0;

  const handleReassignment = async () => {
    if (!sourceOfficerId || !targetOfficerId) {
      toast({ title: 'Error', description: 'Please select both source and target officers.', variant: 'destructive' });
      return;
    }
    if (sourceOfficerId === targetOfficerId) {
      toast({ title: 'Error', description: 'Source and target officers cannot be the same.', variant: 'destructive' });
      return;
    }
    if (!hasSelection) {
      toast({
        title: 'Error',
        description: 'Choose Transfer everything, or select at least one centre, group, or borrower.',
        variant: 'destructive',
      });
      return;
    }

    setProcessing(true);
    try {
      if (transferEverything) {
        const { error } = await supabase.rpc('reassign_partial_officer_data', {
          p_old_officer_id: sourceOfficerId,
          p_new_officer_id: targetOfficerId,
          p_center_ids: [],
          p_group_ids: [],
          p_reassign_all: true,
        });
        if (error) throw error;
      } else {
        const { error: e1 } = await supabase.rpc('reassign_partial_officer_data', {
          p_old_officer_id: sourceOfficerId,
          p_new_officer_id: targetOfficerId,
          p_center_ids: selectedCenterIds,
          p_group_ids: groupIdsForRpc,
          p_reassign_all: false,
        });
        if (e1) throw e1;

        if (borrowerIdsForGranularRpc.length > 0) {
          const { error: e2 } = await supabase.rpc('reassign_borrowers_by_ids', {
            p_old_officer_id: sourceOfficerId,
            p_new_officer_id: targetOfficerId,
            p_borrower_ids: borrowerIdsForGranularRpc,
          });
          if (e2) throw e2;
        }
      }

      toast({
        title: 'Transfer successful',
        description: transferEverything
          ? 'All centres, groups, borrowers, and loans were transferred.'
          : 'Selected centres, groups, and/or borrowers were transferred.',
      });

      setSourceOfficerId('');
      setTargetOfficerId('');
      setTransferEverything(true);
      setSelectedCenterIds([]);
      setSelectedGroupIds([]);
      setSelectedBorrowerIds([]);
    } catch (error) {
      console.error('Reassignment error:', error);
      toast({
        title: 'Transfer failed',
        description: error.message || 'An error occurred during the transfer.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const summaryLines = useMemo(() => {
    if (transferEverything) return ['Scope: everything under this officer (all centres, groups, borrowers, loans).'];
    const lines = [];
    if (selectedCenterIds.length) lines.push(`${selectedCenterIds.length} centre(s)`);
    if (groupIdsForRpc.length) lines.push(`${groupIdsForRpc.length} group(s) (not already covered by a selected centre)`);
    if (borrowerIdsForGranularRpc.length)
      lines.push(`${borrowerIdsForGranularRpc.length} borrower(s) (individual picks or partial group)`);
    return lines;
  }, [transferEverything, selectedCenterIds.length, groupIdsForRpc.length, borrowerIdsForGranularRpc.length]);

  if (loading) {
    return (
      <DashboardLayout title="Officer & borrower transfer">
        <div className="flex justify-center py-16">
          <RotateCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Officer & borrower transfer">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="mb-6 flex items-start gap-4">
          <div className="rounded-full bg-brand-gold/15 p-3">
            <ArrowRightLeft className="h-8 w-8 text-brand-gold-deep" aria-hidden />
          </div>
          <div>
            <p className="text-sm text-neutral-600">
              Transfer centres, groups, and borrowers (and their loans) from one loan officer to another. Use{' '}
              <strong>Transfer everything</strong> for a full handover, or expand the tree to pick specific centres,
              groups, or individual borrowers.
            </p>
            <p className="mt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200/90">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              Selecting a centre moves its groups and borrowers. Selecting a group moves all borrowers in that group. You
              can also pick single borrowers (e.g. only some members of a group) without moving the whole group.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-600">Source officer (from)</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={sourceOfficerId} onValueChange={setSourceOfficerId}>
                <SelectTrigger className="h-12 border-red-200 bg-red-50 focus:ring-red-200">
                  <SelectValue placeholder="Select officer to transfer FROM" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map((officer) => (
                    <SelectItem key={officer.id} value={officer.id}>
                      {getOfficerLabel(officer)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-600">Target officer (to)</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={targetOfficerId} onValueChange={setTargetOfficerId}>
                <SelectTrigger className="h-12 border-green-200 bg-green-50 focus:ring-green-200">
                  <SelectValue placeholder="Select officer to transfer TO" />
                </SelectTrigger>
                <SelectContent>
                  {officers
                    .filter((o) => o.id !== sourceOfficerId)
                    .map((officer) => (
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
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-orange-800">
                  <Building className="h-5 w-5" />
                  <CardTitle>What to transfer</CardTitle>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="transfer-all"
                      checked={transferEverything}
                      onCheckedChange={setTransferEverythingToggle}
                    />
                    <Label htmlFor="transfer-all" className="text-sm font-semibold cursor-pointer">
                      Transfer everything
                    </Label>
                  </div>
                  {!transferEverything && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={selectAllCenters}>
                        All centres
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={selectAllGroupsGlobal}>
                        All groups
                      </Button>
                      {individualBorrowers.length > 0 && (
                        <Button type="button" variant="outline" size="sm" onClick={selectAllIndividuals}>
                          All individual borrowers
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <CardDescription className="text-orange-900/80">
                When not using &quot;Transfer everything&quot;, tick centres, groups, and/or borrowers below. Quick
                actions select all items in that category only.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {loadingResources ? (
                <div className="flex justify-center py-10">
                  <RotateCw className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className={cn('space-y-8', transferEverything && 'opacity-60 pointer-events-none')}>
                  {/* Centres */}
                  <div>
                    <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <Building className="h-4 w-4" /> Centres ({centers.length})
                    </h3>
                    {centers.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">No centres.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {centers.map((center) => (
                          <div
                            key={center.id}
                            className={cn(
                              'flex items-center space-x-2 border p-3 rounded-md transition-colors',
                              isCenterSelected(center.id) ? 'bg-green-50 border-green-200' : 'bg-white'
                            )}
                          >
                            <Checkbox
                              id={`c-${center.id}`}
                              checked={isCenterSelected(center.id)}
                              onCheckedChange={() => toggleCenter(center.id)}
                              disabled={transferEverything}
                            />
                            <Label htmlFor={`c-${center.id}`} className="cursor-pointer flex-1 truncate" title={center.name}>
                              {center.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border my-6" role="separator" />

                  {/* Groups + borrowers tree */}
                  <div>
                    <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <Users2 className="h-4 w-4" /> Groups & borrowers ({groups.length} groups, {borrowers.length}{' '}
                      borrowers)
                    </h3>
                    {groups.length === 0 && individualBorrowers.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">No groups or borrowers.</p>
                    ) : (
                      <div className="space-y-6">
                        {centers.map((center) => {
                          const centreGroups = groupsByCenterId.get(center.id) || [];
                          if (centreGroups.length === 0) return null;
                          return (
                            <div key={center.id} className="border rounded-lg p-4 bg-muted/20">
                              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
                                Centre: {center.name}
                                {isCenterSelected(center.id) && (
                                  <Badge variant="secondary" className="ml-2">
                                    Included — all groups & borrowers below
                                  </Badge>
                                )}
                              </p>
                              <div className="space-y-4 pl-2 border-l-2 border-orange-200/80">
                                {centreGroups.map((group) => {
                                  const gBorrowers = borrowersByGroupId.get(group.id) || [];
                                  const centreCovers = isCenterSelected(center.id);
                                  const groupChecked = isGroupSelected(group.id);
                                  return (
                                    <div key={group.id} className="rounded-md border bg-background p-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Checkbox
                                          id={`g-${group.id}`}
                                          checked={groupChecked}
                                          onCheckedChange={() => toggleGroup(group.id)}
                                          disabled={transferEverything || centreCovers}
                                        />
                                        <Label htmlFor={`g-${group.id}`} className="cursor-pointer font-medium flex-1">
                                          {group.name}
                                        </Label>
                                        {centreCovers && !transferEverything && (
                                          <Badge variant="outline" className="text-[10px]">
                                            via centre
                                          </Badge>
                                        )}
                                        {gBorrowers.length > 0 && !centreCovers && !selectedGroupIds.includes(group.id) && (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => selectAllBorrowersInGroup(group.id)}
                                          >
                                            Select all borrowers in group
                                          </Button>
                                        )}
                                      </div>
                                      {gBorrowers.length > 0 && (
                                        <div className="mt-3 ml-6 space-y-2 border-l border-dashed pl-3">
                                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                            <User className="h-3 w-3" /> Borrowers
                                          </p>
                                          {gBorrowers.map((b) => {
                                            const covered = transferEverything || isBorrowerCoveredByScope(b);
                                            const checked = covered || selectedBorrowerIds.includes(b.id);
                                            return (
                                              <div
                                                key={b.id}
                                                className={cn(
                                                  'flex items-center gap-2 text-sm',
                                                  covered && 'opacity-70'
                                                )}
                                              >
                                                <Checkbox
                                                  id={`b-${b.id}`}
                                                  checked={checked}
                                                  onCheckedChange={() => toggleBorrower(b.id)}
                                                  disabled={transferEverything || covered}
                                                />
                                                <Label htmlFor={`b-${b.id}`} className="cursor-pointer font-normal flex-1">
                                                  {b.first_name} {b.surname}
                                                  <span className="text-muted-foreground ml-1">({b.borrower_id})</span>
                                                </Label>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {/* Groups without centre */}
                        {(groupsByCenterId.get('_none') || []).length > 0 && (
                          <div className="border rounded-lg p-4 bg-muted/20">
                            <p className="text-xs font-medium text-muted-foreground mb-3">Groups without centre</p>
                            <div className="space-y-4">
                              {(groupsByCenterId.get('_none') || []).map((group) => {
                                const gBorrowers = borrowersByGroupId.get(group.id) || [];
                                const groupChecked = isGroupSelected(group.id);
                                return (
                                  <div key={group.id} className="rounded-md border bg-background p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Checkbox
                                        id={`g-${group.id}`}
                                        checked={groupChecked}
                                        onCheckedChange={() => toggleGroup(group.id)}
                                        disabled={transferEverything}
                                      />
                                      <Label htmlFor={`g-${group.id}`} className="cursor-pointer font-medium flex-1">
                                        {group.name}
                                      </Label>
                                      {gBorrowers.length > 0 && !selectedGroupIds.includes(group.id) && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 text-xs"
                                          onClick={() => selectAllBorrowersInGroup(group.id)}
                                        >
                                          Select all borrowers in group
                                        </Button>
                                      )}
                                    </div>
                                    {gBorrowers.length > 0 && (
                                      <div className="mt-3 ml-6 space-y-2 border-l border-dashed pl-3">
                                        {gBorrowers.map((b) => {
                                          const covered = transferEverything || isBorrowerCoveredByScope(b);
                                          const checked = covered || selectedBorrowerIds.includes(b.id);
                                          return (
                                            <div key={b.id} className="flex items-center gap-2 text-sm">
                                              <Checkbox
                                                id={`b-${b.id}`}
                                                checked={checked}
                                                onCheckedChange={() => toggleBorrower(b.id)}
                                                disabled={transferEverything || covered}
                                              />
                                              <Label htmlFor={`b-${b.id}`} className="cursor-pointer font-normal flex-1">
                                                {b.first_name} {b.surname}{' '}
                                                <span className="text-muted-foreground">({b.borrower_id})</span>
                                              </Label>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {individualBorrowers.length > 0 && (
                          <div className="border rounded-lg p-4 bg-blue-50/40 dark:bg-blue-950/20">
                            <p className="text-sm font-medium mb-3 flex items-center gap-2">
                              <User className="h-4 w-4" /> Individual borrowers (no group)
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {individualBorrowers.map((b) => (
                                <div key={b.id} className="flex items-center gap-2 border rounded p-2 bg-background text-sm">
                                  <Checkbox
                                    id={`ib-${b.id}`}
                                    checked={transferEverything || selectedBorrowerIds.includes(b.id)}
                                    onCheckedChange={() => toggleBorrower(b.id)}
                                    disabled={transferEverything}
                                  />
                                  <Label htmlFor={`ib-${b.id}`} className="cursor-pointer flex-1">
                                    {b.first_name} {b.surname}{' '}
                                    <span className="text-muted-foreground">({b.borrower_id})</span>
                                  </Label>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
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
                      disabled={!sourceOfficerId || !targetOfficerId || processing || !hasSelection}
                    >
                      {processing ? <RotateCw className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                      {processing ? 'Transferring…' : 'Confirm transfer'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="max-w-lg">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm transfer</AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div className="text-sm text-muted-foreground space-y-3">
                          <p>
                            From <strong>{officers.find((o) => o.id === sourceOfficerId)?.full_name}</strong> to{' '}
                            <strong>{officers.find((o) => o.id === targetOfficerId)?.full_name}</strong>.
                          </p>
                          <div>
                            <p className="font-medium text-foreground">Summary</p>
                            <ul className="list-disc list-inside mt-2 space-y-1">
                              {summaryLines.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          </div>
                          <p>This updates live borrower and loan records immediately.</p>
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleReassignment} className="bg-orange-600 hover:bg-orange-700">
                        Yes, transfer
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
