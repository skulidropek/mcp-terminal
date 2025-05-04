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
    
    console.error(`DEBUG: Checking command: "${command}"`);
    console.error(`DEBUG: Config: enabled=${config.enabled}, allow_all_other_commands=${config.allow_all_other_commands}`);
    console.error(`DEBUG: Denylist: ${JSON.stringify(config.denylist)}`);
    
    // Максимально упрощенная логика:
    // 1. Если allow_all_other_commands=true, проверяем ТОЛЬКО denylist
    // 2. Если команда не в denylist, ВСЕГДА разрешаем
    
    // Проверяем только denylist с использованием регулярных выражений для поиска слов
    for (const deniedPattern of config.denylist) {
        // Создаем регулярное выражение для поиска слова (с границами слов)
        const regex = new RegExp(`\\b${deniedPattern}\\b`, 'i');
        if (regex.test(command)) {
            console.error(`DEBUG: Command denied - found word pattern "${deniedPattern}" in command`);
            return true; // Команда запрещена, т.к. содержит запрещенное слово
        }
    }
    
    // Если включен режим allow_all_other_commands, и команда не в denylist - разрешаем
    if (config.enabled && config.allow_all_other_commands) {
        console.error(`DEBUG: Command allowed - not in denylist and allow_all_other_commands=true`);
        return false; // Команда разрешена
    }
    
    // В противном случае используем стандартную логику через shouldAutoApproveCommand
    if (!config.enabled) {
        console.error(`DEBUG: Command allowed - autorun_mode is disabled`);
        return false; // Если autorun_mode выключен, разрешаем все команды, не входящие в denylist
    }
    
    // Проверяем через shouldAutoApproveCommand
    const result = !shouldAutoApproveCommand(command);
    console.error(`DEBUG: Using shouldAutoApproveCommand, result: ${result ? 'denied' : 'allowed'}`);
    return result;
};

/**
 * Executes a shell command based on the provided arguments.
 * Handles foreground/background execution, timeouts, output truncation.
 *
 * Returns a CommandExecOutcome indicating success or error.
 */
export const executeCommand = async (
    params: RunTerminalCmdArgs
): Promise<CommandExecOutcome> => {

    logCommand(params.command, 'requested', { is_background: params.is_background, explanation: params.explanation });

    // SECURITY CHECK: Check all commands against security rules
    if (isCommandDenied(params.command)) {
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
