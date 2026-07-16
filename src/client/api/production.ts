import { clearCurrentV1Authority } from "../offline/db";
import { ApiClient } from "./client";

export function createProductionApi(fetcher: typeof fetch = fetch): ApiClient {
  return new ApiClient(fetcher, {
    onAuthorityFailure: clearCurrentV1Authority
  });
}
