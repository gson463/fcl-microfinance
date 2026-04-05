import React, { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { RotateCcw } from 'lucide-react';
import { ALL } from '@/lib/hierarchyFilterUtils';

/**
 * Branch → center → group → loan officer + optional date range (disbursement or generic labels).
 */
export function HierarchyFilterBar({
  branches = [],
  centersForBranch = [],
  groupsForCenter = [],
  officersForBranch = [],
  branchId,
  setBranchId,
  centerId,
  setCenterId,
  groupId,
  setGroupId,
  officerId,
  setOfficerId,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  onReset,
  disableBranch = false,
  disableOfficer = false,
  dateLabelFrom = 'From (disbursement)',
  dateLabelTo = 'To (disbursement)',
  showDateRange = true,
  className = '',
}) {
  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: b.id, label: b.name })),
    [branches]
  );
  const centerOptions = useMemo(
    () => centersForBranch.map((c) => ({ value: c.id, label: c.name })),
    [centersForBranch]
  );
  const groupOptions = useMemo(
    () => groupsForCenter.map((g) => ({ value: g.id, label: g.name })),
    [groupsForCenter]
  );
  const officerOptions = useMemo(
    () => officersForBranch.map((o) => ({ value: o.id, label: o.full_name })),
    [officersForBranch]
  );

  return (
    <div className={`flex flex-wrap items-end gap-4 ${className}`}>
      <div className="space-y-2">
        <Label>Branch</Label>
        <SearchableSelect
          value={branchId}
          onValueChange={setBranchId}
          options={branchOptions}
          allLabel="All branches"
          allValue={ALL}
          placeholder="All branches"
          searchPlaceholder="Search branches…"
          emptyText="No branch found."
          disabled={disableBranch}
          triggerClassName="w-[200px]"
        />
      </div>
      <div className="space-y-2">
        <Label>Center</Label>
        <SearchableSelect
          value={centerId}
          onValueChange={setCenterId}
          options={centerOptions}
          allLabel="All centers"
          allValue={ALL}
          placeholder="All centers"
          searchPlaceholder="Search centers…"
          emptyText="No center found."
          triggerClassName="w-[200px]"
        />
      </div>
      <div className="space-y-2">
        <Label>Group</Label>
        <SearchableSelect
          value={groupId}
          onValueChange={setGroupId}
          options={groupOptions}
          allLabel="All groups"
          allValue={ALL}
          placeholder={centerId === ALL ? 'Pick a center first' : 'All groups'}
          searchPlaceholder="Search groups…"
          emptyText="No group found."
          disabled={centerId === ALL}
          triggerClassName="w-[200px]"
        />
      </div>
      <div className="space-y-2">
        <Label>Loan officer</Label>
        <SearchableSelect
          value={officerId}
          onValueChange={setOfficerId}
          options={officerOptions}
          allLabel="All officers"
          allValue={ALL}
          placeholder="All officers"
          searchPlaceholder="Search officers…"
          emptyText="No officer found."
          disabled={disableOfficer}
          triggerClassName="w-[220px]"
        />
      </div>
      {showDateRange && (
        <>
          <div className="space-y-2">
            <Label htmlFor="hf-date-from">{dateLabelFrom}</Label>
            <Input
              id="hf-date-from"
              type="date"
              className="w-[160px]"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hf-date-to">{dateLabelTo}</Label>
            <Input
              id="hf-date-to"
              type="date"
              className="w-[160px]"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </>
      )}
      {onReset && (
        <Button type="button" variant="outline" size="sm" className="mb-0.5" onClick={onReset}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset filters
        </Button>
      )}
    </div>
  );
}
