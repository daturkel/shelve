/** Adds `https://` to a bare input like `example.com` so manually-entered
 * URLs work as links without requiring the user to type a scheme. Leaves
 * anything that already looks like it has one (`http://`, `ftp://`, etc.)
 * untouched. */
export function normalizeUrl(input: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;
}
