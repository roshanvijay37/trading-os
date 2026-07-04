import { X, ChevronRight, Activity, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useMatch } from "react-router-dom";
import { FyersConnect } from "./FyersConnect";
import { Toaster } from "./ui/toast";
import { CommandPalette } from "./commandPalette/CommandPalette";
import { togglePalette } from "./commandPalette/registry";
import { navigation } from "./navigation";
import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { useLiveDataSync } from "../store/useLiveDataSync";
import { pingApi, isFyersConnected } from "../services/api";
import type { DashboardState } from "../types/institutional";

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: React.ElementType }) {
  const match = useMatch(to === "/" ? "/" : `${to}/*`);
  const isActive = !!match;
  return (
    <Link
      to={to}
      className={`group flex items-center gap-2.5 rounded px-2.5 py-1.5 text-2xs font-medium transition ${
        isActive
          ? "bg-surface text-zinc-100"
          : "text-zinc-500 hover:bg-surface hover:text-zinc-300"
      }`}
    >
      <Icon
        size={14}
        strokeWidth={isActive ? 2.5 : 1.5}
        className="transition"
      />
      <span>{label}</span>
      {isActive && <ChevronRight size={12} className="ml-auto text-zinc-600" />}
    </Link>
  );
}

function marketStatusLabel(s: DashboardState["marketStatus"]): { text: string; tone: string } {
  switch (s) {
    case "OPEN":
      return { text: "NSE Open", tone: "text-gain" };
    case "PRE_OPEN":
      return { text: "NSE Pre-open", tone: "text-warn" };
    case "POST_CLOSE":
      return { text: "NSE Post-close", tone: "text-zinc-400" };
    default:
      return { text: "NSE Closed", tone: "text-zinc-500" };
  }
}

// Client-side IST market status — used as a fallback before login (ignores holidays;
// the backend value, which is holiday-aware, is used once connected).
function computeMarketStatusIST(): DashboardState["marketStatus"] {
  const now = new Date();
  const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  const istDay = new Date(now.getTime() + 330 * 60000).getUTCDay();
  if (istDay === 0 || istDay === 6) return "CLOSED";
  if (istMin >= 540 && istMin < 555) return "PRE_OPEN"; // 09:00–09:15 IST
  if (istMin >= 555 && istMin <= 930) return "OPEN"; // 09:15–15:30 IST
  return "CLOSED";
}

function StatusBar() {
  const { state } = useInstitutionalStore();
  const [latency, setLatency] = useState<number | null>(null);
  const [, setClock] = useState(0);

  // Live round-trip latency + reachability against our API.
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      const ms = await pingApi();
      if (!cancelled) setLatency(ms);
    }
    ping();
    const id = setInterval(ping, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Tick the clock once a second so it advances live.
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const online = latency !== null;
  const market = marketStatusLabel(isFyersConnected() ? state.dashboard.marketStatus : computeMarketStatusIST());
  const latencyTone = latency === null ? "text-zinc-600" : latency < 120 ? "text-gain" : latency < 350 ? "text-warn" : "text-loss";

  return (
    <div className="hidden h-7 items-center border-b border-border bg-surface px-4 lg:flex">
      <div className="flex items-center gap-6 text-2xs">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${online ? "bg-gain" : "bg-loss"}`} />
          <span className="text-zinc-500">System</span>
          <span className={online ? "text-zinc-400" : "text-loss"}>{online ? "Online" : "Offline"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity size={10} className="text-zinc-600" />
          <span className="text-zinc-500">Latency</span>
          <span className={`font-mono ${latencyTone}`}>{latency === null ? "—" : `${latency}ms`}</span>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <span className={market.tone}>{market.text}</span>
          <span className="font-mono text-zinc-500">
            {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
          </span>
        </div>
      </div>
    </div>
  );
}

function Header() {
  const location = useLocation();
  // Match by prefix (like the sidebar's useMatch) so nested/deep-linked routes still resolve
  // to the right title instead of falling back to "Command Center".
  const current = navigation.find((n) =>
    n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)
  );
  const label = current?.label || "Command Center";

  return (
    <header className="sticky top-0 z-30 hidden h-11 items-center justify-between border-b border-border bg-ink/90 px-4 backdrop-blur lg:flex lg:px-6">
      <div className="flex items-center gap-3">
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      </div>
      <FyersConnect />
    </header>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  useLiveDataSync(); // poll backend status -> institutional store (Command Center, Risk Dashboard)

  // Global Ctrl/Cmd-K — the single palette binding for the whole app (the Options
  // Workspace's local handler was removed in the same change; its other shortcuts stay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const grouped = navigation.reduce<Record<string, typeof navigation>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-11 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-gain/10">
          <Activity size={14} className="text-gain" strokeWidth={2.5} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight text-zinc-100">TradingOS</span>
          <span className="font-mono text-2xs text-zinc-600">v3.0</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group}>
            <p className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-700">
              {group}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => (
                <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon as React.ElementType} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <p className="text-2xs leading-relaxed text-zinc-700">
          I do not trade.
          <br />
          I supervise.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink text-zinc-400">
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
          />
          <aside className="relative h-full w-64 border-r border-border bg-surface">
            <button
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 text-zinc-500"
            >
              <X size={16} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-border bg-surface lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden">
        <div className="flex h-11 items-center justify-between border-b border-border bg-ink/90 px-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="rounded p-1.5 text-zinc-500 hover:bg-surface"
            >
              <Menu size={16} />
            </button>
            <span className="text-sm font-semibold text-zinc-100">TradingOS</span>
          </div>
          <FyersConnect />
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-56">
        <StatusBar />
        <Header />
        <main className="mx-auto max-w-[1400px] p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      <Toaster />
      <CommandPalette />
    </div>
  );
}
