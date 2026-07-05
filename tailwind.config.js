/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens: values live in CSS custom properties (src/styles.css), swapped
        // wholesale by the [data-theme="light"] selector on <html>. The rgb(var(..) / <alpha-value>)
        // form is Tailwind's documented pattern for CSS-var colors that still support opacity
        // modifiers (e.g. bg-ink/90, border-border-subtle/60), which this codebase uses throughout.
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        "panel-hover": "rgb(var(--color-panel-hover) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "border-subtle": "rgb(var(--color-border-subtle) / <alpha-value>)",
        "border-hover": "rgb(var(--color-border-hover) / <alpha-value>)",
        // Semantic accent colors stay fixed across themes (same convention as GitHub/most
        // dashboards — green=gain/red=loss reads correctly on both a dark and a light panel).
        gain: "rgb(16 185 129 / <alpha-value>)",
        "gain-dim": "rgba(16,185,129,0.10)",
        loss: "rgb(239 68 68 / <alpha-value>)",
        "loss-dim": "rgba(239,68,68,0.10)",
        warn: "rgb(245 158 11 / <alpha-value>)",
        "warn-dim": "rgba(245,158,11,0.10)",
        info: "rgb(59 130 246 / <alpha-value>)",
        "info-dim": "rgba(59,130,246,0.10)",
        // Overrides Tailwind's built-in zinc scale so the ~760 existing text-zinc-* utility
        // classes across the app flip automatically with the theme — no component edits needed.
        zinc: {
          50: "var(--zinc-50)",
          100: "var(--zinc-100)",
          200: "var(--zinc-200)",
          300: "var(--zinc-300)",
          400: "var(--zinc-400)",
          500: "var(--zinc-500)",
          600: "var(--zinc-600)",
          700: "var(--zinc-700)",
          800: "var(--zinc-800)",
          900: "var(--zinc-900)",
          950: "var(--zinc-950)",
        },
      },
      fontFamily: {
        mono: [
          '"SF Mono"',
          "SFMono-Regular",
          "ui-monospace",
          "Menlo",
          "Monaco",
          '"Cascadia Mono"',
          '"Segoe UI Mono"',
          '"Roboto Mono"',
          '"Oxygen Mono"',
          '"Ubuntu Monospace"',
          '"Source Code Pro"',
          '"Fira Mono"',
          '"Droid Sans Mono"',
          '"Courier New"',
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
      },
      boxShadow: {
        glow: "0 0 24px rgba(16,185,129,0.06)",
        panel: "0 1px 3px rgba(0,0,0,0.3)",
      },
      borderRadius: {
        panel: "6px",
      },
      spacing: {
        18: "4.5rem",
      },
      keyframes: {
        "flash-up": {
          from: { backgroundColor: "rgba(16,185,129,0.22)" },
          to: { backgroundColor: "transparent" },
        },
        "flash-down": {
          from: { backgroundColor: "rgba(239,68,68,0.22)" },
          to: { backgroundColor: "transparent" },
        },
        "flash-neutral": {
          from: { backgroundColor: "rgba(59,130,246,0.18)" },
          to: { backgroundColor: "transparent" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { opacity: "0.5" },
          "50%": { opacity: "1" },
          to: { opacity: "0.5" },
        },
      },
      animation: {
        "flash-up": "flash-up 0.6s ease-out",
        "flash-down": "flash-down 0.6s ease-out",
        "flash-neutral": "flash-neutral 0.6s ease-out",
        "toast-in": "toast-in 0.15s ease-out",
        shimmer: "shimmer 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
