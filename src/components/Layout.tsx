import { ReactNode, useState } from 'react';
import {
  LayoutDashboard,
  ClipboardPlus,
  History,
  Settings,
  Cog,
  ListChecks,
  Users,
  LogOut,
  Menu,
  X,
  Shield,
  CalendarClock,
  Mail,
  ClipboardList,
  History as HistoryIcon2,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import interbatLogo from '@/assets/interbat-logo.png';

export type PageKey =
  | 'dashboard'
  | 'new-monitoring'
  | 'history'
  | 'report'
  | 'trend-analysis'
  | 'work-requests'
  | 'admin-machines'
  | 'admin-parameters'
  | 'admin-schedules'
  | 'admin-users'
  | 'admin-report-recipients'
  | 'admin-audit-trail';

interface NavItem {
  key: PageKey;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'new-monitoring', label: 'New Monitoring', icon: ClipboardPlus },
  { key: 'history', label: 'History', icon: History },
  { key: 'report', label: 'Reports', icon: ListChecks },
  { key: 'trend-analysis', label: 'Trend Parameter', icon: TrendingUp },
  { key: 'work-requests', label: 'Titipan Pekerjaan', icon: ClipboardList },
  { key: 'admin-machines', label: 'Machines', icon: Cog, adminOnly: true },
  { key: 'admin-parameters', label: 'Parameters', icon: Settings, adminOnly: true },
  { key: 'admin-schedules', label: 'Schedules', icon: CalendarClock, adminOnly: true },
  { key: 'admin-users', label: 'Users', icon: Users, adminOnly: true },
  { key: 'admin-report-recipients', label: 'Report Email', icon: Mail, adminOnly: true },
  { key: 'admin-audit-trail', label: 'Audit Trail', icon: HistoryIcon2, adminOnly: true },
];

interface LayoutProps {
  current: PageKey;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
}

export default function Layout({ current, onNavigate, children }: LayoutProps) {
  const { profile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  const handleNavigate = (key: PageKey) => {
    onNavigate(key);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-slate-900 text-slate-300 flex flex-col z-40 transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center p-1">
              <img src={interbatLogo} alt="Interbat" className="w-full h-full object-contain" />
            </div>
            <div>
              <p className="text-white font-bold text-sm">Equipment Monitor</p>
              <p className="text-slate-500 text-xs">24-Hour System</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = current === item.key;
            return (
              <button
                key={item.key}
                onClick={() => handleNavigate(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-semibold text-white">
              {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{profile?.full_name}</p>
              <div className="flex items-center gap-1">
                {isAdmin && <Shield className="w-3 h-3 text-teal-400" />}
                <p className="text-slate-500 text-xs capitalize">{profile?.role}</p>
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
            <LogOut className="w-[18px] h-[18px]" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600">
            <Menu className="w-6 h-6" />
          </button>
          <span className="flex items-center gap-2 font-semibold text-slate-800 text-sm">
            <img src={interbatLogo} alt="Interbat" className="h-5" />
            Equipment Monitor
          </span>
          <div className="w-6" />
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
