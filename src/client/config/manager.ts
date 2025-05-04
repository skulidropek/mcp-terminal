import { readFileSync } from "fs";
import { resolve } from "path";

export interface ServerConfig {
  command: string; // Полная строка команды ИЛИ "sse"
  sseUrl?: string; // URL для SSE транспорта
}

export interface ConfigShape {
  mcpServers: Record<string, ServerConfig>; // Изменено с servers на mcpServers
}

export class ConfigManager {
  private static data: ConfigShape;

  static load(configPath = resolve("mcpServers.json")): void {
    const fileContent = readFileSync(configPath, "utf-8");
    const parsedData = JSON.parse(fileContent);
    
    // Проверка, что корневой ключ именно mcpServers
    if (!parsedData || typeof parsedData !== 'object' || !parsedData.mcpServers) {
      throw new Error(`Invalid config format: Missing "mcpServers" root key in ${configPath}`);
    }
    
    ConfigManager.data = parsedData as ConfigShape;
  }

  static get(server: string): ServerConfig {
    if (!ConfigManager.data) ConfigManager.load();
    
    const cfg = ConfigManager.data.mcpServers[server];
    if (!cfg) {
        throw new Error(`Server '${server}' not found in mcpServers.json`);
    }
    
    // Валидация конфигурации сервера
    if (typeof cfg.command !== 'string') {
         throw new Error(`Invalid config for server '${server}': "command" field must be a string.`);
    }
    
    if (cfg.command === 'sse' && typeof cfg.sseUrl !== 'string') {
         throw new Error(`Invalid config for SSE server '${server}': "sseUrl" field must be a string when command is "sse".`);
    }
    
    return cfg;
  }
  
  // Новый метод для получения всех серверов
  static getAllServers(): Record<string, ServerConfig> {
      if (!ConfigManager.data) ConfigManager.load();
      return ConfigManager.data.mcpServers;
  }
} 