#!/usr/bin/env node
import readline from 'readline';

console.error('Mock MCP Server started via stdio');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const request = JSON.parse(line);
    console.error(`Mock Server Received: ${line}`);

    if (request.jsonrpc === '2.0' && request.id && request.method) {
      let result = null;
      let error = null;

      if (request.method === 'ping') {
        result = { pong: true, receivedParams: request.params };
      } else {
        error = { code: -32601, message: 'Method not found' };
      }

      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: result,
        error: error
      };

      const responseString = JSON.stringify(response);
      console.log(responseString);
      console.error(`Mock Server Sent: ${responseString}`);
    } else {
       console.error('Mock Server Received invalid JSON-RPC request');
    }
  } catch (e) {
    console.error(`Mock Server Error parsing line: ${line}`, e);
    // Optionally send a parse error response back if possible
    // This simple mock won't handle request ID association on parse error
    const errorResponse = {
       jsonrpc: '2.0',
       id: null, // Cannot determine ID if parse failed
       error: { code: -32700, message: 'Parse error' }
    };
     console.log(JSON.stringify(errorResponse));
  }
});

rl.on('close', () => {
  console.error('Mock MCP Server stdin closed');
}); 