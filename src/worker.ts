import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";

export class QuietoMCP extends McpAgent {
  server = new McpServer({
    name: "@quieto/mcp",
    version: "0.1.0",
  });

  async init() {
    registerTools(this.server);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/mcp") {
      return QuietoMCP.serve("/sse").fetch(request, env, ctx);
    }

    return new Response("Quieto MCP Server is running.", { status: 200 });
  },
};
