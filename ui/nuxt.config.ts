import { cpSync, existsSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  ssr: true,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  // The dashboard passes raw Tailwind palette names (not just the semantic
  // primary/secondary/success/etc. slots) as `color` props — e.g. the Run
  // page's per-status buttons, and UAlert/UBadge status colors. This list
  // controls the generated `color` prop TYPE union; the actual runtime CSS
  // custom properties for the non-semantic names (red/green/amber/blue/sky)
  // are supplied via app.config.ts's `ui.colors` map — both are required.
  ui: {
    theme: {
      colors: ['secondary', 'success', 'info', 'warning', 'error', 'red', 'green', 'amber', 'blue', 'sky'],
    },
  },
  // Nuxt 3.21+ enables appManifest by default; the dashboard does not use it,
  // and dev can hit a Vite pre-transform race resolving "#app-manifest".
  experimental: {
    appManifest: false,
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  nitro: {
    // The aidev CLI binds NITRO_HOST/NITRO_PORT via env so the listener stays
    // on 127.0.0.1. Keeping the listener loopback-only is part of the auth
    // story — see ui/server/middleware/auth.ts.
    experimental: {
      asyncContext: true,
    },
    hooks: {
      // @vue/compiler-core (externalised by Nitro as a real node_module) requires
      // 'entities/decode' at runtime via Node.js module resolution. Nitro's tracer
      // misses 'entities' because it's only referenced via a subpath export from
      // an already-externalised package, so we copy it explicitly after the build.
      compiled(nitro) {
        const src = join(nitro.options.rootDir, 'node_modules', 'entities');
        const dest = join(nitro.options.output.serverDir, 'node_modules', 'entities');
        if (!existsSync(src)) return;
        // Nitro may leave a symlink here; npm does not follow symlinks when
        // packaging, so replace it with real files.
        try {
          if (lstatSync(dest).isSymbolicLink()) rmSync(dest);
        } catch {}
        if (!existsSync(dest)) cpSync(src, dest, { recursive: true });
      },
    },
  },
  runtimeConfig: {
    aidevUiToken: process.env.AIDEV_UI_TOKEN ?? '',
    public: {
      // Only non-secret values go here. The token lives server-side and is
      // delivered to the SPA via the /login?token=... handshake.
      port: process.env.AIDEV_UI_PORT ?? '19422',
      aidevCwd: process.env.AIDEV_CWD ?? '',
    },
  },
});
