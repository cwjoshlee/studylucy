import { createHash, timingSafeEqual } from "node:crypto";

export function hashOpaqueToken(token: string, pepper: string): string {
  return createHash("sha256").update(token + pepper).digest("hex");
}

export function matchesSetupSecret(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
