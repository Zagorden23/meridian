
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e?.message || e).slice(0, 200)));
const out = {};
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
out.landing = { url: page.url(), title: await page.title(),
  text: (await page.locator("body").innerText()).replace(/\s+/g," ").slice(0, 220) };
await page.screenshot({ path: "screenshots/now-landing.png" });
const guest = page.locator('button:has-text("Continue as guest"), a:has-text("Continue as guest"), button:has-text("CONTINUE AS GUEST")').first();
if (await guest.count()) { await guest.click(); await page.waitForTimeout(2500); }
out.afterGuest = { url: page.url() };
// measure layout at /app (or wherever we are)
await page.waitForTimeout(1500);
out.layout = await page.evaluate(() => {
  const aside = document.querySelector("aside");
  const section = document.querySelector('section[aria-label="Main workspace"]') || document.querySelector("section");
  const a = aside?.getBoundingClientRect(), s = section?.getBoundingClientRect();
  const featured = [...document.querySelectorAll('nav[aria-label="Featured locations"]')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
  return { aside: a ? { x: a.x, w: a.width } : null, section: s ? { x: s.x, w: s.width } : null,
    overlap: a && s ? a.right > s.left + 1 : null, featuredNavVisible: featured > 0,
    canvases: document.querySelectorAll("canvas").length, bodyText: (document.body.innerText||"").replace(/\s+/g," ").slice(0,200) };
});
await page.screenshot({ path: "screenshots/now-app.png" });
// module tour
const MODULES = ["Explore","Weather","Travel","Maps","Discover","Tools","Saved","Meridian AI","Settings"];
out.modules = {};
for (const label of MODULES) {
  const btn = page.locator(`aside button[title="${label}"]`).first();
  if (!(await btn.count())) { out.modules[label] = "missing"; continue; }
  await btn.click(); await page.waitForTimeout(900);
  out.modules[label] = await page.evaluate(() => {
    const featured = [...document.querySelectorAll('nav[aria-label="Featured locations"]')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
    const panels = [...document.querySelectorAll("aside section")].filter(el => el.getBoundingClientRect().height > 40).length;
    return { featuredVisible: featured > 0, panels };
  });
}
// travel module screenshot
await page.locator('aside button[title="Travel"]').click(); await page.waitForTimeout(800);
await page.screenshot({ path: "screenshots/now-travel.png" });
// 2D map
await page.locator('aside button[title="Maps"], aside button[title="Explore"]').first().click(); await page.waitForTimeout(500);
const modeBtn = page.locator('button:has-text("2D Map")').first();
if (await modeBtn.count()) {
  await modeBtn.click(); await page.waitForTimeout(4500);
  out.map2d = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll(".leaflet-tile")];
    const loaded = tiles.filter(t => t.naturalWidth > 0 || (t.complete && t.naturalWidth > 0)).length;
    return { totalTiles: tiles.length, loadedTiles: loaded, leaflet: Boolean(document.querySelector(".leaflet-container")) };
  });
  await page.screenshot({ path: "screenshots/now-2d.png" });
} else out.map2d = "button missing";
out.errors = errors.slice(0, 10);
console.log(JSON.stringify(out));
await browser.close();
