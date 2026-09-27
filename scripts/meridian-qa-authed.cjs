// Authenticated-browser QA: real login (planted OTP via app crypto) inside a
// Playwright request context sharing cookies with the page, then UI asserts.
const { chromium, request: playwrightRequest } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const BASE = "http://localhost:8080/";
const EMAIL = "browser.authed@example.com";
const CODE = "731946";

const plant = `
import mongoose from 'mongoose';
import { hashOtp } from 'AUTH_PATH';
const Otp = mongoose.models.MeridianOtp ?? mongoose.model('MeridianOtpTmp', new mongoose.Schema({
  identifier: String, channel: String, codeHash: String, salt: String,
  expiresAt: Date, attempts: { type: Number, default: 0 }, maxAttempts: { type: Number, default: 5 },
  resendAvailableAt: Date, consumedAt: Date, createdAt: { type: Date, default: Date.now },
}, { collection: 'otpCodes' }));
await mongoose.connect('mongodb://127.0.0.1:27017/meridian');
const { salt, codeHash } = await hashOtp('${CODE}');
await Otp.deleteMany({ identifier: '${EMAIL}' });
await Otp.create({ identifier: '${EMAIL}', channel: 'email', codeHash, salt,
  expiresAt: new Date(Date.now() + 5*60*1000), resendAvailableAt: new Date() });
await mongoose.disconnect();
console.log('planted');`;

(async () => {
  const out = {};
  const plantPath = path.join(__dirname, "plant-qa-otp.tmp.mjs");
  fs.writeFileSync(plantPath, plant.replace("AUTH_PATH", "../src/lib/meridian/auth.js"));
  try {
    execFileSync("node", [plantPath], { cwd: path.join(__dirname, ".."), stdio: "pipe" });
  } finally {
    try { fs.unlinkSync(plantPath); } catch { /* noop */ }
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const login = await api.post("api/auth/verify-email-otp", { data: { email: EMAIL, code: CODE, name: "Browser" } });
  out.loginStatus = login.status();
  const setCookie = login.headers()["set-cookie"] || "";
  out.httpOnly = setCookie.includes("HttpOnly");
  // transfer session cookie into the browser context
  const match = setCookie.match(/meridian_session=([^;]+)/);
  await ctx.addCookies([{ name: "meridian_session", value: decodeURIComponent(match[1]), domain: "localhost", path: "/" }]);

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}app`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(5000);
  out.avatarMenu = await page.evaluate(() => !!document.querySelector('[aria-label="Account menu"]'));
  // open account menu → Saved → API-backed list renders
  await page.click('[aria-label="Account menu"]');
  await page.waitForTimeout(800);
  out.menuItems = await page.evaluate(() => document.body.innerText.includes("Sign out"));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Saved");
    if (b) b.click();
  });
  await page.waitForTimeout(2500);
  out.savedPanel = await page.evaluate(() => document.body.innerText.includes("Saved locations"));
  await page.screenshot({ path: path.join(__dirname, "..", "screenshots", "meridian-authed.png") });
  // sign out via the already-open menu (no second toggle)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Sign out");
    if (b) b.click();
  });
  await page.waitForURL("**/", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  out.afterSignOut = page.url();
  out.errors = errors;
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error("QA_FAIL " + (e && e.message)); process.exit(1); });
