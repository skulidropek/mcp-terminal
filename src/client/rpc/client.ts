import { v4 as uuid } from "uuid";
import type { JsonRpcMessage, JsonRpcRequest, JsonRpcResponse } from "./types.js";
import type { Transport } from "../transport/types.js";

// Интерфейсы для Initialize (упрощенные)
interface InitializeParams {
    protocolVersion: string;
    capabilities: object; // Можно детализировать при необходимости
    clientInfo: { name: string; version: string };
}

interface InitializeResult {
    protocolVersion: string;
    capabilities: object;
    serverInfo: { name: string; version: string };
}

interface RpcError {
    code: number;
    message: string;
    data?: unknown;
}

export class RpcClient {
  private pending = new Map<string, (m: JsonRpcResponse) => void>();
  private initializePromise: Promise<InitializeResult> | null = null;
  private resolveInitialize: ((result: InitializeResult) => void) | null = null;
  private rejectInitialize: ((reason?: any) => void) | null = null;
  private static readonly INITIALIZE_ID = 'client-initialize-handshake';
  private closed = false; // Флаг состояния соединения

  constructor(private t: Transport) {
    // Обработчик сообщений устанавливается сразу
    t.onMessage((m) => this.handle(m));
  }

  private handle(m: JsonRpcMessage) {
      if (this.closed) {
          return;
      }
      if ('id' in m && m.id === RpcClient.INITIALIZE_ID) {
         const response = m as JsonRpcResponse;
         if (response.result && this.resolveInitialize) {
             this.resolveInitialize(response.result as InitializeResult);
         } else if (response.error && this.rejectInitialize) {
             const error = response.error as RpcError;
             this.rejectInitialize(new Error(`Initialize failed: ${error.message} (Code: ${error.code})`));
         }
         this.resolveInitialize = null;
         this.rejectInitialize = null;
         this.initializePromise = null;
         return;
      }

      if ("id" in m && this.pending.has(m.id)) {
        const callback = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        callback(m as JsonRpcResponse);
      }
  }

  // Метод для выполнения хендшейка
  async performHandshake(clientName = "mcp-client", clientVersion = "0.1.0"): Promise<InitializeResult> {
      if (!this.initializePromise) {
          this.initializePromise = new Promise<InitializeResult>((resolve, reject) => {
              this.resolveInitialize = resolve;
              this.rejectInitialize = reject;
              
              const params: InitializeParams = {
                  protocolVersion: "2024-11-05",
                  capabilities: { experimental: {} },
                  clientInfo: { name: clientName, version: clientVersion }
              };
              const req: JsonRpcRequest = { 
                  jsonrpc: "2.0", 
                  id: RpcClient.INITIALIZE_ID,
                  method: "initialize", 
                  params 
              };

              this.t.send(req);
          });
      }
      
      const initResult = await this.initializePromise;
      
      const initializedNotification = { 
          jsonrpc: "2.0", 
          method: "notifications/initialized", 
          params: {} 
      };
      this.t.send(initializedNotification as JsonRpcRequest);
      
      return initResult;
  }

  // Метод для обычных вызовов
  call(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = uuid();
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    
    return new Promise((res, rej) => {
      this.pending.set(id, (response) => {
          const error = response.error as RpcError | undefined;
          if (error) {
              rej(new Error(`RPC Error: ${error.message} (Code: ${error.code})`));
          } else {
              res(response);
          }
      });
      this.t.send(req);
    });
  }

  // Новый метод для проверки состояния
  isClosed(): boolean {
      return this.closed;
  }

  close() {
    if (!this.closed) {
        this.closed = true; // Сначала устанавливаем флаг, чтобы handle перестал обрабатывать
        try {
            this.t.close(); // Закрываем транспорт
        } catch (e) {
             console.error(`[RpcClient] Error closing transport: ${e}`);
        }
        // Очищаем ожидающие запросы с ошибкой
        this.pending.forEach((callback, id) => {
            callback({ jsonrpc: "2.0", id: id, error: { code: -32000, message: "Client connection closed" } });
        });
        this.pending.clear();
        // Сбрасываем промис инициализации, если он еще активен
        if (this.rejectInitialize) {
            this.rejectInitialize(new Error("Client connection closed during handshake"));
            this.resolveInitialize = null;
            this.rejectInitialize = null;
            this.initializePromise = null;
        }
    }
  }
} 