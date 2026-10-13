// Forward only approved read tools; credentials stay in the child environment, never argv or stdout.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const profiles = {
  'research-github': { url: 'https://api.githubcopilot.com/mcp/', env: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    headers: { 'X-MCP-Readonly': 'true' }, tools: ['search_repositories','search_code','get_file_contents','list_commits','get_commit','search_issues','issue_read','pull_request_read','search_pull_requests'] },
  'research-zhihu': { url: 'https://developer.zhihu.com/api/mcp/v1', env: 'ZHIHU_ACCESS_SECRET',
    tools: ['zhihu_search','hot_list'] }
};
const profile = profiles[process.argv[2]];
if (!profile || !process.env[profile.env]) { console.error('Missing supported profile or local credential'); process.exit(1); }
const client = new Client({ name: 'research-read-only', version: '1' });
let phase = 'connect';
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(profile.url), {
    requestInit: { headers: { ...profile.headers, Authorization: `Bearer ${process.env[profile.env]}` } }
  }));
  phase = 'list-tools';
  const list = await client.listTools();
  const tools = list.tools.filter(t => profile.tools.includes(t.name));
  const available = new Set(tools.map(t => t.name));
  const server = new Server({ name: process.argv[2], version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (!available.has(request.params.name)) throw new Error('Tool is outside the read-only allowlist');
    return await client.callTool(request.params, undefined, { timeout: 40000 });
  });
  await server.connect(new StdioServerTransport());
  process.on('SIGTERM', async () => { await client.close(); process.exit(0); });
} catch (error) {
  // Do not echo arbitrary upstream errors: they can contain authentication headers or URLs.
  const code = typeof error?.code === 'number' ? error.code : null;
  const network = ['ENOTFOUND','ECONNREFUSED','ETIMEDOUT','ECONNRESET','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error?.cause?.code) ? error.cause.code : null;
  const status = String(error?.message ?? '').match(/(?:endpoint:|status(?: code)?[: ]+)\s*(\d{3})/i)?.[1] ?? null;
  console.error(JSON.stringify({error:'Research authenticated connection failed',phase,code,http_status:status,network}));
  process.exit(1);
}
