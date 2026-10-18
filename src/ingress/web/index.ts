import http from 'node:http';
import type { GatewayConfig } from '../../config.ts';
import type { Dispatcher } from '../../router/dispatcher.ts';
import { DASHBOARD_PAGES, DASHBOARD_PAGE_ROUTES, type DashboardPage } from './types.ts';
import { renderLayout } from './layout.ts';
import { getClientScript } from './client/index.ts';

import { renderHomeView } from './views/home.ts';
import { renderUsageView } from './views/usage.ts';
import { renderRequestsView } from './views/requests.ts';
import { renderGoogleAccountsView, renderAddAccountModal, renderAllQuotasModal } from './views/google-accounts.ts';
import { renderCodexView } from './views/codex.ts';
import { renderModelsView } from './views/models.ts';
import { renderPlaygroundView } from './views/playground.ts';
import { renderConnectView } from './views/connect.ts';

export { DASHBOARD_PAGES, DASHBOARD_PAGE_ROUTES, type DashboardPage };

export async function handleWeb(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: GatewayConfig,
  dispatcher: Dispatcher
): Promise<void> {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  const route = pathname === '/web' ? DASHBOARD_PAGES['/'] : DASHBOARD_PAGE_ROUTES[pathname];

  if (!route) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Dashboard page not found');
    return;
  }

  const html = getDashboardHtml(config, route.id, route.title, route.description);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(html);
}

export function getDashboardHtml(
  config: GatewayConfig,
  page: DashboardPage,
  pageTitle: string,
  pageDescription: string
): string {
  const defaultApiKey = config.server.apiKey || '';
  const port = config.server.port;
  const host = config.server.host;

  let content = '';
  let extraModals = '';

  switch (page) {
    case 'home':
      content = renderHomeView();
      break;
    case 'usage':
      content = renderUsageView();
      break;
    case 'requests':
      content = renderRequestsView();
      break;
    case 'google-accounts':
      content = renderGoogleAccountsView();
      extraModals = renderAddAccountModal() + renderAllQuotasModal();
      break;
    case 'codex':
      content = renderCodexView();
      break;
    case 'models':
      content = renderModelsView();
      break;
    case 'playground':
      content = renderPlaygroundView();
      break;
    case 'connect':
      content = renderConnectView(host, port, defaultApiKey);
      break;
    default:
      content = renderHomeView();
      break;
  }

  const clientScript = getClientScript({
    defaultApiKey,
    page
  });

  return renderLayout({
    host,
    port,
    page,
    pageTitle,
    pageDescription,
    content,
    extraModals,
    clientScript
  });
}
