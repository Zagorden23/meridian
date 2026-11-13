/**
 * Contrast audit for the MERIDIAN text palette.
 *
 * The palette lives in `src/styles.css` under `@theme`, and every secondary
 * label, hint, timestamp and disabled pill in the app is painted with
 * `--color-subtle` or `--color-muted`. Those were chosen by eye, so nothing
 * stopped a "tidy up the greys" commit from dropping small text under WCAG AA
 * across 160-odd call sites at once. This reads the real tokens from the CSS
 * (never a copy) and asserts each declared text/surface pairing clears the
 * threshold for its size class.
 *
 * Usage: node scripts/contrast-audit.mjs [--json]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const THEME_REL_PATH = "src/styles.css";

/** WCAG AA: 4.5:1 for normal text, 3:1 for large text and UI boundaries. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

const toRgb = (hex) => {
  const s = String(hex).trim().replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex) => {
  const rgb = toRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two hex colours, or null if either is unparseable. */
export function contrastRatio(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Colour tokens declared in the stylesheet's `@theme` block. */
export function readThemeTokens(workspaceRoot) {
  const css = readFileSync(join(workspaceRoot, THEME_REL_PATH), "utf8");
  const start = css.indexOf("@theme");
  // Only the @theme block holds tokens; later rules reference them.
  const end = start === -1 ? -1 : css.indexOf("\n}", start);
  const block = start === -1 ? "" : css.slice(start, end === -1 ? undefined : end);
  const tokens = {};
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

/**
 * The pairings the design actually renders. `size` picks the threshold:
 * large text (>=24px, or >=18.66px bold) is allowed the lower ratio.
 * `accent-fg` is the inverse pairing — dark text painted ON the accent.
 */
export const PAIRINGS = [
  { fg: "color-fg", bg: "color-bg", size: "normal" },
  { fg: "color-fg", bg: "color-surface", size: "normal" },
  { fg: "color-fg", bg: "color-surface-raised", size: "normal" },
  { fg: "color-muted", bg: "color-bg", size: "normal" },
  { fg: "color-muted", bg: "color-surface", size: "normal" },
  { fg: "color-muted", bg: "color-surface-raised", size: "normal" },
  { fg: "color-subtle", bg: "color-bg", size: "normal" },
  { fg: "color-subtle", bg: "color-surface", size: "normal" },
  { fg: "color-subtle", bg: "color-surface-raised", size: "normal" },
  { fg: "color-accent", bg: "color-bg", size: "normal" },
  { fg: "color-accent", bg: "color-surface", size: "normal" },
  { fg: "color-accent-fg", bg: "color-accent", size: "normal" },
];

/** Every pairing that falls short of its threshold. Empty array === palette is clean. */
export function contrastViolations(workspaceRoot) {
  const tokens = readThemeTokens(workspaceRoot);
  const violations = [];
  for (const { fg, bg, size } of PAIRINGS) {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    if (fgValue === undefined || bgValue === undefined) {
      violations.push({ fg, bg, size, reason: "token missing from @theme" });
      continue;
    }
    const ratio = contrastRatio(fgValue, bgValue);
    if (ratio === null) {
      violations.push({ fg, bg, size, reason: `not a parseable hex colour (${fgValue} / ${bgValue})` });
      continue;
    }
    const required = size === "large" ? AA_LARGE : AA_NORMAL;
    if (ratio < required) {
      violations.push({ fg, bg, size, ratio: Number(ratio.toFixed(2)), required });
    }
  }
  return violations;
}

export function formatReport(workspaceRoot) {
  const tokens = readThemeTokens(workspaceRoot);
  const lines = [];
  for (const { fg, bg, size } of PAIRINGS) {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    const required = size === "large" ? AA_LARGE : AA_NORMAL;
    const mark = ratio === null ? "??" : ratio >= required ? "ok" : "FAIL";
    lines.push(
      `${mark.padEnd(5)} ${fg} on ${bg}: ${ratio === null ? "unparseable" : `${ratio.toFixed(2)}:1`} (needs ${required})`,
    );
  }
  return lines.join("\n");
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const workspaceRoot = process.cwd();
  const violations = contrastViolations(workspaceRoot);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ workspaceRoot, violations }, null, 2));
  } else {
    console.log(formatReport(workspaceRoot));
    console.log(violations.length === 0 ? "\ncontrast-audit: palette clears WCAG AA." : `\ncontrast-audit: ${violations.length} violation(s).`);
  }
  process.exitCode = violations.length === 0 ? 0 : 1;
}
