import { z } from "zod";

export const DeviceTypeSchema = z.enum(["tablet", "phone", "mac", "windows"]);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;
export const DEVICE_TYPE_LIMITS = {
  tablet: 3,
  phone: 3,
  mac: 1,
  windows: 2
} as const;

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
  name: z.string().trim().min(1).max(60),
  deviceType: DeviceTypeSchema
});

export const RenameDeviceRequest = z.object({
  name: z.string().trim().min(1).max(60)
});

export const RevokeDeviceRequest = z.object({
  publicId: z.string().trim().min(1).max(80)
});

export const UpdateDeviceTypeRequest = z.object({
  deviceType: DeviceTypeSchema
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
  deviceType: DeviceType | null;
  status: "active" | "revoked";
  current: boolean;
};

export type StudentLoginResult = {
  offlineAccessUntil: string;
};
