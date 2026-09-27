// MERIDIAN browser QA (Windows-local): loads the app, collects console
// errors, asserts visible content + module switching, screenshots desktop.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const shotDir = path.join(__dirname, "..", "screenshots");
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 300)));
  await page.goto("http://localhost:8080/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(6000);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
  const hasMeridian = await page.evaluate(() => document.body.innerText.includes("Meridian"));
  const hasGlobe = await page.evaluate(() => !!document.querySelector("canvas"));
  const sidebarVisible = await page.evaluate(() => {
    const a = document.querySelector('aside[aria-label="Meridian sidebar"]');
    if (!a) return "missing";
    const r = a.getBoundingClientRect();
    return `w=${Math.round(r.width)} visible=${r.width > 0}`;
  });
  // Switch to 2D map and confirm Leaflet tiles load.
  const mode2d = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => x.textContent.trim() === "2D Map");
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(5000);
  const leafletTiles = await page.evaluate(() => document.querySelectorAll(".leaflet-tile").length);
  await page.screenshot({ path: path.join(shotDir, "meridian-2d.png") });
  // Back to 3D.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "3D Globe");
    if (b) b.click();
  });
  await page.waitForTimeout(4000);
  // Open Travel module.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Travel");
    if (b) b.click();
  });
  await page.waitForTimeout(2000);
  const travelVisible = await page.evaluate(() => document.body.innerText.includes("Domestic flights") || document.body.innerText.includes("International flights"));
  const featuredInTravel = await page.evaluate(() => {
    const n = document.querySelector('nav[aria-label="Featured locations"]');
    return !!n && n.getBoundingClientRect().width > 0;
  });
  await page.screenshot({ path: path.join(shotDir, "meridian-travel.png") });
  console.log(JSON.stringify({ hasMeridian, hasGlobe, sidebarVisible, mode2d, leafletTiles, travelVisible, featuredInTravel, consoleErrors: errors.slice(0, 10), bodyPreview: bodyText.slice(0, 300) }, null, 2));
  await browser.close();
})().catch((e) => { console.error("QA_FAIL " + e.message); process.exit(1); });
