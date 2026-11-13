// Drives the production build's sign-in screen in a real browser: every
// method, start to signed-in. The identity providers' own pages are answered
// in the browser (as if the person approved) and the server's provider calls
// by standin-providers.mjs. Started by scripts/auth-e2e/run.mjs.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.argv[2];
const OUTBOX = process.argv[3];
const SHOTS = process.argv[4];
const stamp = Date.now();
const outbox = () => JSON.parse(readFileSync(OUTBOX, "utf8"));
const results = [];
const errors = [];
const browser = await chromium.launch();
let lastPage = null;
const APP = /^http:\/\/127\.0\.0\.1:\d+\/app/;

async function open(viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  lastPage = p;
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  p.on("console", (m) => {
    if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  return { ctx, p };
}

const session = (p) => p.evaluate(() => fetch("/api/auth/session").then((r) => r.json()).then((j) => ({
  status: j.data.status,
  method: j.data.method,
  email: j.data.user?.email,
  emailVerified: j.data.user?.emailVerified,
  phone: j.data.user?.phone,
  name: j.data.user?.name,
  providers: j.data.user?.providers,
})));

const grant = (u, who) => Buffer.from(JSON.stringify({ nonce: u.searchParams.get("nonce"), ...who })).toString("base64url");

async function run(name, fn) {
  try {
    results.push({ ...(await fn()), scenario: name });
  } catch (e) {
    const shot = `${SHOTS}/e2e-fail-${results.length}.png`;
    const at = lastPage ? lastPage.url() : null;
    await lastPage?.screenshot({ path: shot }).catch(() => {});
    results.push({ scenario: name, FAILED: String(e).slice(0, 300), at, shot });
  }
}

await run("sign-in screen (production)", async () => {
  const { ctx, p } = await open();
  await p.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: /Email code/ }).waitFor();
  const buttons = await p.locator("section[aria-label*='provider'] li").allInnerTexts();
  const tabs = await p.getByRole("tab").allInnerTexts();
  const devHints = await p.getByText(/Local dev mode|Dev preview|Setup needed/i).count();
  await p.screenshot({ path: `${SHOTS}/prod-auth-desktop.png` });
  await ctx.close();
  const m = await open({ width: 390, height: 844 });
  await m.p.goto(`${BASE}/auth?mode=signup`, { waitUntil: "networkidle" });
  await m.p.getByRole("tab", { name: /Email code/ }).waitFor();
  await m.p.waitForTimeout(600);
  await m.p.screenshot({ path: `${SHOTS}/prod-auth-mobile.png`, fullPage: true });
  const mobileOverflow = await m.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await m.ctx.close();
  return { buttons, tabs, devHints, mobileOverflow };
});

// Chrome will not let a test answer for accounts.google.com, and blocks an
// HTTPS page posting a form to plain-HTTP localhost. So the app's own redirect
// to the provider is followed up to the provider's doorstep (its URL is kept
// for checking) and the browser is then sent to a stand-in host on another
// site, which answers the way the provider would.
async function standIn(p, provider, respond) {
  const seen = {};
  await p.route(`**/api/auth/${provider}*`, async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const headers = res.headers();
    seen.authorize = new URL(headers.location);
    seen.status = res.status();
    const next = `http://${provider}-standin.test/authorize${seen.authorize.search}`;
    delete headers.location;
    delete headers["content-length"];
    await route.fulfill({
      status: 200,
      headers: { ...headers, "content-type": "text/html" },
      body: `<script>location.replace(${JSON.stringify(next)})</script>`,
    });
  });
  await p.route(`http://${provider}-standin.test/**`, (route) => respond(route, new URL(route.request().url())));
  return seen;
}

const approve = (provider, who) => (route, u) => {
  const back = new URL(u.searchParams.get("redirect_uri"));
  back.searchParams.set("code", grant(u, who));
  back.searchParams.set("state", u.searchParams.get("state"));
  route.fulfill({ status: 302, headers: { location: back.toString() } });
};

for (const [provider, host, label] of [
  ["google", "accounts.google.com", "Google"],
  ["microsoft", "login.microsoftonline.com", "Microsoft"],
]) {
  await run(`${label}: button -> provider -> callback -> signed in`, async () => {
    const { ctx, p } = await open();
    const seen = await standIn(p, provider, approve(provider, {
      sub: `${provider}-e2e-${stamp}`,
      email: `${provider}-${stamp}@example.com`,
      name: `${label} Person`,
    }));
    await p.goto(`${BASE}/auth?returnTo=${encodeURIComponent("/app?m=saved")}`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: `Continue with ${label}` }).click();
    await p.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/app\?m=saved/, { timeout: 20000 });
    const s = await session(p);
    const cookies = (await ctx.cookies()).map((c) => c.name);
    // Coming back a second time finds the same account.
    await p.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
    await p.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: `Continue with ${label}` }).click();
    await p.waitForURL(APP, { timeout: 20000 });
    const again = await session(p);
    await ctx.close();
    return {
      sentTo: seen.authorize.host === host ? host : `UNEXPECTED ${seen.authorize.host}`,
      callback: seen.authorize.searchParams.get("redirect_uri"),
      landedOn: "/app?m=saved",
      ...s,
      oauthCookieCleared: !cookies.includes("meridian_oauth"),
      secondSignInSameAccount: again.email === s.email && again.status === "authenticated",
    };
  });
}

await run("Apple: cross-site form POST back -> signed in with name", async () => {
  const { ctx, p } = await open();
  const seen = await standIn(p, "apple", (route, u) => {
    const code = grant(u, { sub: `apple-e2e-${stamp}`, email: `relay${stamp}@privaterelay.appleid.com` });
    const user = JSON.stringify({ name: { firstName: "Apple", lastName: "Person" } }).replace(/"/g, "&quot;");
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<form id="f" method="post" action="${u.searchParams.get("redirect_uri")}">`
        + `<input name="code" value="${code}"><input name="state" value="${u.searchParams.get("state")}">`
        + `<input name="user" value="${user}"></form><script>document.getElementById("f").submit()</script>`,
    });
  });
  await p.goto(`${BASE}/auth?mode=signup`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Sign up with Apple" }).click();
  await p.waitForURL(APP, { timeout: 20000 });
  const s = await session(p);
  const leftover = (await ctx.cookies()).map((c) => c.name).filter((n) => n !== "meridian_session" && n !== "meridian_auth_notice");
  await ctx.close();
  return {
    sentTo: seen.authorize.host,
    responseMode: seen.authorize.searchParams.get("response_mode"),
    ...s,
    leftoverCookies: leftover,
  };
});

await run("Google: person cancels at the provider", async () => {
  const { ctx, p } = await open();
  await standIn(p, "google", (route, u) => {
    const back = new URL(u.searchParams.get("redirect_uri"));
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("state", u.searchParams.get("state"));
    route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await p.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Continue with Google" }).click();
  await p.waitForURL(/\/auth\?error=OAUTH_CANCELLED/, { timeout: 20000 });
  const message = await p.getByRole("alert").first().innerText();
  const s = await session(p);
  await ctx.close();
  return { message, status: s.status };
});

await run("Google: forged callback (no matching state in this browser) is refused", async () => {
  const { ctx, p } = await open();
  const code = grant(new URL("https://x/?nonce=n"), { sub: "attacker", email: "victim@example.com" });
  await p.goto(`${BASE}/api/auth/google/callback?code=${code}&state=forged`, { waitUntil: "networkidle" });
  const url = new URL(p.url());
  const s = await session(p);
  await ctx.close();
  return { landedOn: `${url.pathname}?error=${url.searchParams.get("error")}`, status: s.status };
});

await run("Email code: request -> delivered by email -> verify -> signed in", async () => {
  const { ctx, p } = await open();
  const email = `prod-otp-${stamp}@example.com`;
  await p.goto(`${BASE}/auth?mode=signup`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: /Email code/ }).click();
  await p.getByPlaceholder("you@example.com").fill(email);
  await p.getByRole("button", { name: "Send verification code" }).click();
  await p.getByLabel("Digit 1 of 6").waitFor();
  const shownOnScreen = await p.getByText(/Dev preview/i).count();
  const mail = outbox().emails.findLast((m) => m.to === email);
  await p.keyboard.type(mail.code);
  await p.waitForURL(APP, { timeout: 20000 });
  const s = await session(p);
  await ctx.close();
  return { emailedFrom: mail.from, subject: mail.subject.replace(/\d{6}/, "######"), codeShownOnScreen: shownOnScreen > 0, ...s };
});

await run("Phone code: request -> SMS via Twilio Verify -> verify -> signed in", async () => {
  const { ctx, p } = await open({ width: 390, height: 844 });
  await p.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: /Phone/ }).click();
  await p.getByLabel("Country dial code").selectOption("+44");
  const national = `07${String(stamp).slice(-9)}`;
  await p.getByPlaceholder("415 555 0199").fill(national);
  await p.getByRole("button", { name: "Continue with Phone" }).click();
  await p.getByLabel("Digit 1 of 6").waitFor();
  await p.keyboard.type("111111");
  await p.getByRole("alert").filter({ hasText: /Incorrect code/ }).waitFor();
  const wrong = await p.getByRole("alert").filter({ hasText: /Incorrect/ }).innerText();
  await p.keyboard.type("424242");
  await p.waitForURL(APP, { timeout: 20000 });
  const s = await session(p);
  const twilioCalls = outbox().sms.filter((m) => m.to === s.phone).map((m) => m.call);
  await ctx.close();
  return { wrongCode: wrong, twilioCalls, ...s };
});

await run("Password sign-up: confirm email by code, then forgot-password reset", async () => {
  const { ctx, p } = await open();
  const email = `prod-pw-${stamp}@example.com`;
  await p.goto(`${BASE}/auth?mode=signup`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: /Password/ }).click();
  await p.getByPlaceholder("Ada Lovelace").fill("Password Person");
  await p.getByPlaceholder("you@example.com").fill(email);
  await p.getByPlaceholder("Create a password (8+ chars)").fill("Correct-Horse-9!");
  await p.getByPlaceholder("Re-enter your password").fill("Correct-Horse-9!");
  await p.locator("form button[type=submit]").click();
  await p.getByLabel("Digit 1 of 6").waitFor();
  const before = await session(p);
  await p.keyboard.type(outbox().emails.findLast((m) => m.to === email).code);
  await p.waitForURL(APP, { timeout: 20000 });
  const s = await session(p);
  await p.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await p.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await p.getByRole("tab", { name: /Password/ }).click();
  await p.getByPlaceholder("you@example.com").fill(email);
  await p.getByRole("button", { name: "Forgot password?" }).click();
  await p.getByRole("button", { name: "Send reset code" }).click();
  await p.getByLabel("Digit 1 of 6").waitFor();
  const reset = outbox().emails.findLast((m) => m.to === email);
  await p.keyboard.type(reset.code);
  await p.getByPlaceholder("Choose a new password").fill("Brand-New-Pass-7!");
  await p.getByPlaceholder("Re-enter your new password").fill("Brand-New-Pass-7!");
  await p.locator("form button[type=submit]").click();
  await p.waitForURL(APP, { timeout: 20000 });
  const afterReset = await session(p);
  const oldPasswordStatus = await p.evaluate((e) => fetch("/api/auth/signin-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: e, password: "Correct-Horse-9!" }),
  }).then((r) => r.status), email);
  await ctx.close();
  return {
    signedInBeforeConfirming: before.status,
    afterConfirm: s.status,
    emailVerified: s.emailVerified,
    resetSubject: reset.subject.replace(/\d{6}/, "######"),
    afterReset: afterReset.status,
    oldPasswordStatus,
  };
});

await browser.close();

const tokenRequests = outbox().tokenRequests;
const failed = results.filter((r) => r.FAILED);
for (const r of results) {
  console.log(`${r.FAILED ? "FAIL" : "ok  "}  ${r.scenario}`);
  if (r.FAILED) {
    console.log(`        ${r.FAILED.split(/\r?\n/)[0]}`);
    console.log(`        at ${r.at}`);
    console.log(`        screenshot: ${r.shot}`);
  }
}
// Every code exchange must carry the PKCE verifier and client secret, and a
// page error anywhere in sign-in is a failure in its own right.
const badExchange = tokenRequests.filter((t) => !t.hasVerifier || !t.hasSecret);
if (badExchange.length) console.log(`FAIL  code exchange without PKCE verifier or client secret: ${JSON.stringify(badExchange)}`);
for (const message of errors) console.log(`FAIL  browser error: ${message}`);
if (process.argv.includes("--verbose")) console.log(JSON.stringify({ results, tokenRequests }, null, 1));
const bad = failed.length + badExchange.length + errors.length;
console.log("");
console.log(bad ? `${bad} problem(s).` : `All ${results.length} sign-in scenarios passed.`);
process.exit(bad ? 1 : 0);
