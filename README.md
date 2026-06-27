# @quieto/mcp

An [MCP](https://modelcontextprotocol.io/) server that exposes [Quieto Tokens](https://github.com/dillonschultz93/quieto-tokens) design token generation and analysis as tools for LLMs.

## Tools

| Tool | Description |
|---|---|
| `generate_color_ramp` | Generate a 10-step accessible color ramp (50-900) from a brand hex color |
| `generate_spacing` | Generate a spacing token scale from a base unit (4px or 8px) |
| `generate_typography` | Generate typography tokens from a scale preset (compact, balanced, spacious) |
| `check_contrast` | Check WCAG 2.1 contrast ratio between two hex colors |
| `map_semantics` | Generate semantic tokens (tier 2) from primitive inputs |
| `generate_themes` | Generate light and dark theme token collections |
| `bootstrap_from_codebase` | Infer a seed from an existing codebase's hardcoded styles, then generate a token system |

## Installation

```bash
npm install -g @quieto/mcp
```

## Usage

### Remote (hosted on Cloudflare Workers)

The server is live at `https://quieto.dev/sse` — no install required.

#### Claude Code

```bash
claude mcp add quieto --transport sse https://quieto.dev/sse
```

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "quieto": {
      "url": "https://quieto.dev/sse"
    }
  }
}
```

#### Cursor

Add to your MCP settings:

```json
{
  "mcpServers": {
    "quieto": {
      "url": "https://quieto.dev/sse"
    }
  }
}
```

### Local (stdio)

Install globally and run as a local MCP server:

```bash
npm install -g @quieto/mcp
```

#### Claude Code

```bash
claude mcp add quieto -- npx -y @quieto/mcp
```

#### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "quieto": {
      "command": "npx",
      "args": ["-y", "@quieto/mcp"]
    }
  }
}
```

## Examples

### Generate a color ramp

```json
{
  "tool": "generate_color_ramp",
  "arguments": {
    "brandColor": "#4F46E5",
    "includeNeutral": true
  }
}
```

### Check contrast

```json
{
  "tool": "check_contrast",
  "arguments": {
    "foreground": "#1A1A1A",
    "background": "#FFFFFF"
  }
}
```

### Generate a full theme

```json
{
  "tool": "generate_themes",
  "arguments": {
    "brandColor": "#4F46E5",
    "spacingBase": 8,
    "typeScale": "balanced",
    "darkMode": true
  }
}
```

### Bootstrap from an existing codebase

Already have a project with hardcoded styles but no token system? Instead of answering the quick-start prompts from scratch, point Quieto at your code and let it infer the seed. Read your stylesheets (`.css`, `.scss`, `.sass`, `.less`, `.styl`) and pass their content — Quieto tallies the colors, spacing, font families, and weights it finds and infers the brand color, additional hues (named by role), spacing base, type scale, fonts/weights, and whether to generate light + dark themes.

```json
{
  "tool": "bootstrap_from_codebase",
  "arguments": {
    "stylesheets": [
      { "path": "src/app.css", "content": ".btn { background: #4F46E5; color: #fff; padding: 8px; }" }
    ],
    "generate": true
  }
}
```

This is a **seed-and-generate** flow: the inferred values drive the normal accessible-ramp pipeline, so you get a clean, idealized system rather than a literal copy of every hardcoded value. The response includes an **inference summary** (`inferred`) — with warnings when Quieto had to guess — plus the generated `themes` when `generate` is `true` (the default). Review and override the inferred inputs before committing to them; set `generate` to `false` to only return the inferred seed.

## License

MIT
