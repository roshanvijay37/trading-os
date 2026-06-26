/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#09090b",
        panel: "#18181b",
        discipline: "#a3e635",
        warning: "#f59e0b",
        danger: "#f43f5e",
      },
      boxShadow: {
        glow: "0 0 40px rgba(163, 230, 53, 0.08)",
      },
    },
  },
  plugins: [],
};
