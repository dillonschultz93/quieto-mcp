import { parseColor } from "@quieto/engine";

/**
 * Bootstrap-from-codebase inference.
 *
 * A faithful, filesystem-free port of `quieto-tokens init --from-codebase`.
 * The CLI walks a project's stylesheets on disk; this MCP server runs on
 * Cloudflare Workers (no `fs`), and the underlying scan/inference functions
 * are not part of `@quieto/tokens`' public API. So the MCP client reads the
 * stylesheets and passes their content here, and we tally the same colors,
 * spacing, font families, and weights to infer the same seed inputs the
 * quick-start questionnaire would have collected.
 */

export interface StylesheetInput {
  /** Path or name of the stylesheet, used only for reporting. */
  path: string;
  /** Raw stylesheet source. */
  content: string;
}

interface Occurrence {
  count: number;
  properties: Set<string>;
}

interface FontFamilyOccurrence {
  count: number;
  onHeadingSelector: boolean;
  isMono: boolean;
}

interface Histograms {
  colors: Map<string, Occurrence>;
  dimensions: Map<number, Occurrence>;
  fontFamilies: Map<string, FontFamilyOccurrence>;
  fontWeights: Map<number, number>;
  darkModeSignals: boolean;
  filesScanned: number;
  totalColorUsages: number;
  totalDimensionUsages: number;
}

interface AdditionalHue {
  name: string;
  seed: string;
}

interface InferredTypography {
  fontFamily?: { body: string; heading?: string; mono?: string };
  customSizes?: Record<string, number>;
  customWeights?: Record<string, number>;
}

interface Rationale {
  lines: string[];
  warnings: string[];
}

export interface InferredSeed {
  options: {
    brandColor: string;
    spacingBase: 4 | 8;
    typeScale: "compact" | "balanced" | "spacious";
    generateThemes: boolean;
  };
  advanced: {
    color?: { additionalHues: AdditionalHue[] };
    typography?: InferredTypography;
  };
  rationale: Rationale;
  scan: {
    filesScanned: number;
    totalColorUsages: number;
    totalDimensionUsages: number;
  };
}

// --- Stylesheet extraction --------------------------------------------------

const DARK_MODE_SIGNAL =
  /prefers-color-scheme:\s*dark|\.dark\b|\[data-theme=['"]?dark['"]?\]/i;
const HEADING_SELECTOR = /\bh[1-6]\b/;
const MONO_HINT = /\bmono\b|monospace|courier|consolas|menlo|"?sf mono"?|ui-monospace/i;
const FONT_WEIGHT_KEYWORDS: Record<string, number> = { normal: 400, bold: 700 };
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;
const DIMENSION_PATTERN = /\b(\d+(?:\.\d+)?)(px|rem|em)\b/g;

function normalizeHex(input: string): { hex: string; hadAlpha: boolean } | null {
  const s = input.trim();
  if (!s.startsWith("#")) return null;
  const h = s.slice(1).toLowerCase();
  if (![3, 4, 6, 8].includes(h.length)) return null;
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3) {
    const [r, g, b] = h.split("");
    return { hex: `#${r}${r}${g}${g}${b}${b}`, hadAlpha: false };
  }
  if (h.length === 4) {
    const [r, g, b] = h.slice(0, 3).split("");
    return { hex: `#${r}${r}${g}${g}${b}${b}`, hadAlpha: true };
  }
  if (h.length === 8) return { hex: `#${h.slice(0, 6)}`, hadAlpha: true };
  return { hex: `#${h}`, hadAlpha: false };
}

function dimensionToPx(value: string): number | null {
  const m = value.trim().match(/^(\d+(?:\.\d+)?)(px|rem|em)\b/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toLowerCase() === "px" ? n : n * 16;
}

function isQuietoVarDeclaration(line: string): boolean {
  return /--quieto-[a-z0-9-]+\s*:/.test(line);
}

function stripInlineBlockComments(line: string): string {
  return line.replace(/\/\*.*?\*\//g, "");
}

function stripQuietoVarCalls(valueSegment: string): string {
  return valueSegment.replace(/var\(\s*--quieto-[^)]+\)/g, "");
}

function splitDeclaration(
  originalLine: string,
): { property: string; valueSegment: string } | null {
  if (!originalLine.includes(":")) return null;
  if (isQuietoVarDeclaration(originalLine)) return null;
  const colonIdx = originalLine.indexOf(":");
  if (colonIdx < 0) return null;
  let property = originalLine.slice(0, colonIdx).trim().toLowerCase();
  const braceIdx = property.lastIndexOf("{");
  if (braceIdx >= 0) property = property.slice(braceIdx + 1).trim();
  const valueSegmentRaw = originalLine.slice(colonIdx + 1);
  const valueSegment = stripQuietoVarCalls(stripInlineBlockComments(valueSegmentRaw));
  return { property, valueSegment };
}

function isMonoStack(stack: string): boolean {
  return MONO_HINT.test(stack);
}

function parseFontWeight(valueSegment: string): number | null {
  const raw = valueSegment.trim().replace(/!important.*$/i, "").trim();
  const token = raw.split(/[\s;]+/)[0]?.toLowerCase() ?? "";
  if (token in FONT_WEIGHT_KEYWORDS) return FONT_WEIGHT_KEYWORDS[token];
  const n = Number.parseInt(token, 10);
  if (Number.isFinite(n) && n >= 100 && n <= 900) return n;
  return null;
}

function cleanFontFamilyStack(valueSegment: string): string {
  return valueSegment.replace(/!important.*$/i, "").replace(/;.*$/, "").trim();
}

function bumpOccurrence<K>(map: Map<K, Occurrence>, key: K, property: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    existing.properties.add(property);
  } else {
    map.set(key, { count: 1, properties: new Set([property]) });
  }
}

function extractRawValues(stylesheets: StylesheetInput[]): Histograms {
  const colors = new Map<string, Occurrence>();
  const dimensions = new Map<number, Occurrence>();
  const fontFamilies = new Map<string, FontFamilyOccurrence>();
  const fontWeights = new Map<number, number>();
  let darkModeSignals = false;
  let totalColorUsages = 0;
  let totalDimensionUsages = 0;

  for (const { content } of stylesheets) {
    if (!darkModeSignals && DARK_MODE_SIGNAL.test(content)) {
      darkModeSignals = true;
    }
    const lines = content.split(/\r?\n/);
    let currentSelector = "";
    for (const originalLine of lines) {
      if (originalLine.includes("{")) {
        currentSelector = originalLine
          .slice(0, originalLine.indexOf("{"))
          .trim()
          .toLowerCase();
      }
      if (originalLine.includes("}")) {
        currentSelector = "";
      }
      const decl = splitDeclaration(originalLine);
      if (!decl) continue;
      const { property, valueSegment } = decl;

      for (const m of valueSegment.matchAll(HEX_PATTERN)) {
        const norm = normalizeHex(m[0]);
        if (!norm) continue;
        totalColorUsages += 1;
        bumpOccurrence(colors, norm.hex, property);
      }
      for (const m of valueSegment.matchAll(DIMENSION_PATTERN)) {
        const px = dimensionToPx(m[0]);
        if (px === null) continue;
        totalDimensionUsages += 1;
        bumpOccurrence(dimensions, px, property);
      }
      if (property === "font-family") {
        const stack = cleanFontFamilyStack(valueSegment);
        if (stack.length > 0) {
          const existing = fontFamilies.get(stack);
          const onHeading = HEADING_SELECTOR.test(currentSelector);
          if (existing) {
            existing.count += 1;
            existing.onHeadingSelector ||= onHeading;
          } else {
            fontFamilies.set(stack, {
              count: 1,
              onHeadingSelector: onHeading,
              isMono: isMonoStack(stack),
            });
          }
        }
      }
      if (property === "font-weight") {
        const weight = parseFontWeight(valueSegment);
        if (weight !== null) {
          fontWeights.set(weight, (fontWeights.get(weight) ?? 0) + 1);
        }
      }
    }
  }

  return {
    colors,
    dimensions,
    fontFamilies,
    fontWeights,
    darkModeSignals,
    filesScanned: stylesheets.length,
    totalColorUsages,
    totalDimensionUsages,
  };
}

// --- Seed inference ---------------------------------------------------------

const NEUTRAL_CHROMA = 0.04;
const DEFAULT_BRAND = "#5B21B6";
const SPACING_PROPERTY =
  /^(padding|margin|gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap)/;
const WEIGHT_ROLES: Record<number, string> = {
  100: "thin",
  200: "extralight",
  300: "light",
  400: "regular",
  500: "medium",
  600: "semibold",
  700: "bold",
  800: "extrabold",
  900: "black",
};

const HUE_NAMES = [
  { min: 0, max: 40, name: "red" },
  { min: 40, max: 60, name: "orange" },
  { min: 60, max: 90, name: "yellow" },
  { min: 90, max: 130, name: "lime" },
  { min: 130, max: 170, name: "green" },
  { min: 170, max: 200, name: "teal" },
  { min: 200, max: 230, name: "cyan" },
  { min: 230, max: 270, name: "blue" },
  { min: 270, max: 300, name: "violet" },
  { min: 300, max: 330, name: "purple" },
  { min: 330, max: 360, name: "pink" },
] as const;

function hueNameFromAngle(hueAngle: number): string {
  const normalized = ((hueAngle % 360) + 360) % 360;
  return HUE_NAMES.find((e) => normalized >= e.min && normalized < e.max)?.name ?? "gray";
}

function toUpperHex(hex: string): string {
  return hex.toUpperCase();
}

interface ColorFact {
  hex: string;
  count: number;
  chroma: number;
  hueName: string;
}

function analyzeColors(histograms: Histograms): ColorFact[] {
  const facts: ColorFact[] = [];
  for (const [hex, occ] of histograms.colors) {
    const parsed = parseColor(hex);
    if (!parsed.ok) continue;
    const { l, c, h } = parsed.value.oklch;
    if (l <= 0.05 || l >= 0.98) continue;
    facts.push({ hex, count: occ.count, chroma: c, hueName: hueNameFromAngle(h) });
  }
  facts.sort((a, b) => b.count - a.count || b.chroma - a.chroma);
  return facts;
}

function roleForHue(hueName: string): string {
  if (hueName === "red") return "error";
  if (hueName === "green" || hueName === "lime") return "success";
  if (hueName === "yellow" || hueName === "orange") return "warning";
  return "accent";
}

function inferBrandAndHues(
  histograms: Histograms,
  rationale: Rationale,
): { brandColor: string; additionalHues: AdditionalHue[] } {
  const facts = analyzeColors(histograms);
  const saturated = facts.filter((f) => f.chroma > NEUTRAL_CHROMA);

  if (saturated.length === 0) {
    if (facts.length > 0) {
      const brand = toUpperHex(facts[0].hex);
      rationale.warnings.push(
        `No vivid color found — using the most common color ${brand} as the brand. Adjust by re-running plain init if that's wrong.`,
      );
      return { brandColor: brand, additionalHues: [] };
    }
    rationale.warnings.push(
      `No colors found in stylesheets — defaulting brand to ${DEFAULT_BRAND}.`,
    );
    return { brandColor: DEFAULT_BRAND, additionalHues: [] };
  }

  const brandFact = saturated[0];
  const brandColor = toUpperHex(brandFact.hex);
  rationale.lines.push(
    `Brand color ${brandColor} (${brandFact.hueName}) — ${brandFact.count} use${brandFact.count === 1 ? "" : "s"}.`,
  );

  const additionalHues: AdditionalHue[] = [];
  const usedNames = new Set<string>();
  const seenFamilies = new Set<string>([brandFact.hueName]);
  for (const f of saturated.slice(1)) {
    if (additionalHues.length >= 3) break;
    if (seenFamilies.has(f.hueName)) continue;
    seenFamilies.add(f.hueName);
    let name = roleForHue(f.hueName);
    let suffix = 2;
    while (usedNames.has(name)) name = `${roleForHue(f.hueName)}-${suffix++}`;
    usedNames.add(name);
    additionalHues.push({ name, seed: toUpperHex(f.hex) });
  }
  if (additionalHues.length > 0) {
    rationale.lines.push(
      `Additional hues: ${additionalHues.map((h) => `${h.name} (${h.seed})`).join(", ")}.`,
    );
  }
  return { brandColor, additionalHues };
}

function inferSpacingBase(histograms: Histograms, rationale: Rationale): 4 | 8 {
  let weight8 = 0;
  let weightTotal = 0;
  for (const [px, occ] of histograms.dimensions) {
    if (px <= 0 || !Number.isInteger(px)) continue;
    const isSpacing = [...occ.properties].some((prop) => SPACING_PROPERTY.test(prop));
    if (!isSpacing) continue;
    weightTotal += occ.count;
    if (px % 8 === 0) weight8 += occ.count;
  }
  if (weightTotal === 0) {
    rationale.lines.push("Spacing base 8px (default — no spacing values found).");
    return 8;
  }
  const ratio8 = weight8 / weightTotal;
  const base = ratio8 >= 0.6 ? 8 : 4;
  rationale.lines.push(
    `Spacing base ${base}px — ${Math.round(ratio8 * 100)}% of spacing values are multiples of 8.`,
  );
  return base;
}

function inferTypeScale(
  histograms: Histograms,
  rationale: Rationale,
): "compact" | "balanced" | "spacious" {
  const sizes = [...histograms.dimensions.entries()]
    .filter(([px, occ]) => px > 0 && [...occ.properties].includes("font-size"))
    .map(([px]) => px)
    .sort((a, b) => a - b);
  if (sizes.length < 2) {
    rationale.lines.push("Type scale: balanced (default — too few font sizes).");
    return "balanced";
  }
  let ratioSum = 0;
  let ratioCount = 0;
  for (let i = 1; i < sizes.length; i++) {
    const prev = sizes[i - 1];
    const cur = sizes[i];
    if (prev > 0 && cur > prev) {
      ratioSum += cur / prev;
      ratioCount += 1;
    }
  }
  const avg = ratioCount > 0 ? ratioSum / ratioCount : 1.25;
  const scale = avg < 1.225 ? "compact" : avg < 1.29 ? "balanced" : "spacious";
  rationale.lines.push(`Type scale: ${scale} — average size ratio ${avg.toFixed(3)}.`);
  return scale;
}

function inferTypography(
  histograms: Histograms,
  rationale: Rationale,
): InferredTypography | undefined {
  const typography: InferredTypography = {};

  const families = [...histograms.fontFamilies.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  );
  if (families.length > 0) {
    const body = families[0][0];
    const fontFamily: { body: string; heading?: string; mono?: string } = { body };
    const heading = families.find(([stack, occ]) => occ.onHeadingSelector && stack !== body);
    if (heading) fontFamily.heading = heading[0];
    const mono = families.find(([, occ]) => occ.isMono);
    if (mono) fontFamily.mono = mono[0];
    typography.fontFamily = fontFamily;
    rationale.lines.push(
      `Font families: body "${body}"${heading ? `, heading "${heading[0]}"` : ""}${mono ? `, mono "${mono[0]}"` : ""}.`,
    );
  }

  const fontSizes = [...histograms.dimensions.entries()]
    .filter(([px, occ]) => px > 0 && [...occ.properties].includes("font-size"))
    .sort((a, b) => b[1].count - a[1].count);
  if (fontSizes.length > 0) {
    const dominant = Math.round(fontSizes[0][0]);
    if (dominant !== 16 && dominant >= 10 && dominant <= 24) {
      typography.customSizes = { "font-size-base": dominant };
      rationale.lines.push(`Base font size: ${dominant}px (overrides 16px default).`);
    }
  }

  if (histograms.fontWeights.size > 0) {
    const customWeights: Record<string, number> = {};
    for (const weight of histograms.fontWeights.keys()) {
      const role = WEIGHT_ROLES[weight];
      if (role) customWeights[`font-weight-${role}`] = weight;
    }
    if (Object.keys(customWeights).length > 0) {
      typography.customWeights = customWeights;
      rationale.lines.push(
        `Font weights: ${[...histograms.fontWeights.keys()].sort((a, b) => a - b).join(", ")}.`,
      );
    }
  }

  return Object.keys(typography).length > 0 ? typography : undefined;
}

/**
 * Scan the provided stylesheets and infer a seed (the same inputs the
 * quick-start questionnaire collects). Returns `null` when the stylesheets
 * contain no usable color/spacing/typography signal.
 */
export function inferSeedFromStylesheets(stylesheets: StylesheetInput[]): InferredSeed | null {
  const histograms = extractRawValues(stylesheets);
  const hasSignal =
    histograms.colors.size > 0 ||
    histograms.dimensions.size > 0 ||
    histograms.fontFamilies.size > 0 ||
    histograms.fontWeights.size > 0;
  if (!hasSignal) return null;

  const rationale: Rationale = { lines: [], warnings: [] };
  const { brandColor, additionalHues } = inferBrandAndHues(histograms, rationale);
  const spacingBase = inferSpacingBase(histograms, rationale);
  const typeScale = inferTypeScale(histograms, rationale);
  const generateThemes = histograms.darkModeSignals;
  rationale.lines.push(
    generateThemes
      ? "Themes: light + dark (dark-mode styles detected)."
      : "Themes: single (no dark-mode styles detected).",
  );

  const advanced: InferredSeed["advanced"] = {};
  if (additionalHues.length > 0) advanced.color = { additionalHues };
  const typography = inferTypography(histograms, rationale);
  if (typography) advanced.typography = typography;

  return {
    options: { brandColor, spacingBase, typeScale, generateThemes },
    advanced,
    rationale,
    scan: {
      filesScanned: histograms.filesScanned,
      totalColorUsages: histograms.totalColorUsages,
      totalDimensionUsages: histograms.totalDimensionUsages,
    },
  };
}
