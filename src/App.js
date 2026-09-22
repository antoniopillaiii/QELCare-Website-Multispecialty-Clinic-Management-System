import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import LoginScreen from "./components/Login/LoginScreen";
import ForgotPassScreen from "./components/ForgotPassword/ForgotPassScreen";
import EmailVerification from "./components/Verifications/EmailVerification";
import RegisterScreen from "./components/Register/RegisterScreen";

import AdminDashboard from "./components/AdminFeatures/CreateUserAcc/AdminDashboard";
import ManageUsers from "./components/AdminFeatures/ManageUsers/ManageUsers";
import AdminAppointments from "./components/AdminFeatures/AppointmentManagement/AdminAppointments";
import AdminInquiries from "./components/AdminFeatures/Inquiries/AdminInquiries";
import AdminBilling from "./components/AdminFeatures/Billing/AdminBilling";
import ProfileSettings from "./components/AdminFeatures/ProfileSettings/ProfileSettings";
import AnalyticsReports from "./components/AdminFeatures/ReportsAndAnalytics/index";
import AppointmentAnalyticsReport from "./components/AdminFeatures/ReportsAndAnalytics/AppointmentAnalyticsReport";
import MedicalRecordReport from "./components/AdminFeatures/ReportsAndAnalytics/MedicalRecordReport";
import UserStatisticsReport from "./components/AdminFeatures/ReportsAndAnalytics/UserStatisticsReport";
import AdminLogs from "./components/AdminFeatures/ActivityLogs/AdminLogs";
import AdminPatients from "./components/AdminFeatures/PatientManagement/AdminPatients";
import AdminQueue from "./components/AdminFeatures/QueueManagement/AdminQueue";
import AdminRecords from "./components/AdminFeatures/MedicalRecords/AdminRecords";

import QueueDisplayScreen from "./components/QueueDisplay/QueueDisplayScreen";
import QNurseStationVitals from "./components/Nurse/QNurseStationVitals";
import SpecialtyQueueScreen from "./components/NurseQueue/SpecialtyQueueScreen";
import DoctorDashboard from "./components/DoctorSide/DoctorDashboard";
import MedicationApprovals from "./components/DoctorSide/MedicationApprovals";
import FrontDesk from "./components/FrontDesk/ManageDoctor/FrontDesk";
import CashierDashboard from "./components/Cashier/CashierDashboard";
import CashierBilling from "./components/Cashier/CashierBilling";

import UserScreen from "./components/UserSide/UserScreen";
import AppointmentList from "./components/UserSide/AppointmentList";
import PatientAppointments from "./components/UserSide/PatientAppointments";
import MedicalRecords from "./components/UserSide/MedicalRecords";
import HealthRecords from "./components/UserSide/HealthRecords";
import MainLayout from "./components/Layout/MainLayout";
import LandingPage from "./components/LandingPage/LandingPage";
import PatientIdleTimeout from "./components/Auth/PatientIdleTimeout";

import { getUserRole, isAuthenticated } from "./utils/auth";

const SPECIALTIES = [
  { label: "ENT", slug: "ent", color: "#14536b" },
  { label: "Cardiology", slug: "cardiology", color: "#163a6b" },
  { label: "Gastroenterology", slug: "gastroenterology", color: "#176b45" },
  { label: "General Medicine", slug: "general-medicine", color: "#5b4aa0" },
  { label: "Rehabilitation Medicine", slug: "rehabilitation-medicine", color: "#1f6b58" },
  { label: "Obstetrics & Gynecology", slug: "ob-gyne", color: "#8a2f62" },
  { label: "Pediatrics", slug: "pediatrics", color: "#9a6500" },
  { label: "Psychiatry", slug: "psychiatry", color: "#4d4f9f" },
];

function ProtectedRoute({ children, allowedRoles }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  if (allowedRoles) {
    const role = getUserRole();
    if (!allowedRoles.includes(role)) return <Navigate to="/unauthorized" replace />;
  }
  return children;
}

function RoleRedirect() {
  const role = getUserRole();
  const redirectMap = {
    Admin: "/admin/dashboard",
    Doctor: "/doctor/dashboard",
    Nurse: "/nurse-station",
    Cashier: "/cashier/dashboard",
    Patient: "/dashboard",
    Frontdesk: "/frontdesk/dashboard",
  };
  return <Navigate to={redirectMap[role] || "/login"} replace />;
}

const guard = (roles, element) => <ProtectedRoute allowedRoles={roles}>{element}</ProtectedRoute>;

function Unauthorized() {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h2>Access Denied</h2>
      <p>You do not have permission to view this page.</p>
      <a href="/redirect">Back to dashboard</a>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Patient-only inactivity auto-logout. No-op for all other roles. */}
      <PatientIdleTimeout />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/forgot-password" element={<ForgotPassScreen />} />
        <Route path="/verify-email" element={<EmailVerification />} />
        <Route path="/register" element={<RegisterScreen />} />
        <Route path="/redirect" element={<RoleRedirect />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="/lobby/live-queue-display" element={<QueueDisplayScreen />} />

        <Route path="/admin/dashboard" element={guard(["Admin"], <AdminDashboard />)} />
        <Route path="/admin/users" element={guard(["Admin"], <ManageUsers />)} />
        <Route path="/admin/patients" element={guard(["Admin"], <AdminPatients />)} />
        <Route path="/admin/appointments" element={guard(["Admin"], <AdminAppointments />)} />
        <Route path="/admin/inquiries" element={guard(["Admin"], <AdminInquiries />)} />
        <Route path="/admin/queue" element={guard(["Admin"], <AdminQueue />)} />
        <Route path="/admin/records" element={guard(["Admin"], <AdminRecords />)} />
        <Route path="/admin/billing" element={guard(["Admin"], <AdminBilling />)} />
        <Route path="/admin/reports" element={guard(["Admin"], <AnalyticsReports />)} />
        <Route path="/admin/reports/appointments" element={guard(["Admin"], <AppointmentAnalyticsReport />)} />
        <Route path="/admin/reports/medical-records" element={guard(["Admin"], <MedicalRecordReport />)} />
        <Route path="/admin/reports/users" element={guard(["Admin"], <UserStatisticsReport />)} />
        <Route path="/admin/logs" element={guard(["Admin"], <AdminLogs />)} />
        <Route path="/admin/profile" element={guard(["Admin"], <ProfileSettings />)} />

        <Route path="/frontdesk/dashboard" element={guard(["Frontdesk", "Admin"], <FrontDesk />)} />
        <Route
          path="/frontdesk/appointments"
          element={guard(["Frontdesk", "Admin"], (
            <MainLayout pageTitle="Appointment Management" pageSubtitle="Confirm, reschedule, and cancel active appointments">
              <AppointmentList />
            </MainLayout>
          ))}
        />
        <Route path="/frontdesk/patients" element={guard(["Frontdesk", "Admin"], <AdminPatients />)} />
        <Route path="/frontdesk/inquiries" element={guard(["Frontdesk", "Admin"], <AdminInquiries />)} />
        <Route path="/frontdesk/profile" element={guard(["Frontdesk"], <ProfileSettings />)} />

        <Route path="/nurse-station" element={guard(["Nurse", "Admin"], <QNurseStationVitals />)} />
        <Route path="/nurse/vitals" element={guard(["Nurse", "Admin"], <QNurseStationVitals />)} />
        {SPECIALTIES.map((specialty) => (
          <Route
            key={specialty.slug}
            path={`/nurse/queue/${specialty.slug}`}
            element={guard(["Nurse", "Admin"], <SpecialtyQueueScreen slug={specialty.slug} specialtyName={specialty.label} />)}
          />
        ))}
        <Route
          path="/nurse/appointments"
          element={guard(["Nurse", "Admin"], (
            <MainLayout pageTitle="Appointments" pageSubtitle="View active appointments and history">
              <AppointmentList />
            </MainLayout>
          ))}
        />
        <Route path="/nurse/profile" element={guard(["Nurse"], <ProfileSettings />)} />

        <Route path="/doctor/dashboard" element={guard(["Doctor", "Admin"], <DoctorDashboard />)} />
        <Route
          path="/doctor/appointments"
          element={guard(["Doctor", "Admin"], (
            <MainLayout pageTitle="Appointments" pageSubtitle="Assigned appointments and history">
              <AppointmentList />
            </MainLayout>
          ))}
        />
        <Route
          path="/doctor/records"
          element={guard(["Doctor", "Admin"], (
            <MainLayout pageTitle="Medical Records" pageSubtitle="Create and review consultation records">
              <MedicalRecords />
            </MainLayout>
          ))}
        />
        <Route path="/doctor/medication-approvals" element={guard(["Doctor", "Admin"], <MedicationApprovals />)} />
        <Route path="/doctor/profile" element={guard(["Doctor"], <ProfileSettings />)} />

        <Route path="/cashier/dashboard" element={guard(["Cashier", "Admin"], <CashierDashboard />)} />
        <Route path="/cashier/billing" element={guard(["Cashier", "Admin"], <CashierBilling />)} />
        <Route path="/cashier/profile" element={guard(["Cashier"], <ProfileSettings />)} />

        <Route path="/dashboard" element={guard(["Patient"], <UserScreen />)} />
        <Route
          path="/patient/appointments"
          element={guard(["Patient"], (
            <MainLayout pageTitle="Appointments" pageSubtitle="Upcoming visits, history, and booking">
              <PatientAppointments />
            </MainLayout>
          ))}
        />
        <Route path="/patient/appointments/book" element={guard(["Patient"], <Navigate to="/patient/appointments?tab=book" replace />)} />
        <Route
          path="/patient/records"
          element={guard(["Patient"], (
            <MainLayout pageTitle="Consultation Records" pageSubtitle="Completed consultation results">
              <MedicalRecords />
            </MainLayout>
          ))}
        />
        <Route
          path="/patient/health"
          element={guard(["Patient"], (
            <MainLayout pageTitle="Health Records" pageSubtitle="Medications, documents, and clinical history">
              <HealthRecords />
            </MainLayout>
          ))}
        />
        <Route path="/patient/profile" element={guard(["Patient"], <ProfileSettings />)} />

        <Route path="*" element={<Navigate to="/redirect" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
