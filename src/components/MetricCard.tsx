import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "green" | "amber" | "rose";
}

const tones = {
  green: "bg-lime-400/10 text-lime-300",
  amber: "bg-amber-400/10 text-amber-300",
  rose: "bg-rose-400/10 text-rose-300",
};

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "green",
}: MetricCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-400">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-1 text-xs text-zinc-500">{detail}</p>
        </div>
        <span className={`rounded-xl p-2.5 ${tones[tone]}`}>
          <Icon size={19} />
        </span>
      </div>
    </Card>
  );
}
