
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e?.message || e).slice(0, 300)));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(5000);

const info = await page.evaluate(() => ({
  title: document.title,
  hasRoot: Boolean(document.querySelector("#root, #__start, [data-twsroot]")),
  asideCount: document.querySelectorAll("aside").length,
  sectionCount: document.querySelectorAll("section").length,
  canvasCount: document.querySelectorAll("canvas").length,
  h1: document.querySelector("h1")?.textContent?.slice(0, 80) ?? null,
  bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 600),
  bodyHTMLlen: document.body.innerHTML.length,
  firstDivClass: [...document.querySelectorAll("body > div")].map(d => d.className?.slice?.(0, 80) || d.tagName).slice(0, 5),
  reactErrorBoundary: [...document.querySelectorAll("[role='alert'], pre")].map(p => p.textContent?.slice(0, 300)).filter(Boolean).slice(0, 3),
}));
console.log(JSON.stringify(info, null, 2));
console.log("ERRORS:", JSON.stringify(errors.slice(0, 15), null, 1));
await browser.close();
