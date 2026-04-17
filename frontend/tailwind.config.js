/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: "#2a14b4",
        "primary-container": "#4338ca",
        "primary-fixed": "#e3dfff",
        "primary-fixed-dim": "#c3c0ff",
        "on-primary": "#ffffff",
        "on-primary-container": "#c1beff",
        "on-primary-fixed": "#100069",
        "on-primary-fixed-variant": "#372abf",
        "inverse-primary": "#c3c0ff",

        secondary: "#a93349",
        "secondary-container": "#fe7488",
        "secondary-fixed": "#ffdadc",
        "secondary-fixed-dim": "#ffb2b9",
        "on-secondary": "#ffffff",
        "on-secondary-container": "#730425",
        "on-secondary-fixed": "#400010",
        "on-secondary-fixed-variant": "#891933",

        tertiary: "#00387d",
        "tertiary-container": "#004eaa",
        "tertiary-fixed": "#d8e2ff",
        "tertiary-fixed-dim": "#adc6ff",
        "on-tertiary": "#ffffff",
        "on-tertiary-container": "#abc5ff",
        "on-tertiary-fixed": "#001a42",
        "on-tertiary-fixed-variant": "#004395",

        error: "#ba1a1a",
        "error-container": "#ffdad6",
        "on-error": "#ffffff",
        "on-error-container": "#93000a",

        surface: "#f7f9fb",
        "surface-dim": "#d8dadc",
        "surface-bright": "#f7f9fb",
        "surface-tint": "#5148d7",
        "surface-variant": "#e0e3e5",
        "surface-container": "#eceef0",
        "surface-container-low": "#f2f4f6",
        "surface-container-lowest": "#ffffff",
        "surface-container-high": "#e6e8ea",
        "surface-container-highest": "#e0e3e5",

        background: "#f7f9fb",
        "on-background": "#191c1e",
        "on-surface": "#191c1e",
        "on-surface-variant": "#464554",
        "inverse-surface": "#2d3133",
        "inverse-on-surface": "#eff1f3",

        outline: "#777586",
        "outline-variant": "#c7c4d7",
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      fontFamily: {
        headline: ["Manrope", "sans-serif"],
        body: ["Inter", "sans-serif"],
        label: ["Inter", "sans-serif"],
      },
      boxShadow: {
        ambient: "0px 24px 48px rgba(42, 20, 180, 0.06)",
        "ambient-lg": "0px 24px 48px rgba(42, 20, 180, 0.10)",
      },
    },
  },
  plugins: [],
};
