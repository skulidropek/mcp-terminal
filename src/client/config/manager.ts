import { readFileSync } from "fs";
import { resolve, join } from "path";
import { existsSync } from "fs";

export interface ServerConfig {
  command: string; // Полная строка команды ИЛИ "sse"
  sseUrl?: string; // URL для SSE транспорта
}

export interface ConfigShape {
  mcpServers: Record<string, ServerConfig>; // Изменено с servers на mcpServers
}

export class ConfigManager {
  private static data: ConfigShape;

  static load(configPath?: string): void {
    let resolvedPath;
    
    if (configPath) {
      resolvedPath = resolve(configPath);
    } else {
      // Сначала пробуем текущую директорию
      resolvedPath = resolve("mcpServers.json");
      
      // Если в текущей директории нет, проверяем путь относительно директории модуля
      if (!existsSync(resolvedPath)) {
        const moduleDir = __dirname;
        // Поднимаемся на 3 уровня: config -> client -> src (или dist) -> корень проекта
        const projectRoot = join(moduleDir, '..', '..', '..');
        resolvedPath = join(projectRoot, "mcpServers.json");
      }
      
      // Если и в директории проекта нет, пробуем домашнюю директорию
      if (!existsSync(resolvedPath)) {
        resolvedPath = resolve(process.env.HOME || process.env.USERPROFILE || '', "mcpServers.json");
      }
    }
    
    if (!existsSync(resolvedPath)) {
      throw new Error(`Cannot find mcpServers.json at ${resolvedPath}`);
    }
    
    const fileContent = readFileSync(resolvedPath, "utf-8");
    const parsedData = JSON.parse(fileContent);
    
    // Проверка, что корневой ключ именно mcpServers
    if (!parsedData || typeof parsedData !== 'object' || !parsedData.mcpServers) {
      throw new Error(`Invalid config format: Missing "mcpServers" root key in ${resolvedPath}`);
    }
    
    ConfigManager.data = parsedData as ConfigShape;
    console.log(`Successfully loaded config from ${resolvedPath}`);
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