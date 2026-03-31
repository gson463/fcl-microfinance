import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Save, RotateCw } from 'lucide-react';

const ManagerSettings = () => {
  const { toast } = useToast();
  const [currency, setCurrency] = useState('TZS');
  const [applicationFeePerDisbursement, setApplicationFeePerDisbursement] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('system_config')
        .select('key, value')
        .in('key', ['currency', 'applicationFeePerDisbursement']);
      if (cancelled) return;
      if (error) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
        setLoading(false);
        return;
      }
      const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
      setCurrency(map.currency || 'TZS');
      setApplicationFeePerDisbursement(
        map.applicationFeePerDisbursement != null && String(map.applicationFeePerDisbursement).trim() !== ''
          ? String(map.applicationFeePerDisbursement)
          : '0'
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const handleSave = async (e) => {
    e.preventDefault();
    const n = parseFloat(String(applicationFeePerDisbursement).replace(',', ''));
    if (!Number.isFinite(n) || n < 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter zero or a positive number.' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('system_config').upsert(
        { key: 'applicationFeePerDisbursement', value: String(n) },
        { onConflict: 'key' }
      );
      if (error) throw error;
      toast({ title: 'Saved', description: 'Application fee per disbursement has been updated.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout title="Organization settings">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Application fee</CardTitle>
          <CardDescription>
            Same value as in Admin → System settings. It applies <strong>per disbursement</strong> (per member loan). It
            does not change loan principal; it is for field cash-flow when that feature uses this figure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-6">
              <RotateCw className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Currency (read-only): <span className="font-medium text-foreground">{currency}</span>
              </p>
              <div className="space-y-2">
                <Label htmlFor="mgr-app-fee">Application fee per disbursement ({currency})</Label>
                <Input
                  id="mgr-app-fee"
                  type="number"
                  min={0}
                  step="0.01"
                  value={applicationFeePerDisbursement}
                  onChange={(e) => setApplicationFeePerDisbursement(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default ManagerSettings;
