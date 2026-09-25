import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"] });
const client = new Client({ name: "chrome-ops-smoke", version: "0.1.0" });
await client.connect(transport);
await new Promise(resolve => setTimeout(resolve, 2500));
for (const name of ["chrome_status", "tabs_list"]) {
  const result = await client.callTool({ name, arguments: {} });
  console.log(name, JSON.stringify(result.content));
}
await client.close();
