import { describe, expect, it } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { Flash, useFlashOnChange } from "./Flash";

describe("useFlashOnChange", () => {
  it("does not flash on first render", () => {
    const { result } = renderHook(({ v }) => useFlashOnChange(v), { initialProps: { v: 100 } });
    expect(result.current.flashClass).toBe("");
    expect(result.current.flashKey).toBe(0);
  });

  it("flashes up when a number increases and down when it decreases", () => {
    const { result, rerender } = renderHook(({ v }) => useFlashOnChange(v), { initialProps: { v: 100 } });
    rerender({ v: 105 });
    expect(result.current.flashClass).toBe("animate-flash-up");
    expect(result.current.flashKey).toBe(1);
    rerender({ v: 95 });
    expect(result.current.flashClass).toBe("animate-flash-down");
    expect(result.current.flashKey).toBe(2);
  });

  it("keeps the same key when the value has not changed (no re-animation)", () => {
    const { result, rerender } = renderHook(({ v }) => useFlashOnChange(v), { initialProps: { v: 100 } });
    rerender({ v: 105 });
    const key = result.current.flashKey;
    rerender({ v: 105 });
    expect(result.current.flashKey).toBe(key);
  });

  it("uses the neutral flash for non-numeric transitions", () => {
    const { result, rerender } = renderHook(({ v }: { v: unknown }) => useFlashOnChange(v), {
      initialProps: { v: "live" as unknown },
    });
    rerender({ v: "stale" });
    expect(result.current.flashClass).toBe("animate-flash-neutral");
  });

  it("treats null → number as neutral (no fake direction)", () => {
    const { result, rerender } = renderHook(({ v }: { v: unknown }) => useFlashOnChange(v), {
      initialProps: { v: null as unknown },
    });
    rerender({ v: 42 });
    expect(result.current.flashClass).toBe("animate-flash-neutral");
  });
});

describe("Flash", () => {
  it("renders children when provided", () => {
    render(<Flash value={12.5}>₹12.50</Flash>);
    expect(screen.getByText("₹12.50")).toBeInTheDocument();
  });

  it("renders the raw value without children and an em dash for null", () => {
    const { rerender } = render(<Flash value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    rerender(<Flash value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
