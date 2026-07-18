/** A real favicon, or a fixed-size placeholder — so entries/tabs without
 * one don't shift their title out of alignment with ones that have an
 * icon. */
export function buildPlaceholderFavicon(): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "favicon favicon-placeholder";
  return placeholder;
}

export function buildFaviconEl(url: string | null | undefined): HTMLElement {
  if (url) {
    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.src = url;
    // A manually-added link's favicon.ico guess (linkMetadata.ts) often
    // doesn't exist — swap to the same placeholder used for no-favicon
    // entries rather than showing a broken-image icon.
    icon.onerror = () => icon.replaceWith(buildPlaceholderFavicon());
    return icon;
  }
  return buildPlaceholderFavicon();
}
