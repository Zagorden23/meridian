// Preload for the PRODUCTION server (`node --import`): replaces only the
// outbound calls to the identity / email / SMS providers with local stand-ins.
// Everything else — routes, cookies, redirects, id_token verification,
// MongoDB — is the real build. Used by scripts/auth-e2e/run.mjs; never loaded
// by the app itself.
import { writeFileSync } from "node:fs";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const OUTBOX = process.env.AUTH_E2E_OUTBOX;
const MS_CONSUMER = "9188040d-6c67-4c5b-b112-36a304b66dad";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "standin-1", alg: "RS256", use: "sig" }] };
const real = globalThis.fetch;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const outbox = { emails: [], sms: [], tokenRequests: [] };
const flush = () => writeFileSync(OUTBOX, JSON.stringify(outbox));
flush();

async function token(provider, init) {
  const p = new URLSearchParams(String(init.body));
  outbox.tokenRequests.push({
    provider,
    hasVerifier: Boolean(p.get("code_verifier")),
    hasSecret: Boolean(p.get("client_secret")),
    redirect_uri: p.get("redirect_uri"),
  });
  flush();
  const grant = JSON.parse(Buffer.from(p.get("code"), "base64url").toString());
  const iss = {
    google: "https://accounts.google.com",
    apple: "https://appleid.apple.com",
    microsoft: `https://login.microsoftonline.com/${MS_CONSUMER}/v2.0`,
  }[provider];
  const claims = { iss, aud: p.get("client_id"), sub: grant.sub, nonce: grant.nonce, name: grant.name };
  if (provider === "microsoft") Object.assign(claims, { tid: MS_CONSUMER, preferred_username: grant.email });
  else Object.assign(claims, { email: grant.email, email_verified: provider === "apple" ? "true" : true });
  const idToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "standin-1" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return json({ access_token: "at", token_type: "Bearer", id_token: idToken });
}

const JWKS_URLS = new Set([
  "https://www.googleapis.com/oauth2/v3/certs",
  "https://appleid.apple.com/auth/keys",
  "https://login.microsoftonline.com/common/discovery/v2.0/keys",
]);

globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  if (JWKS_URLS.has(url)) return json(jwks);
  if (url === "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration") {
    return json({ jwks_uri: "https://login.microsoftonline.com/common/discovery/v2.0/keys" });
  }
  if (url === "https://oauth2.googleapis.com/token") return token("google", init);
  if (url === "https://login.microsoftonline.com/common/oauth2/v2.0/token") return token("microsoft", init);
  if (url === "https://appleid.apple.com/auth/token") return token("apple", init);
  if (url === "https://api.resend.com/emails") {
    const m = JSON.parse(init.body);
    outbox.emails.push({ to: m.to, from: m.from, subject: m.subject, code: /\b(\d{6})\b/.exec(m.text)?.[1] });
    flush();
    return json({ id: `email_${outbox.emails.length}` });
  }
  if (url.startsWith("https://verify.twilio.com/")) {
    const p = new URLSearchParams(String(init.body));
    outbox.sms.push({ call: url.split("/").pop(), to: p.get("To"), code: p.get("Code") });
    flush();
    if (url.endsWith("/Verifications")) return json({ status: "pending" }, 201);
    return json({ status: p.get("Code") === "424242" ? "approved" : "pending" });
  }
  return real(input, init);
};
console.log("[standin] provider stand-ins active");
