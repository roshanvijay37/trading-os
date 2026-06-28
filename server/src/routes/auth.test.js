import { describe, it, expect, beforeEach } from "vitest";
import { refreshAccessToken } from "./auth.js";

// These cover only the no-network guard paths: refreshAccessToken must return null (never throw,
// never hit FYERS) when it cannot possibly succeed, so callers can fail safe. The actual broker
// round-trip is integration-tested against the live API, not here.
describe("refreshAccessToken guards (no network)", () => {
  beforeEach(() => {
    delete process.env.FYERS_PIN;
  });

  it("returns null for a missing session", async () => {
    expect(await refreshAccessToken(null)).toBeNull();
    expect(await refreshAccessToken(undefined)).toBeNull();
  });

  it("returns null when the session has no refresh_token", async () => {
    expect(await refreshAccessToken({ id: "s1" })).toBeNull();
  });

  it("returns null when FYERS_PIN is not configured (cannot refresh unattended)", async () => {
    expect(await refreshAccessToken({ id: "s1", refreshToken: "rt" })).toBeNull();
  });
});
