/**
 * Shared working-strategy state for the Strategy Builder, Payoff Analyzer and Strategy
 * Analyzer panels. Holds the current legs and exposes template loading (anchored to the
 * live ATM strike and live premiums/IV) plus leg CRUD. Lives inside the data provider so
 * templates can read live chain context.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useOptionsData } from "./OptionsDataProvider";
import { getTemplate, STRATEGY_TEMPLATES } from "../lib/strategies";
import type { LegInstrument, StrategyBuildContext, StrategyLeg } from "../types";

let seq = 0;
function newId() {
  return `leg-${Date.now().toString(36)}-${seq++}`;
}

export interface StrategyContextValue {
  legs: StrategyLeg[];
  name: string;
  setName: (n: string) => void;
  setLegs: (legs: StrategyLeg[]) => void;
  addLeg: (partial?: Partial<StrategyLeg>) => void;
  updateLeg: (id: string, patch: Partial<StrategyLeg>) => void;
  removeLeg: (id: string) => void;
  clear: () => void;
  loadTemplate: (templateId: string) => void;
  templates: typeof STRATEGY_TEMPLATES;
}

const StrategyContext = createContext<StrategyContextValue | null>(null);

export function StrategyProvider({ children }: { children: ReactNode }) {
  const { chain, instrument, ivAt, priceAt } = useOptionsData();
  const [legs, setLegs] = useState<StrategyLeg[]>([]);
  const [name, setName] = useState("Custom Strategy");

  const buildContext = useCallback((): StrategyBuildContext => {
    const atm = chain?.atmStrike ?? 0;
    const expiryMs = chain?.selectedExpiry?.ms ?? Date.now();
    const farExpiryMs = chain?.expiries.find((e) => e.ms > expiryMs)?.ms ?? expiryMs;
    return {
      atmStrike: atm,
      strikeInterval: instrument.strikeInterval,
      expiryMs,
      farExpiryMs,
      priceAt: (type: LegInstrument, strike: number) => priceAt(type, strike),
      ivAt: (type: LegInstrument, strike: number) => ivAt(type, strike),
    };
  }, [chain, instrument, ivAt, priceAt]);

  const loadTemplate = useCallback(
    (templateId: string) => {
      const tpl = getTemplate(templateId);
      if (!tpl) return;
      setName(tpl.name);
      setLegs(tpl.build(buildContext()));
    },
    [buildContext],
  );

  const addLeg = useCallback(
    (partial?: Partial<StrategyLeg>) => {
      const ctx = buildContext();
      const instr: LegInstrument = partial?.instrument ?? "CE";
      const strike = partial?.strike ?? ctx.atmStrike;
      setLegs((prev) => [
        ...prev,
        {
          id: newId(),
          action: partial?.action ?? "BUY",
          instrument: instr,
          strike,
          lots: partial?.lots ?? 1,
          price: partial?.price ?? ctx.priceAt(instr, strike),
          iv: partial?.iv ?? ctx.ivAt(instr, strike),
          expiryMs: partial?.expiryMs ?? ctx.expiryMs,
        },
      ]);
    },
    [buildContext],
  );

  const updateLeg = useCallback((id: string, patch: Partial<StrategyLeg>) => {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const removeLeg = useCallback((id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const clear = useCallback(() => setLegs([]), []);

  const value = useMemo<StrategyContextValue>(
    () => ({
      legs, name, setName, setLegs, addLeg, updateLeg, removeLeg, clear, loadTemplate,
      templates: STRATEGY_TEMPLATES,
    }),
    [legs, name, addLeg, updateLeg, removeLeg, clear, loadTemplate],
  );

  return <StrategyContext.Provider value={value}>{children}</StrategyContext.Provider>;
}

export function useStrategy(): StrategyContextValue {
  const ctx = useContext(StrategyContext);
  if (!ctx) throw new Error("useStrategy must be used within StrategyProvider");
  return ctx;
}
