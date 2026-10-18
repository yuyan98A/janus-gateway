import type { DashboardPage } from '../types.ts';
import { coreScript } from './core.ts';
import { gatewayScript } from './gateway.ts';
import { usageScript } from './usage.ts';
import { requestsScript } from './requests.ts';
import { accountsScript } from './accounts.ts';
import { codexScript } from './codex.ts';
import { modelsScript } from './models.ts';
import { playgroundScript } from './playground.ts';

export interface ClientScriptOptions {
  defaultApiKey: string;
  page: DashboardPage;
}

export function getClientScript(options: ClientScriptOptions): string {
  const { defaultApiKey, page } = options;

  return `
  // --- Injected Gateway Configuration ---
  const API_KEY = ${JSON.stringify(defaultApiKey)};
  const DASHBOARD_PAGE = ${JSON.stringify(page)};

  ${coreScript}

  ${gatewayScript}

  ${usageScript}

  ${requestsScript}

  ${accountsScript}

  ${codexScript}

  ${modelsScript}

  ${playgroundScript}

  // --- Client Application Initialization & Deep Linking ---
  initUsageFiltersFromUrl();
  initRequestsFiltersFromUrl();
  initModelsFiltersFromUrl();
  checkOAuthRedirect();

  // Load the initial data for the current route
  refreshCurrentPage();

  // Background Polling Tasks
  if (DASHBOARD_PAGE === 'google-accounts') {
    setInterval(loadAccounts, 5000);
  }
  if (DASHBOARD_PAGE === 'home' || DASHBOARD_PAGE === 'usage') {
    setInterval(refreshRequestAnalytics, 30000);
  }
  setInterval(refreshGatewayHealth, 30000);
  `;
}
