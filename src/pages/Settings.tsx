import { useState, type FormEvent } from "react";
import { Panel, toast } from "../components/ui";
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
    toast.success("Settings saved", { id: "settings-save" });
  };

  const fieldClass =
    "mt-1.5 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover";

  return (
    <div>
      <p className="text-2xs text-zinc-600 mb-5">Configure bot risk parameters and capital allocation.</p>

      <Panel className="max-w-2xl" title="Bot Configuration" icon={Bot}>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="text-2xs text-zinc-500">
            Trading capital (₹)
            <input
              type="number"
              min="1"
              value={form.capital}
              onChange={(event) => update("capital", Number(event.target.value))}
              className={fieldClass}
            />
          </label>
          <label className="text-2xs text-zinc-500">
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
          <label className="text-2xs text-zinc-500">
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
          <label className="text-2xs text-zinc-500">
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
              className="rounded-panel border border-gain/20 bg-gain-dim px-5 py-2.5 text-2xs font-semibold text-gain transition hover:bg-gain/20"
            >
              Save configuration
            </button>
            {saved && <span className="ml-3 text-2xs text-gain">Saved.</span>}
          </div>
        </form>
      </Panel>

      <Panel className="mt-5 max-w-2xl border-border" title="Risk Philosophy" icon={Shield}>
        <p className="text-2xs text-zinc-500 leading-relaxed">
          The bot manages position sizing, stop-losses, and daily limits automatically.
          These settings define the outer guardrails. The bot will never exceed the
          configured risk per trade or daily loss limit. Paper trading is available
          for strategy validation before live deployment.
        </p>
      </Panel>
    </div>
  );
}