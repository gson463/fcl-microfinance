import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Home, Users, Briefcase, DollarSign, Settings, LogOut, Building, UserPlus, 
  BookOpen, GitBranch, ArrowLeftRight, Calendar, Users2, 
  FileText, UserCog, AlertTriangle, FileX, BarChart3, Menu, ChevronLeft, ChevronRight, X, ScrollText, Archive, ClipboardList, Wallet
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Helmet } from 'react-helmet';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';
import { DEFAULT_SYSTEM_NAME, resolveLogoUrl } from '@/lib/brand';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { SidebarPaletteMenu } from '@/components/theme/SidebarPaletteMenu';
import { useTheme } from '@/contexts/ThemeContext';
import { getSidebarPreset } from '@/lib/sidebarPresets';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import OfficerTakenGate from '@/components/officer/OfficerTakenGate';
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';

function headerProfileInitials(user) {
  const name = (user?.user_metadata?.full_name || '').trim();
  if (!name) return 'U';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

const reportsNavLinks = [{ to: '/reports', icon: BarChart3, text: 'Reports' }];

/** Admin primary nav (under "Menu") */
const adminMainLinks = [
  { to: '/admin/dashboard', icon: Home, text: 'Dashboard' },
  { to: '/admin/branches', icon: GitBranch, text: 'Branches' },
  { to: '/admin/users', icon: Users, text: 'Users' },
  { to: '/admin/borrowers', icon: Users2, text: 'Borrowers' },
  { to: '/admin/loans', icon: Briefcase, text: 'Loans & Disbursements' },
  { to: '/admin/reassignment', icon: ArrowLeftRight, text: 'Officer transfer' },
  { to: '/admin/loan-products', icon: Briefcase, text: 'Loan Products' },
  { to: '/admin/data-history', icon: Archive, text: 'History & audit' },
  { to: '/admin/repayment-management', icon: DollarSign, text: 'Prepayments' },
  { to: '/admin/field-wallet-trace', icon: Wallet, text: 'Field wallet trace' },
  { to: '/arrears', icon: AlertTriangle, text: 'Arrears' },
  { to: '/defaulters', icon: FileX, text: 'Defaulters' },
  { to: '/admin/holidays', icon: Calendar, text: 'Holidays' },
];

/** Admin only: System Settings + Activity log */
const adminSystemLinks = [
  { to: '/admin/settings', icon: Settings, text: 'System Settings' },
  { to: '/admin/audit-logs', icon: ScrollText, text: 'Activity log' },
];

const managerLinks = [
  { to: '/manager/dashboard', icon: Home, text: 'Dashboard' },
  { to: '/manager/loan-officers', icon: UserPlus, text: 'Loan Officers' },
  { to: '/manager/borrowers', icon: Users, text: 'Borrowers' },
  { to: '/manager/loans', icon: Briefcase, text: 'Loans & Disbursements' },
  { to: '/manager/loan-requests', icon: FileText, text: 'Requests' },
  { to: '/manager/repayment-management', icon: DollarSign, text: 'Prepayments' },
  { to: '/arrears', icon: AlertTriangle, text: 'Arrears' },
  { to: '/defaulters', icon: FileX, text: 'Defaulters' },
  { to: '/manager/settings', icon: Settings, text: 'Settings' },
];

const officerLinks = [
  { to: '/officer/dashboard', icon: Home, text: 'Dashboard' },
  { to: '/officer/field-wallet', icon: Wallet, text: 'Field wallet' },
  { to: '/officer/centers-groups', icon: Building, text: 'Centers & Groups' },
  { to: '/officer/borrowers', icon: Users, text: 'Borrowers' },
  { to: '/officer/loans', icon: Briefcase, text: 'Loans & Disbursements' },
  { to: '/officer/requests', icon: FileText, text: 'Requests' },
  { to: '/officer/group-repayment', icon: Users2, text: 'Group Prepayments' },
  { to: '/officer/repayment-management', icon: DollarSign, text: 'Prepayments' },
  { to: '/arrears', icon: AlertTriangle, text: 'Arrears' },
  { to: '/defaulters', icon: FileX, text: 'Defaulters' },
  { to: '/officer/expenses', icon: BookOpen, text: 'Expenses' },
  { to: '/officer/attendance', icon: ClipboardList, text: 'Attendance' },
];

const SidebarLink = ({ to, icon: Icon, text, collapsed }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        'group flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 mb-0.5',
        collapsed ? 'justify-center px-2' : 'px-3',
        isActive
          ? 'bg-gradient-to-r from-brand-gold via-[#c9a227] to-brand-gold-deep text-neutral-950 shadow-gold-glow-sm font-semibold'
          : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
      )
    }
    title={collapsed ? text : undefined}
  >
    <Icon
      className={cn(
        'h-[1.125rem] w-[1.125rem] flex-shrink-0 transition-transform duration-200',
        collapsed ? 'mr-0' : 'mr-3',
        'group-hover:scale-105'
      )}
      strokeWidth={2}
    />
    {!collapsed && <span className="truncate">{text}</span>}
  </NavLink>
);

const DashboardLayout = ({ children, title, description = "Microfinance Management System" }) => {
  const { user, signOut, effectiveRole } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { sidebarPreset } = useTheme();
  const sb = getSidebarPreset(sidebarPreset);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 
  const [isCollapsed, setIsCollapsed] = useState(false); 
  const [systemConfig, setSystemConfig] = useState({ name: DEFAULT_SYSTEM_NAME, logoUrl: null });

  useEffect(() => {
    const fetchSystemConfig = async () => {
      const { data } = await supabase.from('system_config').select('*');
      if (data) {
        const config = data.reduce((acc, item) => {
          acc[item.key] = item.value;
          return acc;
        }, {});
        setSystemConfig({
          name: config.systemName || DEFAULT_SYSTEM_NAME,
          logoUrl: config.logoUrl || null,
        });
      }
    };
    fetchSystemConfig();
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
    toast({
      title: 'Signed Out',
      description: "You have been successfully signed out.",
    });
  };

  let links = [];
  let adminSystemSection = null;
  if (user) {
    switch (effectiveRole) {
      case 'admin':
        links = adminMainLinks;
        adminSystemSection = adminSystemLinks;
        break;
      case 'manager': links = managerLinks; break;
      case 'officer': links = officerLinks; break;
      default: links = [];
    }
  }

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const toggleCollapse = () => setIsCollapsed(!isCollapsed);

  const profilePhotoUrl = user?.user_metadata?.photoUrl || null;

  return (
    <>
      <Helmet>
        <title>{`${title} | ${systemConfig.name}`}</title>
        <meta name="description" content={description} />
      </Helmet>

      <OfficerTakenGate />

      <div className="flex h-screen overflow-hidden bg-[#f4f2ed] dark:bg-neutral-950">
        {/* Mobile Overlay */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-[#030712]/60 backdrop-blur-sm lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <motion.aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex flex-col text-white shadow-[4px_0_32px_-8px_rgba(0,0,0,0.45)] transition-all duration-300 ease-in-out lg:static lg:shadow-none',
            sb.aside,
            isCollapsed ? 'w-20' : 'w-72',
            'lg:translate-x-0',
            isSidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-px', sb.topHairline)} aria-hidden />
          <div
            className={cn('pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl', sb.glow)}
            aria-hidden
          />

          {/* Sidebar header */}
          <div
            className={cn(
              'relative z-10 flex min-h-[5.25rem] items-center border-b p-4',
              sb.header,
              isCollapsed ? 'justify-center' : 'justify-between'
            )}
          >
            {!isCollapsed ? (
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src={resolveLogoUrl(systemConfig.logoUrl)}
                  alt="Fahari Credit Limited"
                  className="h-10 w-auto max-w-[200px] flex-shrink-0 object-contain object-left drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)]"
                />
                <span className="font-display hidden truncate text-sm font-bold uppercase leading-tight tracking-wide text-brand-gold sm:inline">
                  {systemConfig.name}
                </span>
              </div>
            ) : (
              <img src={resolveLogoUrl(systemConfig.logoUrl)} alt="" className="h-10 w-10 object-contain" />
            )}
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="scrollbar-hide relative z-10 flex-1 overflow-y-auto px-3 py-4">
            <p
              className={cn(
                'mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em]',
                sb.navLabel,
                isCollapsed && 'sr-only'
              )}
            >
              Menu
            </p>
            <div className="space-y-0.5">
              {links.map((link) => (
                <SidebarLink key={link.to} {...link} collapsed={isCollapsed} />
              ))}
            </div>
            <div className={cn('my-4 h-px', sb.divider)} />
            <p
              className={cn(
                'mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em]',
                sb.navLabel,
                isCollapsed && 'sr-only'
              )}
            >
              Reports
            </p>
            <div className="space-y-0.5">
              {reportsNavLinks.map((link) => (
                <SidebarLink key={link.to} {...link} collapsed={isCollapsed} />
              ))}
            </div>
            {adminSystemSection && (
              <>
                <div className={cn('my-4 h-px', sb.divider)} />
                <p
                  className={cn(
                    'mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em]',
                    sb.navLabel,
                    isCollapsed && 'sr-only'
                  )}
                >
                  System
                </p>
                <div className="space-y-0.5">
                  {adminSystemSection.map((link) => (
                    <SidebarLink key={link.to} {...link} collapsed={isCollapsed} />
                  ))}
                </div>
              </>
            )}
          </nav>

          <div className={cn('relative z-10 space-y-2 border-t p-3 backdrop-blur-sm', sb.footerWrap)}>
            <Button
              onClick={toggleCollapse}
              variant="ghost"
              className={cn(
                'hidden w-full hover:bg-white/[0.06] lg:flex',
                sb.collapseBtn,
                isCollapsed ? 'justify-center px-0' : 'justify-start'
              )}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <>
                  <ChevronLeft className="mr-3 h-5 w-5" />
                  <span className="text-sm font-medium">Collapse</span>
                </>
              )}
            </Button>

            <Button
              onClick={handleSignOut}
              variant="ghost"
              className={cn(
                'w-full text-red-300/95 hover:bg-red-950/40 hover:text-red-200',
                isCollapsed ? 'justify-center px-0' : 'justify-start'
              )}
              title="Sign out"
            >
              <LogOut className={cn('h-5 w-5', isCollapsed ? 'mr-0' : 'mr-3')} />
              {!isCollapsed && <span className="text-sm font-medium">Sign out</span>}
            </Button>
          </div>
        </motion.aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Mobile header */}
          <header className={cn('relative z-30 flex items-center justify-between gap-3 border-b p-4 shadow-md lg:hidden', sb.mobileHeader)}>
            <div className={cn('absolute inset-x-0 top-0 h-px', sb.mobileTopHairline)} aria-hidden />
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="-ml-1 shrink-0 text-brand-gold hover:bg-white/10 hover:text-brand-gold"
                aria-label="Open menu"
              >
                <Menu className="h-6 w-6" />
              </Button>
              <div className="min-w-0">
                <h1 className="font-display truncate text-base font-semibold tracking-tight text-white">{title}</h1>
                <p className="truncate text-[11px] font-medium uppercase tracking-wider text-brand-gold/70">
                  {systemConfig.name}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SidebarPaletteMenu className="border-white/20 bg-white/5 text-white hover:bg-white/10" />
              <ThemeToggle className="border-white/20 bg-white/5 text-brand-gold hover:bg-white/10 hover:text-brand-gold" />
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  cn(
                    'flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border transition-colors',
                    isActive
                      ? 'border-brand-gold bg-brand-gold/20 text-brand-gold'
                      : 'border-white/15 bg-white/5 text-brand-gold/90 hover:bg-white/10 hover:text-brand-gold'
                  )
                }
                aria-label="Profile"
                title="Profile"
              >
                {profilePhotoUrl ? (
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={profilePhotoUrl} alt="" className="object-cover" />
                    <AvatarFallback className="bg-brand-gold/20 text-xs font-semibold text-brand-gold">
                      {headerProfileInitials(user)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <UserCog className="h-5 w-5" strokeWidth={2} />
                )}
              </NavLink>
              <img
                src={resolveLogoUrl(systemConfig.logoUrl)}
                alt=""
                className="h-9 w-auto max-w-[100px] flex-shrink-0 object-contain opacity-95"
              />
            </div>
          </header>

          {/* Desktop header */}
          <header className="relative z-30 hidden items-center justify-between gap-4 border-b border-brand-gold/20 bg-white/90 px-8 py-4 shadow-sm backdrop-blur-md dark:border-brand-gold/25 dark:bg-neutral-900/95 lg:flex">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-brand-gold/0 via-brand-gold/25 to-brand-gold/0" aria-hidden />
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">{title}</h1>
              <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <SidebarPaletteMenu className="border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700" />
              <ThemeToggle className="border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700" />
              <span className="hidden rounded-full border border-brand-gold/25 bg-brand-gold/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-gold-deep dark:border-brand-gold/35 dark:bg-brand-gold/10 dark:text-brand-gold sm:inline-block">
                {systemConfig.name}
              </span>
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-brand-gold bg-brand-gold/10 text-brand-gold-deep dark:text-brand-gold'
                      : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:hover:text-white'
                  )
                }
              >
                {profilePhotoUrl ? (
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={profilePhotoUrl} alt="" className="object-cover" />
                    <AvatarFallback className="bg-brand-gold/15 text-xs font-semibold text-brand-gold-deep dark:text-brand-gold">
                      {headerProfileInitials(user)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <UserCog className="h-4 w-4 shrink-0" strokeWidth={2} />
                )}
                <span>Profile</span>
              </NavLink>
            </div>
          </header>

          <main className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-x-contain bg-[#f4f2ed]/90 p-4 [-webkit-overflow-scrolling:touch] dark:bg-neutral-950/95 sm:p-6 lg:p-8">
            <div className="mx-auto min-w-0 w-full max-w-7xl">
              <ImpersonationBanner />
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  );
};

export default DashboardLayout;