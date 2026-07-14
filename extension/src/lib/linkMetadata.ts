export interface LinkMetadata {
  title: string | null;
  faviconUrl: string | null;
}

/** Fetches a page and pulls its <title> and favicon <link>, for the
 * manual "add link" flow (drag-from-open-tabs gets both directly from
 * chrome.tabs, so doesn't need this). Cross-origin fetch works from an
 * extension page without CORS trouble because of the "<all_urls>"
 * host_permissions grant in manifest.json. Best-effort: any failure
 * (network error, timeout, malformed HTML) just yields nulls, and the
 * caller falls back to the URL itself as the title. */
export async function fetchLinkMetadata(url: string, timeoutMs = 5000): Promise<LinkMetadata> {
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
