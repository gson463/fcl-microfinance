import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import {
	DEFAULT_SYSTEM_NAME,
	DEFAULT_TAGLINE,
	resolveLogoUrl,
	LOGIN_SUPPORT_PHONE,
	LOGIN_SUPPORT_WHATSAPP,
	LOGIN_SUPPORT_EMAIL,
	LOGIN_PLUSNOLOGY_URL,
	LOGIN_VOGU_ETHICS_URL,
	LOGIN_APP_VERSION,
} from '@/lib/brand';
import { Shield, Lock, Sparkles, ArrowRight, Clock, Phone, Mail, MessageCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { cn } from '@/lib/utils';

const features = [
	{
		icon: Shield,
		title: 'Trusted platform',
		desc: 'Built for microfinance teams who need clarity and control.',
	},
	{
		icon: Lock,
		title: 'Secure access',
		desc: 'Role-based sign-in keeps your data where it belongs.',
	},
	{
		icon: Sparkles,
		title: 'Streamlined ops',
		desc: 'Loans, repayments, and reporting in one place.',
	},
];

const waDigits = (s) => String(s || '').replace(/\D/g, '');

const Login = () => {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);
	const { signIn, user, loading: authLoading, profileLoading, effectiveRole } = useAuth();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [systemConfig, setSystemConfig] = useState({ systemName: DEFAULT_SYSTEM_NAME, logoUrl: '' });
	const [clock, setClock] = useState(() => new Date());
	const [networkOnline, setNetworkOnline] = useState(
		() => typeof navigator !== 'undefined' && navigator.onLine
	);

	useEffect(() => {
		const id = window.setInterval(() => setClock(new Date()), 1000);
		return () => window.clearInterval(id);
	}, []);

	useEffect(() => {
		const sync = () => setNetworkOnline(navigator.onLine);
		sync();
		window.addEventListener('online', sync);
		window.addEventListener('offline', sync);
		return () => {
			window.removeEventListener('online', sync);
			window.removeEventListener('offline', sync);
		};
	}, []);

	useEffect(() => {
		const fetchConfig = async () => {
			const { data } = await supabase.from('system_config').select('*');
			if (data) {
				const config = data.reduce((acc, item) => {
					acc[item.key] = item.value;
					return acc;
				}, {});
				setSystemConfig((prev) => ({
					...prev,
					systemName: config.systemName || DEFAULT_SYSTEM_NAME,
					logoUrl: config.logoUrl || '',
				}));
			}
		};
		fetchConfig();
	}, []);

	useEffect(() => {
		if (!user || profileLoading) return;
		switch (effectiveRole) {
			case 'admin':
				navigate('/admin/dashboard');
				break;
			case 'manager':
				navigate('/manager/dashboard');
				break;
			case 'officer':
				navigate('/officer/dashboard');
				break;
			default:
				navigate('/');
		}
	}, [user, profileLoading, effectiveRole, navigate]);

	const performSignIn = async () => {
		setIsSubmitting(true);
		const { error } = await signIn(email, password);
		if (error) {
			toast({
				variant: 'destructive',
				title: 'Sign in failed',
				description: error.message || 'Invalid credentials. Please check your email and password.',
			});
		}
		setIsSubmitting(false);
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		await performSignIn();
	};

	if (authLoading || (user && profileLoading)) {
		return (
			<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 dark:bg-brand-login-bg">
				<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(184,146,58,0.12),transparent)] dark:block" />
				<div className="relative flex flex-col items-center gap-4">
					<div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-gold-cta/40 border-t-brand-gold-cta" />
					<p className="text-sm font-medium tracking-wide text-neutral-500 dark:text-zinc-400">Loading…</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<Helmet>
				<title>Sign in — {systemConfig.systemName}</title>
				<meta name="description" content={`Sign in to ${systemConfig.systemName}`} />
			</Helmet>

			<div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-100 dark:bg-brand-login-bg lg:flex-row">
				<div className="fixed right-4 top-4 z-50">
					<ThemeToggle className="border-slate-200/80 bg-white/90 text-neutral-700 shadow-sm backdrop-blur-sm hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-brand-gold dark:hover:bg-white/15" />
				</div>
				{/* Ambient: soft blue + warm gold (dark); light mode subtle wash */}
				<div className="pointer-events-none fixed inset-0" aria-hidden>
					<div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_80%_at_50%_0%,rgba(56,139,253,0.08),transparent_55%)] dark:bg-[radial-gradient(ellipse_100%_70%_at_50%_45%,rgba(56,139,253,0.14),transparent_58%)]" />
					<div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_50%_at_100%_0%,rgba(184,146,58,0.05),transparent_45%)] dark:bg-[radial-gradient(ellipse_90%_50%_at_100%_0%,rgba(184,146,58,0.08),transparent_45%)]" />
					<div className="absolute left-1/2 top-1/3 hidden h-[min(520px,50vh)] w-[min(640px,90vw)] -translate-x-1/2 rounded-full bg-[#388bfd]/10 blur-[90px] dark:block" />
					<div
						className="absolute inset-0 opacity-[0.04] dark:opacity-[0.055]"
						style={{
							backgroundImage: `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z' fill='%23000000'/%3E%3C/svg%3E")`,
							backgroundSize: '24px 24px',
						}}
					/>
				</div>

				{/* Brand column */}
				<motion.section
					initial={{ opacity: 0, x: -16 }}
					animate={{ opacity: 1, x: 0 }}
					transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
					className="relative z-10 flex flex-[1.15] flex-col justify-between border-b border-slate-200/80 px-6 py-10 sm:px-10 dark:border-white/[0.06] lg:border-b-0 lg:border-r lg:px-14 lg:py-16 lg:dark:border-white/[0.06]"
				>
					<div>
						<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div className="inline-flex items-center gap-2 rounded-full border border-brand-gold/30 bg-brand-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-gold-deep dark:border-brand-gold/25 dark:bg-brand-gold/5 dark:text-brand-gold">
								<span className="h-1.5 w-1.5 rounded-full bg-brand-gold shadow-[0_0_12px_rgba(212,175,55,0.8)]" />
								Loans Control Portal
							</div>
							<div className="text-left sm:text-right">
								<p className="font-mono text-xl font-semibold tabular-nums tracking-tight text-neutral-900 dark:text-white sm:text-2xl">
									{format(clock, 'HH:mm:ss')}
								</p>
								<p className="mt-0.5 text-xs text-neutral-600 dark:text-zinc-500">
									{format(clock, 'EEE, d MMM yyyy')}
								</p>
							</div>
						</div>

						<div className="mt-8 flex flex-col items-start">
							<img
								className="h-16 w-auto max-w-[260px] object-contain sm:h-20 drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
								alt=""
								src={resolveLogoUrl(systemConfig.logoUrl)}
							/>
							<h1 className="font-display mt-8 text-3xl font-bold leading-tight tracking-tight text-neutral-900 dark:text-white sm:text-4xl lg:text-[2.35rem]">
								<span className="bg-gradient-to-r from-brand-gold via-[#e8c547] to-brand-gold-muted bg-clip-text text-transparent">
									{systemConfig.systemName}
								</span>
							</h1>
							<p className="mt-3 max-w-md text-base text-neutral-600 dark:text-zinc-400 sm:text-lg">{DEFAULT_TAGLINE}</p>
						</div>

						<ul className="mt-10 space-y-5 max-w-md">
							{features.map(({ icon: Icon, title, desc }, i) => (
								<motion.li
									key={title}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
									className="flex gap-4"
								>
									<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-gold/30 bg-gradient-to-br from-brand-gold/20 to-transparent text-brand-gold-deep shadow-sm dark:border-brand-gold/20 dark:from-brand-gold/15 dark:text-brand-gold dark:shadow-gold-glow-sm">
										<Icon className="h-5 w-5" strokeWidth={1.75} />
									</div>
									<div>
										<p className="font-display font-semibold text-neutral-900 dark:text-zinc-100">{title}</p>
										<p className="mt-0.5 text-sm leading-relaxed text-neutral-600 dark:text-zinc-500">{desc}</p>
									</div>
								</motion.li>
							))}
						</ul>
					</div>
				</motion.section>

				{/* Form column */}
				<motion.section
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
					className="relative z-10 flex flex-1 items-center justify-center px-4 py-12 sm:px-8 lg:py-16"
				>
					<div className="w-full max-w-[420px]">
						<div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<span
								className={cn(
									'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide',
									networkOnline
										? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300'
										: 'border-red-500/35 bg-red-500/10 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'
								)}
							>
								<span
									className={cn(
										'h-2 w-2 shrink-0 rounded-full',
										networkOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
									)}
									aria-hidden
								/>
								{networkOnline ? 'System online' : 'System offline'}
							</span>
							<time
								dateTime={format(clock, "yyyy-MM-dd")}
								className="text-xs text-neutral-500 dark:text-zinc-500"
							>
								{format(clock, 'EEE, d MMM yyyy')}
							</time>
						</div>

						<div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-px shadow-xl shadow-slate-300/30 dark:border-white/[0.09] dark:bg-brand-login-card dark:shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_24px_48px_-12px_rgba(0,0,0,0.55)]">
							<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-gold-cta/50 to-transparent" />
							<div className="rounded-[15px] bg-white p-8 dark:bg-brand-login-card sm:p-10">
								<div className="mb-8">
									<h2 className="font-display text-2xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-[1.65rem]">
										Welcome back
									</h2>
									<p className="mt-2 text-sm text-neutral-600 dark:text-zinc-400">
										Enter your work email and password to access your dashboard.
									</p>
								</div>

								<form onSubmit={handleSubmit} className="space-y-5">
									<div className="space-y-2">
										<Label htmlFor="email" className="text-neutral-700 dark:text-zinc-300">
											Email
										</Label>
										<Input
											id="email"
											type="email"
											autoComplete="email"
											placeholder="you@company.com"
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											className="h-12 rounded-xl border-slate-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus-visible:border-brand-gold-cta/55 focus-visible:ring-brand-gold-cta/25 dark:border-white/[0.12] dark:bg-[#0d1117] dark:text-zinc-100 dark:placeholder:text-zinc-500"
											required
										/>
									</div>

									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<Label htmlFor="password" className="text-neutral-700 dark:text-zinc-300">
												Password
											</Label>
											<a
												href="/forgot-password"
												className="text-xs font-medium text-brand-gold-deep hover:underline dark:text-brand-gold"
											>
												Forgot password?
											</a>
										</div>
										<Input
											id="password"
											type="password"
											autoComplete="current-password"
											placeholder="••••••••"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											className="h-12 rounded-xl border-slate-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus-visible:border-brand-gold-cta/55 focus-visible:ring-brand-gold-cta/25 dark:border-white/[0.12] dark:bg-[#0d1117] dark:text-zinc-100 dark:placeholder:text-zinc-500"
											required
										/>
									</div>

									<Button
										type="submit"
										disabled={isSubmitting}
										className="group mt-2 h-12 w-full rounded-xl bg-brand-gold-cta font-display text-[15px] font-semibold text-neutral-950 shadow-[0_4px_20px_-4px_rgba(184,146,58,0.45)] transition hover:bg-brand-gold-cta-hover focus-visible:ring-2 focus-visible:ring-brand-gold-cta/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-brand-login-card"
									>
										{isSubmitting ? (
											<span className="flex items-center justify-center gap-2">
												<span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-950/30 border-t-neutral-950" />
												Signing in…
											</span>
										) : (
											<span className="flex items-center justify-center gap-2">
												Sign in
												<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
											</span>
										)}
									</Button>
								</form>

								<div className="mt-8 flex flex-col items-center gap-2 text-xs text-neutral-500 dark:text-zinc-500">
									<div className="flex items-center justify-center gap-2">
										<Lock className="h-3.5 w-3.5 text-brand-gold-cta" aria-hidden />
										<span>Encrypted connection · Staff access only</span>
									</div>
									<p>
										<Link to="/terms" className="underline-offset-2 hover:underline">
											Masharti
										</Link>
										{' · '}
										<Link to="/privacy" className="underline-offset-2 hover:underline">
											Faragha
										</Link>
									</p>
								</div>
							</div>
						</div>

						<div className="mt-5 rounded-xl border border-slate-200/90 bg-slate-50/90 p-4 dark:border-white/[0.08] dark:bg-white/[0.04]">
							<p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-zinc-300">
								<Clock className="h-3.5 w-3.5 text-brand-gold-cta" aria-hidden />
								Need help?
							</p>
							<ul className="space-y-2.5 text-xs text-neutral-600 dark:text-zinc-400">
								<li className="flex gap-2">
									<Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-cta" aria-hidden />
									<a
										href={`tel:${waDigits(LOGIN_SUPPORT_PHONE)}`}
										className="break-all underline-offset-2 hover:text-neutral-900 hover:underline dark:hover:text-zinc-200"
									>
										{LOGIN_SUPPORT_PHONE}
									</a>
								</li>
								<li className="flex gap-2">
									<MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-cta" aria-hidden />
									<a
										href={`https://wa.me/${waDigits(LOGIN_SUPPORT_WHATSAPP)}`}
										target="_blank"
										rel="noopener noreferrer"
										className="break-all underline-offset-2 hover:text-neutral-900 hover:underline dark:hover:text-zinc-200"
									>
										{LOGIN_SUPPORT_WHATSAPP} (WhatsApp)
									</a>
								</li>
								<li className="flex gap-2">
									<Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-cta" aria-hidden />
									<a
										href={`mailto:${LOGIN_SUPPORT_EMAIL}`}
										className="break-all underline-offset-2 hover:text-neutral-900 hover:underline dark:hover:text-zinc-200"
									>
										{LOGIN_SUPPORT_EMAIL}
									</a>
								</li>
							</ul>
						</div>

						<div className="mt-6 flex flex-col gap-3">
							<div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
								<p className="max-w-full text-[11px] leading-relaxed text-neutral-500 dark:text-zinc-600">
									© {new Date().getFullYear()} {systemConfig.systemName}
								</p>
								<span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-400">
									{LOGIN_APP_VERSION}
								</span>
							</div>
							<p className="text-center text-[11px] leading-relaxed text-neutral-600 dark:text-zinc-500 sm:text-left">
								Designed by{' '}
								<a
									href={LOGIN_PLUSNOLOGY_URL}
									target="_blank"
									rel="noopener noreferrer"
									className="font-medium text-brand-gold-deep underline-offset-2 hover:underline dark:text-brand-gold"
								>
									Plusnology Limited
								</a>
								, Secured By{' '}
								<a
									href={LOGIN_VOGU_ETHICS_URL}
									target="_blank"
									rel="noopener noreferrer"
									className="font-medium text-brand-gold-deep underline-offset-2 hover:underline dark:text-brand-gold"
								>
									Vogu Ethics Org
								</a>
								.
							</p>
						</div>
					</div>
				</motion.section>
			</div>
		</>
	);
};

export default Login;
