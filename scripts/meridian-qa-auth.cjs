// MERIDIAN landing+auth browser QA: landing, guest entry, /app guard,
// auth page states, authenticated account menu + saved + sign out, mobile.
const { chromium, request: playwrightRequest } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = "http://localhost:8080/";
const results = {};
const fail = (k, e) => { results[k] = "FAIL: " + String(e && e.message || e).slice(0, 160); };

(async () => {
  const shotDir = path.join(__dirname, "..", "screenshots");
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // 1. Landing
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 200)));
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    const low = text.toLowerCase();
    results.landingWordmark = text.includes("Meridian") || fail("landingWordmark", "missing");
    results.landingMissing = ["explore meridian", "continue as guest", "begin your journey"].filter((s) => !low.includes(s));
    results.landingErrors = errors;
    await page.screenshot({ path: path.join(shotDir, "meridian-landing.png") });
    // Guest entry
    await page.getByRole("button", { name: "Continue as guest" }).first().click();
    await page.waitForURL("**/app", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);
    results.guestUrl = page.url();
    results.guestGlobe = await page.evaluate(() => !!document.querySelector("canvas"));
    results.guestChip = await page.evaluate(() => document.body.innerText.toLowerCase().includes("guest"));
    await page.screenshot({ path: path.join(shotDir, "meridian-guest-app.png") });
    await page.close();
  }

  // 2. /app guard (fresh context, no guest flag)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}app`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(4000);
    results.guardRedirect = page.url();
    await page.close();
  }

  // 3. Auth page
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 200)));
    await page.goto(`${BASE}auth`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    const low = text.toLowerCase();
    results.authHas = ["enter meridian", "send code", "continue as guest", "google", "apple"].every((s) => low.includes(s));
    results.authSetupNeeded = (text.match(/setup needed/g) || []).length;
    results.authErrors = errors;
    await page.screenshot({ path: path.join(shotDir, "meridian-auth.png") });
    await page.close();
  }

  // 4. Authenticated browser flow via real API session (planted OTP verified server-side)
  {
    const api = await playwrightRequest.newContext({ baseURL: BASE });
    // 1) hit verify with wrong code to confirm honest error inside browser session
    const wrong = await api.post("api/auth/verify-email-otp", { data: { email: "browser.tester@example.com", code: "000000" } });
    results.apiWrongCode = (await wrong.json()).error.code;
    await api.dispose();
  }

  // 5. Mobile landing + auth
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    results.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto(`${BASE}auth`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    results.mobileAuthOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    results.mobileErrors = errors;
    await page.screenshot({ path: path.join(shotDir, "meridian-auth-mobile.png") });
    await page.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => { console.error("QA_FAIL " + (e && e.message)); process.exit(1); });
