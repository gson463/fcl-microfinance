import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { logAudit } from '@/lib/auditLog';
import {
	captureSessionLocation,
	isGpsExemptEmail,
	isSessionLocationReady,
	SessionLocationRequiredError,
	SESSION_LOCATION_MESSAGES,
} from '@/lib/geolocation';
import {
	DEFAULT_POLICY_CONFIG,
	fetchPolicyConfig,
	checkUserConsent,
	recordUserConsent,
} from '@/lib/policyConsent';
import PolicyConsentModal from '@/components/consent/PolicyConsentModal';
import { Loader2, Shield } from 'lucide-react';

/**
 * Blocks protected routes until security consent (once per policy version) and session verification complete.
 */
const ConsentGate = ({ children }) => {
	const { user, signOut, completeLoginAudit } = useAuth();
	const navigate = useNavigate();
	const { toast } = useToast();

	const [phase, setPhase] = useState('loading'); // loading | consent | verify | ready
	const [policyConfig, setPolicyConfig] = useState(DEFAULT_POLICY_CONFIG);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const verifyStarted = useRef(false);

	const email = user?.email;
	const exempt = isGpsExemptEmail(email);

	const runSessionVerify = useCallback(async () => {
		if (verifyStarted.current) return;
		verifyStarted.current = true;
		setPhase('verify');
		try {
			if (!isSessionLocationReady()) {
				await captureSessionLocation();
			}
			await completeLoginAudit();
			setPhase('ready');
		} catch (err) {
			const description =
				err instanceof SessionLocationRequiredError
					? err.message
					: SESSION_LOCATION_MESSAGES.UNAVAILABLE;
			toast({
				variant: 'destructive',
				title: 'Huwezi kuendelea',
				description,
			});
			await signOut();
			navigate('/login', { replace: true });
		} finally {
			verifyStarted.current = false;
		}
	}, [completeLoginAudit, navigate, signOut, toast]);

	useEffect(() => {
		if (!user || exempt) {
			setPhase('ready');
			return;
		}

		let cancelled = false;

		const init = async () => {
			setPhase('loading');
			const { config } = await fetchPolicyConfig();
			if (cancelled) return;
			setPolicyConfig(config);

			const version = config.privacyPolicyVersion;
			const { hasConsent, error } = await checkUserConsent(supabase, version);
			if (cancelled) return;

			if (error || !hasConsent) {
				setPhase('consent');
				return;
			}

			if (isSessionLocationReady()) {
				setPhase('ready');
				return;
			}

			await runSessionVerify();
		};

		void init();

		return () => {
			cancelled = true;
		};
	}, [user, exempt, runSessionVerify]);

	const handleAccept = async (locale) => {
		setIsSubmitting(true);
		try {
			const version = policyConfig.privacyPolicyVersion;
			const { error: recordErr } = await recordUserConsent(supabase, {
				policyVersion: version,
				locale,
			});
			if (recordErr) throw recordErr;

			await logAudit({
				action: 'policy.consent.accepted',
				metadata: {
					policy_version: version,
					locale,
					email: email ?? null,
				},
			});

			await runSessionVerify();
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Imeshindwa',
				description: err?.message || 'Hatukuweza kuhifadhi idhini yako. Jaribu tena.',
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDecline = async () => {
		await signOut();
		navigate('/login', { replace: true });
	};

	if (!user || exempt || phase === 'ready') {
		return children;
	}

	if (phase === 'consent') {
		return (
			<PolicyConsentModal
				open
				policyConfig={policyConfig}
				onAccept={handleAccept}
				onDecline={handleDecline}
				isSubmitting={isSubmitting}
			/>
		);
	}

	return (
		<div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background">
			<Shield className="h-10 w-10 text-primary" aria-hidden />
			<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			<p className="text-sm text-muted-foreground">Inathibitisha session salama…</p>
		</div>
	);
};

export default ConsentGate;
