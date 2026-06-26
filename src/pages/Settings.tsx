import { useState, type FormEvent } from "react";
import { Card } from "../components/Card";
import { useTradingStore } from "../store/useTradingStore";
import type { Settings as SettingsType } from "../types";
import { Shield, Bot } from "lucide-react";

export function Settings() {
  const { settings, saveSettings } = useTradingStore();
  const [form, setForm] = useState<SettingsType>(settings);
  const [saved, setSaved] = useState(false);

  const update = (key: keyof SettingsType, value: number) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (Object.values(form).some((value) => !Number.isFinite(value) || value <= 0)) return;
    saveSettings({
      ...form,
      riskPercent: Math.min(form.riskPercent, 1),
      dailyLossLimitPercent: Math.min(form.dailyLossLimitPercent, 2),
      maxTradesPerDay: Math.max(form.maxTradesPerDay, 1),
    });
    setForm((current) => ({
      ...current,
      riskPercent: Math.min(current.riskPercent, 1),
      dailyLossLimitPercent: Math.min(current.dailyLossLimitPercent, 2),
      maxTradesPerDay: Math.max(current.maxTradesPerDay, 1),
    }));
    setSaved(true);
  };

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-white outline-none focus:border-lime-400/60";

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-white">Settings</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Configure bot risk parameters and capital allocation.
      </p>

      <Card className="mt-8 max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Bot size={16} className="text-zinc-400" />
          <h2 className="text-sm font-medium text-white">Bot Configuration</h2>
        </div>
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm text-zinc-400">
            Trading capital (₹)
            <input
              type="number"
              min="1"
              value={form.capital}
              onChange={(event) => update("capital", Number(event.target.value))}
              className={fieldClass}
            />
          </label>
          <label className="text-sm text-zinc-400">
            Risk per trade (%) — max 1
            <input
              type="number"
              min="0.1"
              max="1"
              step="0.1"
              value={form.riskPercent}
              onChange={(event) => update("riskPercent", Number(event.target.value))}
              className={fieldClass}
            />
          </label>
          <label className="text-sm text-zinc-400">
            Daily loss limit (%) — max 2
            <input
              type="number"
              min="0.1"
              max="2"
              step="0.1"
              value={form.dailyLossLimitPercent}
              onChange={(event) =>
                update("dailyLossLimitPercent", Number(event.target.value))
              }
              className={fieldClass}
            />
          </label>
          <label className="text-sm text-zinc-400">
            Max trades per day
            <input
              type="number"
              min="1"
              max="50"
              value={form.maxTradesPerDay}
              onChange={(event) => update("maxTradesPerDay", Number(event.target.value))}
              className={fieldClass}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-semibold text-zinc-950"
            >
              Save configuration
            </button>
            {saved && <span className="ml-3 text-sm text-lime-300">Saved.</span>}
          </div>
        </form>
      </Card>

      <Card className="mt-6 max-w-2xl border-zinc-700">
        <div className="flex items-start gap-3">
          <Shield size={18} className="mt-0.5 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-white">Risk Philosophy</p>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
              The bot manages position sizing, stop-losses, and daily limits automatically.
              These settings define the outer guardrails. The bot will never exceed the
              configured risk per trade or daily loss limit. Paper trading is available
              for strategy validation before live deployment.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}