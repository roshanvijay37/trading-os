/**
 * The single live-data engine for the Options Workspace.
 *
 * One polling loop fetches the FYERS option chain (and positions), enriches it with
 * computed IV/Greeks, and shares the result to every panel via context. Refresh cadence
 * is market-aware (fast when open, slow when shut) to respect rate limits, and status is
 * always honest: disconnected / loading / live / stale / closed / error.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { accountApi, isFyersConnected } from "../../services/api";
import { buildEnrichedChain } from "../lib/chain";
import { parsePositions } from "../lib/positions";
import { getInstrument, INSTRUMENTS } from "../lib/instruments";
import type {
  DataStatus,
  EnrichedChain,
  ExpiryInfo,
  InstrumentConfig,
  InstrumentId,
  LegInstrument,
  PositionRow,
  StrikeRow,
} from "../types";

const OPEN_REFRESH_MS = 5000;
const CLOSED_REFRESH_MS = 30000;
const DEFAULT_STRIKECOUNT = 25;

/** IST market-open check (ignores holidays — used only to choose poll cadence). */
function isMarketOpenIST(now = new Date()): boolean {
  const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  const istDay = new Date(now.getTime() + 330 * 60000).getUTCDay();
  if (istDay === 0 || istDay === 6) return false;
  return istMin >= 555 && istMin <= 930; // 09:15–15:30 IST
}

export interface OptionsContextValue {
  instrument: InstrumentConfig;
  setInstrumentId: (id: InstrumentId) => void;
  strikecount: number;
  setStrikecount: (n: number) => void;
  selectedExpiryMs: number | null;
  setSelectedExpiryMs: (ms: number | null) => void;
  status: DataStatus;
  chain: EnrichedChain | null;
  expiries: ExpiryInfo[];
  positions: PositionRow[];
  lastUpdated: number | null;
  error: string | null;
  connected: boolean;
  marketOpen: boolean;
  refresh: () => void;
  // Convenience accessors used by the strategy builder / payoff tools.
  rowAt: (strike: number) => StrikeRow | undefined;
  priceAt: (type: LegInstrument, strike: number) => number;
  ivAt: (type: LegInstrument, strike: number) => number;
}

const OptionsContext = createContext<OptionsContextValue | null>(null);

export function OptionsDataProvider({ children }: { children: ReactNode }) {
  const [instrumentId, setInstrumentId] = useState<InstrumentId>("NIFTY");
  const [strikecount, setStrikecount] = useState(DEFAULT_STRIKECOUNT);
  const [selectedExpiryMs, setSelectedExpiryMs] = useState<number | null>(null);
  const [status, setStatus] = useState<DataStatus>(() => (isFyersConnected() ? "loading" : "disconnected"));
  const [chain, setChain] = useState<EnrichedChain | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(isFyersConnected());

  const instrument = getInstrument(instrumentId);
  const expiriesRef = useRef<ExpiryInfo[]>([]);
  const chainRef = useRef<EnrichedChain | null>(null);
  chainRef.current = chain;

  // Reset expiry selection when the instrument changes (a stale expiry from the other
  // instrument must not leak into the next request).
  const handleInstrument = useCallback((id: InstrumentId) => {
    setInstrumentId(id);
    setSelectedExpiryMs(null);
    expiriesRef.current = [];
  }, []);

  const fetchOnce = useCallback(async () => {
    if (!isFyersConnected()) {
      setConnected(false);
      setStatus("disconnected");
      return;
    }
    setConnected(true);
    const cfg = INSTRUMENTS[instrumentId];
    // Resolve the raw expiry token FYERS expects from the last known expiry list.
    const expiryRaw =
      selectedExpiryMs != null
        ? expiriesRef.current.find((e) => e.ms === selectedExpiryMs)?.raw
        : undefined;
    try {
      const res = await accountApi.getOptionChain(cfg.underlying, strikecount, expiryRaw as string | number | undefined);
      const built = buildEnrichedChain({
        instrument: cfg,
        rawChain: res?.optionChain,
        expiryData: res?.expiryData,
        vixRaw: res?.indiavix,
        selectedExpiryMs,
        nowMs: Date.now(),
      });
      expiriesRef.current = built.expiries;
      setChain(built);
      setLastUpdated(Date.now());
      setError(null);
      setStatus(built.rows.length > 0 ? "live" : "closed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load option chain";
      setError(msg);
      // Keep the last good snapshot if we have one (stale), else hard error.
      setStatus(chainRef.current ? "stale" : "error");
    }
  }, [instrumentId, strikecount, selectedExpiryMs]);

  const fetchPositions = useCallback(async () => {
    if (!isFyersConnected()) return;
    try {
      const res = await accountApi.getPositions();
      setPositions(parsePositions(res?.netPositions));
    } catch {
      /* positions are non-critical to the chain view; leave the last snapshot */
    }
  }, []);

  // Main polling loop — re-armed whenever the request key changes.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled) return;
      await fetchOnce();
      if (cancelled) return;
      const interval = isMarketOpenIST() ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS;
      timer = setTimeout(tick, interval);
    };
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchOnce]);

  // Positions loop — slower, independent of the chain.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      await fetchPositions();
      if (cancelled) return;
      timer = setTimeout(tick, isMarketOpenIST() ? 8000 : 60000);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchPositions]);

  // React to logout broadcast from the rest of the app.
  useEffect(() => {
    const onLogout = () => {
      setConnected(false);
      setStatus("disconnected");
      setChain(null);
      setPositions([]);
    };
    window.addEventListener("fyers:logout", onLogout);
    return () => window.removeEventListener("fyers:logout", onLogout);
  }, []);

  const rowAt = useCallback(
    (strike: number): StrikeRow | undefined => chain?.rows.find((r) => r.strike === strike),
    [chain],
  );

  const priceAt = useCallback(
    (type: LegInstrument, strike: number): number => {
      if (!chain) return 0;
      if (type === "FUT") return chain.spot;
      const row = chain.rows.find((r) => r.strike === strike);
      if (!row) return 0;
      return type === "CE" ? row.ce.ltp : row.pe.ltp;
    },
    [chain],
  );

  const ivAt = useCallback(
    (type: LegInstrument, strike: number): number => {
      if (!chain || type === "FUT") return 0;
      const row = chain.rows.find((r) => r.strike === strike);
      if (!row) return chain.vix ? chain.vix.value / 100 : 0;
      const iv = type === "CE" ? row.ce.iv : row.pe.iv;
      return iv > 0 ? iv : chain.vix ? chain.vix.value / 100 : 0;
    },
    [chain],
  );

  const value = useMemo<OptionsContextValue>(
    () => ({
      instrument,
      setInstrumentId: handleInstrument,
      strikecount,
      setStrikecount,
      selectedExpiryMs,
      setSelectedExpiryMs,
      status,
      chain,
      expiries: chain?.expiries ?? expiriesRef.current,
      positions,
      lastUpdated,
      error,
      connected,
      marketOpen: isMarketOpenIST(),
      refresh: fetchOnce,
      rowAt,
      priceAt,
      ivAt,
    }),
    [
      instrument, handleInstrument, strikecount, selectedExpiryMs, status, chain,
      positions, lastUpdated, error, connected, fetchOnce, rowAt, priceAt, ivAt,
    ],
  );

  return <OptionsContext.Provider value={value}>{children}</OptionsContext.Provider>;
}

export function useOptionsData(): OptionsContextValue {
  const ctx = useContext(OptionsContext);
  if (!ctx) throw new Error("useOptionsData must be used within OptionsDataProvider");
  return ctx;
}
