import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "./auth-context";

type LoginPhase =
  | "setup"
  | "onboarding-guardian-login"
  | "guardian-login"
  | "device-registration"
  | "pin-setup"
  | "student-login";

const titles: Record<LoginPhase, string> = {
  setup: "수아의 공부방 시작하기",
  "onboarding-guardian-login": "보호자 로그인",
  "guardian-login": "보호자 로그인",
  "device-registration": "이 기기 등록하기",
  "pin-setup": "수아 PIN 만들기",
  "student-login": "수아 PIN으로 들어가기"
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span>{label}</span>{children}</label>;
}

export function LoginScreen({ phase }: { phase: LoginPhase }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: (data: FormData) => Promise<void>
  ) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await action(new FormData(event.currentTarget));
    } catch (error) {
      setMessage(error instanceof ApiError
        ? `확인이 필요해요. (${error.code})`
        : "잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">우리 가족만의 보호된 공간</p>
        <h1 id="login-title">{titles[phase]}</h1>
        {phase === "setup" ? (
          <form onSubmit={(event) => void submit(event, async (data) => {
            await auth.setup({
              setupSecret: String(data.get("setupSecret")),
              guardianName: String(data.get("guardianName")),
              password: String(data.get("password")),
              studentName: String(data.get("studentName"))
            });
          })}>
            <Field label="초기 설정 비밀번호"><input name="setupSecret" type="password" required minLength={32} autoComplete="off" /></Field>
            <Field label="보호자 이름"><input name="guardianName" required maxLength={40} autoComplete="name" /></Field>
            <Field label="보호자 비밀번호"><input name="password" type="password" required minLength={12} autoComplete="new-password" /></Field>
            <Field label="학생 이름"><input name="studentName" required maxLength={20} autoComplete="off" /></Field>
            <button disabled={pending} type="submit">가족 공부방 만들기</button>
          </form>
        ) : null}
        {phase === "guardian-login" || phase === "onboarding-guardian-login" ? (
          <form onSubmit={(event) => void submit(event, (data) =>
            auth.guardianLogin(String(data.get("password"))))}>
            <Field label="보호자 비밀번호"><input name="password" type="password" required autoComplete="current-password" /></Field>
            <button disabled={pending} type="submit">로그인</button>
          </form>
        ) : null}
        {phase === "device-registration" ? (
          <form onSubmit={(event) => void submit(event, (data) =>
            auth.registerDevice(String(data.get("deviceName"))))}>
            <p>수아가 안전하게 들어올 수 있도록 현재 기기만 등록해요.</p>
            <Field label="기기 이름"><input name="deviceName" defaultValue="수아 갤럭시 탭" required maxLength={60} /></Field>
            <button disabled={pending} type="submit">현재 기기 등록</button>
          </form>
        ) : null}
        {phase === "pin-setup" ? (
          <form onSubmit={(event) => void submit(event, (data) =>
            auth.setStudentPin(String(data.get("pin"))))}>
            <Field label="수아의 새 4자리 PIN"><input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="new-password" /></Field>
            <button disabled={pending} type="submit">PIN 저장하기</button>
          </form>
        ) : null}
        {phase === "student-login" ? (
          <form onSubmit={(event) => void submit(event, (data) =>
            auth.studentLogin(String(data.get("pin"))))}>
            <Field label="수아의 4자리 PIN"><input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="current-password" /></Field>
            <button disabled={pending} type="submit">공부 시작하기</button>
            <button className="button-secondary" type="button" onClick={auth.showGuardianLogin}>보호자 로그인</button>
          </form>
        ) : null}
        {message ? <p role="alert">{message}</p> : null}
      </section>
    </main>
  );
}
