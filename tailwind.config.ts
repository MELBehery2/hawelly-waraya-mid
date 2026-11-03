import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 900: "#0A1128", 800: "#0F1A3A", 700: "#16244D" },
        charcoal: { 900: "#0D0F14", 800: "#14171E", 700: "#1C2029" },
        slate2: { 400: "#8B97AD", 500: "#6B7790", 600: "#4A5568" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
