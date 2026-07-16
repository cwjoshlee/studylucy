import type { ClientApi } from "./api/client";
import { AuthProvider, useAuth } from "./auth/auth-context";
import { LoginScreen } from "./auth/login-screen";
import { StudentHome } from "./home/student-home";

function AppContent() {
  const auth = useAuth();
  if (auth.phase === "loading") return <main aria-busy="true">공부방을 준비하고 있어요.</main>;
  if (
    auth.phase === "setup" ||
    auth.phase === "onboarding-guardian-login" ||
    auth.phase === "guardian-login" ||
    auth.phase === "device-registration" ||
    auth.phase === "pin-setup" ||
    auth.phase === "student-login"
  ) {
    return <LoginScreen phase={auth.phase} />;
  }
  if (auth.phase === "error") return <main>잠시 후 다시 시도해 주세요.</main>;
  if (auth.user.role === "guardian") {
    return (
      <main className="guardian-placeholder">
        <p className="eyebrow">보호자 로그인으로 보호되어 있어요</p>
        <h1>보호자 공간</h1>
        <p id="guardian-placeholder-note">진도와 별 기록을 보는 화면은 다음 단계에서 열려요.</p>
        <button type="button" disabled aria-describedby="guardian-placeholder-note">보호자 화면으로 가기</button>
      </main>
    );
  }
  return <StudentHome api={auth.api} />;
}

export function App({ api }: { api: ClientApi }) {
  return (
    <AuthProvider api={api}>
      <AppContent />
    </AuthProvider>
  );
}
