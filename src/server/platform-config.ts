import type { WebConfig } from './parallel.js';
import type { SetupStatus } from '../shared/types.js';

export interface PlatformConfig extends WebConfig {
  model?: string;
  apiKey?: string;
  baseUrl: string;
  computerSupervisorUrl?: string;
  computerSupervisorToken?: string;
  computerToken?: string;
  computerNamespace?: string;
  computerMode?: 'local-chrome' | 'managed';
  computerAdminAccess?: boolean;
  harnessManagerUrl?: string;
  harnessManagerToken?: string;
  browserUrl?: string;
  browserSecret?: string;
  voiceKey?: string;
  voiceModel?: string;
  voiceName: string;
  runtimeUrl: string;
  ownerToken?: string;
}
export function setupStatus(config: PlatformConfig): SetupStatus {
  const missing = [
    !config.apiKey && 'OPENAI_API_KEY',
    !config.model && 'OPENAI_MODEL',
  ].filter((item): item is string => !!item);
  return {
    model: !!(config.apiKey && config.model),
    browser: !!(config.browserUrl && config.browserSecret),
    voice: !!(
      config.voiceKey &&
      config.voiceModel &&
      config.apiKey &&
      config.model
    ),
    missing,
  };
}
