// Defined once in shared/ (rather than here) so the wire contract with
// worker/src/linkMetadata.ts's server-side counterpart can't silently
// drift — see shared/types.ts's doc comment. Re-exported under this
// module's own path since every existing import site already expects
// LinkMetadata to live at "@shelve/core/lib/linkMetadata".
import type { LinkMetadata } from "@shelve/shared";
export type { LinkMetadata };

/** Which implementation `fetchLinkMetadata()` (below) delegates to —
 * swappable per platform, same module-level-singleton-set-once-at-startup
 * shape as `core/lib/store.ts`'s `Store`/`setStore()`. The call site
 * (`core/ui/folders.ts`'s "Add link" flow) is shared, platform-agnostic
 * code with no way to know which platform it's running on.
 *
 * Defaults to `directFetchLinkMetadata` below — the extension never calls
 * `setLinkMetadataFetcher()` and just gets this directly, since it's
 * already the best available option there (exempt from CORS via
 * manifest.json's host_permissions, so no round-trip through the Worker
 * needed or wanted). The web app installs a Worker-backed implementation
 * instead (`web/src/webLinkMetadata.ts`), since a plain client-side fetch
 * from a web page is subject to normal browser CORS and fails for most
 * ordinary sites — see worker/src/linkMetadata.ts for the server-side
 * counterpart this proxies to. */
let activeFetcher: (url: string) => Promise<LinkMetadata> = directFetchLinkMetadata;

export function setLinkMetadataFetcher(fetcher: (url: string) => Promise<LinkMetadata>): void {
  activeFetcher = fetcher;
}

export function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  return activeFetcher(url);
}

/** Fetches a page and pulls its <title> and favicon <link>, for the
 * manual "add link" flow (drag-from-open-tabs gets both directly from
 * chrome.tabs, so doesn't need this). Cross-origin fetch works from an
 * extension page without CORS trouble because of the "<all_urls>"
 * host_permissions grant in manifest.json. Best-effort: any failure
 * (network error, timeout, malformed HTML) just yields nulls, and the
 * caller falls back to the URL itself as the title. */
export async function directFetchLinkMetadata(url: string, timeoutMs = 5000): Promise<LinkMetadata> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const title = doc.querySelector("title")?.textContent?.trim() || null;

    const iconHref = doc.querySelector('link[rel~="icon"]')?.getAttribute("href");
    // "data:," is a well-known convention some sites use specifically to
    // suppress the browser's automatic favicon.ico request — not real
    // icon data. Treat it as "no icon found" rather than an empty image.
    const faviconUrl =
      iconHref && iconHref !== "data:," ? new URL(iconHref, url).toString() : new URL("/favicon.ico", url).toString();

    return { title, faviconUrl };
  } catch {
    return { title: null, faviconUrl: null };
  } finally {
    clearTimeout(timeout);
  }
}
