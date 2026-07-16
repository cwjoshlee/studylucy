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

type AuthState =
  | { phase: "loading"; user: null }
  | { phase: "setup"; user: null }
  | { phase: "onboarding-guardian-login"; user: null }
  | { phase: "guardian-login"; user: null }
  | { phase: "device-registration"; user: null }
  | { phase: "pin-setup"; user: null }
  | { phase: "student-login"; user: null }
  | { phase: "authenticated"; user: CurrentUser }
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

  const endSession = async () => {
    await api.endSession();
  };

  useEffect(() => {
    let active = true;
    void api.me().then(
      (user) => {
        if (active) setState({ phase: "authenticated", user });
      },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === "SETUP_REQUIRED") {
          setState({ phase: "setup", user: null });
          return;
        }
        if (error instanceof ApiError && error.code === "AUTH_REQUIRED") {
          setState({ phase: "student-login", user: null });
          return;
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
      setState({ phase: "authenticated", user });
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
      await api.studentLogin(pin);
      const user = await api.me();
      setState({ phase: "authenticated", user });
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
