import { ConfigManager, ServerConfig } from '../src/client/config/manager.js';
import { createTransport } from '../src/client/transport/index.js';
import { RpcClient } from '../src/client/rpc/client.js';
import fs from 'fs'; // Импортируем модуль fs
import path from 'path'; // Импортируем модуль path

interface ToolInfo {
    name: string;
    description?: string;
    inputSchema?: any; // Adding inputSchema field to store the full schema
}

interface ServerTools {
    serverName: string;
    tools?: ToolInfo[];
    error?: string;
}

async function getToolsFromServer(serverName: string, config: ServerConfig): Promise<ServerTools> {
    console.error(`---> Querying server: ${serverName}`);
    let client: RpcClient | null = null;
    try {
        // Добавим проверку на недоступные URL для SSE
        if (config.command === 'sse' && config.sseUrl && config.sseUrl.includes('example.com')) {
            throw new Error(`Skipping example SSE server: ${config.sseUrl}`);
        }
        
        const transport = createTransport(config);
        client = new RpcClient(transport);
        
        // Устанавливаем таймаут для handshake и вызова
        const timeoutMs = 10000; // 10 секунд

        const handshakePromise = client.performHandshake("mcp-prompt-generator", "0.1.0");
        await Promise.race([
            handshakePromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Handshake timeout')), timeoutMs))
        ]);
        console.error(`   [${serverName}] Handshake successful.`);

        const callPromise = client.call('tools/list', {});
        const response = await Promise.race([
            callPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('tools/list call timeout')), timeoutMs))
        ]) as any; // Используем any, т.к. структура ответа может варьироваться

        console.error(`   [${serverName}] Received tools/list response.`);
        
        // Извлекаем инструменты, проверяя структуру ответа
        const toolsList = response?.result?.tools;
        if (Array.isArray(toolsList)) {
             const toolsInfo: ToolInfo[] = toolsList.map((tool: any) => ({
                 name: tool.name || 'Unnamed Tool',
                 description: tool.description || 'No description provided.',
                 inputSchema: tool.inputSchema || null // Capture the full input schema
             }));
             console.error(`   [${serverName}] Found ${toolsInfo.length} tools.`);
            // Успех! Закрываем клиент перед возвратом
            client.close(); 
            console.error(`   [${serverName}] Connection closed successfully.`);
            return { serverName, tools: toolsInfo };
        } else {
            console.error(`   [${serverName}] Invalid tools/list response structure:`, JSON.stringify(response));
            throw new Error('Invalid response structure from tools/list'); // Генерируем ошибку для блока catch
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`   [${serverName}] Error: ${errorMessage}`);
        // Блок finally закроет соединение, если оно еще открыто
        return { serverName, error: errorMessage };
    } finally {
       // Убеждаемся что клиент закрыт в любом случае
       if (client && !client.isClosed()) {
            try {
                console.error(`   [${serverName}] Closing connection in finally...`);
                client.close();
            } catch (closeError) {
                 console.error(`   [${serverName}] Error closing connection in finally: ${closeError}`);
            }
       }
    }
}

async function generatePrompt() {
    console.error("Starting prompt generation...");
    try {
        ConfigManager.load(); // Загружаем mcpServers.json
    } catch (e) {
        console.error("Failed to load mcpServers.json:", String(e));
        process.exit(1);
    }

    const serverConfigs = ConfigManager.getAllServers();
    const serverNames = Object.keys(serverConfigs);
    console.error(`Found servers: ${serverNames.join(', ')}`);

    const results: ServerTools[] = await Promise.all(
        serverNames.map(name => getToolsFromServer(name, serverConfigs[name]))
    );

    console.error("\n--- Formatting Prompt ---");
    let prompt = "# Available MCP Tools\n\n";
    prompt += "This document describes the MCP (Model Context Protocol) tools available in the current project, fetched from configured servers.\n\n";
    prompt += "MCP provides a standardized way for Cursor Agent to communicate with external tools and services.\n\n";
    prompt += "You can call these tools using the CLI client:\n`cd /home/user/mcp-terminal && node dist/client/index.js <server_name> <tool_name> [arguments...]`\n\n";

    for (const result of results) {
        prompt += `## Server: ${result.serverName}\n`;
        if (result.error) {
            prompt += `*   **Error fetching tools:** ${result.error}\n`;
        } else if (result.tools && result.tools.length > 0) {
            result.tools.forEach(tool => {
                prompt += `*   **${tool.name}**\n`;
                prompt += `    *   Description: ${tool.description || 'N/A'}\n`;
                
                // Add detailed schema information if available
                if (tool.inputSchema) {
                    prompt += `    *   Parameters:\n`;
                    try {
                        // Handle different schema formats
                        const properties = tool.inputSchema.properties || {};
                        const required = tool.inputSchema.required || [];
                        
                        for (const [paramName, paramDetails] of Object.entries(properties)) {
                            const typedParamDetails = paramDetails as { 
                                type?: string; 
                                description?: string;
                                enum?: any[];
                            };
                            
                            const isRequired = required.includes(paramName) ? ' (Required)' : '';
                            const paramType = typedParamDetails.type || 'any';
                            const paramDesc = typedParamDetails.description || 'No description';
                            
                            prompt += `        * \`${paramName}\`${isRequired}: ${paramType} - ${paramDesc}\n`;
                            
                            // If there are enum values, add them
                            if (typedParamDetails.enum) {
                                prompt += `          Allowed values: ${typedParamDetails.enum.map((v: any) => `\`${v}\``).join(', ')}\n`;
                            }
                        }
                    } catch (e) {
                        prompt += `        * Schema parsing error: ${e}\n`;
                    }
                }
                
                // Генерируем пример вызова
                let exampleArgs = '';
                // Простые примеры для конкретных инструментов
                if (tool.name === 'call_method' && result.serverName === 'ton') {
                    exampleArgs = `'{\"module\": \"blockchain\", \"method\": \"getAccount\", \"params\": {\"account_id\": \"<some_ton_address>\"}}'`; // Пример для TON
                } else if (tool.name === 'list_modules' && result.serverName === 'ton') {
                    // Нет аргументов
                } else if (tool.name === 'list_methods' && result.serverName === 'ton') {
                    exampleArgs = `'{\"module\": \"blockchain\"}'`;
                } else if (tool.name === 'mcp_run_terminal_cmd' && result.serverName === 'mcp-terminal') {
                    exampleArgs = `'{\"command\":\"ls -la\",\"explanation\":\"List files\",\"is_background\":false}'`; // Пример для терминала
                } else {
                    // Общий пример для других инструментов (можно улучшить, если известна структура)
                    exampleArgs = `[args...]`; 
                }
                
                prompt += `    *   Example CLI Call: \`cd /home/user/mcp-terminal && node dist/client/index.js ${result.serverName} ${tool.name} ${exampleArgs}\`\n`;
            });
        } else {
            prompt += `*   No tools found or reported by the server.\n`;
        }
        prompt += "\n"; // Добавляем пустую строку для лучшего форматирования
    }
    
    // Определяем путь к файлу в корне проекта
    const outputFilePath = path.resolve(process.cwd(), 'mcp-tools-prompt.md');
    
    try {
        fs.writeFileSync(outputFilePath, prompt, 'utf8');
        console.error(`\nPrompt successfully written to: ${outputFilePath}`);
    } catch (writeError) {
        console.error(`\nError writing prompt file: ${writeError}`);
        // Выводим в консоль, если запись не удалась
        console.log("\n--- Generated Prompt (fallback to console) ---");
        console.log(prompt); 
    }
    
    console.error("Prompt generation finished.");
}

generatePrompt(); 