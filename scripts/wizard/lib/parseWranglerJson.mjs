/** `wrangler ... --json` commands print unpredictable noise before the JSON
 * payload (update-available banners, telemetry notices, deprecation
 * warnings) that varies by Wrangler version. Skip to the first occurrence
 * of the expected top-level marker (`[` for arrays, `{` for objects) and
 * parse from there. Returns `null` if the marker never appears or the
 * remainder isn't valid JSON. */
export function parseWranglerJson(stdout, startChar) {
  const start = stdout.indexOf(startChar);
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}
