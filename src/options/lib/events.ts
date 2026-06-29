/**
 * Tiny typed event bus for cross-panel actions (e.g. click a strike in the chain →
 * prefill the Trade Ticket / Strategy Builder). Decouples panels without bloating the
 * data provider. Built on a DOM CustomEvent so it works across the whole workspace.
 */

import type { OptionType } from "../types";

export interface SelectContractDetail {
  symbol: string;
  type: OptionType;
  strike: number;
  ltp: number;
  source?: "chain" | "screener" | "watchlist";
}

const SELECT_EVENT = "options:select-contract";

export function emitSelectContract(detail: SelectContractDetail): void {
  window.dispatchEvent(new CustomEvent<SelectContractDetail>(SELECT_EVENT, { detail }));
}

export function onSelectContract(handler: (d: SelectContractDetail) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent<SelectContractDetail>).detail);
  window.addEventListener(SELECT_EVENT, fn);
  return () => window.removeEventListener(SELECT_EVENT, fn);
}

export interface AddLegDetail {
  action: "BUY" | "SELL";
  instrument: OptionType | "FUT";
  strike: number;
}
const ADD_LEG_EVENT = "options:add-leg";
export function emitAddLeg(detail: AddLegDetail): void {
  window.dispatchEvent(new CustomEvent<AddLegDetail>(ADD_LEG_EVENT, { detail }));
}
export function onAddLeg(handler: (d: AddLegDetail) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent<AddLegDetail>).detail);
  window.addEventListener(ADD_LEG_EVENT, fn);
  return () => window.removeEventListener(ADD_LEG_EVENT, fn);
}
