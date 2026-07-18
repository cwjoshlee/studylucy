import {
  applyAuthorityFailure,
  clearOfflineAuthority,
  handleDeviceActionRequired
} from "../offline/db";
import { ApiClient } from "./client";

export function createProductionApi(fetcher: typeof fetch = fetch): ApiClient {
  return new ApiClient(fetcher, {
    onSessionEnded: () => clearOfflineAuthority("auth-required"),
    onDeviceRevoked: () => handleDeviceActionRequired("DEVICE_REVOKED"),
    onAuthorityFailure: applyAuthorityFailure
  });
}
