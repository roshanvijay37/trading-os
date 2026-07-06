import { describe, it, expect, beforeEach } from "vitest";
import { refreshAccessToken, isOperatorSession } from "./auth.js";

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

// Single-operator gate: this app runs one person's live trading bot. Without it, anyone who
// completes their OWN FYERS login gets a session that can hit /emergency-stop, mutate risk
// config, or read positions — bot state is process-wide, not scoped to a specific user.
describe("isOperatorSession", () => {
  it("allows any session when no operator id is configured (gate disabled)", () => {
    expect(isOperatorSession({ userId: "AB12345" }, null)).toBe(true);
    expect(isOperatorSession({ userId: "unknown" }, null)).toBe(true);
  });

  it("matches the configured operator id case-insensitively", () => {
    expect(isOperatorSession({ userId: "xr07633" }, "XR07633")).toBe(true);
    expect(isOperatorSession({ userId: "XR07633" }, "XR07633")).toBe(true);
  });

  it("rejects a different FYERS account", () => {
    expect(isOperatorSession({ userId: "AB99999" }, "XR07633")).toBe(false);
  });

  it("fails CLOSED when identity couldn't be verified (profile fetch failed)", () => {
    expect(isOperatorSession({ userId: "unknown" }, "XR07633")).toBe(false);
  });

  it("fails CLOSED for a missing/garbage session", () => {
    expect(isOperatorSession(null, "XR07633")).toBe(false);
    expect(isOperatorSession({}, "XR07633")).toBe(false);
  });
});
