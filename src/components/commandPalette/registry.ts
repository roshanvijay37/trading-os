/**
 * Global command registry + palette open-state. Commands are derived, not duplicated:
 * pages come from the navigation array and options panels from the options PANELS
 * registry (labels/icons/keywords already live there). Panels deep-link via
 * /options?panel=<id> — the workspace reads the param, so entries are bookmarkable.
 * The open-state is a module observer store (same pattern as toast) so any code —
 * e.g. the options Toolbar search button — can call openCommandPalette().
 */

import type { LucideIcon } from "lucide-react";
import type { NavigateFunction } from "react-router-dom";
import { navigation } from "../navigation";
import { PANELS } from "../../options/panels/registry";

export interface Command {
  id: string;
  label: string;
  group: "Pages" | "Options";
  icon: LucideIcon;
  keywords?: string;
  perform: (ctx: { navigate: NavigateFunction }) => void;
}

export function buildCommands(): Command[] {
  const pages: Command[] = navigation.map((n) => ({
    id: `page:${n.to}`,
    label: n.label,
    group: "Pages",
    icon: n.icon,
    keywords: `${n.group} ${n.keywords ?? ""}`,
    perform: ({ navigate }) => navigate(n.to),
  }));
  const panels: Command[] = PANELS.map((p) => ({
    id: `options:${p.id}`,
    label: p.label,
    group: "Options",
    icon: p.icon,
    keywords: `${p.group} ${p.keywords ?? ""}`,
    perform: ({ navigate }) => navigate(`/options?panel=${p.id}`),
  }));
  return [...pages, ...panels];
}

/** Same substring match the options palette used. Pure — unit-testable. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const term = query.trim().toLowerCase();
  if (!term) return commands;
  return commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(term));
}

// ---------------------------------------------------------------------------
// Open-state observer store
// ---------------------------------------------------------------------------

let isOpen = false;
const listeners = new Set<() => void>();

export function getPaletteOpen(): boolean {
  return isOpen;
}

export function setPaletteOpen(open: boolean): void {
  if (isOpen === open) return;
  isOpen = open;
  for (const l of listeners) l();
}

export function openCommandPalette(): void {
  setPaletteOpen(true);
}

export function togglePalette(): void {
  setPaletteOpen(!isOpen);
}

export function subscribePalette(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
