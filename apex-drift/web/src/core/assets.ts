/**
 * Where a bundled file lives. The normal build ships files next to index.html;
 * the single-file build (`npm run single`) packs every one of them into the
 * page as a data: URL under `window.__APEX_ASSETS`, keyed by its path in dist.
 */
const inline = (globalThis as { __APEX_ASSETS?: Record<string, string> }).__APEX_ASSETS

export const singleFile = !!inline

export function asset(path: string): string {
  if (!inline) return path
  const rel = path.replace(/^\.\//, '')
  // Vite resolves emitted scripts against the module URL, which in the single
  // file is the page itself; match those by file name.
  return inline[rel] ?? inline[`assets/${rel.split('/').pop()}`] ?? path
}

/**
 * URLs to try, in order, for a script loaded by URL (the audio worklet). From
 * a file:// page Chrome accepts a data: URL for a worklet but rejects a blob:
 * one (its origin is opaque); a blob: URL is kept as the fallback for browsers
 * that are stricter about data: modules.
 */
export async function scriptUrls(path: string): Promise<string[]> {
  const url = asset(path)
  if (!url.startsWith('data:')) return [url]
  const blob = await (await fetch(url)).blob()
  return [url, URL.createObjectURL(new Blob([blob], { type: 'text/javascript' }))]
}
