/** Server-side counterpart to core/lib/linkMetadata.ts's client-side fetch —
 * exists purely because the web app can't reliably do this itself. The
 * extension bypasses CORS via manifest.json's host_permissions and always
 * uses the direct client-side fetch (see core/lib/linkMetadata.ts); a web
 * page has no such exemption, and most ordinary sites don't send permissive
 * CORS headers on their HTML responses, so a plain client-side fetch()
 * fails for the vast majority of URLs. Workers aren't subject to browser
 * CORS at all, so this fetches server-side and hands back the same shape
 * core/lib/linkMetadata.ts's LinkMetadata already defines.
 *
 * Same best-effort contract as the client-side version: any failure
 * (network error, timeout, non-HTML response) degrades to nulls rather than
 * an error response, since the caller's fallback (ask for a title manually)
 * is designed around "didn't find one," not around distinguishing *why*. */

export interface LinkMetadata {
  title: string | null;
  faviconUrl: string | null;
}

const FETCH_TIMEOUT_MS = 5000;
// <head> content (title/meta/link tags) is always near the top of a
// well-formed page — capping how much of the response we read bounds worst
// case Worker CPU/time against a huge or pathological response without
// needing to inspect Content-Length (which may be absent or wrong) upfront.
const MAX_BYTES_READ = 65536;

function firstNonEmpty(...values: (string | null)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { title: null, faviconUrl: null };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { title: null, faviconUrl: null };
  }

  let res: Response;
  try {
    res = await fetch(target.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return { title: null, faviconUrl: null };
  }
  if (!res.ok) return { title: null, faviconUrl: null };
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) return { title: null, faviconUrl: null };

  let titleText = "";
  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;
  let iconHref: string | null = null;

  const rewriter = new HTMLRewriter()
    .on("title", {
      text(text) {
        titleText += text.text;
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        ogTitle ??= el.getAttribute("content");
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        twitterTitle ??= el.getAttribute("content");
      },
    })
    .on('link[rel~="icon"]', {
      element(el) {
        iconHref ??= el.getAttribute("href");
      },
    });

  const transformed = rewriter.transform(res);
  const reader = transformed.body?.getReader();
  if (reader) {
    let bytesRead = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value?.byteLength ?? 0;
        // og:title is the top preference — once it and an icon are both in
        // hand there's nothing higher-value left to find. Otherwise keep
        // reading (twitter:title/<title> could still appear later in
        // <head>) until the byte cap.
        if ((ogTitle && iconHref) || bytesRead >= MAX_BYTES_READ) {
          await reader.cancel();
          break;
        }
      }
    } catch {
      // Whatever was extracted before the stream errored is still used.
    }
  }

  const title = firstNonEmpty(ogTitle, twitterTitle, titleText);

  // "data:," is a well-known convention some sites use specifically to
  // suppress the browser's automatic favicon.ico request — not real icon
  // data. Treat it as "no icon found" rather than an empty image, same as
  // core/lib/linkMetadata.ts's client-side version.
  const faviconUrl =
    iconHref && iconHref !== "data:,"
      ? new URL(iconHref, target).toString()
      : new URL("/favicon.ico", target).toString();

  return { title, faviconUrl };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function handleLinkMetadata(request: Request): Promise<Response> {
  const url = new URL(request.url).searchParams.get("url");
  if (!url || !isHttpUrl(url)) {
    return new Response("Missing or invalid url query parameter", { status: 400 });
  }
  const meta = await fetchLinkMetadata(url);
  return Response.json(meta);
}
