import { useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import LoginPage from '@/pages/LoginPage';
import Layout, { type PageKey } from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import NewMonitoring from '@/pages/NewMonitoring';
import History from '@/pages/History';
import Reports from '@/pages/Reports';
import AdminMachines from '@/pages/AdminMachines';
import AdminParameters from '@/pages/AdminParameters';
import AdminSchedules from '@/pages/AdminSchedules';
import AdminUsers from '@/pages/AdminUsers';
import AdminReportRecipients from '@/pages/AdminReportRecipients';
import WorkRequests from '@/pages/WorkRequests';
import AuditTrail from '@/pages/AuditTrail';
import TrendAnalysis from '@/pages/TrendAnalysis';
import { Settings } from 'lucide-react';

function AppContent() {
  const { user, profile, loading } = useAuth();
  const [page, setPage] = useState<PageKey>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginPage />;
  }

  const isAdmin = profile.role === 'admin';
  let currentPage = page;
  if (
    !isAdmin &&
    (page === 'admin-machines' ||
      page === 'admin-parameters' ||
      page === 'admin-schedules' ||
      page === 'admin-users' ||
      page === 'admin-report-recipients' ||
      page === 'admin-audit-trail')
  ) {
    currentPage = 'dashboard';
  }

  if (!profile.is_active) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="card p-8 text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Settings className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Account Inactive</h2>
          <p className="text-slate-500 text-sm mb-6">
            Your account has been deactivated. Please contact an administrator to reactivate it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Layout current={currentPage} onNavigate={setPage}>
      {currentPage === 'dashboard' && <Dashboard onNavigate={setPage} />}
      {currentPage === 'new-monitoring' && <NewMonitoring onNavigate={setPage} />}
      {currentPage === 'history' && <History />}
      {currentPage === 'report' && <Reports />}
      {currentPage === 'trend-analysis' && <TrendAnalysis />}
      {currentPage === 'admin-machines' && isAdmin && <AdminMachines />}
      {currentPage === 'admin-parameters' && isAdmin && <AdminParameters />}
      {currentPage === 'admin-schedules' && isAdmin && <AdminSchedules />}
      {currentPage === 'admin-users' && isAdmin && <AdminUsers />}
      {currentPage === 'admin-report-recipients' && isAdmin && <AdminReportRecipients />}
      {currentPage === 'admin-audit-trail' && isAdmin && <AuditTrail />}
      {currentPage === 'work-requests' && <WorkRequests />}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
