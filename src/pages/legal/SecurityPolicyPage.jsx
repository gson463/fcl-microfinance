import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Shield, ArrowLeft } from 'lucide-react';
import { DEFAULT_POLICY_CONFIG, fetchPolicyConfig } from '@/lib/policyConsent';
import { DEFAULT_SYSTEM_NAME } from '@/lib/brand';

const SecurityPolicyPage = ({ pageTitle, subtitle }) => {
	const [config, setConfig] = useState(DEFAULT_POLICY_CONFIG);

	useEffect(() => {
		void fetchPolicyConfig().then(({ config: c }) => setConfig(c));
	}, []);

	return (
		<>
			<Helmet>
				<title>{pageTitle} — {DEFAULT_SYSTEM_NAME}</title>
			</Helmet>
			<div className="min-h-screen bg-slate-50 dark:bg-zinc-950">
				<div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
					<Button variant="ghost" size="sm" asChild className="mb-6 -ml-2">
						<Link to="/login">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to sign in
						</Link>
					</Button>

					<div className="mb-8 flex items-start gap-3">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<Shield className="h-5 w-5" aria-hidden />
						</div>
						<div>
							<h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
							{subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
							<p className="mt-2 text-xs text-muted-foreground">
								Policy version {config.privacyPolicyVersion}
							</p>
						</div>
					</div>

					<Tabs defaultValue="sw" className="rounded-xl border bg-card p-6 shadow-sm">
						<TabsList className="grid w-full max-w-xs grid-cols-2">
							<TabsTrigger value="sw">Kiswahili</TabsTrigger>
							<TabsTrigger value="en">English</TabsTrigger>
						</TabsList>
						<TabsContent value="sw" className="mt-6 space-y-4">
							<h2 className="text-lg font-semibold">{config.securityConsentTitleSw}</h2>
							<p className="text-sm text-muted-foreground">{config.securityConsentSummarySw}</p>
							<div className="whitespace-pre-wrap text-sm leading-relaxed">{config.securityConsentBodySw}</div>
						</TabsContent>
						<TabsContent value="en" className="mt-6 space-y-4">
							<h2 className="text-lg font-semibold">{config.securityConsentTitleEn}</h2>
							<p className="text-sm text-muted-foreground">{config.securityConsentSummaryEn}</p>
							<div className="whitespace-pre-wrap text-sm leading-relaxed">{config.securityConsentBodyEn}</div>
						</TabsContent>
					</Tabs>
				</div>
			</div>
		</>
	);
};

export default SecurityPolicyPage;
