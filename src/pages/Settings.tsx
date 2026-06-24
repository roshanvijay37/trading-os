import { useState, type FormEvent } from "react";
import { Card } from "../components/Card";
import { useTradingStore } from "../store/useTradingStore";
import type { Settings as SettingsType } from "../types";

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
      maxTradesPerDay: 1,
    });
    setForm((current) => ({
      ...current,
      riskPercent: Math.min(current.riskPercent, 1),
      dailyLossLimitPercent: Math.min(current.dailyLossLimitPercent, 2),
      maxTradesPerDay: 1,
    }));
    setSaved(true);
  };

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-white outline-none focus:border-lime-400/60";

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-white">Settings</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Guardrails can be made stricter, never looser than the constitution.
      </p>
      <Card className="mt-8 max-w-2xl">
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
            Maximum trades per day
            <input type="number" value={1} disabled className={`${fieldClass} opacity-50`} />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-semibold text-zinc-950"
            >
              Save guardrails
            </button>
            {saved && <span className="ml-3 text-sm text-lime-300">Saved.</span>}
          </div>
        </form>
      </Card>
    </div>
  );
}
