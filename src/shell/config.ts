import fs from 'fs';
import { z } from 'zod';

// Define configuration schema
export const ApprovalConfigSchema = z.object({
  autorun_mode: z.object({
    enabled: z.boolean().default(false),
    allowlist: z.array(z.string()).default([]),
    denylist: z.array(z.string()).default([]),
    allow_all_other_commands: z.boolean().default(false)
  })
});

export type ApprovalConfig = z.infer<typeof ApprovalConfigSchema>;

// Default configuration (no automatic approvals)
const defaultConfig: ApprovalConfig = {
  autorun_mode: {
    enabled: false,
    allowlist: [],
    denylist: [],
    allow_all_other_commands: false
  }
};

let activeConfig: ApprovalConfig = { ...defaultConfig };

/**
 * Checks if a command should be auto-approved based on current configuration
 */
export function shouldAutoApproveCommand(command: string): boolean {
  const config = activeConfig.autorun_mode;
  
  // Добавляем отладочные сообщения
  console.error(`DEBUG-CONFIG: Command check: "${command.substring(0, 30)}..."`);
  
  if (!config.enabled) {
    console.error(`DEBUG-CONFIG: Auto-approval disabled`);
    return false;
  }
  
  // Check denylist first (takes precedence) - используем регулярные выражения
  for (const deniedPattern of config.denylist) {
    // Создаем регулярное выражение для поиска слова
    const regex = new RegExp(`\\b${deniedPattern}\\b`, 'i');
    if (regex.test(command)) {
      console.error(`DEBUG-CONFIG: Command in denylist (${deniedPattern})`);
      return false;
    }
  }
  
  // Если режим allow_all_other_commands включен, и команда не в denylist - автоматически разрешаем
  if (config.allow_all_other_commands) {
    console.error(`DEBUG-CONFIG: Using allow_all_other_commands=true`);
    return true;
  }
  
  // Check allowlist - также используем регулярные выражения
  for (const allowedPattern of config.allowlist) {
    // Для allowlist можно использовать более гибкую проверку (без границ слов)
    if (command.includes(allowedPattern)) {
      console.error(`DEBUG-CONFIG: Command in allowlist (${allowedPattern})`);
      return true;
    }
  }
  
  // По умолчанию запрещаем
  console.error(`DEBUG-CONFIG: Command not in allowlist, denied by default`);
  return false;
}

/**
 * Loads configuration from a file
 */
export function loadConfigFromFile(filePath: string): void {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    setConfigFromJson(fileContent);
    console.error(`Loaded configuration from ${filePath}`);
  } catch (error) {
    console.error(`Failed to load configuration from ${filePath}:`, error);
    console.error('Using default configuration');
  }
}

/**
 * Sets configuration from a JSON string
 */
export function setConfigFromJson(jsonString: string): void {
  try {
    const parsedJson = JSON.parse(jsonString);
    const validationResult = ApprovalConfigSchema.safeParse(parsedJson);
    
    if (validationResult.success) {
      activeConfig = validationResult.data;
      console.error('Configuration updated successfully');
    } else {
      console.error('Invalid configuration format:', validationResult.error);
      console.error('Using existing configuration');
    }
  } catch (error) {
    console.error('Failed to parse configuration JSON:', error);
  }
}

/**
 * Gets the current active configuration
 */
export function getConfig(): ApprovalConfig {
  return { ...activeConfig };
} 