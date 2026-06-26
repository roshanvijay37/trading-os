interface MetricCardProps {
  label: string;
  value: string | number;
  detail?: string;
  icon: React.ElementType;
  tone?: "green" | "rose" | "amber" | "blue" | "zinc";
}

export function MetricCard({ label, value, detail, icon: Icon, tone = "zinc" }: MetricCardProps) {
  const toneClasses: Record<string, { text: string; bg: string }> = {
    green: { text: "text-gain", bg: "bg-gain/10" },
    rose: { text: "text-loss", bg: "bg-loss/10" },
    amber: { text: "text-warn", bg: "bg-warn/10" },
    blue: { text: "text-info", bg: "bg-info/10" },
    zinc: { text: "text-zinc-100", bg: "bg-zinc-800" },
  };

  const t = toneClasses[tone] || toneClasses.zinc;

  return (
    <div className="rounded-panel border border-border bg-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={14} className="text-zinc-500" strokeWidth={1.5} />
        <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      </div>
      <p className={`font-mono text-xl font-semibold ${t.text}`}>{value}</p>
      {detail && <p className="mt-1 text-2xs text-zinc-600">{detail}</p>}
    </div>
  );
}