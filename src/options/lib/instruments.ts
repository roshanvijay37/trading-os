/**
 * Supported optionable instruments. Architected so adding another (FINNIFTY, SENSEX, a stock)
 * is a one-line addition here — every panel reads from this registry, nothing is hard-coded.
 */

import type { InstrumentConfig, InstrumentId } from "../types";

export const INSTRUMENTS: Record<InstrumentId, InstrumentConfig> = {
  NIFTY: {
    id: "NIFTY",
    label: "NIFTY",
    underlying: "NSE:NIFTY50-INDEX",
    lotSize: 75,
    strikeInterval: 50,
    expiryWeekday: 4, // Thursday
    fallbackIv: 0.13,
  },
  BANKNIFTY: {
    id: "BANKNIFTY",
    label: "BANKNIFTY",
    underlying: "NSE:NIFTYBANK-INDEX",
    lotSize: 30,
    strikeInterval: 100,
    expiryWeekday: 3, // Wednesday (BANKNIFTY weekly)
    fallbackIv: 0.16,
  },
};

export const INSTRUMENT_LIST: InstrumentConfig[] = Object.values(INSTRUMENTS);

export function getInstrument(id: InstrumentId): InstrumentConfig {
  return INSTRUMENTS[id];
}
