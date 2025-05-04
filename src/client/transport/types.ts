import type { JsonRpcMessage } from "../rpc/types.js";

export interface Transport {
  send(msg: JsonRpcMessage): Promise<void>;
  onMessage(cb: (msg: JsonRpcMessage) => void): void;
  close(): void;
} 