import { exec, ExecException } from 'child_process';
import {
    RunTerminalCmdArgs,
    CommandExecOutcome,
    CommandExecSuccessResult,
    CommandExecErrorResult
} from '../types.js';
import { shouldAutoApproveCommand, getConfig } from './config.js';

const MAX_BUFFER_SIZE = 2 * 1024 * 1024; // 2 MB
const EXEC_TIMEOUT = 30 * 1000; // 30 seconds

// Simple structured logging to console (can be adapted or removed based on MCP server logging)
const logCommand = (command: string, phase: string, details: any = {}) => {
    // Removed ID and clientId as they are less relevant in MCP tool context unless passed explicitly
    // Use console.error to send logs to stderr, keeping stdout clean for MCP JSON responses
    console.error(JSON.stringify({ ts: new Date().toISOString(), command, phase, ...details }));
};

/**
 * Checks if a command is denied by security rules
 * Extracted to a separate function for reuse
 */
export const isCommandDenied = (command: string): boolean => {
    const config = getConfig().autorun_mode;
    
    // If auto-approval is disabled, only check the blacklist
    if (!config.enabled) {
        for (const deniedPattern of config.denylist) {
            if (command.includes(deniedPattern)) {
                return true;
            }
        }
        return false;
    }
    
    // If auto-approval is enabled, use the full logic from shouldAutoApproveCommand
    // but invert the result (we need to know if the command is denied)
    return !shouldAutoApproveCommand(command);
};

/**
 * Executes a shell command based on the provided arguments.
 * Handles foreground/background execution, timeouts, output truncation,
 * and the require_user_approval flag.
 *
 * Returns a CommandExecOutcome indicating success, waiting, or error.
 */
export const executeCommand = async (
    params: RunTerminalCmdArgs
): Promise<CommandExecOutcome> => {

    logCommand(params.command, 'requested', { is_background: params.is_background, require_approval: params.require_user_approval, explanation: params.explanation });

    // ADDED SECURITY CHECK: Check all commands against security rules
    // regardless of the require_user_approval parameter
    if (isCommandDenied(params.command)) {
        // If the command is denied but the user is trying to execute without confirmation
        if (!params.require_user_approval) {
            logCommand(params.command, 'denied', { explanation: "Command is denied by security rules" });
            return {
                status: 'error',
                error: {
                    code: 'security_violation',
                    message: 'Command is denied by security rules',
                    details: { command: params.command }
                }
            };
        }
        
        // If the command is denied and require_user_approval=true, request confirmation
        logCommand(params.command, 'waiting_for_approval', { reason: "Command is in the deny list" });
        return {
            status: 'waiting',
            result: { status: 'waiting_for_approval' }
        };
    }

    // Handle approval requirement, checking auto-approval config
    if (params.require_user_approval) {
        // Check if this command can be auto-approved based on configuration
        if (shouldAutoApproveCommand(params.command)) {
            logCommand(params.command, 'auto_approved', { explanation: "Command matches auto-approval rules" });
            // Continue execution with auto-approval
        } else {
            logCommand(params.command, 'waiting_for_approval');
            return {
                status: 'waiting',
                result: { status: 'waiting_for_approval' }
            };
        }
    }

    // Background execution: Append '&' and return success immediately
    if (params.is_background) {
        logCommand(params.command, 'background_started');
        // Use exec without awaiting it. Add '&' for shell backgrounding.
        exec(`${params.command} &`, { maxBuffer: 1024 }, (error) => {
            if (error) {
                logCommand(params.command, 'background_error', { error: error.message });
            }
        });
        // MCP tool call completes successfully, indicating the background command started.
        const successResult: CommandExecSuccessResult = {
            stdout: '', // No stdout/stderr captured for background tasks in this simple implementation
            stderr: '',
            exitCode: 0, // Per original spec, return 0 immediately
            truncated: false
        };
        return { status: 'success', result: successResult };
    }

    // Foreground execution
    return new Promise((resolve) => {
        logCommand(params.command, 'executing');
        let stdout = '';
        let stderr = '';
        let truncated = false;

        const process = exec(params.command, {
            timeout: EXEC_TIMEOUT,
            maxBuffer: MAX_BUFFER_SIZE + 1024, // Allow slightly more to check for truncation
            encoding: 'utf8',
        });

        process.stdout?.on('data', (data: string) => {
            if (stdout.length + data.length > MAX_BUFFER_SIZE) {
                const remainingSpace = MAX_BUFFER_SIZE - stdout.length;
                stdout += data.substring(0, remainingSpace);
                truncated = true;
            } else if (!truncated) {
                stdout += data;
            }
        });

        process.stderr?.on('data', (data: string) => {
            if (stderr.length + data.length > MAX_BUFFER_SIZE) {
                const remainingSpace = MAX_BUFFER_SIZE - stderr.length;
                stderr += data.substring(0, remainingSpace);
                truncated = true;
            } else if (!truncated) {
                stderr += data;
            }
        });

        process.on('close', (code) => {
            const exitCode = code === null ? -1 : code;
            logCommand(params.command, 'finished', { exitCode, truncated, stdout_len: stdout.length, stderr_len: stderr.length });
            const successResult: CommandExecSuccessResult = {
                stdout,
                stderr,
                exitCode,
                truncated: truncated || undefined
            };
            resolve({ status: 'success', result: successResult });
        });

        process.on('error', (err: ExecException) => {
            logCommand(params.command, 'error', { error: err.message, code: err.code });

            let errorCode = 'exec_error';
            let errorMessage = `Command failed: ${err.message}`;
            let errorDetails: any = { command: params.command, error_code: err.code, signal: err.signal };

            if (err.signal === 'SIGTERM' || (err.code as any) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
                errorMessage = `Command output exceeded ${MAX_BUFFER_SIZE / 1024 / 1024}MB buffer limit.`;
                errorCode = 'max_buffer';
                // Stderr might contain useful info, but ensure it doesn't cause secondary issues
                const errorMsgSuffix = `\nERROR: ${errorMessage}`;
                 if (stderr.length + errorMsgSuffix.length > MAX_BUFFER_SIZE) {
                     stderr = stderr.substring(0, MAX_BUFFER_SIZE - errorMsgSuffix.length);
                 }
                 stderr += errorMsgSuffix;
                 truncated = true;

                // Even though it's an error, return it as part of a 'success' outcome
                // for the execution process itself, with the error details in stderr.
                // MCP handler will decide if this constitutes a tool error.
                const partialResult: CommandExecSuccessResult = {
                    stdout,
                    stderr,
                    exitCode: err.code ?? 1,
                    truncated: true
                };
                 resolve({ status: 'success', result: partialResult });
                 return;
            } else if ((err.code as any) === 'ETIMEDOUT' || err.signal === 'SIGKILL') {
                errorCode = 'timeout';
                errorMessage = `Command timed out after ${EXEC_TIMEOUT / 1000} seconds.`;
            }

            const errorResult: CommandExecErrorResult = {
                code: errorCode,
                message: errorMessage,
                details: errorDetails
            };
            resolve({ status: 'error', error: errorResult });
        });
    });
};
