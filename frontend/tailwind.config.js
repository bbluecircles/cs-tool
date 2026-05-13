/** @type {import('tailwindcss').Config} */

// Intellimed UI palette, translated into Tailwind color tokens.
// All hex values come from the reference palette image; do not edit without
// a matching update to the palette doc. Components should reference these
// tokens (e.g. `bg-primary-900`) rather than using raw hex anywhere.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary — teals. Sidebar and brand accents.
        primary: {
          100: '#E6F4F5',
          300: '#7ECBD1',
          500: '#38A3AA',
          700: '#2D8C92',
          900: '#1E6F73',
        },
        // Secondary — blues. Primary action buttons and links.
        secondary: {
          100: '#E3F2FD',
          300: '#64B5F6',
          500: '#1976D2',
          700: '#1565C0',
          900: '#0D47A1',
        },
        // Neutrals
        gray: {
          50:  '#F8F9FA',
          100: '#F1F3F5',
          300: '#ADB5BD',
          500: '#6C757D',
          700: '#495057',
          900: '#212529',
        },
        // Status
        success: { 100: '#E8F5E9', 600: '#28A745' },
        warning: { 100: '#FFF3CD', 600: '#F0AD00' },
        error:   { 100: '#F8D7DA', 600: '#DC3545' },
        info:    { 100: '#D6E9FF', 600: '#0D6EFD' },
        // UI elements
        border:   '#DEE2E6',
        divider:  '#E9ECEF',
        surface:  '#F8F9FA',
        // Table-specific tokens from the palette
        'table-header': '#D9EDF7',
        'table-row-alt': '#F2F7FB',
        'row-hover':   '#F1F8FA',
        'row-selected':'#E3F2FD',
        'focus-ring':  '#64B5F6',
      },
      fontFamily: {
        // System-font stack first for resilience on Windows/IIS deployments;
        // a distinctive sans for display text. Inter is explicitly avoided
        // per our design direction.
        sans: [
          'Source Sans 3',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Cascadia Code',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // Tighter than Tailwind defaults — data-dense UIs benefit.
        'xs':  ['0.75rem',  { lineHeight: '1rem' }],
        'sm':  ['0.8125rem',{ lineHeight: '1.125rem' }],
        'base':['0.875rem', { lineHeight: '1.25rem' }],
        'lg':  ['1rem',     { lineHeight: '1.5rem' }],
        'xl':  ['1.125rem', { lineHeight: '1.5rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.75rem' }],
      },
      boxShadow: {
        card:  '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        modal: '0 10px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.08)',
      },
      ringColor: {
        DEFAULT: '#64B5F6',
      },
    },
  },
  plugins: [],
}
