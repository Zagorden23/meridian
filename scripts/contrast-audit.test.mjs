import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AA_NORMAL,
  PAIRINGS,
  contrastRatio,
  contrastViolations,
  readThemeTokens,
} from "./contrast-audit.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A throwaway workspace whose @theme block is exactly `css`. */
const workspaceWith = (css) => {
  const root = mkdtempSync(join(tmpdir(), "meridian-contrast-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/styles.css"), css);
  return root;
};

test("contrastRatio matches known WCAG reference values", () => {
  assert.equal(Number(contrastRatio("#000000", "#ffffff").toFixed(2)), 21);
  assert.equal(Number(contrastRatio("#ffffff", "#ffffff").toFixed(2)), 1);
  // Order must not matter.
  assert.equal(contrastRatio("#123456", "#abcdef"), contrastRatio("#abcdef", "#123456"));
});

test("contrastRatio reports null rather than guessing at non-hex colours", () => {
  assert.equal(contrastRatio("rgb(1 2 3 / 0.5)", "#ffffff"), null);
  assert.equal(contrastRatio("#9ec9d6", "currentColor"), null);
});

test("readThemeTokens parses the real stylesheet and finds every paired token", () => {
  const tokens = readThemeTokens(REPO_ROOT);
  // Guards against a silent no-op: a parser that returned {} would make the
  // palette test below pass while checking nothing.
  for (const { fg, bg } of PAIRINGS) {
    assert.ok(tokens[fg] !== undefined, `@theme is missing --${fg}`);
    assert.ok(tokens[bg] !== undefined, `@theme is missing --${bg}`);
  }
  assert.ok(Object.keys(tokens).length >= 10, "expected the full token set");
});

test("the shipped palette clears WCAG AA for normal text", () => {
  const violations = contrastViolations(REPO_ROOT);
  assert.deepEqual(
    violations,
    [],
    `palette has ${violations.length} contrast violation(s): ${JSON.stringify(violations)}`,
  );
});

test("a darkened --color-subtle is caught", () => {
  // The regression this audit exists for: #6b7386 measured 4.21:1 on bg and
  // 3.58:1 on --color-surface-raised, i.e. below AA across 160-odd call sites.
  const root = workspaceWith(`@theme {
  --color-bg: #07080c;
  --color-surface: #12141c;
  --color-surface-raised: #191c27;
  --color-fg: #e9edf4;
  --color-muted: #8b93a7;
  --color-subtle: #6b7386;
  --color-accent: #9ec9d6;
  --color-accent-fg: #07080c;
}
`);
  const violations = contrastViolations(root);
  const subtle = violations.filter((v) => v.fg === "color-subtle");
  assert.equal(subtle.length, 3, "all three --color-subtle surfaces should be flagged");
  assert.ok(subtle.every((v) => v.required === AA_NORMAL));
  assert.ok(subtle.every((v) => v.ratio < AA_NORMAL));
});

test("a missing token is reported instead of crashing", () => {
  const root = workspaceWith("@theme {\n  --color-bg: #07080c;\n  --color-fg: #e9edf4;\n}\n");
  const violations = contrastViolations(root);
  assert.ok(violations.length > 0);
  assert.ok(violations.every((v) => v.reason === "token missing from @theme"));
});
