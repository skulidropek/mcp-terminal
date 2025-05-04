#!/usr/bin/env node
import { Command } from "commander";
import { ConfigManager } from "./config/manager.js";
import { createTransport } from "./transport/index.js";
import { RpcClient } from "./rpc/client.js";

const program = new Command();

// Загружаем конфигурацию один раз перед парсингом
try {
  ConfigManager.load(); 
} catch (e) {
    console.error("Failed to load mcpServers.json:", String(e));
    process.exit(1);
}

program
  .name("mcp")
  .usage("<server> <tool_name> [json_arguments]")
  .argument("<server>", "server name from mcpServers.json")
  .argument("<tool_name>", "tool name to call (e.g., tools/list, call_method)")
  .argument("[json_arguments]", "Optional JSON string with arguments for the tool")
  .action(async (server, toolName, jsonArguments: string | undefined) => {
    let client: RpcClient | null = null; 
    
    try {
      const cfg = ConfigManager.get(server); 
      
      const transport = createTransport(cfg);
      client = new RpcClient(transport); 
      
      const serverInfo = await client.performHandshake("mcp-cli-client", "0.2.0"); 
      
      let toolArguments: unknown = {}; 
      
      if (jsonArguments) {
          try {
              toolArguments = JSON.parse(jsonArguments);
          } catch (parseError) {
              console.error(`\nError: Failed to parse JSON arguments: ${parseError}`);
              console.error(`Provided arguments string: ${jsonArguments}`);
              process.exit(1);
          }
      }

      const paramsForToolCall = {
          name: toolName,      
          arguments: toolArguments 
      };
      
      const resp = await client.call('tools/call', paramsForToolCall); 
      
      console.log(JSON.stringify(resp, null, 2));

    } catch (e) {
      console.error(`\nError during execution for server '${server}':`, String(e));
      process.exit(1);
    } finally {
        if (client) {
            client.close();
        }
    }
  });

program.parseAsync(); 