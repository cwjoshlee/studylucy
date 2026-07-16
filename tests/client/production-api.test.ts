import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/client/api/client";
import { createProductionApi } from "../../src/client/api/production";
import {
  OFFLINE_DB_NAME,
  getConfirmedStars,
  getDeviceState,
  handleDeviceActionRequired,
  markStudentAuthenticated,
  storeConfirmedStars
} from "../../src/client/offline/db";

describe("production ApiClient authority wiring", () => {
  beforeEach(async () => {
    await deleteDB(OFFLINE_DB_NAME);
  });

  it("runs the current-v1 authority policy for an explicit student denial", async () => {
    await markStudentAuthenticated();
    await storeConfirmedStars({
      balance: 7,
      earnedToday: 2,
      deductedToday: 1,
      lastReason: "이 값은 제거되어야 해요"
    });
    const api = createProductionApi(vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "DEVICE_NOT_TRUSTED" }),
      { status: 403, headers: { "content-type": "application/json" } }
    )));

    await expect(api.getToday()).rejects.toEqual(
      new ApiError(403, "DEVICE_NOT_TRUSTED")
    );
    await expect(getConfirmedStars()).resolves.toBeUndefined();
    await expect(getDeviceState()).resolves.toBe("device-action-required");
  });

  it("does not clear device-recovery authority for a rejected guardian credential attempt", async () => {
    await markStudentAuthenticated();
    await handleDeviceActionRequired("DEVICE_REVOKED");
    const api = createProductionApi(vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "AUTH_INVALID" }),
      { status: 401, headers: { "content-type": "application/json" } }
    )));

    await expect(api.guardianLogin("wrong password")).rejects.toEqual(
      new ApiError(401, "AUTH_INVALID")
    );
    await expect(getDeviceState()).resolves.toBe("device-action-required");
  });
});
