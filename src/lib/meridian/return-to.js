// Where a person lands after signing in. Shared by the server (authorize
// request, callback redirect, start failure) and the browser (auth screen), so
// every hop applies exactly the same rule.
//
// Only a same-origin, path-like destination is ever accepted: an absolute or
// protocol-relative URL arriving from a query string would otherwise turn
// sign-in into an open redirect, and a backslash is normalised into a host by
// some browsers.
export function safeReturnTo(value, fallback = "/app") {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || /[\r\n]/.test(raw)) return fallback;
  return raw.slice(0, 512);
}
