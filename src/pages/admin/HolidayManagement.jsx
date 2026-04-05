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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Edit, Trash2, RotateCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { getTanzanianHolidaysForYear, yearRangeInclusive } from '@/lib/tanzaniaHolidays';

function holidayKey(h) {
  return `${h.date}|${h.name}`;
}

const HolidayManagement = () => {
  const { toast } = useToast();
  const [holidays, setHolidays] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentHoliday, setCurrentHoliday] = useState({ id: null, name: '', date: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingBulk, setIsAddingBulk] = useState(false);

  const [tzDialogOpen, setTzDialogOpen] = useState(false);
  const [tzYear, setTzYear] = useState(() => new Date().getFullYear());
  const [tzPreview, setTzPreview] = useState([]);
  const [tzSelected, setTzSelected] = useState(() => new Set());

  const currentCalendarYear = new Date().getFullYear();
  const yearOptions = useMemo(
    () => yearRangeInclusive(currentCalendarYear, currentCalendarYear + 15),
    [currentCalendarYear],
  );

  const fetchHolidays = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('holidays').select('*').order('date', { ascending: true });
    if (error) {
      toast({ title: 'Error', description: 'Could not fetch holidays.', variant: 'destructive' });
    } else {
      setHolidays(data);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  useEffect(() => {
    if (!tzDialogOpen) return;
    const list = getTanzanianHolidaysForYear(tzYear);
    setTzPreview(list);
    const existingDates = new Set((holidays || []).map((h) => h.date));
    const next = new Set();
    list.forEach((h) => {
      if (!existingDates.has(h.date)) {
        next.add(holidayKey(h));
      }
    });
    setTzSelected(next);
  }, [tzDialogOpen, tzYear, holidays]);

  const handleOpenTzDialog = () => {
    setTzYear(currentCalendarYear);
    setTzDialogOpen(true);
  };

  const toggleTzOne = (h, checked, alreadyInDb) => {
    if (alreadyInDb) return;
    const k = holidayKey(h);
    setTzSelected((prev) => {
      const n = new Set(prev);
      if (checked) n.add(k);
      else n.delete(k);
      return n;
    });
  };

  const selectAllAvailableInPreview = () => {
    const existingDates = new Set((holidays || []).map((h) => h.date));
    const next = new Set();
    tzPreview.forEach((h) => {
      if (!existingDates.has(h.date)) next.add(holidayKey(h));
    });
    setTzSelected(next);
  };

  const clearTzSelection = () => {
    setTzSelected(new Set());
  };

  const handleAddTanzanianHolidaysFromDialog = async () => {
    const existingDates = new Set((holidays || []).map((h) => h.date));
    const rows = tzPreview.filter((h) => tzSelected.has(holidayKey(h)) && !existingDates.has(h.date));
    if (rows.length === 0) {
      toast({
        title: 'Nothing to add',
        description: 'Select holidays that are not already saved, or all listed dates are already in the system.',
      });
      return;
    }
    setIsAddingBulk(true);
    const { error } = await supabase.from('holidays').insert(rows.map(({ name, date }) => ({ name, date })));
    setIsAddingBulk(false);
    if (error) {
      toast({ title: 'Error', description: `Failed to add holidays: ${error.message}`, variant: 'destructive' });
    } else {
      toast({
        title: 'Success',
        description: `${rows.length} holiday(s) for ${tzYear} added.`,
      });
      setTzDialogOpen(false);
      fetchHolidays();
    }
  };

  const handleAdd = () => {
    setIsEditing(false);
    setCurrentHoliday({ id: null, name: '', date: '' });
    setDialogOpen(true);
  };

  const handleEdit = (holiday) => {
    setIsEditing(true);
    setCurrentHoliday(holiday);
    setDialogOpen(true);
  };

  const handleDelete = async (holidayId) => {
    const { error } = await supabase.from('holidays').delete().eq('id', holidayId);
    if (error) {
      toast({ title: 'Error', description: `Failed to delete holiday: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Holiday deleted successfully.' });
      fetchHolidays();
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!currentHoliday.name || !currentHoliday.date) {
      toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);

    let result;
    if (isEditing) {
      result = await supabase.from('holidays').update({ name: currentHoliday.name, date: currentHoliday.date }).eq('id', currentHoliday.id);
    } else {
      result = await supabase.from('holidays').insert([{ name: currentHoliday.name, date: currentHoliday.date }]);
    }

    if (result.error) {
      toast({ title: 'Error', description: `Failed to save holiday: ${result.error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Holiday ${isEditing ? 'updated' : 'added'} successfully.` });
      setDialogOpen(false);
      fetchHolidays();
    }
    setIsSaving(false);
  };

  const holidayIds = useMemo(() => (holidays || []).map((h) => h.id), [holidays]);
  const bulk = useBulkSelection(holidayIds);

  const exportHolidaysCsv = () => {
    const rows = (holidays || []).filter((h) => bulk.isSelected(h.id));
    if (rows.length === 0) {
      toast({ title: 'Nothing selected', description: 'Select one or more holidays first.', variant: 'destructive' });
      return;
    }
    exportObjectsToCsv(`holidays_${Date.now()}.csv`, [
      { header: 'Name', accessor: 'name' },
      { header: 'Date', accessor: 'date' },
    ], rows);
    toast({ title: 'Exported', description: `${rows.length} holiday(s) to CSV.` });
  };

  return (
    <DashboardLayout title="Holiday Management">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mb-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={handleOpenTzDialog}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Tanzanian holidays
          </Button>

          <Dialog open={tzDialogOpen} onOpenChange={setTzDialogOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Tanzanian public holidays</DialogTitle>
                <DialogDescription>
                  Choose a year (from this year up to 15 years ahead). Review the list, select the holidays you want, then click Add selected.
                  Dates already saved in the system cannot be selected again.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="tz-year">Year</Label>
                  <Select
                    value={String(tzYear)}
                    onValueChange={(v) => setTzYear(Number(v))}
                  >
                    <SelectTrigger id="tz-year">
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={selectAllAvailableInPreview}>
                    Select all available
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearTzSelection}>
                    Clear selection
                  </Button>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
                  {tzPreview.length === 0 ? (
                    <p className="text-sm text-neutral-500">No holidays for this year.</p>
                  ) : (
                    tzPreview.map((h) => {
                      const existingDates = new Set((holidays || []).map((x) => x.date));
                      const inDb = existingDates.has(h.date);
                      const k = holidayKey(h);
                      const checked = tzSelected.has(k);
                      return (
                        <label
                          key={k}
                          className={`flex cursor-pointer items-start gap-3 rounded-md px-1 py-1.5 text-sm ${
                            inDb ? 'cursor-not-allowed opacity-60' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/80'
                          }`}
                        >
                          <Checkbox
                            checked={inDb ? false : checked}
                            disabled={inDb}
                            onCheckedChange={(v) => toggleTzOne(h, Boolean(v), inDb)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{h.name}</span>
                            <span className="block text-neutral-600 dark:text-neutral-400">
                              {format(parseISO(h.date), 'EEEE, d MMMM yyyy')}
                            </span>
                            {inDb && (
                              <span className="text-xs text-amber-700 dark:text-amber-400">Already in system</span>
                            )}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setTzDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleAddTanzanianHolidaysFromDialog} disabled={isAddingBulk}>
                  {isAddingBulk ? (
                    <>
                      <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                      Adding…
                    </>
                  ) : (
                    'Add selected'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button onClick={handleAdd}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Custom Holiday
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Holiday List</CardTitle>
            <CardDescription>
              Public holidays used when building new schedules and for repayment-day checks. Updating this list does not change existing loans. After a rare change, use Admin → Loans → &quot;Bulk: regenerate schedules&quot; for a branch, or regenerate a single loan from its Schedule dialog.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Holidays...</span>
              </div>
            ) : (
              <>
              <BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportHolidaysCsv} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
                        onCheckedChange={() => bulk.toggleAll()}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Holiday Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holidays.length > 0 ? holidays.map(holiday => (
                    <TableRow key={holiday.id}>
                      <TableCell>
                        <Checkbox
                          checked={bulk.isSelected(holiday.id)}
                          onCheckedChange={() => bulk.toggle(holiday.id)}
                          aria-label="Select row"
                        />
                      </TableCell>
                      <TableCell>{holiday.name}</TableCell>
                      <TableCell>{format(parseISO(holiday.date), 'MMMM dd, yyyy')}</TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(holiday)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the holiday. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(holiday.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-10 text-gray-500">
                        No holidays found. Start by adding a new holiday.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit' : 'Add'} Holiday</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">Holiday Name</Label>
              <Input
                id="name"
                value={currentHoliday.name}
                onChange={(e) => setCurrentHoliday({ ...currentHoliday, name: e.target.value })}
                placeholder="e.g., Nyerere Day"
              />
            </div>
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={currentHoliday.date}
                onChange={(e) => setCurrentHoliday({ ...currentHoliday, date: e.target.value })}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'Save Holiday'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HolidayManagement;
