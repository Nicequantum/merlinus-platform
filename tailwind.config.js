/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'benz-dark': '#08080a',
        'benz-surface': '#14141a',
        'benz-surface-2': '#1c1c24',
        'benz-surface-3': '#252530',
        'benz-accent': '#00adef',
        'benz-blue': '#00adef',
        'benz-blue-dim': '#0088c6',
        'benz-silver': '#c4c8d0',
        'benz-muted': '#6b7280',
        'benz-green': '#34d399',
        'benz-amber': '#f59e0b',
        'benz-red': '#f87171',
      },
      height: {
        13: '3.25rem',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        benz: '14px',
        'benz-lg': '18px',
        'benz-xl': '22px',
      },
      boxShadow: {
        benz: '0 4px 24px rgba(0, 0, 0, 0.45)',
        'benz-lg': '0 8px 40px rgba(0, 0, 0, 0.55)',
        'benz-glow': '0 0 24px rgba(0, 173, 239, 0.25)',
      },
    },
  },
  plugins: [],
};