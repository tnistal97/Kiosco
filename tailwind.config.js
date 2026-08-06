/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: {
          light: '#f9fafb', // gray-50
          dark: '#111827', // gray-900
        },
        card: {
          light: '#ffffff', // white
          dark: '#1f2937', // gray-800
        },
        border: {
          light: '#e5e7eb', // gray-200
          dark: '#374151', // gray-700
        },
        text: {
          light: '#111827', // gray-800
          dark: '#f9fafb', // gray-50
          mutedLight: '#6b7280', // gray-500
          mutedDark: '#9ca3af', // gray-400
        },
        primary: {
          DEFAULT: '#2563eb', // blue-600
          hover: '#1d4ed8', // blue-700
          light: '#3b82f6', // blue-500
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}
