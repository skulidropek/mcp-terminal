import fetch from "node-fetch";
import { createParser, type ParseEvent, type ParsedEvent } from "eventsource-parser";
import type { Transport } from "./types.js";
import type { JsonRpcMessage } from "../rpc/types.js";

export class SseTransport implements Transport {
  private controller = new AbortController();
  private onMsg: ((m: JsonRpcMessage) => void) | null = null;
  
  constructor(private url: string) {
    this.start();
  }
  
  private async start() {
    try {
      const response = await fetch(this.url, {
        signal: this.controller.signal
      });
      
      if (!response.body) {
        throw new Error("No response body from SSE endpoint");
      }
      
      const parser = createParser((event: ParseEvent) => {
        if (event.type === 'event') {
          const parsedEvent = event as ParsedEvent;
          if (parsedEvent.data && this.onMsg) {
            try {
              const obj = JSON.parse(parsedEvent.data) as JsonRpcMessage;
              this.onMsg(obj);
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      });
      
      // @ts-ignore - Type definition mismatch between node-fetch and standard fetch
      const reader = response.body.getReader();
      
      // Read the stream
      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = new TextDecoder().decode(value);
            parser.feed(chunk);
          }
        } catch (e) {
          if (!this.controller.signal.aborted) {
            console.error("Error reading SSE stream:", e);
          }
        }
      };
      
      processStream();
    } catch (err) {
      if (!this.controller.signal.aborted) {
        console.error("SSE transport error:", err);
      }
    }
  }
  
  async send(msg: JsonRpcMessage) {
    try {
      await fetch(this.url.replace(/\/sse$/, "/messages"), {
        method: "POST",
        headers: { 
          "Content-Type": "application/json" 
        },
        body: JSON.stringify(msg),
      });
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }
  
  onMessage(cb: (msg: JsonRpcMessage) => void) {
    this.onMsg = cb;
  }
  
  close() {
    this.controller.abort();
  }
} 