#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    CallToolResultSchema,
    ListToolsRequestSchema,
    ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { RunTerminalCmdArgsSchema, CommandExecOutcome } from './types.js';
import { executeCommand } from './shell/exec.js';
import { loadConfigFromFile } from './shell/config.js';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables from .env file if present
dotenv.config();

// Process command line arguments for configuration
function processArgs(): void {
    const args = process.argv.slice(2);
    let i = 0;
    
    while (i < args.length) {
        const arg = args[i];
        
        if (arg === '--file' || arg === '-f') {
            if (i + 1 < args.length) {
                const configPath = args[i + 1];
                loadConfigFromFile(configPath);
                i += 2;
            } else {
                console.error(chalk.red('Error: --file requires a path argument'));
                process.exit(1);
            }
        } else {
            console.error(chalk.yellow(`Warning: Unknown argument: ${arg}`));
            i++;
        }
    }
}

// Process arguments at startup
processArgs();

// Define the tool
// Remove the specific type inference for inputSchemaType
// type ToolInputSchemaType = z.infer<typeof ToolSchema.shape.inputSchema>;

const jsonSchemaOptions = {
    target: 'jsonSchema7' as const // Explicitly target JSON Schema Draft 7
};

const runTerminalCmdTool: z.infer<typeof ToolSchema> = {
    name: "mcp_run_terminal_cmd",
    description: "Execute a shell command locally. Handles foreground/background execution.",
    // Generate schema with explicit options and cast to a compatible object type
    // Assuming ToolSchema.shape.inputSchema expects an object with at least a 'type' field
    inputSchema: zodToJsonSchema(RunTerminalCmdArgsSchema, jsonSchemaOptions) as { type: 'object', [key: string]: any },
};

// Server setup
const server = new Server(
    {
        // Server Metadata
        name: "mcp-terminal-server",
        version: "1.0.0", // Consider reading from package.json
    },
    {
        // Server Capabilities
        capabilities: {
            tools: {},
        },
    },
);

// Register list_tools handler
server.setRequestHandler(ListToolsRequestSchema, () => {
    return {
        tools: [runTerminalCmdTool],
    };
});

// Infer the full request type and the result type
type CallToolRequestType = z.infer<typeof CallToolRequestSchema>;
type CallToolResultType = z.infer<typeof CallToolResultSchema>;

// Register call_tool handler with explicitly typed request parameter
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequestType): Promise<CallToolResultType> => {

    // Add debug logging
    console.error(chalk.yellow('Debug - Request:'), JSON.stringify(request, null, 2));
    console.error(chalk.yellow('Debug - Params:'), JSON.stringify(request.params, null, 2));
    
    // Extract parameters directly from request.params
    const params = request.params as any; // Cast params to any for flexibility
    
    // Extract name and arguments directly from params instead of params.toolCall
    const name = params.name;
    const args = params.arguments;
    const toolCallId = params.id || 'call_' + Date.now(); // Generate ID if not provided
    
    console.error(chalk.yellow('Extracted values:'), {
        name,
        args: JSON.stringify(args),
        toolCallId
    });

    if (!name || name !== runTerminalCmdTool.name) {
        // Handle case where name might be missing or incorrect
        throw new Error(`Unknown or invalid tool call in request: ${JSON.stringify(request.params)}`);
    }

    try {
        const parsedArgs = RunTerminalCmdArgsSchema.safeParse(args);
        if (!parsedArgs.success) {
           return {
                toolCallId: toolCallId ?? 'parse_error_id', // Provide a fallback ID
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            error: true,
                            message: "Invalid arguments for run_terminal_cmd",
                            details: parsedArgs.error.issues,
                        })
                    }
                ],
                isError: true,
            };
        }

        const executionOutcome: CommandExecOutcome = await executeCommand(parsedArgs.data);

        switch (executionOutcome.status) {
            case 'success':
                return {
                    toolCallId: toolCallId,
                    content: [{ type: "text", text: JSON.stringify(executionOutcome.result) }]
                };
            case 'error':
                return {
                    toolCallId: toolCallId,
                    content: [{ type: "text", text: JSON.stringify({ error: true, ...executionOutcome.error }) }],
                    isError: true,
                };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Use already extracted name and toolCallId if available
        console.error(chalk.red(`Error executing tool ${name ?? 'unknown_tool'}:`), error);
        return {
            toolCallId: toolCallId ?? 'exec_error_id', // Fallback ID
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ error: true, message: `Internal server error executing tool: ${errorMessage}` })
                }
            ],
            isError: true,
        };
    }
});

// Start server
async function runServer() {
    const transport = new StdioServerTransport();
    console.error(chalk.green('MCP Terminal Server starting up...'));

    // Add signal handling for graceful shutdown
    process.on('SIGINT', () => {
        console.error(chalk.yellow('\nReceived SIGINT signal, shutting down server'));
        // Perform any cleanup if needed
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.error(chalk.yellow('Received SIGTERM signal, shutting down server'));
        // Perform any cleanup if needed
        process.exit(0);
    });

    await server.connect(transport);
    console.error(chalk.green('MCP Terminal Server running on stdio'));
}

runServer().catch((error) => {
    console.error(chalk.red("Fatal error running server:"), error);
    process.exit(1);
});
