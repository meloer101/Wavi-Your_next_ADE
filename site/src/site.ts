/* Site-wide constants. The GitHub repository is named only here. */
export const REPO = 'meloer101/Wavi-Your_next_ADE'
export const gh = (path = ''): string => `https://github.com/${REPO}${path}`

/** The newest release's dmg for one chip; the release workflow uploads these version-free copies. */
export const dmg = (arch: 'arm64' | 'x64'): string => gh(`/releases/latest/download/Wavi-${arch}.dmg`)

/** A path under the site's base ("/" on Vercel; SITE_BASE in astro.config.mjs moves it). */
export const withBase = (path: string): string => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`

/**
 * The absolute URL of a path under the base, for canonical, hreflang, sitemap and link previews, which all
 * need a full URL. Without a configured site (local dev) it falls back to the path.
 */
export const absolute = (path: string, site: URL | undefined): string =>
  site ? new URL(withBase(path), site).href : withBase(path)
