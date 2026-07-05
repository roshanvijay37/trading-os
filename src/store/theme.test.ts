import { describe, it, expect, beforeEach } from "vitest";
import { getTheme, setTheme, toggleTheme, subscribeTheme } from "./theme";

describe("theme store", () => {
  beforeEach(() => {
    // setTheme() no-ops when the value is unchanged, so force a real light->dark transition
    // (guaranteed regardless of whatever state the previous test left the module-level
    // singleton in) rather than relying on setTheme("dark") alone to re-apply.
    setTheme("light");
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    setTheme("dark");
  });

  it("defaults to dark and applies it to <html> and localStorage", () => {
    expect(getTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("trading-os-theme")).toBe("dark");
  });

  it("setTheme('light') updates the getter, the DOM attribute, and storage", () => {
    setTheme("light");
    expect(getTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("trading-os-theme")).toBe("light");
  });

  it("toggleTheme flips dark <-> light", () => {
    expect(getTheme()).toBe("dark");
    toggleTheme();
    expect(getTheme()).toBe("light");
    toggleTheme();
    expect(getTheme()).toBe("dark");
  });

  it("setTheme with the current value is a no-op (does not notify subscribers)", () => {
    let calls = 0;
    const unsub = subscribeTheme(() => calls++);
    setTheme("dark"); // already dark
    expect(calls).toBe(0);
    setTheme("light");
    expect(calls).toBe(1);
    unsub();
  });

  it("subscribeTheme's returned unsubscribe stops further notifications", () => {
    let calls = 0;
    const unsub = subscribeTheme(() => calls++);
    setTheme("light");
    expect(calls).toBe(1);
    unsub();
    setTheme("dark");
    expect(calls).toBe(1);
  });

  it("updates the theme-color meta tag to match the active theme", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#09090b");
    document.head.appendChild(meta);

    setTheme("light");
    expect(meta.getAttribute("content")).toBe("#ffffff");
    setTheme("dark");
    expect(meta.getAttribute("content")).toBe("#09090b");

    document.head.removeChild(meta);
  });
});
