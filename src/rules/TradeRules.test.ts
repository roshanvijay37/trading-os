import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../services/storage";
import type { Trade } from "../types";
import { TradeRules } from "./TradeRules";

const trade: Trade = {
  id: "one",
  date: "2026-06-22",
  symbol: "NIFTY",
  side: "LONG",
  entryPrice: 100,
  stopLossPrice: 99,
  quantity: 10,
  riskAmount: 10,
  emotionStatus: "SAFE",
  followedRules: true,
  outcome: "OPEN",
  pnl: 0,
  notes: "",
  createdAt: "2026-06-22T09:00:00.000Z",
};

describe("TradeRules", () => {
  it("locks a second trade on the same day", () => {
    const result = new TradeRules().validate(
      trade,
      [trade],
      DEFAULT_SETTINGS,
      100,
      "2026-06-22",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("daily trade limit");
  });

  it("allows the first correctly sized trade", () => {
    const result = new TradeRules().validate(
      trade,
      [],
      DEFAULT_SETTINGS,
      100,
      "2026-06-22",
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
