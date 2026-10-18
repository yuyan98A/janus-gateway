/**
 * Backward compatibility facade for web dashboard ingress.
 * Re-exports modular implementation from ./web/index.ts
 */
export { handleWeb, DASHBOARD_PAGES, DASHBOARD_PAGE_ROUTES, getDashboardHtml } from './web/index.ts';
export type { DashboardPage, DashboardRoute } from './web/types.ts';
