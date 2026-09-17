/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Interbat brand blue, mapped onto the "teal" scale the app already
        // uses everywhere (buttons, accents, highlights) — so every existing
        // teal-* class renders in brand blue without touching each component.
        teal: {
          50: '#EAF4FC',
          100: '#D3E9F8',
          200: '#A6D3F1',
          300: '#78BDEA',
          400: '#4FA8DE',
          500: '#2E93D1',
          600: '#1B7FBD',
          700: '#166699',
          800: '#124F79',
          900: '#0C3A59',
        },
      },
    },
  },
  plugins: [],
};
