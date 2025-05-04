import { z } from 'zod';

// Base JSON-RPC Types
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string(),
  params: z.any().optional(), // Params validation will be specific to the method
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.any(),
});
export type JsonRpcSuccessResponse = z.infer<typeof JsonRpcSuccessResponseSchema>;

export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.any().optional(),
  }),
});
export type JsonRpcErrorResponse = z.infer<typeof JsonRpcErrorResponseSchema>;

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// --- run_terminal_cmd Tool Schema ---

export const RunTerminalCmdArgsSchema = z.object({
  command: z.string().describe('Complete, single-line shell command. No line breaks.')
    .refine(s => !s.includes('\n'), { message: "Command must be a single line." }),
  explanation: z.string().describe('One sentence explaining why the command is needed (logged and sent to the client).'),
  is_background: z.boolean().describe('true → run with &, server DOES NOT wait for completion; false → wait.'),
  require_user_approval: z.boolean().describe('If true, server DOES NOT execute the command, but returns waiting_for_approval status. Client must send another request with require_user_approval=false to execute.'),
});

export type RunTerminalCmdArgs = z.infer<typeof RunTerminalCmdArgsSchema>;

// --- Result Types used by exec.ts (internal, might be adapted for MCP response) ---

// Result for successful execution (will be stringified in MCP response)
export interface CommandExecSuccessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated?: boolean; // Present and true if output was truncated
}

// Result for waiting for approval (will be stringified in MCP response)
export interface CommandExecWaitingResult {
  status: 'waiting_for_approval';
}

// Result for command error (will be stringified in MCP error response)
export interface CommandExecErrorResult {
    message: string;
    code?: string; // e.g., 'timeout', 'exec_error', 'max_buffer'
    details?: any;
}

// Union type for the possible outcomes of attempting to execute a command
export type CommandExecOutcome =
  | { status: 'success', result: CommandExecSuccessResult }
  | { status: 'waiting', result: CommandExecWaitingResult }
  | { status: 'error', error: CommandExecErrorResult };

// --- SSE Message Types ---

export interface SseMessage {
    event: string; // e.g., 'command_result', 'error', 'keepalive'
    data: string;  // JSON stringified data
    clientId: string; // Target client ID for this message
    id?: string;      // Optional message ID (can correlate with RPC ID)
}

// Type for the data field when event is 'command_result'
export type CommandResultSseData = CommandExecSuccessResult;

// Type for the data field when event is 'error'
export interface ErrorSseData {
    message: string;
    code?: string; // e.g., 'timeout', 'exec_error'
    details?: any;
}
