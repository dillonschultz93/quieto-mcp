import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  generatePrimaryRamp,
  generateNeutralRamp,
  generateSpacingPrimitives,
  generateTypographyPrimitives,
  generateSemanticTokens,
  generateThemes,
  contrastRatio,
  type ColorRamp,
  type PrimitiveToken,
} from "@quieto/tokens";

function colorRampToTokens(ramp: ColorRamp): PrimitiveToken[] {
  return ramp.steps.map((step) => ({
    tier: "primitive" as const,
    category: "color",
    name: step.name,
    $type: "color",
    $value: step.hex,
    path: ["color", ramp.hue, String(step.step)],
  }));
}

function buildColorPrimitives(brandColor: string): PrimitiveToken[] {
  const primary = generatePrimaryRamp(brandColor);
  const neutral = generateNeutralRamp(brandColor);
  return [...colorRampToTokens(primary), ...colorRampToTokens(neutral)];
}

export function registerTools(server: McpServer) {
  server.tool(
    "generate_color_ramp",
    "Generate a 10-step accessible color ramp (50-900) from a brand hex color. Returns primary and optional neutral ramps as DTCG-aligned tokens.",
    {
      brandColor: z.string().describe("Hex color string (e.g. '#4F46E5')"),
      includeNeutral: z.boolean().optional().default(true).describe("Also generate a neutral ramp. Defaults to true."),
    },
    async ({ brandColor, includeNeutral }) => {
      const primary = generatePrimaryRamp(brandColor);
      const ramps = [primary];
      if (includeNeutral) {
        ramps.push(generateNeutralRamp(brandColor));
      }
      return { content: [{ type: "text", text: JSON.stringify(ramps, null, 2) }] };
    },
  );

  server.tool(
    "generate_spacing",
    "Generate a spacing primitive token scale from a base unit (4px or 8px). Returns DTCG-aligned spacing tokens.",
    {
      base: z.union([z.literal(4), z.literal(8)]).describe("Base spacing unit in pixels."),
    },
    async ({ base }) => {
      const tokens = generateSpacingPrimitives(base);
      return { content: [{ type: "text", text: JSON.stringify(tokens, null, 2) }] };
    },
  );

  server.tool(
    "generate_typography",
    "Generate typography primitive tokens (font sizes, weights) from a scale preset. Returns DTCG-aligned tokens.",
    {
      scale: z.enum(["compact", "balanced", "spacious"]).describe("Type scale preset."),
    },
    async ({ scale }) => {
      const tokens = generateTypographyPrimitives(scale);
      return { content: [{ type: "text", text: JSON.stringify(tokens, null, 2) }] };
    },
  );

  server.tool(
    "check_contrast",
    "Check WCAG 2.1 contrast ratio between two hex colors. Returns ratio and pass/fail for AA and AAA at normal and large text sizes.",
    {
      foreground: z.string().describe("Foreground hex color (e.g. '#1A1A1A')"),
      background: z.string().describe("Background hex color (e.g. '#FFFFFF')"),
    },
    async ({ foreground, background }) => {
      const ratio = contrastRatio(foreground, background);
      const result = {
        foreground,
        background,
        ratio: Math.round(ratio * 100) / 100,
        wcag: {
          AA: { normalText: ratio >= 4.5, largeText: ratio >= 3 },
          AAA: { normalText: ratio >= 7, largeText: ratio >= 4.5 },
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "map_semantics",
    "Generate semantic tokens (tier 2) from primitive inputs. Maps color, spacing, and typography to UI roles like 'background.primary', 'spacing.md', 'typography.body'.",
    {
      brandColor: z.string().describe("Hex color string (e.g. '#4F46E5')"),
      spacingBase: z.union([z.literal(4), z.literal(8)]).describe("Spacing base unit."),
      typeScale: z.enum(["compact", "balanced", "spacious"]).describe("Typography scale preset."),
    },
    async ({ brandColor, spacingBase, typeScale }) => {
      const primitives = [
        ...buildColorPrimitives(brandColor),
        ...generateSpacingPrimitives(spacingBase),
        ...generateTypographyPrimitives(typeScale),
      ];
      const semantics = generateSemanticTokens(primitives);
      return { content: [{ type: "text", text: JSON.stringify(semantics, null, 2) }] };
    },
  );

  server.tool(
    "generate_themes",
    "Generate light and dark theme token collections. The dark theme inverts color steps to maintain contrast and vibrancy against dark surfaces.",
    {
      brandColor: z.string().describe("Hex color string (e.g. '#4F46E5')"),
      spacingBase: z.union([z.literal(4), z.literal(8)]).describe("Spacing base unit."),
      typeScale: z.enum(["compact", "balanced", "spacious"]).describe("Typography scale preset."),
      darkMode: z.boolean().optional().default(true).describe("Generate dark theme. Defaults to true."),
    },
    async ({ brandColor, spacingBase, typeScale, darkMode }) => {
      const primitives = [
        ...buildColorPrimitives(brandColor),
        ...generateSpacingPrimitives(spacingBase),
        ...generateTypographyPrimitives(typeScale),
      ];
      const semantics = generateSemanticTokens(primitives);
      const themes = generateThemes(semantics, primitives, darkMode);
      return { content: [{ type: "text", text: JSON.stringify(themes, null, 2) }] };
    },
  );
}
