// Minimal stand-in for the `vitepress` client module in tests. The real
// module wires up virtual modules (`@siteData`) only available inside a
// running VitePress app, which unit tests don't have.
export function withBase(path: string): string {
  return path;
}
