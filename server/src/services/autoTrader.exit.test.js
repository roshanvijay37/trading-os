import { describe, it, expect } from "vitest";
import { classifyExit } from "./autoTrader.js";

// classifyExit is the pure decision behind C2: a partial or unfilled market exit must NOT mark the
// position CLOSED and orphan the unsold remainder (which would sit at the broker with no stop-loss).
// It tells closePosition whether to fully close, or keep the position OPEN with `remainder` and retry.
describe("classifyExit (C2 partial-exit safety)", () => {
  it("paper mode always fully closes the entry qty", () => {
    expect(classifyExit({ paper: true, entryQty: 75, fillQty: 0 })).toEqual({ action: "full", exitQty: 75, remainder: 0 });
  });

  it("a full fill closes completely", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 75 })).toEqual({ action: "full", exitQty: 75, remainder: 0 });
  });

  it("an over-fill never reports more than the entry qty", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 90 })).toEqual({ action: "full", exitQty: 75, remainder: 0 });
  });

  it("a partial fill keeps the position open with the remainder", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 45 })).toEqual({ action: "partial", exitQty: 45, remainder: 30 });
  });

  it("a zero fill is 'unfilled' and keeps the whole position open", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 0 })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
  });

  it("a missing/garbage fill qty is treated as unfilled (never a false full close)", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: undefined })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: NaN })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: -10 })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
  });
});
