import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { GatewayConfig } from './types.ts';

const DEFAULT_CONFIG: GatewayConfig = {
  server: {
    port: 18763,
    apiKey: 'sk-gateway-local-token',
    host: '127.0.0.1'
  },
  providers: {
    google: {
      enabled: true,
      accountsPath: './data/google-accounts.json',
      accountPool: {
        autoReload: true
      },
      reasoning: { models: {} }
    },
    codex: {
      enabled: true,
      authPath: path.join(os.homedir(), '.codex/auth.json'),
      baseURL: 'https://chatgpt.com/backend-api/codex',
      modelsCachePath: path.join(os.homedir(), '.codex/models_cache.json'),
      reasoning: {
        models: {},
        anthropicBudget: { lowMaxTokens: 2000, mediumMaxTokens: 8000 }
      }
    }
  },
  routes: {
    // Google Antigravity Models
    'claude-sonnet-4-6': 'google',
    'claude-opus-4-6-thinking': 'google',
    'claude-3-7-sonnet': 'google',
    'gemini-3.8-flash': 'google',
    'gemini-3.8-flash-high': 'google',
    'gemini-3.8-flash-medium': 'google',
    'gemini-2.5-pro': 'google',

    // Codex Compute Models (OpenAI internal/ChatGPT session compute)
    'gpt-6.1-sol': 'codex',
    'gpt-6-astra': 'codex',
    'gpt-6-sol': 'codex',
    'gpt-6-luna': 'codex',
    'gpt-5.6-sol': 'codex',
    'gpt-5.6-terra': 'codex',
    'gpt-5.5': 'codex',
    'gpt-5-codex': 'codex',
    'codex': 'codex'
  }
};

function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

export function loadConfig(configPath = 'config.json'): GatewayConfig {
  try {
    const fullPath = path.resolve(configPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(content);

      const config: GatewayConfig = {
        server: {
          ...DEFAULT_CONFIG.server,
          ...parsed.server
        },
        providers: {
          google: {
            ...DEFAULT_CONFIG.providers.google,
            ...parsed.providers?.google,
            reasoning: {
              models: {
                ...(DEFAULT_CONFIG.providers.google.reasoning?.models ?? {}),
                ...parsed.providers?.google?.reasoning?.models
              }
            }
          },
          codex: {
            ...DEFAULT_CONFIG.providers.codex,
            ...parsed.providers?.codex,
            reasoning: {
              ...DEFAULT_CONFIG.providers.codex.reasoning,
              ...parsed.providers?.codex?.reasoning,
              models: {
                ...(DEFAULT_CONFIG.providers.codex.reasoning?.models ?? {}),
                ...parsed.providers?.codex?.reasoning?.models
              },
              anthropicBudget: {
                ...(DEFAULT_CONFIG.providers.codex.reasoning?.anthropicBudget ?? { lowMaxTokens: 2000, mediumMaxTokens: 8000 }),
                ...parsed.providers?.codex?.reasoning?.anthropicBudget
              }
            }
          }
        },
        routes: {
          ...DEFAULT_CONFIG.routes,
          ...Object.fromEntries(
            Object.entries(parsed.routes || {}).filter(([, provider]) => provider === 'google' || provider === 'codex')
          )
        }
      };

      if (config.providers.google.accountsPath) {
        config.providers.google.accountsPath = resolvePath(config.providers.google.accountsPath);
      }
      if (config.providers.codex.authPath) {
        config.providers.codex.authPath = resolvePath(config.providers.codex.authPath);
      }
      if (config.providers.codex.modelsCachePath) {
        config.providers.codex.modelsCachePath = resolvePath(config.providers.codex.modelsCachePath);
      }

      // Check environment variable overrides
      if (process.env.GATEWAY_PORT) {
        config.server.port = parseInt(process.env.GATEWAY_PORT, 10);
      }
      if (process.env.GATEWAY_API_KEY) {
        config.server.apiKey = process.env.GATEWAY_API_KEY;
      }
      if (process.env.GOOGLE_ACCOUNTS_PATH) {
        config.providers.google.accountsPath = resolvePath(process.env.GOOGLE_ACCOUNTS_PATH);
      }
      if (process.env.CODEX_AUTH_PATH) {
        config.providers.codex.authPath = resolvePath(process.env.CODEX_AUTH_PATH);
      }
      if (process.env.CODEX_BASE_URL) {
        config.providers.codex.baseURL = process.env.CODEX_BASE_URL;
      }

      return config;
    }
  } catch (err: any) {
    console.warn(`[Config] Failed to read ${configPath}, using defaults:`, err.message);
  }

  return DEFAULT_CONFIG;
}
