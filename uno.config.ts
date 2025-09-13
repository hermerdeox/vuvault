import { defineConfig, presetWind, presetIcons } from 'unocss';

export default defineConfig({
  presets: [
    presetWind(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/'
    })
  ],
  theme: {
    colors: {
      primary: '#6366f1',
      secondary: '#8b5cf6',
      success: '#10b981',
      danger: '#ef4444',
      warning: '#f59e0b',
      dark: '#0f172a',
      light: '#f8fafc'
    }
  },
  shortcuts: {
    'btn': 'px-4 py-2 rounded-lg font-semibold transition-all duration-200 active:scale-95',
    'btn-primary': 'btn bg-primary text-white hover:bg-primary/90',
    'btn-secondary': 'btn bg-secondary text-white hover:bg-secondary/90',
    'btn-danger': 'btn bg-danger text-white hover:bg-danger/90',
    'input-field': 'w-full px-4 py-3 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-primary',
    'card': 'p-6 rounded-xl bg-white dark:bg-gray-900 shadow-lg',
    'safe-top': 'pt-[env(safe-area-inset-top)]',
    'safe-bottom': 'pb-[env(safe-area-inset-bottom)]'
  }
});
