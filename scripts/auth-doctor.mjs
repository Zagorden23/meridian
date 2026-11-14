#!/usr/bin/env node
// Sign-in readiness check.
//
// Reads the same environment the server reads (`.env`, `.env.local`, then real
// env vars) and reports, per sign-in method, whether it is live — then proves
// it by asking each provider to accept the credentials. Nothing is created or
// changed and no visitor-facing message is sent unless you pass --email/--sms.
//
//   npm run auth:doctor                       check configuration + credentials
//   npm run auth:doctor -- --offline          configuration only, no network
//   npm run auth:doctor -- --email you@x.com  also deliver a real test email
//   npm run auth:doctor -- --sms +14155550123 also deliver a real test SMS
//
// Exit code 1 when a method that has been configured does not work.
import "../src/lib/meridian/load-env.js";
import {
  OAUTH_PROVIDERS,
  appleClientSecret,
  emailConfigured,
  oauthRedirectUri,
  providerStatus,
  sendEmailOtp,
  sendPhoneOtp,
  smsConfigured,
  smsMissingEnv,
  smsVerifyServiceSid,
} from "../src/lib/meridian/auth.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at !== -1 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : null;
};
const offline = flag("--offline");
const env = (...keys) => {
  for (const key of keys) {
    const v = String(process.env[key] ?? "").trim();
    if (v) return v;
  }
  return "";
};

const results = []; // { name, state: "ready" | "off" | "problem", lines: [] }
function report(name, state, ...lines) {
  results.push({ name, state, lines: lines.flat().filter(Boolean) });
}

async function http(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

function appOrigin() {
  const raw = env("APP_URL");
  if (!raw) return null;
  try { return new URL(raw).origin; } catch { return null; }
}

// --- Foundations ---------------------------------------------------------------
async function checkFoundations() {
  const secret = ["SESSION_SECRET", "AUTH_SECRET", "BETTER_AUTH_SECRET"].map(env).find((v) => v.length >= 32);
  report("Session secret", secret ? "ready" : "problem",
    secret ? null : "SESSION_SECRET must be at least 32 random characters (openssl rand -hex 32).");

  const origin = appOrigin();
  if (!env("APP_URL")) {
    report("APP_URL", "off", "Not set — callback URLs follow the request origin. Set it in production.");
  } else if (!origin) {
    report("APP_URL", "problem", "Not a valid URL. Use the full public address, e.g. https://meridian.example.com");
  } else if (!origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) {
    report("APP_URL", "problem", `${origin} is not HTTPS — providers refuse non-HTTPS callbacks and cookies would not be Secure.`);
  } else {
    report("APP_URL", "ready", origin);
  }

  if (!env("MONGODB_URI")) {
    report("MongoDB", "problem", "MONGODB_URI is not set — accounts, sessions and codes have nowhere to live.");
  } else if (offline) {
    report("MongoDB", "ready", "MONGODB_URI is set (connection not tested: --offline).");
  } else {
    const { default: mongoose } = await import("mongoose");
    try {
      const conn = await mongoose.createConnection(env("MONGODB_URI"), { serverSelectionTimeoutMS: 8000 }).asPromise();
      await conn.db.admin().command({ ping: 1 });
      report("MongoDB", "ready", `Connected to database "${conn.name}".`);
      await conn.close();
    } catch (err) {
      report("MongoDB", "problem", `Could not connect: ${err?.message ?? err}`);
    }
  }
}

// --- OAuth providers -----------------------------------------------------------
// A token request with a made-up authorization code tells the two failure modes
// apart: `invalid_grant` means the provider recognised this client and its
// secret and only objected to the code; `invalid_client` means it did not.
async function probeTokenEndpoint(id, clientSecret) {
  const cfg = OAUTH_PROVIDERS[id];
  const tokenUrl = typeof cfg.token === "function" ? cfg.token() : cfg.token;
  const redirectUri = oauthRedirectUri(id, appOrigin() ?? "https://app.invalid");
  const res = await http(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "meridian-auth-doctor-not-a-real-code",
      redirect_uri: redirectUri,
      client_id: env(cfg.idEnv),
      client_secret: clientSecret,
    }),
  });
  const error = String(res.json?.error ?? "");
  const detail = String(res.json?.error_description ?? "").split(/\r?\n/)[0].slice(0, 200);
  if (error === "invalid_grant") return { ok: true };
  if (error === "invalid_client" || error === "unauthorized_client") {
    return { ok: false, why: `${cfg.label} does not recognise this client ID / secret${detail ? ` — ${detail}` : ""}.` };
  }
  return { ok: null, why: `${cfg.label} answered "${error || `HTTP ${res.status}`}"${detail ? ` — ${detail}` : ""}; credentials could not be confirmed.` };
}

// The sign-in page itself is the only place Google and Microsoft say whether a
// client ID exists and whether this callback URL is registered for it — the
// most common reason a correctly coded sign-in still fails. Open it the way a
// browser would and read the verdict. Best effort: an unrecognised answer is
// reported as "could not confirm", never as a pass.
const MICROSOFT_PAGE_ERRORS = {
  700016: "No app registration has this client ID.",
  50059: "No app registration has this client ID.",
  90002: "The tenant in MICROSOFT_TENANT_ID does not exist.",
  50011: "This callback URL is not registered as a redirect URI on the app registration.",
  50194: "The app is single-tenant — set MICROSOFT_TENANT_ID to its tenant ID, or make the app multi-tenant.",
  700054: "ID tokens are not enabled for this app registration.",
};

async function probeAuthorizePage(id) {
  const cfg = OAUTH_PROVIDERS[id];
  const authorize = typeof cfg.authorize === "function" ? cfg.authorize() : cfg.authorize;
  const callback = oauthRedirectUri(id, appOrigin());
  const url = `${authorize}?${new URLSearchParams({
    client_id: env(cfg.idEnv),
    redirect_uri: callback,
    response_type: "code",
    scope: cfg.scope,
    state: "auth-doctor",
    nonce: "auth-doctor",
  })}`;
  const headers = { "user-agent": "Mozilla/5.0 (auth-doctor)" };
  if (id === "google") {
    const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const location = res.headers.get("location") ?? "";
    if (!location) return { ok: null, why: "Google's sign-in page gave no verdict on the client ID and callback URL." };
    if (!location.includes("/oauth/error")) return { ok: true };
    const encoded = new URL(location).searchParams.get("authError") ?? "";
    const reason = Buffer.from(encoded, "base64url").toString("latin1");
    if (reason.includes("redirect_uri_mismatch")) {
      return { ok: false, why: `Google has no such redirect URI on this OAuth client. Add exactly: ${callback}` };
    }
    if (reason.includes("invalid_client")) return { ok: false, why: "Google has no OAuth client with this GOOGLE_CLIENT_ID." };
    return { ok: false, why: `Google refuses to start sign-in: ${reason.replace(/[^\x20-\x7e]+/g, " ").trim().slice(0, 160)}` };
  }
  if (id === "microsoft") {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const code = /"sErrorCode":"(\d+)"/.exec(await res.text())?.[1];
    if (!code) return res.ok ? { ok: true } : { ok: null, why: `Microsoft's sign-in page answered HTTP ${res.status}.` };
    const known = MICROSOFT_PAGE_ERRORS[code];
    return { ok: false, why: `${known ?? "Microsoft refuses to start sign-in."} (AADSTS${code})${code === "50011" ? ` Add exactly: ${callback}` : ""}` };
  }
  return { ok: null, why: null };
}

async function checkOAuth() {
  for (const status of providerStatus()) {
    const { id, label } = status;
    const name = `${label} sign-in`;
    const callback = oauthRedirectUri(id, appOrigin() ?? "<APP_URL>");
    const callbackLine = `Callback URL to register: ${callback}`;
    if (!status.configured) {
      const started = status.missing.length < (id === "apple" ? 4 : 2);
      report(name, started ? "problem" : "off", `Not set: ${status.missing.join(", ")}`, callbackLine);
      continue;
    }
    const notes = [callbackLine];
    if (id === "google" && !/\.apps\.googleusercontent\.com$/.test(env("GOOGLE_CLIENT_ID"))) {
      report(name, "problem", "GOOGLE_CLIENT_ID should end in .apps.googleusercontent.com — this looks like a different value.", notes);
      continue;
    }
    if (id === "apple" && /^https?:/.test(callback) && !callback.startsWith("https://")) {
      notes.push("Apple only redirects to HTTPS domains — it cannot be tested on localhost.");
    }
    if (offline) {
      report(name, "ready", "Variables are set (credentials not tested: --offline).", notes);
      continue;
    }
    try {
      const findings = [];
      let failed = false;
      // 1. Client ID + callback URL, as the provider's sign-in page sees them.
      if ((id === "google" || id === "microsoft") && appOrigin()) {
        const page = await probeAuthorizePage(id);
        if (page.ok === true) findings.push(`${label} knows this client ID and has the callback URL registered.`);
        else {
          findings.push(page.why);
          failed ||= page.ok === false;
        }
      } else if (id === "google" || id === "microsoft") {
        findings.push("Set APP_URL to have the callback URL registration checked too.");
      }
      // 2. The secret. Microsoft rejects a made-up code before it looks at the
      //    secret, so its secret can only be proven by a real sign-in.
      if (id === "microsoft") {
        findings.push("The client secret is first exercised at a real sign-in — try one after deploying.");
      } else if (!failed) {
        const secret = id === "apple" ? await appleClientSecret() : env(OAUTH_PROVIDERS[id].secretEnv);
        const probe = await probeTokenEndpoint(id, secret);
        if (probe.ok === true) findings.push(`${label} accepted the client ${id === "apple" ? "ID and signing key" : "secret"}.`);
        else {
          findings.push(probe.why);
          failed ||= probe.ok === false;
        }
      }
      report(name, failed ? "problem" : "ready", findings, notes);
    } catch (err) {
      report(name, "problem", `${err?.message ?? err}${err?.cause?.message ? ` (${err.cause.message})` : ""}`, notes);
    }
  }
}

// --- Email (Resend) ------------------------------------------------------------
function senderDomain() {
  const from = env("EMAIL_FROM", "RESEND_FROM");
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  return address.includes("@") ? address.split("@").pop().toLowerCase() : null;
}

async function checkEmail() {
  const name = "Email codes + password reset";
  const emailKey = env("EMAIL_PROVIDER_KEY", "RESEND_API_KEY");
  const emailFrom = env("EMAIL_FROM", "RESEND_FROM");
  if (!emailConfigured()) {
    const missing = [];
    if (!emailKey) missing.push("EMAIL_PROVIDER_KEY");
    if (!emailFrom) missing.push("EMAIL_FROM");
    report(name, emailKey ? "problem" : "off", `Not set: ${missing.join(", ")}`);
    return;
  }
  const domain = senderDomain();
  if (!domain || domain === "yourdomain.com") {
    report(name, "problem", "EMAIL_FROM is still the placeholder — use an address on your verified Resend domain.");
    return;
  }
  if (offline) {
    report(name, "ready", "Variables are set (key and domain not tested: --offline).");
    return;
  }
  const res = await http("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${emailKey}` },
  });
  if (res.ok) {
    const domains = res.json?.data ?? [];
    // A subdomain sender (mail.example.com) is covered by its own entry only.
    const match = domains.find((d) => String(d.name).toLowerCase() === domain);
    if (!match) {
      report(name, "problem", `${domain} is not a domain in this Resend account. Add and verify it, or change EMAIL_FROM.`,
        domains.length ? `Domains in the account: ${domains.map((d) => `${d.name} (${d.status})`).join(", ")}` : "The account has no domains yet.");
    } else if (match.status !== "verified") {
      report(name, "problem", `${domain} is "${match.status}" in Resend — finish its DNS records; Resend only delivers from verified domains.`);
    } else {
      report(name, "ready", `Resend key accepted; ${domain} is verified.`);
    }
  } else if (res.json?.name === "restricted_api_key") {
    report(name, "ready", `Resend key accepted (sending-only key, so ${domain} could not be checked — use --email to send a real test).`);
  } else {
    report(name, "problem", `Resend rejected the API key (HTTP ${res.status}${res.json?.message ? `: ${res.json.message}` : ""}).`);
  }
}

// --- SMS (Twilio) --------------------------------------------------------------
async function checkSms() {
  const name = "Phone codes";
  const sid = env("SMS_PROVIDER_KEY", "TWILIO_ACCOUNT_SID");
  const secret = env("SMS_PROVIDER_SECRET", "TWILIO_AUTH_TOKEN");
  const from = env("SMS_FROM", "TWILIO_FROM", "TWILIO_PHONE_NUMBER");
  if (!smsConfigured()) {
    const started = sid || secret || from || smsVerifyServiceSid();
    report(name, started ? "problem" : "off", `Not set: ${smsMissingEnv().join(", ")}`);
    return;
  }
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) {
    report(name, "problem", "SMS_PROVIDER_KEY must be the Twilio Account SID (starts with AC, 34 characters).");
    return;
  }
  const verifySid = smsVerifyServiceSid();
  if (verifySid && !/^VA[0-9a-fA-F]{32}$/.test(verifySid)) {
    report(name, "problem", "SMS_VERIFY_SERVICE_SID must be a Twilio Verify Service SID (starts with VA).");
    return;
  }
  if (!verifySid && !/^(\+[1-9]\d{6,14}|MG[0-9a-fA-F]{32})$/.test(from)) {
    report(name, "problem", "SMS_FROM must be a phone number in E.164 form (+15550000000) or a Messaging Service SID (MG…).");
    return;
  }
  const via = verifySid ? "Twilio Verify" : `Twilio Messages from ${from}`;
  if (offline) {
    report(name, "ready", `Variables are set — sending through ${via} (credentials not tested: --offline).`);
    return;
  }
  const basic = `Basic ${Buffer.from(`${sid}:${secret}`).toString("base64")}`;
  const account = await http(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { authorization: basic } });
  if (!account.ok) {
    report(name, "problem", `Twilio rejected the Account SID / Auth Token (HTTP ${account.status}).`);
    return;
  }
  const notes = [];
  let state = "ready";
  if (account.json?.status !== "active") {
    state = "problem";
    notes.push(`The Twilio account is "${account.json?.status}".`);
  }
  if (account.json?.type === "Trial") {
    notes.push("Trial account: Twilio only delivers to numbers you have verified in its console. Upgrade before launch.");
  }
  if (verifySid) {
    const service = await http(`https://verify.twilio.com/v2/Services/${verifySid}`, { headers: { authorization: basic } });
    if (!service.ok) {
      state = "problem";
      notes.push(`Verify service ${verifySid} was not found in this account (HTTP ${service.status}).`);
    } else if (Number(service.json?.code_length) !== 6) {
      state = "problem";
      notes.push(`The Verify service sends ${service.json?.code_length}-digit codes; the sign-in screen takes 6. Set the code length to 6.`);
    }
  } else {
    notes.push("Sending from your own number: make sure it is registered for every country you serve (US A2P 10DLC, India DLT, …), or switch to SMS_VERIFY_SERVICE_SID.");
  }
  report(name, state, `Twilio credentials accepted — sending through ${via}.`, notes);
}

// --- Optional real deliveries --------------------------------------------------
async function deliverTests() {
  const email = option("--email");
  if (email) {
    try {
      await sendEmailOtp(email, "000000", { purpose: "auth" });
      report("Test email", "ready", `Sent to ${email} — the code in it (000000) is a placeholder.`);
    } catch (err) {
      report("Test email", "problem", `${err?.message ?? err} See the line above from Resend for the reason.`);
    }
  }
  const sms = option("--sms");
  if (sms) {
    try {
      await sendPhoneOtp(sms, "000000", { purpose: "auth" });
      report("Test SMS", "ready", `Sent to ${sms}.`);
    } catch (err) {
      report("Test SMS", "problem", `${err?.message ?? err} See the line above from Twilio for the reason.`);
    }
  }
}

const MARK = { ready: "READY  ", off: "OFF    ", problem: "PROBLEM" };

await checkFoundations();
await checkOAuth();
await checkEmail();
await checkSms();
if (!offline) await deliverTests();

console.log("\nMeridian sign-in readiness\n");
for (const r of results) {
  console.log(`  ${MARK[r.state]}  ${r.name}`);
  for (const line of r.lines) console.log(`             ${line}`);
}
const problems = results.filter((r) => r.state === "problem");
const off = results.filter((r) => r.state === "off" && r.name !== "APP_URL");
console.log("");
if (off.length) console.log(`Not offered to visitors yet: ${off.map((r) => r.name).join(", ")}.`);
console.log(problems.length
  ? `${problems.length} item${problems.length === 1 ? "" : "s"} need attention.`
  : "Everything that is configured checks out.");
process.exit(problems.length ? 1 : 0);
