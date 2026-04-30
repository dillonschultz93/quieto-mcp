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

## Installation

```bash
npm install -g @quieto/mcp
```

## Usage

### Claude Code

Add to your Claude Code MCP settings:

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

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

### Programmatic

```bash
quieto-mcp
```

The server communicates over stdio using the MCP protocol.

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

## License

MIT
