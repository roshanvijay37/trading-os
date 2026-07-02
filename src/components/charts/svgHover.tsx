/**
 * Hover/crosshair/tooltip toolkit for the hand-rolled SVG charts (options panels,
 * payoff diagrams). Design contract: the SVG's viewBox width equals its measured CSS
 * pixel width (via useMeasuredWidth), so pointer coordinates map 1:1 onto chart
 * coordinates and text/strokes never distort — this is also the fix for the old
 * fixed-viewBox + preserveAspectRatio="none" stretching.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** Observe an element's content width (ResizeObserver). Returns [ref, width-in-px]. */
export function useMeasuredWidth<T extends HTMLElement>(initial = 0): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number" && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Map a pointer x (chart coords) to the nearest series index for `count` evenly
 * spaced points between padL and width-padR. Pure — unit-tested.
 */
export function nearestIndex(
  pxX: number,
  opts: { width: number; padL: number; padR: number; count: number },
): number | null {
  const { width, padL, padR, count } = opts;
  if (count <= 0) return null;
  if (count === 1) return 0;
  const inner = width - padL - padR;
  if (inner <= 0) return null;
  const idx = Math.round(((pxX - padL) / inner) * (count - 1));
  return Math.max(0, Math.min(count - 1, idx));
}

/**
 * Nearest index for UNEVENLY spaced points: binary-search an ascending array of
 * per-point x positions (e.g. time-scaled lines with session gaps). Pure — unit-tested.
 */
export function nearestByX(pxX: number, xs: number[]): number | null {
  const n = xs.length;
  if (n === 0) return null;
  if (n === 1) return 0;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= pxX) lo = mid;
    else hi = mid;
  }
  return pxX - xs[lo] <= xs[hi] - pxX ? lo : hi;
}

/**
 * Transparent pointer-capture layer + vertical crosshair + point dot. Render LAST
 * inside the <svg> so it sits on top. The parent owns hoverIndex state.
 */
export function SvgHoverLayer({
  width,
  height,
  padL = 0,
  padR = 0,
  padT = 0,
  padB = 0,
  count,
  xOf,
  yOf,
  xs,
  hoverIndex,
  onHover,
}: {
  width: number;
  height: number;
  padL?: number;
  padR?: number;
  padT?: number;
  padB?: number;
  count: number;
  xOf: (i: number) => number;
  /** Optional: y of the hovered point, to draw the marker dot. */
  yOf?: (i: number) => number;
  /** Ascending per-point x positions for unevenly spaced series (overrides even-spacing lookup). */
  xs?: number[];
  hoverIndex: number | null;
  onHover: (i: number | null) => void;
}) {
  return (
    <g>
      {hoverIndex != null && (
        <>
          <line
            x1={xOf(hoverIndex)}
            y1={padT}
            x2={xOf(hoverIndex)}
            y2={height - padB}
            stroke="#3e3e48"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {yOf && Number.isFinite(yOf(hoverIndex)) && (
            <circle cx={xOf(hoverIndex)} cy={yOf(hoverIndex)} r={3} fill="#3b82f6" stroke="#08080a" strokeWidth={1} />
          )}
        </>
      )}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={(e) => {
          const svg = (e.target as SVGRectElement).ownerSVGElement;
          if (!svg) return;
          const box = svg.getBoundingClientRect();
          if (box.width <= 0) return;
          const x = ((e.clientX - box.left) / box.width) * width;
          onHover(xs ? nearestByX(x, xs) : nearestIndex(x, { width, padL, padR, count }));
        }}
        onMouseLeave={() => onHover(null)}
      />
    </g>
  );
}

/**
 * HTML tooltip for SVG charts. Place inside a `relative` wrapper that contains the
 * svg; x/y are chart-pixel coords (1:1 with CSS px under the measured-width contract).
 * Flips to the left of the cursor near the right edge.
 */
export function ChartTooltip({
  x,
  y,
  containerWidth,
  title,
  rows,
}: {
  x: number;
  y: number;
  containerWidth: number;
  title?: ReactNode;
  rows: { label: string; value: string; color?: string }[];
}) {
  const flip = containerWidth > 0 && x > containerWidth - 150;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[110px] rounded border border-border bg-panel/95 px-2 py-1.5 shadow-panel"
      style={{
        left: flip ? undefined : x + 10,
        right: flip ? containerWidth - x + 10 : undefined,
        top: Math.max(0, y - 8),
      }}
    >
      {title && <p className="mb-0.5 font-mono text-2xs font-semibold text-zinc-200">{title}</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-2xs">
          <span className="text-zinc-500">{r.label}</span>
          <span className="font-mono" style={{ color: r.color ?? "#e4e4e7" }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
