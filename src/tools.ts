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
import { inferSeedFromStylesheets } from "./infer.js";

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

  server.tool(
    "bootstrap_from_codebase",
    "Bootstrap a token system from an existing codebase's hardcoded styles instead of answering the quick-start prompts from scratch. Pass the contents of the project's stylesheets (.css/.scss/.sass/.less/.styl); Quieto tallies the colors, spacing, font families, and weights it finds and infers the seed inputs (brand color, additional hues by role, spacing base, type scale, fonts/weights, and light/dark themes). This is a seed-and-generate flow: by default it also runs the normal accessible-ramp pipeline to produce a full themed token system. Returns an inference summary (with warnings when it had to guess) so you can review and override before writing anything.",
    {
      stylesheets: z
        .array(
          z.object({
            path: z.string().describe("Path or filename of the stylesheet (for reporting only)."),
            content: z.string().describe("Raw stylesheet source."),
          }),
        )
        .min(1)
        .describe(
          "The project's stylesheets. Read each file and pass its content; node_modules/dist/build are normally excluded. Assumes roughly one declaration per line (formatted CSS).",
        ),
      generate: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Also generate the full themed token system from the inferred seed. Set false to only return the inferred inputs and summary. Defaults to true.",
        ),
    },
    async ({ stylesheets, generate }) => {
      const inferred = inferSeedFromStylesheets(stylesheets);
      if (!inferred) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  inferred: null,
                  message:
                    "No color, spacing, or typography signal found in the provided stylesheets. Pass formatted CSS/SCSS/etc. with one declaration per line, or fall back to the quick-start tools (map_semantics / generate_themes).",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const { brandColor, spacingBase, typeScale, generateThemes: darkMode } = inferred.options;
      const result: Record<string, unknown> = { inferred };

      if (generate) {
        const primitives = [
          ...buildColorPrimitives(brandColor),
          ...generateSpacingPrimitives(spacingBase),
          ...generateTypographyPrimitives(typeScale),
        ];
        const semantics = generateSemanticTokens(primitives);
        result.themes = generateThemes(semantics, primitives, darkMode);
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );
}
