import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP stdio still initializes and lists exactly the original 24 tools; audit is a separate entry',async()=>{
  const client=new Client({name:'chrome-ops-contract-test',version:'1.0.0'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js'],stderr:'pipe'}));
    assert.equal(client.getServerVersion().version,'0.5.4-alpha.0');
    const {tools}=await client.listTools();assert.equal(tools.length,24);assert.ok(!tools.some(tool=>tool.name.includes('audit')));
  }finally{await client.close();}
});
