import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-fira-code)", "JetBrains Mono", "ui-monospace", "monospace"],
        poppins: ["var(--font-poppins)", "system-ui", "sans-serif"],
        lora: ["var(--font-lora)", "serif"],
        caveat: ["var(--font-caveat)", "cursive"],
      },
      colors: {
        // Keep existing colors for chat compatibility
        ink: "#283034",
        warm: {
          50: "#fff8f3",
          100: "#ffe9db",
          200: "#ffd2bd",
          500: "#e16a46",
          700: "#9d3d27"
        },
        sage: {
          50: "#f3f7f0",
          100: "#dfead8",
          200: "#c8ddbf",
          300: "#a7c49b",
          400: "#7da878",
          500: "#668a5b",
          600: "#527349",
          700: "#3f5d38"
        },
        skysoft: {
          50: "#eff7fb",
          100: "#d8edf7",
          500: "#3d87a4"
        },
        // Warm Geek palette
        linen: "#FCFAF2",
        cream: "#FBF9F6",
        "deep-slate": "#2C3E50",
        "warm-brown": "#332B25",
        terminal: "#1E1E1E",
        "terminal-accent": "#4EC9B0",
      },
      boxShadow: {
        soft: "0 18px 45px rgba(54, 43, 35, 0.10)",
        card: "0 1px 3px rgba(0, 0, 0, 0.04)",
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "none",
            "--tw-prose-body": "#332B25",
            "--tw-prose-headings": "#2C3E50",
            "--tw-prose-lead": "#4b5563",
            "--tw-prose-links": "#2C3E50",
            "--tw-prose-bold": "#2C3E50",
            "--tw-prose-counters": "#6b7280",
            "--tw-prose-bullets": "#d1d5db",
            "--tw-prose-captions": "#6b7280",
            "--tw-prose-kbd": "#111827",
            "--tw-prose-kbd-shadows": "rgb(17 24 39 / 10%)",
            "--tw-prose-th-borders": "#d1d5db",
            "--tw-prose-td-borders": "#e5e7eb",
            "--tw-prose-code": "#1E1E1E",
            "--tw-prose-pre-bg": "#1E1E1E",
            "--tw-prose-pre-code": "#E0E0E0",
            "--tw-prose-quotes": "#2C3E50",
            "--tw-prose-quote-borders": "#2C3E50",
            "--tw-prose-hr": "#E0E0E0",
            code: {
              fontWeight: "500",
              fontFamily: "var(--font-fira-code), monospace",
            },
            pre: {
              fontFamily: "var(--font-fira-code), monospace",
            },
          },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
