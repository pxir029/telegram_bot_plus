/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}", "./src/**/*.{js,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        px: {
          50:  "#f0f7ff",
          100: "#e0effe",
          200: "#b9dffd",
          300: "#7cc5fb",
          400: "#36a7f6",
          500: "#0c8ce9",
          600: "#006fc7",
          700: "#0158a1",
          800: "#064b85",
          900: "#0b3f6e",
          950: "#072849",
        },
        glass: {
          border: "rgba(255,255,255,0.08)",
          bg: "rgba(15,23,42,0.55)",
          bgLight: "rgba(255,255,255,0.06)",
        },
      },
      fontFamily: {
        sans: ["Inter", "Vazirmatn", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.28)",
        "glass-sm": "0 4px 16px rgba(0,0,0,0.18)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
