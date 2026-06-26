import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  LayoutDashboard,
  Menu,
  Monitor,
  Settings,
  ShieldCheck,
  TestTube,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { FyersConnect } from "./FyersConnect";

const navigation = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/trading-bot", label: "Trading Bot", icon: Bot },
  { to: "/market-monitor", label: "Market Monitor", icon: Monitor },
  { to: "/backtest", label: "Backtest", icon: TestTube },
  { to: "/visual-backtest", label: "Visual", icon: Activity },
  { to: "/journal", label: "Journal", icon: BookOpen },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-20 items-center gap-3 border-b border-zinc-800 px-6">
        <span className="rounded-xl bg-lime-400 p-2 text-zinc-950">
          <ShieldCheck size={22} strokeWidth={2.5} />
        </span>
        <div>
          <p className="font-semibold text-white">TradingOS</p>
          <p className="text-xs text-zinc-500">Automation-first</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${
                isActive
                  ? "bg-lime-400/10 text-lime-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
              }`
            }
          >
            <span className="flex items-center gap-3">
              <Icon size={18} />
              {label}
            </span>
          </NavLink>
        ))}
      </nav>
      <p className="border-t border-zinc-800 p-5 text-xs leading-5 text-zinc-600">
        I do not trade.
        <br />
        I supervise.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink text-zinc-200">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-800 bg-zinc-950 lg:block">
        {sidebar}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
          />
          <aside className="relative h-full w-72 border-r border-zinc-800 bg-zinc-950">
            <button
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-6 text-zinc-400"
            >
              <X />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 backdrop-blur lg:hidden">
          <div className="flex items-center">
            <button
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="rounded-lg border border-zinc-800 p-2"
            >
              <Menu size={20} />
            </button>
            <p className="ml-3 font-semibold text-white">TradingOS</p>
          </div>
          <FyersConnect />
        </header>
        <header className="sticky top-0 z-30 hidden h-16 items-center justify-end border-b border-zinc-800 bg-zinc-950/90 px-6 backdrop-blur lg:flex">
          <FyersConnect />
        </header>
        <main className="mx-auto max-w-7xl p-5 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}