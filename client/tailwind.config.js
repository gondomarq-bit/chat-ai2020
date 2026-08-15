/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Segoe UI", "Tahoma", "system-ui", "sans-serif"],
      },
      keyframes: {
        bounce1: {
          "0%, 80%, 100%": { transform: "scale(0)", opacity: "0.4" },
          "40%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        dot: "bounce1 1.4s infinite ease-in-out both",
      },
    },
  },
  plugins: [],
};
