import { z } from "zod";

export const SetupRequest = z.object({
  setupSecret: z.string().min(32),
  guardianName: z.string().trim().min(1).max(40),
  password: z.string().min(12).max(128),
  studentName: z.string().trim().min(1).max(20)
});

export const GuardianLoginRequest = z.object({
  password: z.string().min(1)
});

export const RegisterDeviceRequest = z.object({
  name: z.string().trim().min(1).max(60)
});

export const RenameDeviceRequest = RegisterDeviceRequest;

export const RevokeDeviceRequest = z.object({
  publicId: z.string().trim().min(1).max(80)
});

export const StudentPinRequest = z.object({
  pin: z.string().regex(/^\d{4}$/)
});

export type CurrentUser = {
  id: string;
  role: "guardian" | "student";
  displayName: string;
};

export type TrustedDeviceView = {
  publicId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  isCurrent: boolean;
};

export type StudentLoginResult = {
  user: CurrentUser;
  trustedDevice: TrustedDeviceView;
};
