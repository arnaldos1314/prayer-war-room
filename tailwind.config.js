/** @type {import('tailwindcss').Config} */
module.exports = {
  // Ajusta esto para que apunte a todas tus carpetas con código
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
}