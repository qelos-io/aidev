export default defineAppConfig({
  ui: {
    // The dashboard passes raw Tailwind palette names (not just the semantic
    // primary/secondary/success/etc. slots) as `color` props — e.g. the Run
    // page's per-status buttons, and UAlert/UBadge status colors. Nuxt UI v4
    // only generates CSS custom properties for colors registered here, so
    // unlisted ones silently render unstyled.
    colors: {
      red: 'red',
      green: 'green',
      amber: 'amber',
      blue: 'blue',
      sky: 'sky',
    },
  },
});
