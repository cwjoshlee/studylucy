import type { ClientApi } from "./api/client";
import { AuthProvider, useAuth } from "./auth/auth-context";
import { LoginScreen } from "./auth/login-screen";
import { GuardianDashboard } from "./guardian/guardian-dashboard";
import { StudentHome } from "./home/student-home";

function AppContent() {
  const auth = useAuth();
  if (auth.phase === "loading") return <main aria-busy="true">공부방을 준비하고 있어요.</main>;
  if (
    auth.phase === "setup" ||
    auth.phase === "onboarding-guardian-login" ||
    auth.phase === "guardian-login" ||
    auth.phase === "device-recovery-guardian-login" ||
    auth.phase === "device-registration" ||
    auth.phase === "device-recovery-registration" ||
    auth.phase === "pin-setup" ||
    auth.phase === "student-login"
  ) {
    return <LoginScreen phase={auth.phase} />;
  }
  if (auth.phase === "error") return <main>잠시 후 다시 시도해 주세요.</main>;
  if (auth.user.role === "guardian") {
    return (
      <GuardianDashboard
        api={auth.api}
        onEnterStudentMode={auth.enterStudentMode}
        onLogout={auth.logout}
      />
    );
  }
  return (
    <StudentHome
      api={auth.api}
      offlineSession={auth.offlineSession}
      onEnterGuardianMode={auth.enterGuardianMode}
      onLogout={auth.logout}
    />
  );
}

export function App({ api }: { api: ClientApi }) {
  return (
    <AuthProvider api={api}>
      <AppContent />
    </AuthProvider>
  );
}
