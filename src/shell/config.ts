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
  
  if (!config.enabled) {
    return false;
  }
  
  // Check denylist first (takes precedence)
  for (const deniedPattern of config.denylist) {
    if (command.includes(deniedPattern)) {
      return false;
    }
  }
  
  // Check allowlist
  for (const allowedPattern of config.allowlist) {
    if (command.includes(allowedPattern)) {
      return true;
    }
  }
  
  // If not matched in either list, use the default policy
  return config.allow_all_other_commands;
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