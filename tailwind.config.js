/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        accent: 'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / <alpha-value>)',
        'accent-void': 'hsl(var(--accent-h) var(--accent-s) var(--accent-l))',
        'text-primary': 'var(--text-primary)',
        'text-heading': 'var(--text-heading)',
        'text-on-accent': 'var(--text-on-accent)',
      },
    },
  },
};
