/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#08080a",
        surface: "#0e0e11",
        panel: "#131318",
        "panel-hover": "#1a1a20",
        border: "#23232a",
        "border-subtle": "#1a1a20",
        "border-hover": "#2e2e38",
        gain: "#10b981",
        "gain-dim": "rgba(16,185,129,0.10)",
        loss: "#ef4444",
        "loss-dim": "rgba(239,68,68,0.10)",
        warn: "#f59e0b",
        "warn-dim": "rgba(245,158,11,0.10)",
        info: "#3b82f6",
        "info-dim": "rgba(59,130,246,0.10)",
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
