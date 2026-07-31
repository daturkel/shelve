import type { LinkMetadata } from "@shelve/core/lib/linkMetadata";
import { getConfig } from "@shelve/core/lib/config";

/** The web app's `fetchLinkMetadata` implementation — installed via
 * `setLinkMetadataFetcher()` in main.ts. A plain client-side fetch (what
 * core/lib/linkMetadata.ts's default `directFetchLinkMetadata` does, and
 * what the extension keeps using unchanged) is subject to normal browser
 * CORS on a web page and fails for most ordinary sites, so this instead
 * calls the Worker's /link-metadata proxy (worker/src/linkMetadata.ts),
 * which fetches server-side and isn't subject to CORS at all.
 *
 * Same best-effort contract as the direct-fetch version: unconfigured, a
 * network failure, or a non-OK response all degrade to nulls rather than
 * throwing, since the caller's fallback (ask for a title manually) is
 * designed around "didn't find one," not around distinguishing why.
 *
 * Bounded by `timeoutMs` (default matches directFetchLinkMetadata's) so a
 * slow/hung Worker can't leave this pending indefinitely — the caller
 * (core/ui/folders.ts's buildAddLinkTile) already stops *waiting* on this
 * promise well before that via its own short race, but this fetch would
 * otherwise keep running in the background forever with nothing to ever
 * cancel it. */
export async function webFetchLinkMetadata(url: string, timeoutMs = 5000): Promise<LinkMetadata> {
  const config = await getConfig();
  if (!config) return { title: null, faviconUrl: null };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.workerUrl}/link-metadata?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return { title: null, faviconUrl: null };
    return (await res.json()) as LinkMetadata;
  } catch {
    return { title: null, faviconUrl: null };
  } finally {
    clearTimeout(timeout);
  }
}
