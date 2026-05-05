import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldOff } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import {
	hasStoredAdminImpersonationBackup,
	readAdminImpersonationBackup,
	clearAdminImpersonationBackup,
	IMPERSONATION_CHANGE_EVENT,
} from '@/lib/adminImpersonation';
import { useToast } from '@/components/ui/use-toast';

export function ImpersonationBanner() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const [visible, setVisible] = useState(() => hasStoredAdminImpersonationBackup());
	const [busy, setBusy] = useState(false);

	const sync = useCallback(() => {
		setVisible(hasStoredAdminImpersonationBackup());
	}, []);

	useEffect(() => {
		sync();
		window.addEventListener(IMPERSONATION_CHANGE_EVENT, sync);
		return () => window.removeEventListener(IMPERSONATION_CHANGE_EVENT, sync);
	}, [sync]);

	const endImpersonation = async () => {
		const backup = readAdminImpersonationBackup();
		if (!backup) {
			setVisible(false);
			return;
		}
		setBusy(true);
		try {
			const { error } = await supabase.auth.setSession({
				access_token: backup.access_token,
				refresh_token: backup.refresh_token,
			});
			if (error) throw error;
			clearAdminImpersonationBackup();
			setVisible(false);
			toast({ title: 'Back to admin', description: 'Your original admin session was restored.' });
			navigate('/admin/dashboard', { replace: true });
		} catch (e) {
			console.error(e);
			toast({
				title: 'Could not restore admin session',
				description: e?.message ?? 'Sign out and log in again as admin.',
				variant: 'destructive',
			});
		} finally {
			setBusy(false);
		}
	};

	if (!visible) return null;

	return (
		<div
			role="status"
			className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/60 bg-amber-500/15 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/50 dark:bg-amber-950/40 dark:text-amber-50"
		>
			<p className="min-w-0 font-medium">
				You are viewing the app as another user (impersonation). Actions use this user&apos;s permissions.
			</p>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				className="shrink-0 border-amber-600/40 bg-white/90 text-amber-950 hover:bg-white dark:bg-neutral-900 dark:text-amber-100"
				disabled={busy}
				onClick={endImpersonation}
			>
				{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldOff className="mr-2 h-4 w-4" />}
				End impersonation
			</Button>
		</div>
	);
}
