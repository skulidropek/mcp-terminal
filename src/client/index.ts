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
  .usage("<server> <method> [args...]")
  .argument("<server>", "server name from mcpServers.json")
  .argument("<method>", "method to call (e.g., tools/list, call_method, ping)")
  .argument("[args...]", "arguments after method")
  .action(async (server, method, args: string[]) => {
    console.error("--- Loaded MCP Server Configurations ---");
    const allServers = ConfigManager.getAllServers();
    for (const serverName in allServers) {
        console.error(`${serverName}:`, JSON.stringify(allServers[serverName]));
    }
    console.error("----------------------------------------");
    
    let client: RpcClient | null = null; // Объявляем заранее для блока finally
    
    try {
      const cfg = ConfigManager.get(server); 
      console.error(`\nAttempting to use server '${server}' with config:`, JSON.stringify(cfg));
      
      const transport = createTransport(cfg);
      client = new RpcClient(transport); // Присваиваем здесь
      
      // === ВЫПОЛНЯЕМ ХЕНДШЕЙК ===
      console.error(`\nPerforming MCP handshake with server '${server}'...`);
      const serverInfo = await client.performHandshake("mcp-cli-client", "0.2.0"); // Используем инфо из лога
      console.error(`\nHandshake successful! Server info: ${JSON.stringify(serverInfo)}`);
      // =============================
      
      let params: unknown; // Определяем переменную для параметров

      // === Интеллектуальная обработка параметров ===
      if (method === 'call_method') {
        if (args.length > 0) {
          try {
            params = JSON.parse(args[0]);
            console.error(`\nCalling method '${method}' on server '${server}' with parsed JSON params:`, params);
          } catch (parseError) {
             console.error(`\nWarning: Failed to parse first argument as JSON for call_method. Using raw arguments. Error: ${parseError}`);
            params = { args };
            console.error(`\nCalling method '${method}' on server '${server}' with raw args:`, args);
          }
        } else {
           console.error(`\nError: 'call_method' requires a JSON parameter string as the first argument.`);
           process.exit(1); // Выходим с ошибкой, если нет аргумента для call_method
        }
      } else if (method === 'tools/list') {
         // Для tools/list параметры {}, согласно логу
         params = {};
         console.error(`\nCalling method '${method}' on server '${server}' with params: {}`);
      } else {
        // Поведение по умолчанию для всех остальных методов (например, ping)
        params = { args };
        console.error(`\nCalling method '${method}' on server '${server}' with default args:`, args);
      }
      // =============================================

      const resp = await client.call(method, params); 
      
      console.error(`\nReceived response from '${server}':`, JSON.stringify(resp));
      console.log(JSON.stringify(resp, null, 2)); // Вывод основного результата в stdout

    } catch (e) {
      console.error(`\nError during execution for server '${server}':`, String(e));
      process.exit(1);
    } finally {
        // Убедимся, что клиент закрывается в любом случае
        if (client) {
            console.error("\nClosing client connection.");
            client.close();
        }
    }
  });

program.parseAsync(); 