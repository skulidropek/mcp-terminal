import { StdioTransport } from "./stdio.js";
import { SseTransport } from "./sse.js";
import type { Transport } from "./types.js";
import type { ServerConfig } from "../config/manager.js";

export function createTransport(cfg: ServerConfig): Transport {
  if (cfg.command === "sse") {
    if (!cfg.sseUrl) {
      throw new Error("sseUrl missing for SSE transport");
    }
    return new SseTransport(cfg.sseUrl);
  }
  
  if (!cfg.command) {
    throw new Error("command field is empty for stdio server");
  }
  return new StdioTransport(cfg.command);
} 