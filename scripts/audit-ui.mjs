
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:8080";
const OUT = "screenshots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 220)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e?.message || e).slice(0, 220)));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/audit-explore.png` });

// Measure sidebar vs workspace overlap
const layout = await page.evaluate(() => {
  const aside = document.querySelector("aside");
  const section = document.querySelector('section[aria-label="Main workspace"]');
  const a = aside?.getBoundingClientRect(), s = section?.getBoundingClientRect();
  return {
    sidebar: a ? { x: Math.round(a.x), w: Math.round(a.width), h: Math.round(a.height) } : null,
    workspace: s ? { x: Math.round(s.x), w: Math.round(s.width), h: Math.round(s.height) } : null,
    overlap: a && s ? (a.right > s.left + 1) : null,
    bodyScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
console.log("LAYOUT:", JSON.stringify(layout));

// Module tour
const MODULES = ["Weather","Travel","Maps","Discover","Tools","Saved","Meridian AI","Settings"];
const moduleStates = {};
for (const label of MODULES) {
  const btn = page.locator(`aside button[title="${label}"]`);
  if (!(await btn.count())) { moduleStates[label] = "button-not-found"; continue; }
  await btn.click();
  await page.waitForTimeout(1400);
  const slug = label.toLowerCase().replace(/\s+/g, "-");
  await page.screenshot({ path: `${OUT}/audit-${slug}.png` });
  const visible = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("aside section, aside div")].filter(el => el.textContent?.trim().length > 40);
    const feat = [...document.querySelectorAll('nav[aria-label="Featured locations"]')].filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
    return { panelCount: panels.length, featuredVisible: feat.length > 0 };
  });
  moduleStates[label] = visible;
}
console.log("MODULES:", JSON.stringify(moduleStates));

// Back to explore, click featured place, then 2D map
await page.locator('aside button[title="Explore"]').click();
await page.waitForTimeout(800);
await page.locator('nav[aria-label="Featured locations"] li').nth(4).locator("button").click().catch(e => console.log("featured click failed:", e.message));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/audit-featured-selected.png` });

const modeBtn = page.locator('button:has-text("2D Map")').first();
if (await modeBtn.count()) {
  await modeBtn.click();
  await page.waitForTimeout(3500);
  const tileInfo = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll(".leaflet-tile-loaded")];
    const loaded = imgs.filter(i => i.naturalWidth > 0).length;
    return { tiles: imgs.length, loaded };
  });
  await page.screenshot({ path: `${OUT}/audit-2d-map.png` });
  console.log("MAP2D:", JSON.stringify(tileInfo));
  // back to 3d
  await page.locator('button:has-text("3D Globe")').first().click();
  await page.waitForTimeout(1200);
} else {
  console.log("MAP2D: mode button not found");
}

// Mobile pass
const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
mp.on("pageerror", (e) => errors.push("mobile pageerror: " + String(e?.message || e).slice(0, 160)));
await mp.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
await mp.waitForTimeout(3000);
const mob = await mp.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, w: document.documentElement.scrollWidth }));
await mp.screenshot({ path: `${OUT}/audit-mobile.png` });
console.log("MOBILE:", JSON.stringify(mob));

console.log("CONSOLE_ERRORS:", JSON.stringify(errors.slice(0, 12), null, 1));
console.log("ERROR_COUNT:", errors.length);
await browser.close();
