export default defineAppConfig({
  ui: {
    // Raw Tailwind palette names are passed as `color` props across the
    // dashboard (Run page status buttons, UAlert/UBadge). Nuxt UI v4 only
    // generates CSS custom properties for colors registered here.
    colors: {
      primary: 'blue',
      neutral: 'slate',
      red: 'red',
      green: 'green',
      amber: 'amber',
      blue: 'blue',
      sky: 'sky',
    },
    icons: {
      loading: 'i-lucide-loader-circle',
    },
    card: {
      slots: {
        root: 'rounded-2xl ring-1 ring-default bg-default shadow-xs',
      },
    },
  },
});
