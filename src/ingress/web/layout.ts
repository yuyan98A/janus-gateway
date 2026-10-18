import { styles } from './styles.ts';
import { DASHBOARD_PAGES, type DashboardPage } from './types.ts';
import { icon } from './icons.ts';

export interface LayoutOptions {
  host: string;
  port: number;
  page: DashboardPage;
  pageTitle: string;
  pageDescription: string;
  content: string;
  extraModals?: string;
  clientScript: string;
}

export function renderLayout(options: LayoutOptions): string {
  const { host, port, page, pageTitle, pageDescription, content, extraModals = '', clientScript } = options;

  const navItems = Object.entries(DASHBOARD_PAGES).map(([href, item]) => {
    const isActive = item.id === page;
    const itemIcon = icon(item.icon, 15, isActive ? 'icon active' : 'icon text-sub');
    return `<a class="nav-link${isActive ? ' active' : ''}" href="${href}"${isActive ? ' aria-current="page"' : ''}>${itemIcon}<span>${item.title}</span></a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#07080b">
  <title>${pageTitle} · Virtual Model Gateway</title>
  <style>
${styles}
  </style>
</head>
<body>
  <div class="app-layout">
    <!-- Tactical Sidebar Telemetry Deck -->
    <aside class="app-sidebar" aria-label="网关管理侧边导航">
      <div class="sidebar-top">
        <div class="sidebar-brand">
          <div class="brand-eyebrow">
            ${icon('activity', 12)}
            <span>GATEWAY CONSOLE</span>
          </div>
          <div class="brand-title">
            ${icon('server', 18)}
            <h1>Virtual Model Provider Gateway</h1>
          </div>
          <div class="brand-tag-row">
            <span class="brand-badge">CLUSTER DUAL-PIPELINE</span>
          </div>
        </div>

        <div class="sidebar-status-box">
          <span class="service-status" id="service-status" data-state="checking">
            <span class="pulse-dot" aria-hidden="true"></span>
            <span id="service-status-text">正在检查服务…</span>
          </span>
        </div>

        <nav class="sidebar-nav" aria-label="控制台区域导航">
          <div class="nav-section-label">调度与管理通道</div>
          ${navItems}
        </nav>
      </div>

      <div class="sidebar-footer">
        <div class="sidebar-node-chip">
          <span class="node-label">网关端点</span>
          <code>http://${host}:${port}</code>
        </div>
        <button class="btn btn-secondary btn-sm sidebar-refresh-btn" onclick="refreshCurrentPage()" aria-label="刷新当前页面数据">
          ${icon('refresh', 13)}
          <span>刷新本页数据</span>
        </button>
      </div>
    </aside>

    <!-- Main Workspace Area -->
    <div class="main-wrapper">
      <header class="app-topbar">
        <div class="topbar-breadcrumbs">
          <span class="crumb-root">${icon('server', 14)} 网关调度中枢</span>
          <span class="crumb-separator">/</span>
          <span class="crumb-current">${pageTitle}</span>
        </div>
        <div class="topbar-actions">
          <div class="node-chip">
            <span>端点:</span>
            <code>http://${host}:${port}</code>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="refreshCurrentPage()" aria-label="刷新当前页面数据">
            ${icon('refresh', 13)}
            <span>刷新</span>
          </button>
        </div>
      </header>

      <main class="content-body">
        <div class="page-title">
          <h2>${pageTitle}</h2>
          <p>${pageDescription}</p>
        </div>
        ${content}
      </main>
    </div>
  </div>

  <!-- Toast Notification Stack -->
  <div id="toast-container" class="toast-container" role="region" aria-label="系统通知"></div>

  <!-- Universal Confirmation Dialog -->
  <dialog id="confirm-modal" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-desc">
    <div class="modal-box">
      <h3 id="confirm-modal-title" style="font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        ${icon('alertCircle', 16)}
        <span>操作确认</span>
      </h3>
      <p id="confirm-modal-desc" style="font-size: 13px; color: var(--text-sub); margin-bottom: 20px; line-height: 1.5;"></p>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary btn-sm" id="confirm-modal-cancel" type="button">取消</button>
        <button class="btn btn-primary btn-sm" id="confirm-modal-confirm" type="button">确认执行</button>
      </div>
    </div>
  </dialog>

  ${extraModals}

  <script>
${clientScript}
  </script>
</body>
</html>`;
}
