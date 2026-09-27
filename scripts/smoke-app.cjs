// Quick smoke for the /app route (dev server already running on 8080).
const { chromium } = require("playwright");

const URL = process.env.SMOKE_URL || "http://127.0.0.1:8080/";

(async () => {
  const b = await chromium.launch();
  for (const [name, w, h] of [
    ["app-desktop", 1280, 800],
    ["app-mobile", 390, 844],
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on("pageerror", (e) => console.error("PAGEERR", e.message));
    p.on("console", (m) => m.type() === "error" && console.error("CONSOLE", m.text()));
    await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForTimeout(1500);
    const explore = p.locator('a[href="/app"], a[href="/app/"]').first();
    if (await explore.count()) {
      await explore.click();
    } else {
      const btn = p.locator('button:has-text("Explore"), a:has-text("Explore")').first();
      if (await btn.count()) await btn.click();
    }
    await p.waitForTimeout(2000);
    // Continue as guest if we landed on /auth
    if (p.url().includes("/auth")) {
      const guest = p.locator('button:has-text("Continue as guest"), button:has-text("Guest")').first();
      if (await guest.count()) {
        await guest.click();
        await p.waitForTimeout(4000);
      }
    }
    await p.waitForTimeout(4000);
    console.log(name, "URL:", p.url());
    await p.screenshot({ path: `screenshots/${name}.png` });
    // Click Explore sidebar item to open the panel, screenshot again (desktop only)
    if (name.includes("desktop")) {
      const sidebarBtn = p.locator('aside nav[aria-label="Meridian modules"] button[title="Explore"]').first();
      if (await sidebarBtn.count()) {
        await sidebarBtn.click();
        await p.waitForTimeout(1500);
        await p.screenshot({ path: `screenshots/${name}-panel.png` });
      }
    }
    await p.close();
  }
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
