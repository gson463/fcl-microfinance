import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { format, parseISO } from 'date-fns';
import { ClipboardList, Plus, FileDown, Save, Loader2, Trash2, Layers } from 'lucide-react';
import { downloadAttendanceSheetPdf, downloadRecordedAttendancePdf, downloadCompiledAttendancePdf } from '@/lib/attendanceSheetPdf';
import { DEFAULT_SYSTEM_NAME, DEFAULT_TAGLINE, resolveLogoUrl } from '@/lib/brand';
import { borrowerPublicId } from '@/lib/borrowerPublicId';
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

function groupBorrowersByGroup(borrowers, groups) {
  const gmap = new Map(groups.map((g) => [g.id, g]));
  const byG = new Map();
  for (const b of borrowers) {
    const gid = b.group_id;
    if (!gid) continue;
    if (!byG.has(gid)) byG.set(gid, []);
    byG.get(gid).push(b);
  }
  return Array.from(byG.entries()).map(([gid, rows]) => ({
    group: gmap.get(gid),
    borrowers: rows.sort((a, b) => `${a.first_name} ${a.surname}`.localeCompare(`${b.first_name} ${b.surname}`)),
  }));
}

/** Saved in DB; ruhusa = excused (does not count toward loan-increase meeting minimum). */
const STATUS_KEYS = ['present', 'absent', 'ruhusa'];
function statusLabel(s) {
  if (s === 'absent') return 'Absent';
  if (s === 'ruhusa') return 'Ruhusa';
  return 'Present';
}

const AttendanceManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [borrowers, setBorrowers] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [systemName, setSystemName] = useState(DEFAULT_SYSTEM_NAME);
  const [logoUrl, setLogoUrl] = useState('');

  const [newMeetingCentre, setNewMeetingCentre] = useState('');
  const [newMeetingDate, setNewMeetingDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [savingMeeting, setSavingMeeting] = useState(false);

  const [recordMeetingId, setRecordMeetingId] = useState('');
  /** borrower_id -> 'present' | 'absent' | 'ruhusa' */
  const [attendanceMap, setAttendanceMap] = useState({});
  const [savingAttendance, setSavingAttendance] = useState(false);

  const [printCentreId, setPrintCentreId] = useState('');
  const [printBoxes, setPrintBoxes] = useState(12);

  const [statsRows, setStatsRows] = useState([]);
  /** For Print tab: export saved attendance for a chosen meeting */
  const [printRecordedMeetingId, setPrintRecordedMeetingId] = useState('');
  /** Multi-select meeting IDs for compiled PDF */
  const [compileMeetingIds, setCompileMeetingIds] = useState([]);
  const [compilingPdf, setCompilingPdf] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [{ data: cfgRows }, { data: cData }, { data: gData }, { data: bData }, { data: mData }] = await Promise.all([
        supabase.from('system_config').select('key, value').in('key', ['systemName', 'logoUrl']),
        supabase.from('centers').select('*').eq('loan_officer_id', user.id).order('name'),
        supabase.from('groups').select('*').eq('loan_officer_id', user.id),
        supabase.from('borrowers').select('*').eq('loan_officer_id', user.id),
        supabase
          .from('centre_meetings')
          .select('*, centers(name)')
          .eq('loan_officer_id', user.id)
          .order('meeting_date', { ascending: false }),
      ]);
      const sn = cfgRows?.find((r) => r.key === 'systemName')?.value;
      if (sn) setSystemName(sn);
      const lu = cfgRows?.find((r) => r.key === 'logoUrl')?.value;
      setLogoUrl(lu && String(lu).trim() ? lu : '');
      setCenters(cData || []);
      setGroups(gData || []);
      setBorrowers(bData || []);
      setMeetings(mData || []);
      if (cData?.length) {
        setPrintCentreId((prev) => prev || cData[0].id);
        setNewMeetingCentre((prev) => prev || cData[0].id);
      }
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.id, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const centreName = (id) => centers.find((c) => c.id === id)?.name || '—';

  const createMeeting = async () => {
    if (!newMeetingCentre || !newMeetingDate) {
      toast({ title: 'Missing fields', description: 'Select centre and date.', variant: 'destructive' });
      return;
    }
    setSavingMeeting(true);
    const { error } = await supabase.from('centre_meetings').insert({
      centre_id: newMeetingCentre,
      meeting_date: newMeetingDate,
      loan_officer_id: user.id,
    });
    setSavingMeeting(false);
    if (error) {
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        toast({
          title: 'Duplicate',
          description: 'A meeting for this centre on this date already exists.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      }
      return;
    }
    toast({ title: 'Meeting scheduled', description: 'You can record attendance below.' });
    fetchAll();
  };

  const deleteMeeting = async (id) => {
    const { error } = await supabase.from('centre_meetings').delete().eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Deleted', description: 'Meeting removed.' });
      if (recordMeetingId === id) setRecordMeetingId('');
      fetchAll();
    }
  };

  const selectedMeeting = useMemo(() => meetings.find((m) => m.id === recordMeetingId), [meetings, recordMeetingId]);

  useEffect(() => {
    if (!selectedMeeting || !borrowers.length) {
      setAttendanceMap({});
      return;
    }
    const centreId = selectedMeeting.centre_id;
    const centreGroups = groups.filter((g) => g.center_id === centreId);
    const gids = new Set(centreGroups.map((g) => g.id));
    const list = borrowers.filter((b) => b.group_id && gids.has(b.group_id));

    (async () => {
      const { data: recs } = await supabase
        .from('attendance_records')
        .select('borrower_id, attendance_status')
        .eq('centre_meeting_id', selectedMeeting.id);

      const m = {};
      for (const b of list) {
        m[b.id] = 'present';
      }
      if (recs?.length) {
        for (const r of recs) {
          const st = r.attendance_status;
          m[r.borrower_id] = STATUS_KEYS.includes(st) ? st : 'present';
        }
      }
      setAttendanceMap(m);
    })();
  }, [selectedMeeting, borrowers, groups]);

  const borrowersForSelectedMeeting = useMemo(() => {
    if (!selectedMeeting) return [];
    const centreId = selectedMeeting.centre_id;
    const centreGroups = groups.filter((g) => g.center_id === centreId);
    const gids = new Set(centreGroups.map((g) => g.id));
    return borrowers.filter((b) => b.group_id && gids.has(b.group_id));
  }, [selectedMeeting, borrowers, groups]);

  const saveAttendance = async () => {
    if (!selectedMeeting) return;
    setSavingAttendance(true);
    const rows = borrowersForSelectedMeeting.map((b) => ({
      centre_meeting_id: selectedMeeting.id,
      borrower_id: b.id,
      group_id: b.group_id,
      attendance_status: STATUS_KEYS.includes(attendanceMap[b.id]) ? attendanceMap[b.id] : 'present',
    }));
    const { error } = await supabase.from('attendance_records').upsert(rows, {
      onConflict: 'centre_meeting_id,borrower_id',
    });
    setSavingAttendance(false);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Saved', description: 'Attendance updated.' });
      loadStats();
    }
  };

  const loadStats = useCallback(async () => {
    if (!user?.id || !borrowers.length) {
      setStatsRows([]);
      return;
    }
    const { data: myMeetings } = await supabase.from('centre_meetings').select('id').eq('loan_officer_id', user.id);
    const mids = (myMeetings || []).map((m) => m.id);
    const myBorrowerIds = new Set(borrowers.map((b) => b.id));
    const counts = new Map();
    if (mids.length) {
      const { data: att } = await supabase
        .from('attendance_records')
        .select('borrower_id')
        .in('centre_meeting_id', mids)
        .eq('attendance_status', 'present');
      for (const a of att || []) {
        if (!myBorrowerIds.has(a.borrower_id)) continue;
        counts.set(a.borrower_id, (counts.get(a.borrower_id) || 0) + 1);
      }
    }
    const rows = borrowers.map((b) => ({
      id: b.id,
      name: `${b.first_name} ${b.surname}`,
      borrower_id: b.borrower_id,
      meetings: counts.get(b.id) || 0,
    }));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    setStatsRows(rows);
  }, [user?.id, borrowers]);

  useEffect(() => {
    if (borrowers.length) loadStats();
  }, [borrowers, loadStats]);

  const runPrintPdf = async () => {
    if (!printCentreId) {
      toast({ title: 'Select centre', variant: 'destructive' });
      return;
    }
    const centre = centers.find((c) => c.id === printCentreId);
    const centreGroups = groups.filter((g) => g.center_id === printCentreId);
    const gids = new Set(centreGroups.map((g) => g.id));
    const list = borrowers.filter((b) => b.group_id && gids.has(b.group_id));
    if (!list.length) {
      toast({
        title: 'No borrowers',
        description: 'Add groups and borrowers for this centre first.',
        variant: 'destructive',
      });
      return;
    }
    const grouped = groupBorrowersByGroup(list, centreGroups);
    const pdfGroups = grouped.map((g, gi) => ({
      groupName: g.group?.name ? `Group: ${g.group.name}` : `Group ${gi + 1}`,
      rows: g.borrowers.map((b, idx) => ({
        sn: idx + 1,
        name: `${b.first_name} ${b.surname}`,
      })),
    }));
    try {
      await downloadAttendanceSheetPdf({
        systemName,
        logoUrl: resolveLogoUrl(logoUrl),
        tagline: DEFAULT_TAGLINE,
        centreName: centre?.name || 'Centre',
        officerName: user?.user_metadata?.full_name || user?.email || 'Officer',
        meetingDate: format(new Date(), 'yyyy-MM-dd'),
        groups: pdfGroups,
        numBoxes: printBoxes,
        fileName: `attendance_${centre?.name || 'centre'}_${format(new Date(), 'yyyyMMdd')}`,
      });
      toast({ title: 'PDF ready', description: 'Download started.' });
    } catch (e) {
      toast({ title: 'PDF error', description: e?.message || 'Could not generate PDF.', variant: 'destructive' });
    }
  };

  const buildRecordedPdfGroups = (meeting, statusByBorrowerId) => {
    const centreId = meeting.centre_id;
    const centreGroups = groups.filter((g) => g.center_id === centreId);
    const gids = new Set(centreGroups.map((g) => g.id));
    const list = borrowers.filter((b) => b.group_id && gids.has(b.group_id));
    const grouped = groupBorrowersByGroup(list, centreGroups);
    return grouped.map((g, gi) => ({
      groupName: g.group?.name ? `Group: ${g.group.name}` : `Group ${gi + 1}`,
      rows: g.borrowers.map((b, idx) => ({
        sn: idx + 1,
        name: `${b.first_name} ${b.surname}`,
        borrowerId: b.borrower_id,
        status: STATUS_KEYS.includes(statusByBorrowerId[b.id]) ? statusByBorrowerId[b.id] : 'present',
      })),
    }));
  };

  const runPrintRecordedFromScreen = async () => {
    if (!selectedMeeting) {
      toast({ title: 'Select a meeting', variant: 'destructive' });
      return;
    }
    if (!borrowersForSelectedMeeting.length) {
      toast({ title: 'No borrowers', description: 'No borrowers in this centre.', variant: 'destructive' });
      return;
    }
    const centre = centers.find((c) => c.id === selectedMeeting.centre_id);
    const pdfGroups = buildRecordedPdfGroups(selectedMeeting, attendanceMap);
    try {
      await downloadRecordedAttendancePdf({
        systemName,
        logoUrl: resolveLogoUrl(logoUrl),
        tagline: DEFAULT_TAGLINE,
        centreName: centre?.name || selectedMeeting.centers?.name || 'Centre',
        officerName: user?.user_metadata?.full_name || user?.email || 'Officer',
        meetingDate: format(parseISO(selectedMeeting.meeting_date), 'yyyy-MM-dd'),
        generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm'),
        groups: pdfGroups,
        fileName: `attendance_recorded_${centre?.name || 'centre'}_${format(parseISO(selectedMeeting.meeting_date), 'yyyyMMdd')}`,
      });
      toast({ title: 'PDF ready', description: 'Recorded attendance (current form, including unsaved changes).' });
    } catch (e) {
      toast({ title: 'PDF error', description: e?.message || 'Could not generate PDF.', variant: 'destructive' });
    }
  };

  const runPrintRecordedFromSaved = async () => {
    const mid = printRecordedMeetingId;
    if (!mid) {
      toast({ title: 'Select a meeting', variant: 'destructive' });
      return;
    }
    const m = meetings.find((x) => x.id === mid);
    if (!m) return;
    const centreId = m.centre_id;
    const centre = centers.find((c) => c.id === centreId);
    const centreGroups = groups.filter((g) => g.center_id === centreId);
    const gids = new Set(centreGroups.map((g) => g.id));
    const list = borrowers.filter((b) => b.group_id && gids.has(b.group_id));
    if (!list.length) {
      toast({ title: 'No borrowers', description: 'Add borrowers to groups for this centre.', variant: 'destructive' });
      return;
    }
    const { data: recs } = await supabase
      .from('attendance_records')
      .select('borrower_id, attendance_status')
      .eq('centre_meeting_id', mid);
    const map = {};
    for (const b of list) map[b.id] = 'present';
    if (recs?.length) {
      for (const r of recs) {
        map[r.borrower_id] = STATUS_KEYS.includes(r.attendance_status) ? r.attendance_status : 'present';
      }
    }
    const pdfGroups = buildRecordedPdfGroups(m, map);
    try {
      await downloadRecordedAttendancePdf({
        systemName,
        logoUrl: resolveLogoUrl(logoUrl),
        tagline: DEFAULT_TAGLINE,
        centreName: centre?.name || m.centers?.name || 'Centre',
        officerName: user?.user_metadata?.full_name || user?.email || 'Officer',
        meetingDate: format(parseISO(m.meeting_date), 'yyyy-MM-dd'),
        generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm'),
        groups: pdfGroups,
        fileName: `attendance_recorded_${centre?.name || 'centre'}_${format(parseISO(m.meeting_date), 'yyyyMMdd')}`,
      });
      toast({ title: 'PDF ready', description: 'Saved attendance from the database.' });
    } catch (e) {
      toast({ title: 'PDF error', description: e?.message || 'Could not generate PDF.', variant: 'destructive' });
    }
  };

  const toggleCompileMeeting = (id) => {
    setCompileMeetingIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const compileSelectAllMeetings = () => setCompileMeetingIds(meetings.map((m) => m.id));
  const compileClearSelection = () => setCompileMeetingIds([]);

  const runPrintCompiledPdf = async () => {
    if (!compileMeetingIds.length) {
      toast({
        title: 'Select meetings',
        description: 'Tick at least one meeting.',
        variant: 'destructive',
      });
      return;
    }
    setCompilingPdf(true);
    try {
      const selected = meetings.filter((m) => compileMeetingIds.includes(m.id));
      const allMids = selected.map((m) => m.id);
      const { data: recs, error } = await supabase
        .from('attendance_records')
        .select('borrower_id, attendance_status, centre_meeting_id')
        .in('centre_meeting_id', allMids);
      if (error) throw error;
      const recMap = new Map();
      for (const r of recs || []) {
        recMap.set(`${r.borrower_id}:${r.centre_meeting_id}`, r.attendance_status);
      }

      const byCentre = new Map();
      for (const m of selected) {
        if (!byCentre.has(m.centre_id)) byCentre.set(m.centre_id, []);
        byCentre.get(m.centre_id).push(m);
      }

      const sections = [];
      for (const [, mlist] of byCentre) {
        mlist.sort((a, b) => new Date(a.meeting_date) - new Date(b.meeting_date));
        const centreId = mlist[0].centre_id;
        const centre = centers.find((c) => c.id === centreId);
        const centreGroups = groups.filter((g) => g.center_id === centreId);
        const gids = new Set(centreGroups.map((g) => g.id));
        const blist = borrowers.filter((b) => b.group_id && gids.has(b.group_id));
        const grouped = groupBorrowersByGroup(blist, centreGroups);
        const meetingsMeta = mlist.map((m) => ({
          id: m.id,
          dateLabel: format(parseISO(m.meeting_date), 'yyyy-MM-dd'),
          shortLabel: format(parseISO(m.meeting_date), 'dd/MM/yy'),
        }));
        const pdfGroups = grouped.map((g, gi) => ({
          groupName: g.group?.name ? `Group: ${g.group.name}` : `Group ${gi + 1}`,
          rows: g.borrowers.map((b, idx) => {
            const presence = mlist.map((mt) => {
              const v = recMap.get(`${b.id}:${mt.id}`);
              return v === undefined ? null : v;
            });
            const totalPresent = presence.filter((p) => p === 'present').length;
            return {
              sn: idx + 1,
              name: `${b.first_name} ${b.surname}`,
              borrowerId: b.borrower_id,
              presence,
              totalPresent,
            };
          }),
        }));
        sections.push({
          centreName: centre?.name || mlist[0]?.centers?.name || 'Centre',
          meetings: meetingsMeta,
          groups: pdfGroups,
        });
      }

      await downloadCompiledAttendancePdf({
        systemName,
        logoUrl: resolveLogoUrl(logoUrl),
        tagline: DEFAULT_TAGLINE,
        officerName: user?.user_metadata?.full_name || user?.email || 'Officer',
        generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm'),
        sections,
        fileName: `attendance_compiled_${format(new Date(), 'yyyyMMdd_HHmm')}`,
      });
      toast({
        title: 'PDF ready',
        description: 'Download started for the selected meetings (saved data).',
      });
    } catch (e) {
      toast({ title: 'PDF error', description: e?.message || 'Could not generate PDF.', variant: 'destructive' });
    } finally {
      setCompilingPdf(false);
    }
  };

  if (loading && !centers.length) {
    return (
      <DashboardLayout title="Centre attendance">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Centre attendance">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-brand-gold-deep" />
            Centre attendance
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
            Schedule centre meetings (one date per centre for all groups), record attendance, print blank or digital recorded PDFs, and
            review history, or compile several meetings into one PDF.
          </p>
        </div>

        <Tabs defaultValue="meetings" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="meetings">Meetings</TabsTrigger>
            <TabsTrigger value="record">Record attendance</TabsTrigger>
            <TabsTrigger value="print">Print sheet</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="meetings" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Schedule a centre meeting</CardTitle>
                <CardDescription>
                  All groups under the selected centre share this meeting date.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-4">
                <div className="space-y-2 min-w-[200px]">
                  <Label>Centre</Label>
                  <Select value={newMeetingCentre} onValueChange={setNewMeetingCentre}>
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
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={newMeetingDate} onChange={(e) => setNewMeetingDate(e.target.value)} />
                </div>
                <Button onClick={createMeeting} disabled={savingMeeting || !centers.length}>
                  {savingMeeting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Add meeting
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Scheduled meetings</CardTitle>
              </CardHeader>
              <CardContent>
                {meetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No meetings yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Centre</TableHead>
                        <TableHead className="w-[100px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {meetings.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{format(parseISO(m.meeting_date), 'PPP')}</TableCell>
                          <TableCell>{m.centers?.name || centreName(m.centre_id)}</TableCell>
                          <TableCell>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete meeting?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This removes all attendance saved for this meeting.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMeeting(m.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="record" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Mark attendance</CardTitle>
                <CardDescription>
                  Select a meeting, then set each borrower to <strong>Present</strong>, <strong>Absent</strong>, or{' '}
                  <strong>Ruhusa</strong> (excused — does not count toward the loan-increase meeting minimum).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 max-w-md">
                  <Label>Meeting</Label>
                  <Select value={recordMeetingId} onValueChange={setRecordMeetingId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose meeting" />
                    </SelectTrigger>
                    <SelectContent>
                      {meetings.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {format(parseISO(m.meeting_date), 'yyyy-MM-dd')} — {m.centers?.name || centreName(m.centre_id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {!recordMeetingId ? (
                  <p className="text-sm text-muted-foreground">Select a meeting to load borrowers.</p>
                ) : borrowersForSelectedMeeting.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No borrowers in this centre&apos;s groups.</p>
                ) : (
                  <>
                    {groupBorrowersByGroup(borrowersForSelectedMeeting, groups).map(({ group, borrowers: brs }) => (
                      <div key={group?.id || 'x'} className="rounded-lg border p-4 space-y-2">
                        <h4 className="font-semibold text-sm bg-emerald-600 text-white px-2 py-1 rounded inline-block">
                          {group?.name || 'Group'}
                        </h4>
                        <div className="space-y-2">
                          {brs.map((b) => {
                            const st = STATUS_KEYS.includes(attendanceMap[b.id]) ? attendanceMap[b.id] : 'present';
                            return (
                              <div
                                key={b.id}
                                className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-700 dark:bg-neutral-900/40"
                              >
                                <span className="text-sm font-medium">
                                  {b.first_name} {b.surname}
                                  {borrowerPublicId(b) ? (
                                    <span className="text-muted-foreground font-normal"> ({borrowerPublicId(b)})</span>
                                  ) : null}
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {STATUS_KEYS.map((key) => (
                                    <Button
                                      key={key}
                                      type="button"
                                      size="sm"
                                      variant={st === key ? 'default' : 'outline'}
                                      className={cn(
                                        'h-8 min-w-[5.5rem] text-xs',
                                        st === key && key === 'present' && 'bg-emerald-600 hover:bg-emerald-700',
                                        st === key && key === 'absent' && 'bg-red-600 hover:bg-red-700',
                                        st === key && key === 'ruhusa' && 'bg-amber-600 hover:bg-amber-700'
                                      )}
                                      onClick={() => setAttendanceMap((prev) => ({ ...prev, [b.id]: key }))}
                                    >
                                      {statusLabel(key)}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={saveAttendance} disabled={savingAttendance}>
                        {savingAttendance ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                        Save attendance
                      </Button>
                      <Button type="button" variant="outline" onClick={runPrintRecordedFromScreen}>
                        <FileDown className="h-4 w-4 mr-2" />
                        Print recorded PDF
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      &quot;Print recorded PDF&quot; uses the marks shown above (save first if you want the file to match the database).
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="print" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recorded attendance (digital)</CardTitle>
                <CardDescription>
                  Print a PDF of saved Present / Absent / Ruhusa marks for one meeting (from the database). Same layout as the manual
                  sheet: logo and brand colours, plus a summary line.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-4">
                <div className="space-y-2 min-w-[260px]">
                  <Label>Meeting</Label>
                  <Select value={printRecordedMeetingId} onValueChange={setPrintRecordedMeetingId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose meeting" />
                    </SelectTrigger>
                    <SelectContent>
                      {meetings.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {format(parseISO(m.meeting_date), 'yyyy-MM-dd')} — {m.centers?.name || centreName(m.centre_id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="secondary" onClick={runPrintRecordedFromSaved} disabled={!printRecordedMeetingId}>
                  <FileDown className="h-4 w-4 mr-2" />
                  Print saved attendance
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Compile &amp; print (multiple meetings)</CardTitle>
                <CardDescription>
                  Select multiple meetings (even across centres). One PDF: each date = P (present), A (absent), R (leave), or — (no
                  record). Σ P = meetings attended as present only (leave does not count).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={compileSelectAllMeetings} disabled={!meetings.length}>
                    Select all
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={compileClearSelection} disabled={!compileMeetingIds.length}>
                    Clear selection
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border p-3 space-y-2">
                  {meetings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No meetings yet.</p>
                  ) : (
                    meetings.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={compileMeetingIds.includes(m.id)}
                          onCheckedChange={() => toggleCompileMeeting(m.id)}
                        />
                        <span>
                          {format(parseISO(m.meeting_date), 'yyyy-MM-dd')} — {m.centers?.name || centreName(m.centre_id)}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <Button type="button" onClick={runPrintCompiledPdf} disabled={!compileMeetingIds.length || compilingPdf}>
                  {compilingPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Layers className="h-4 w-4 mr-2" />}
                  Print compiled PDF
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Printable attendance sheet</CardTitle>
                <CardDescription>
                  Generates a branded PDF (logo, gold headings) with borrowers grouped by group and empty boxes for manual marks. Minimum
                  meetings required for automatic loan-increase eligibility are set by Admin in System Settings (Attendance &amp; loan
                  increase — not “days”, but number of centre meetings attended).
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-4">
                <div className="space-y-2 min-w-[200px]">
                  <Label>Centre</Label>
                  <Select value={printCentreId} onValueChange={setPrintCentreId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Centre" />
                    </SelectTrigger>
                    <SelectContent>
                      {centers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 w-32">
                  <Label>Number of boxes</Label>
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    value={printBoxes}
                    onChange={(e) => setPrintBoxes(Number(e.target.value) || 12)}
                  />
                </div>
                <Button onClick={runPrintPdf} disabled={!printCentreId}>
                  <FileDown className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Attendance counts (your borrowers)</CardTitle>
                <CardDescription>
                  Number of centre meetings marked <strong>Present</strong> (all time). <strong>Ruhusa</strong> does not add to this count.
                  Loan increase eligibility uses the minimum set in System Settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {statsRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Borrower</TableHead>
                        <TableHead>ID</TableHead>
                        <TableHead className="text-right">Meetings attended</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statsRows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.name}</TableCell>
                          <TableCell className="font-mono text-xs">{r.borrower_id}</TableCell>
                          <TableCell className="text-right">{r.meetings}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default AttendanceManagement;
