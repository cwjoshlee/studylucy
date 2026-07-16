import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { CurrentUser } from "../../shared/auth";
import {
  ApiError,
  type ClientApi,
  type SetupInput
} from "../api/client";
import {
  applyAuthorityFailure,
  clearOfflineAuthority,
  loadOfflineStudentSession,
  markStudentAuthenticated,
  storeOfflineLease,
  subscribeAuthorityState,
  type OfflineStudentSession
} from "../offline/db";
import { syncPending } from "../offline/sync";

type AuthState =
  | { phase: "loading"; user: null }
  | { phase: "setup"; user: null }
  | { phase: "onboarding-guardian-login"; user: null }
  | { phase: "guardian-login"; user: null }
  | { phase: "device-registration"; user: null }
  | { phase: "pin-setup"; user: null }
  | { phase: "student-login"; user: null }
  | {
      phase: "authenticated";
      user: CurrentUser;
      offlineSession: OfflineStudentSession | null;
    }
  | { phase: "error"; user: null };

type AuthContextValue = AuthState & {
  api: ClientApi;
  setup(input: SetupInput): Promise<void>;
  guardianLogin(password: string): Promise<void>;
  registerDevice(name: string): Promise<void>;
  setStudentPin(pin: string): Promise<void>;
  studentLogin(pin: string): Promise<void>;
  showGuardianLogin(): void;
  enterGuardianMode(): Promise<void>;
  enterStudentMode(): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  api,
  children
}: {
  api: ClientApi;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ phase: "loading", user: null });

  useEffect(() => subscribeAuthorityState((deviceState) => {
    if (deviceState === "auth-required") {
      setState({ phase: "student-login", user: null });
    } else if (deviceState === "device-action-required") {
      setState({ phase: "device-registration", user: null });
    }
  }), []);

  const endSession = async () => {
    try {
      await api.endSession();
    } catch {
      // Local authority is removed even when the server response is lost.
    }
    await clearOfflineAuthority("auth-required");
  };

  useEffect(() => {
    let active = true;
    void api.me().then(
      (user) => {
        if (active) setState({
          phase: "authenticated",
          user,
          offlineSession: null
        });
      },
      async (error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === "SETUP_REQUIRED") {
          setState({ phase: "setup", user: null });
          return;
        }
        if (error instanceof ApiError && error.code === "AUTH_REQUIRED") {
          await applyAuthorityFailure(error.code).catch(() => undefined);
          if (!active) return;
          setState({ phase: "student-login", user: null });
          return;
        }
        if (
          error instanceof ApiError &&
          (error.code === "DEVICE_REVOKED" || error.code === "DEVICE_NOT_TRUSTED")
        ) {
          await applyAuthorityFailure(error.code).catch(() => undefined);
          if (!active) return;
          setState({ phase: "device-registration", user: null });
          return;
        }
        if (error instanceof TypeError) {
          const offlineSession = await loadOfflineStudentSession()
            .catch(() => undefined);
          if (!active) return;
          if (offlineSession !== undefined) {
            setState({
              phase: "authenticated",
              user: offlineSession.user,
              offlineSession
            });
            return;
          }
        }
        setState({ phase: "error", user: null });
      }
    );
    return () => {
      active = false;
    };
  }, [api]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    api,
    setup: async (input) => {
      await api.setup(input);
      setState({ phase: "onboarding-guardian-login", user: null });
    },
    guardianLogin: async (password) => {
      const onboarding = state.phase === "onboarding-guardian-login";
      await api.guardianLogin(password);
      if (onboarding) {
        setState({ phase: "device-registration", user: null });
        return;
      }
      const user = await api.me();
      setState({ phase: "authenticated", user, offlineSession: null });
    },
    registerDevice: async (name) => {
      await api.registerDevice(name);
      setState({ phase: "pin-setup", user: null });
    },
    setStudentPin: async (pin) => {
      await api.setStudentPin(pin);
      await endSession();
      setState({ phase: "student-login", user: null });
    },
    studentLogin: async (pin) => {
      const login = await api.studentLogin(pin);
      const user = await api.me();
      if (user.role !== "student") throw new Error("STUDENT_SESSION_REQUIRED");
      const studentUser: CurrentUser & { role: "student" } = {
        ...user,
        role: "student"
      };
      await markStudentAuthenticated();
      await storeOfflineLease({
        offlineAccessUntil: login.offlineAccessUntil,
        user: studentUser
      });
      setState({ phase: "authenticated", user: studentUser, offlineSession: null });
      void syncPending(api, { retryRecoveryBlocked: true }).catch(() => undefined);
    },
    showGuardianLogin: () => {
      setState({ phase: "guardian-login", user: null });
    },
    enterGuardianMode: async () => {
      await endSession();
      setState({ phase: "guardian-login", user: null });
    },
    enterStudentMode: async () => {
      await endSession();
      setState({ phase: "student-login", user: null });
    },
    logout: async () => {
      await endSession();
      setState({ phase: "student-login", user: null });
    }
  }), [api, state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("AuthProvider is required");
  return value;
}
