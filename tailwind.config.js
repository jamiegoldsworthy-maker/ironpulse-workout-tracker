/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '"Outfit"', 'system-ui', 'sans-serif'],
      },
      colors: {
        app: 'var(--bg-app)',
        card: 'var(--bg-card)',
        inset: 'var(--bg-inset)',
        input: 'var(--bg-input)',
        sage: 'var(--accent-sage)',
        rust: 'var(--accent-rust)',
        sand: 'var(--accent-sand)',
        brand: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#FF9A4B',
          500: '#FF9A4B',
          600: '#D15D14',
          700: '#B54B0B',
          800: '#9a3412',
          900: '#7c2d12',
        },
      },
    },
  },
  plugins: [],
}
