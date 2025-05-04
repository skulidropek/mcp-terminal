import { spawn, ChildProcess } from "child_process";
import readline from "readline";
import type { Transport } from "./types.js";
import type { JsonRpcMessage } from "../rpc/types.js";

// Функция для парсинга строки команды в команду и аргументы
// Возвращает [commandExecutable, args[]]
function parseCommandString(commandString: string): [string, string[]] {
  const parts = commandString.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') {
      throw new Error(`Invalid command string: "${commandString}"`);
  }
  const commandExecutable = parts[0];
  const args = parts.slice(1);

  // УБИРАЕМ автоматическое добавление флага --transport stdio
  // const needsStdioFlag = !args.includes("--transport") && !args.includes("--stdio");
  // const finalArgs = needsStdioFlag ? [...args, "--transport", "stdio"] : args;
  
  // return [commandExecutable, finalArgs];
  return [commandExecutable, args]; // Возвращаем аргументы как есть
}

// Вспомогательная функция для задержки
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class StdioTransport implements Transport {
  private proc: ChildProcess;
  private isFirstSend = true; // Флаг для отслеживания первой отправки

  constructor(commandString: string) {
    const [executable, args] = parseCommandString(commandString);
    
    console.error(`[StdioTransport] Spawning: ${executable} with args: ${JSON.stringify(args)}`);
    this.proc = spawn(executable, args, {
      stdio: ["pipe", "pipe", "inherit"],
      shell: false // Важно: не используем shell, чтобы избежать проблем с парсингом
    });
    
    this.proc.on('error', (err) => {
        console.error(`[StdioTransport] Failed to start subprocess for command "${commandString}"`, err);
    });
    
    this.proc.on('exit', (code, signal) => {
        console.error(`[StdioTransport] Subprocess exited with code ${code} and signal ${signal}`);
    });
  }

  async send(msg: JsonRpcMessage) {
    if (this.isFirstSend) {
        console.error('[StdioTransport] Applying initial 200ms delay before first send...');
        await delay(200); // Задержка перед первой отправкой
        this.isFirstSend = false;
    }
    const dataToSend = JSON.stringify(msg) + "\n";
    console.error(`[StdioTransport] Sending data: ${dataToSend.trim()}`);
    this.proc.stdin?.write(dataToSend);
  }

  onMessage(cb: (msg: JsonRpcMessage) => void) {
    if (!this.proc.stdout) {
        console.error('[StdioTransport] No stdout stream available for listening.');
        return;
    }
    
    console.error('[StdioTransport] Setting up message listener on stdout.');
    const rl = readline.createInterface({
      input: this.proc.stdout,
      crlfDelay: Infinity
    });
    
    rl.on("line", (line) => {
      console.error(`[StdioTransport] Received line: ${line}`);
      try {
        const obj = JSON.parse(line) as JsonRpcMessage;
        cb(obj);
      } catch (e) {
         console.error(`[StdioTransport] Error parsing received line: ${line}`, e); 
        /* ignore */
      }
    });
    
    rl.on('close', () => {
        console.error('[StdioTransport] Readline interface closed.');
    });
  }

  close() {
    console.error('[StdioTransport] Close requested.');
    if (this.proc && !this.proc.killed) {
        console.error('[StdioTransport] Killing subprocess.');
        this.proc.kill();
    }
  }
} 