// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  ssr: true,
  modules: ['@nuxt/ui'],
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
    // entities v7 uses package.json `exports` subpath maps that Nitro's file
    // copier doesn't fully preserve when externalising the package. Inlining it
    // lets Rollup resolve `entities/decode` at build time instead of at runtime.
    externals: {
      inline: ['entities'],
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
