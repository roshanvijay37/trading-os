import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchHistoricalData } from "./backtest.js";

// Regression for a real production bug: /futures-range requested 730 days of DAILY candles in a
// single unchunked call. FYERS enforces a 366-day cap per request for D/1W/1M resolutions (same
// as its well-known 100-day cap for intraday resolutions) and rejects the whole request with
// {code:-50, message:"Invalid input"} when exceeded — reproduced live when a user tried Futures
// mode in the Backtest Lab. fetchHistoricalData previously only chunked intraday resolutions;
// daily-or-coarser requests always went out as one unchunked call regardless of range length.
const DAY = 86400;

function fetchReturning(candlesBySeenCall) {
  let call = 0;
  return vi.fn(async () => {
    const candles = candlesBySeenCall[Math.min(call, candlesBySeenCall.length - 1)];
    call++;
    return { json: async () => ({ s: "ok", candles }) };
  });
}

describe("fetchHistoricalData chunking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chunks a daily-resolution request spanning >366 days into multiple <=366-day calls", async () => {
    const fetchMock = fetchReturning([[[1000, 1, 1, 1, 1, 0]], [[2000, 1, 1, 1, 1, 0]], [[3000, 1, 1, 1, 1, 0]]]);
    vi.stubGlobal("fetch", fetchMock);

    const toTs = 900 * DAY;
    const fromTs = toTs - 800 * DAY; // 800 days — exceeds the 366-day daily cap, needs 3 chunks (366+366+68)
    const candles = await fetchHistoricalData("NSE:BANKNIFTY26JULFUT", "D", fromTs, toTs, "tok");

    expect(fetchMock.mock.calls.length).toBe(3);
    for (const [url] of fetchMock.mock.calls) {
      const params = new URL(url).searchParams;
      const spanDays = (Number(params.get("range_to")) - Number(params.get("range_from"))) / DAY;
      expect(spanDays).toBeLessThanOrEqual(366);
    }
    expect(candles.length).toBe(3); // concatenated + de-duped across chunks
  });

  it("still sends a single request for a daily-resolution range within the 366-day cap", async () => {
    const fetchMock = fetchReturning([[[1000, 1, 1, 1, 1, 0]]]);
    vi.stubGlobal("fetch", fetchMock);

    const toTs = 500 * DAY;
    const fromTs = toTs - 100 * DAY;
    await fetchHistoricalData("NSE:BANKNIFTY26JULFUT", "D", fromTs, toTs, "tok");

    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("still chunks an intraday request at the pre-existing 100-day cap (unchanged behavior)", async () => {
    const fetchMock = fetchReturning([[[1000, 1, 1, 1, 1, 0]], [[2000, 1, 1, 1, 1, 0]]]);
    vi.stubGlobal("fetch", fetchMock);

    const toTs = 300 * DAY;
    const fromTs = toTs - 150 * DAY; // 150 days — exceeds the 100-day intraday cap
    await fetchHistoricalData("NSE:BANKNIFTY26JULFUT", "15", fromTs, toTs, "tok");

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    for (const [url] of fetchMock.mock.calls) {
      const params = new URL(url).searchParams;
      const spanDays = (Number(params.get("range_to")) - Number(params.get("range_from"))) / DAY;
      expect(spanDays).toBeLessThanOrEqual(100);
    }
  });
});

// Regression: the live Chart page polls /backtest/run every 5s with fromDate/toDate strings
// that don't change intraday (both are calendar dates, and toDate is always "today" while the
// market is open) — so the cache key was identical across every poll for the whole day, and the
// FIRST successful fetch got cached and silently served for every subsequent poll, freezing the
// chart at whatever candles existed when the page first loaded that day. Only a range that's
// already fully in the past (toTs <= now) is safe to cache indefinitely.
describe("fetchHistoricalData caching (only fully-historical ranges are cached)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does NOT cache a request whose range extends to now or later (e.g. a live chart's 'through today' poll)", async () => {
    const fetchMock = fetchReturning([[[1000, 1, 1, 1, 1, 0]], [[2000, 1, 1, 1, 1, 0]]]);
    vi.stubGlobal("fetch", fetchMock);

    const now = Math.floor(Date.now() / 1000);
    const toTs = now + DAY; // extends into the future — not yet finalized
    const fromTs = toTs - 7 * DAY;

    await fetchHistoricalData("NSE:NIFTYBANK-INDEX", "5", fromTs, toTs, "tok");
    await fetchHistoricalData("NSE:NIFTYBANK-INDEX", "5", fromTs, toTs, "tok"); // identical params

    expect(fetchMock.mock.calls.length).toBe(2); // second call was NOT served from cache
  });

  it("still caches a request whose range is safely in the past (repeated identical backtest runs)", async () => {
    const fetchMock = fetchReturning([[[1000, 1, 1, 1, 1, 0]]]);
    vi.stubGlobal("fetch", fetchMock);

    const toTs = 500 * DAY; // far in the past relative to real time
    const fromTs = toTs - 7 * DAY;

    await fetchHistoricalData("NSE:NIFTYBANK-INDEX", "5", fromTs, toTs, "tok");
    await fetchHistoricalData("NSE:NIFTYBANK-INDEX", "5", fromTs, toTs, "tok");

    expect(fetchMock.mock.calls.length).toBe(1); // second call WAS served from cache
  });
});
