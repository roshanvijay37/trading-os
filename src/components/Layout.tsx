import {
  BarChart3,
  BookOpen,
  Bot,
  LayoutDashboard,
  LineChart,
  Radar,
  Settings,
  ShieldCheck,
  Swords,
  TestTube,
  X,
  ChevronRight,
  Activity,
  Menu,
} from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useLocation, useMatch } from "react-router-dom";
import { FyersConnect } from "./FyersConnect";

const navigation = [
  { to: "/", label: "Command Center", icon: LayoutDashboard, group: "Operations" },
  { to: "/trading-bot", label: "Trading Bot", icon: Bot, group: "Operations" },
  { to: "/strategy-manager", label: "Strategies", icon: Swords, group: "Operations" },
  { to: "/chart", label: "Live Chart", icon: LineChart, group: "Operations" },
  { to: "/backtest", label: "Backtest Lab", icon: TestTube, group: "Research" },
  { to: "/market-intelligence", label: "Market Intel", icon: Radar, group: "Research" },
  { to: "/risk-dashboard", label: "Risk Engine", icon: ShieldCheck, group: "Risk" },
  { to: "/journal", label: "Journal", icon: BookOpen, group: "Records" },
  { to: "/reports", label: "Reports", icon: BarChart3, group: "Records" },
  { to: "/settings", label: "Settings", icon: Settings, group: "System" },
];

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

function StatusBar() {
  return (
    <div className="hidden h-7 items-center border-b border-border bg-surface px-4 lg:flex">
      <div className="flex items-center gap-6 text-2xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gain" />
          <span className="text-zinc-500">System</span>
          <span className="text-zinc-400">Online</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity size={10} className="text-zinc-600" />
          <span className="text-zinc-500">Latency</span>
          <span className="font-mono text-zinc-400">24ms</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gain animate-pulse" />
          <span className="text-zinc-500">AI CIO</span>
          <span className="text-zinc-400">Active</span>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <span className="text-zinc-600">NSE Pre-open</span>
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
  const current = navigation.find((n) => n.to === location.pathname);
  const label = current?.label || "Command Center";

  return (
    <header className="sticky top-0 z-30 flex h-11 items-center justify-between border-b border-border bg-ink/90 px-4 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      </div>
      <FyersConnect />
    </header>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);

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
    </div>
  );
}