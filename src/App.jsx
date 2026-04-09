import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import Login from '@/pages/Login';
import AdminSignup from '@/pages/AdminSignup';
import AdminDashboard from '@/pages/admin/Dashboard';
import DashboardMetricDrilldown from '@/pages/admin/DashboardMetricDrilldown';
import BranchManagerDashboard from '@/pages/manager/Dashboard';
import LoanOfficerDashboard from '@/pages/officer/Dashboard';
import BranchManagement from '@/pages/admin/BranchManagement';
import UserManagement from '@/pages/admin/UserManagement';
import LoanProductManagement from '@/pages/admin/LoanProductManagement';
import SystemSettings from '@/pages/admin/SystemSettings';
import HolidayManagement from '@/pages/admin/HolidayManagement';
import AdminDataHistory from '@/pages/admin/DataHistory';
import AdminRepaymentManagement from '@/pages/admin/RepaymentManagement';
import OfficerReassignment from '@/pages/admin/OfficerReassignment';
import AuditLogs from '@/pages/admin/AuditLogs';
import AdminBorrowerManagement from '@/pages/admin/BorrowerManagement';
import AdminLoanManagement from '@/pages/admin/LoanManagement';
import CenterGroupManagement from '@/pages/officer/CenterGroupManagement';
import BorrowerManagement from '@/pages/officer/BorrowerManagement';
import BorrowerDetails from '@/pages/officer/BorrowerDetails';
import LoanManagement from '@/pages/officer/LoanManagement';
import OfficerRequests from '@/pages/officer/OfficerRequests';
import RepaymentManagement from '@/pages/officer/RepaymentManagement';
import GroupRepayment from '@/pages/officer/GroupRepayment';
import ExpenseManagement from '@/pages/officer/ExpenseManagement';
import AttendanceManagement from '@/pages/officer/AttendanceManagement';
import FieldWalletCashFlow from '@/pages/officer/FieldWalletCashFlow';
import AdminFieldWalletTrace from '@/pages/admin/FieldWalletTrace';
import Reports from '@/pages/shared/Reports';
import Profile from '@/pages/shared/Profile';
import LoanOfficerManagement from '@/pages/manager/LoanOfficerManagement';
import ManagerLoanRequests from '@/pages/manager/LoanRequests';
import ManagerSettings from '@/pages/manager/ManagerSettings';
import ManagerRepaymentManagement from '@/pages/manager/RepaymentManagement';
import ManagerLoanManagement from '@/pages/manager/LoanManagement';
import ManagerBorrowerManagement from '@/pages/manager/BorrowerManagement';
import { DateProvider } from '@/contexts/DateContext';
import ArrearsManagement from '@/pages/shared/ArrearsManagement';
import DefaultersManagement from '@/pages/shared/DefaultersManagement';

const AdminDashboardDrilldownRoute = () => {
  const { metricKey } = useParams();
  return <DashboardMetricDrilldown key={metricKey} />;
};

const ManagerDashboardDrilldownRoute = () => {
  const { metricKey } = useParams();
  return <DashboardMetricDrilldown key={`mgr-${metricKey}`} />;
};

const OfficerDashboardDrilldownRoute = () => {
  const { metricKey } = useParams();
  return <DashboardMetricDrilldown key={`off-${metricKey}`} />;
};

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading, profileLoading, effectiveRole } = useAuth();

  if (loading || (user && profileLoading)) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && (!effectiveRole || !allowedRoles.includes(effectiveRole))) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const DashboardRedirect = () => {
  const { user, loading, profileLoading, effectiveRole } = useAuth();

  if (loading || (user && profileLoading)) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  switch (effectiveRole) {
    case 'admin':
      return <Navigate to="/admin/dashboard" replace />;
    case 'manager':
      return <Navigate to="/manager/dashboard" replace />;
    case 'officer':
      return <Navigate to="/officer/dashboard" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
};

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin-signup" element={<AdminSignup />} />
      <Route path="/" element={<DashboardRedirect />} />
      
      {/* Admin Routes */}
      <Route path="/admin/dashboard/metrics/:metricKey" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboardDrilldownRoute /></ProtectedRoute>} />
      <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/field-wallet" element={<ProtectedRoute allowedRoles={['admin']}><Navigate to="/admin/field-wallet-trace" replace /></ProtectedRoute>} />
      <Route path="/admin/field-wallet-trace" element={<ProtectedRoute allowedRoles={['admin']}><AdminFieldWalletTrace /></ProtectedRoute>} />
      <Route path="/admin/branches" element={<ProtectedRoute allowedRoles={['admin']}><BranchManagement /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['admin']}><UserManagement /></ProtectedRoute>} />
      <Route path="/admin/borrowers" element={<ProtectedRoute allowedRoles={['admin']}><AdminBorrowerManagement /></ProtectedRoute>} />
      <Route path="/admin/loans" element={<ProtectedRoute allowedRoles={['admin']}><AdminLoanManagement /></ProtectedRoute>} />
      <Route path="/admin/loan-products" element={<ProtectedRoute allowedRoles={['admin']}><LoanProductManagement /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={['admin']}><SystemSettings /></ProtectedRoute>} />
      <Route path="/admin/holidays" element={<ProtectedRoute allowedRoles={['admin']}><HolidayManagement /></ProtectedRoute>} />
      <Route path="/admin/loan-requests" element={<Navigate to="/admin/data-history" replace />} />
      <Route path="/admin/data-history" element={<ProtectedRoute allowedRoles={['admin']}><AdminDataHistory /></ProtectedRoute>} />
      <Route path="/admin/repayment-management" element={<ProtectedRoute allowedRoles={['admin']}><AdminRepaymentManagement /></ProtectedRoute>} />
      <Route path="/admin/reassignment" element={<ProtectedRoute allowedRoles={['admin']}><OfficerReassignment /></ProtectedRoute>} />
      <Route path="/admin/audit-logs" element={<ProtectedRoute allowedRoles={['admin']}><AuditLogs /></ProtectedRoute>} />

      {/* Manager Routes */}
      <Route path="/manager/dashboard/metrics/:metricKey" element={<ProtectedRoute allowedRoles={['manager']}><ManagerDashboardDrilldownRoute /></ProtectedRoute>} />
      <Route path="/manager/dashboard" element={<ProtectedRoute allowedRoles={['manager']}><BranchManagerDashboard /></ProtectedRoute>} />
      <Route path="/manager/field-wallet" element={<ProtectedRoute allowedRoles={['manager']}><Navigate to="/manager/dashboard" replace /></ProtectedRoute>} />
      <Route path="/manager/settings" element={<ProtectedRoute allowedRoles={['manager']}><ManagerSettings /></ProtectedRoute>} />
      <Route path="/manager/loan-officers" element={<ProtectedRoute allowedRoles={['manager']}><LoanOfficerManagement /></ProtectedRoute>} />
      <Route path="/manager/borrowers" element={<ProtectedRoute allowedRoles={['manager']}><ManagerBorrowerManagement /></ProtectedRoute>} />
      <Route path="/manager/loans" element={<ProtectedRoute allowedRoles={['manager']}><ManagerLoanManagement /></ProtectedRoute>} />
      <Route path="/manager/loan-requests" element={<ProtectedRoute allowedRoles={['manager']}><ManagerLoanRequests /></ProtectedRoute>} />
      <Route path="/manager/repayment-management" element={<ProtectedRoute allowedRoles={['manager']}><ManagerRepaymentManagement /></ProtectedRoute>} />
      
      {/* Officer Routes */}
      <Route path="/officer/dashboard/metrics/:metricKey" element={<ProtectedRoute allowedRoles={['officer']}><OfficerDashboardDrilldownRoute /></ProtectedRoute>} />
      <Route path="/officer/dashboard" element={<ProtectedRoute allowedRoles={['officer']}><LoanOfficerDashboard /></ProtectedRoute>} />
      <Route path="/officer/centers-groups" element={<ProtectedRoute allowedRoles={['officer']}><CenterGroupManagement /></ProtectedRoute>} />
      <Route path="/officer/borrowers" element={<ProtectedRoute allowedRoles={['officer']}><BorrowerManagement /></ProtectedRoute>} />
      <Route path="/officer/borrowers/:borrowerId" element={<ProtectedRoute allowedRoles={['officer']}><BorrowerDetails /></ProtectedRoute>} />
      <Route path="/officer/loans" element={<ProtectedRoute allowedRoles={['officer']}><LoanManagement /></ProtectedRoute>} />
      <Route path="/officer/requests" element={<ProtectedRoute allowedRoles={['officer']}><OfficerRequests /></ProtectedRoute>} />
      <Route path="/officer/repayment-management" element={<ProtectedRoute allowedRoles={['officer']}><RepaymentManagement /></ProtectedRoute>} />
      <Route path="/officer/group-repayment" element={<ProtectedRoute allowedRoles={['officer']}><GroupRepayment /></ProtectedRoute>} />
      <Route path="/officer/expenses" element={<ProtectedRoute allowedRoles={['officer']}><ExpenseManagement /></ProtectedRoute>} />
      <Route path="/officer/field-wallet" element={<ProtectedRoute allowedRoles={['officer']}><FieldWalletCashFlow /></ProtectedRoute>} />
      <Route path="/officer/attendance" element={<ProtectedRoute allowedRoles={['officer']}><AttendanceManagement /></ProtectedRoute>} />
      
      {/* Shared Routes */}
      <Route path="/arrears" element={<ProtectedRoute><ArrearsManagement /></ProtectedRoute>} />
      <Route path="/defaulters" element={<ProtectedRoute><DefaultersManagement /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
    </Routes>
  );
}

export default App;