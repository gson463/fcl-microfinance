import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Loader2 } from 'lucide-react';
import { CHECKBOX_LABEL_EN, CHECKBOX_LABEL_SW } from '@/lib/policyConsent';

const PolicyConsentModal = ({
	open,
	policyConfig,
	onAccept,
	onDecline,
	isSubmitting = false,
}) => {
	const [tab, setTab] = useState('sw');
	const [checkedSw, setCheckedSw] = useState(false);
	const [checkedEn, setCheckedEn] = useState(false);

	if (!open || !policyConfig) return null;

	const titleSw = policyConfig.securityConsentTitleSw;
	const titleEn = policyConfig.securityConsentTitleEn;
	const summarySw = policyConfig.securityConsentSummarySw;
	const summaryEn = policyConfig.securityConsentSummaryEn;
	const bodySw = policyConfig.securityConsentBodySw;
	const bodyEn = policyConfig.securityConsentBodyEn;

	const canAccept = checkedSw && checkedEn;

	const handleAccept = () => {
		if (!canAccept || isSubmitting) return;
		const locale = tab === 'en' ? 'en' : tab === 'sw' ? 'sw' : 'sw_en';
		onAccept(locale);
	};

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
			<div className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
				<div className="border-b px-6 py-5">
					<div className="flex items-start gap-3">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<Shield className="h-5 w-5" aria-hidden />
						</div>
						<div>
							<h2 className="text-lg font-semibold leading-tight">{titleSw}</h2>
							<p className="mt-1 text-sm text-muted-foreground">{titleEn}</p>
						</div>
					</div>
				</div>

				<Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col px-6 pt-4">
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="sw">Kiswahili</TabsTrigger>
						<TabsTrigger value="en">English</TabsTrigger>
					</TabsList>

					<TabsContent value="sw" className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
						<p className="mb-3 text-sm font-medium text-foreground">{summarySw}</p>
						<div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
							{bodySw}
						</div>
						<div className="mt-4 flex items-start gap-3">
							<Checkbox
								id="consent-sw"
								checked={checkedSw}
								onCheckedChange={(v) => setCheckedSw(v === true)}
								disabled={isSubmitting}
							/>
							<Label htmlFor="consent-sw" className="cursor-pointer text-sm font-normal leading-snug">
								{CHECKBOX_LABEL_SW}
							</Label>
						</div>
					</TabsContent>

					<TabsContent value="en" className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
						<p className="mb-3 text-sm font-medium text-foreground">{summaryEn}</p>
						<div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
							{bodyEn}
						</div>
						<div className="mt-4 flex items-start gap-3">
							<Checkbox
								id="consent-en"
								checked={checkedEn}
								onCheckedChange={(v) => setCheckedEn(v === true)}
								disabled={isSubmitting}
							/>
							<Label htmlFor="consent-en" className="cursor-pointer text-sm font-normal leading-snug">
								{CHECKBOX_LABEL_EN}
							</Label>
						</div>
					</TabsContent>
				</Tabs>

				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-6 py-3 text-xs text-muted-foreground">
					<Link to="/terms" className="underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
						Masharti / Terms
					</Link>
					<span aria-hidden>·</span>
					<Link to="/privacy" className="underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
						Faragha / Privacy
					</Link>
				</div>

				<div className="flex gap-3 border-t px-6 py-4">
					<Button
						type="button"
						variant="outline"
						className="flex-1"
						onClick={onDecline}
						disabled={isSubmitting}
					>
						Ghairi
					</Button>
					<Button type="button" className="flex-1" onClick={handleAccept} disabled={!canAccept || isSubmitting}>
						{isSubmitting ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Inaendelea…
							</>
						) : (
							'Nakubali na endelea'
						)}
					</Button>
				</div>
			</div>
		</div>
	);
};

export default PolicyConsentModal;
