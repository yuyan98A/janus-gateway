export const styles = `
  :root {
    color-scheme: dark;

    /* Base Surfaces - Obsidian Tactical */
    --bg-canvas: #07080b;
    --bg-chassis: #0c0e14;
    --bg-panel: #11141c;
    --bg-panel-hover: #161b26;
    --bg-surface-elevated: #1a202e;
    --bg-input: #090b10;

    /* Structural Hairlines */
    --border-hairline: rgba(255, 255, 255, 0.05);
    --border-subtle: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(255, 255, 255, 0.15);
    --border-focus: #22d3ee;

    /* High-Precision Typography */
    --text-pure: #f8fafc;
    --text-main: #f1f5f9;
    --text-sub: #94a3b8;
    --text-muted: #64748b;

    /* Gateway Core Accent - Technical Cyan-Ice */
    --primary: #0891b2;
    --primary-hover: #06b6d4;
    --primary-bright: #22d3ee;
    --primary-glow: rgba(34, 211, 238, 0.18);
    --primary-subtle: rgba(8, 145, 178, 0.12);
    --primary-border: rgba(34, 211, 238, 0.28);

    /* Google Antigravity Channel - Crisp Emerald */
    --google-accent: #10b981;
    --google-text: #34d399;
    --google-subtle: rgba(16, 185, 129, 0.08);
    --google-border: rgba(16, 185, 129, 0.25);
    --google-glow: rgba(16, 185, 129, 0.15);

    /* Codex Compute Channel - Deep Sky Blue */
    --codex-accent: #0284c7;
    --codex-text: #38bdf8;
    --codex-subtle: rgba(56, 189, 248, 0.08);
    --codex-border: rgba(56, 189, 248, 0.25);
    --codex-glow: rgba(56, 189, 248, 0.15);

    /* Diagnostic States */
    --success: #10b981;
    --success-text: #34d399;
    --success-subtle: rgba(16, 185, 129, 0.08);
    --success-border: rgba(16, 185, 129, 0.25);

    --warning: #f59e0b;
    --warning-text: #fbbf24;
    --warning-subtle: rgba(245, 158, 11, 0.08);
    --warning-border: rgba(245, 158, 11, 0.25);

    --danger: #ef4444;
    --danger-text: #f87171;
    --danger-subtle: rgba(239, 68, 68, 0.08);
    --danger-border: rgba(239, 68, 68, 0.25);

    /* Legacy Compatibility Aliases */
    --card-border: var(--border-subtle);
    --card-bg: var(--bg-panel);
    --card-bg-hover: var(--bg-panel-hover);
    --bg-subtle: var(--bg-chassis);

    --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Consolas, monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* Custom Engineering Scrollbars */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  body {
    background-color: var(--bg-canvas);
    background-image:
      linear-gradient(to right, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
    background-size: 32px 32px;
    background-attachment: fixed;
    color: var(--text-main);
    font-family: var(--font-sans);
    line-height: 1.5;
    margin: 0;
    padding: 0;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Application Two-Column Layout */
  .app-layout {
    display: flex;
    min-height: 100vh;
    width: 100%;
  }

  /* Tactical Sidebar */
  .app-sidebar {
    width: 260px;
    min-width: 260px;
    flex: 0 0 260px;
    background: var(--bg-chassis);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    padding: 20px 14px;
    z-index: 40;
  }

  .sidebar-top {
    display: flex;
    flex-direction: column;
  }

  .sidebar-brand {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 4px 14px;
    border-bottom: 1px solid var(--border-hairline);
  }

  .brand-eyebrow {
    color: var(--primary-bright);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    display: flex;
    align-items: center;
    gap: 5px;
    text-transform: uppercase;
  }

  .brand-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-pure);
  }

  .brand-title h1 {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.3px;
    line-height: 1.3;
  }

  .brand-tag-row {
    margin-top: 2px;
  }

  .brand-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--primary-subtle);
    color: var(--primary-bright);
    border: 1px solid var(--primary-border);
    letter-spacing: 0.05em;
    font-family: var(--font-mono);
    display: inline-block;
  }

  .sidebar-status-box {
    margin-top: 12px;
    padding: 8px 10px;
    background: var(--bg-panel);
    border: 1px solid var(--border-hairline);
    border-radius: 6px;
  }

  /* Sidebar Navigation */
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 16px;
  }

  .nav-section-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0 8px 6px;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    border-radius: 6px;
    color: var(--text-sub);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    border: 1px solid transparent;
    position: relative;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .nav-link:hover {
    color: var(--text-pure);
    background: rgba(255, 255, 255, 0.035);
  }

  .nav-link.active {
    background: var(--bg-panel);
    color: var(--text-pure);
    border-color: var(--border-subtle);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .nav-link.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    background: var(--primary-bright);
    border-radius: 0 2px 2px 0;
    box-shadow: 0 0 8px var(--primary-bright);
  }

  .nav-link .icon {
    color: var(--text-muted);
    transition: color 0.15s ease;
  }

  .nav-link:hover .icon,
  .nav-link.active .icon {
    color: var(--primary-bright);
  }

  /* Sidebar Footer */
  .sidebar-footer {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--border-hairline);
  }

  .sidebar-node-chip {
    background: var(--bg-panel);
    border: 1px solid var(--border-hairline);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .sidebar-node-chip .node-label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 2px;
  }

  .sidebar-node-chip code {
    color: #cbd5e1;
    font-family: var(--font-mono);
    font-size: 11px;
    word-break: break-all;
  }

  .sidebar-refresh-btn {
    width: 100%;
    margin-top: 8px;
  }

  /* Main Workspace */
  .main-wrapper {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* Top Breadcrumb & Quick Action Bar */
  .app-topbar {
    height: 52px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 28px;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(7, 8, 11, 0.85);
    backdrop-filter: blur(16px);
    position: sticky;
    top: 0;
    z-index: 30;
  }

  .topbar-breadcrumbs {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-sub);
  }

  .crumb-root {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }

  .crumb-separator {
    color: var(--border-subtle);
    font-size: 11px;
  }

  .crumb-current {
    color: var(--text-pure);
    font-weight: 600;
  }

  .topbar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .content-body {
    flex: 1;
    padding: 24px 28px 40px;
    max-width: 1440px;
    width: 100%;
    margin: 0 auto;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .tabular-nums {
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
  }

  button, a, select, input, textarea {
    touch-action: manipulation;
  }

  :focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .icon {
    display: inline-block;
    vertical-align: -0.15em;
    flex-shrink: 0;
  }

  .node-chip {
    font-size: 12px;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-chassis);
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-hairline);
  }

  .node-chip code {
    color: #cbd5e1;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .service-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-chassis);
    color: var(--text-sub);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  .service-status[data-state="online"] {
    color: var(--success-text);
    border-color: var(--success-border);
    background: var(--success-subtle);
  }

  .service-status[data-state="offline"] {
    color: var(--danger-text);
    border-color: var(--danger-border);
    background: var(--danger-subtle);
  }

  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
    animation: statusPulse 2.4s infinite ease-in-out;
  }

  @keyframes statusPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  .page-title {
    margin: 0 0 20px;
  }

  .page-title h2 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.3px;
    color: var(--text-pure);
  }

  .page-title p {
    color: var(--text-sub);
    margin-top: 4px;
    font-size: 13px;
  }

  /* Grid System */
  .grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 16px;
    margin-bottom: 20px;
  }

  .col-12 { grid-column: span 12; }
  .col-8  { grid-column: span 8; }
  .col-6  { grid-column: span 6; }
  .col-4  { grid-column: span 4; }

  /* Milled Telemetry Cards */
  .card {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 20px;
    position: relative;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .card-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-pure);
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .card-title-text {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    letter-spacing: -0.2px;
  }

  /* Metric Bank (Stat Rows) */
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .stat-item {
    background: var(--bg-chassis);
    padding: 14px 16px;
    border-radius: 8px;
    border: 1px solid var(--border-hairline);
    position: relative;
    overflow: hidden;
  }

  .stat-item::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.3), transparent);
  }

  .stat-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }

  .stat-value {
    font-size: 20px;
    font-weight: 700;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.5px;
    color: var(--text-pure);
    overflow-wrap: anywhere;
  }

  .stat-hint {
    color: var(--text-sub);
    font-size: 11px;
    margin-top: 4px;
    line-height: 1.4;
  }

  /* Compact Status Strip */
  .status-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 10px 16px;
    margin-bottom: 18px;
    flex-wrap: wrap;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .status-strip-group {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .status-strip-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-sub);
  }

  .status-strip-item strong {
    color: var(--text-pure);
    font-weight: 600;
  }

  .status-strip-divider {
    width: 1px;
    height: 14px;
    background: var(--border-hairline);
  }

  /* Quota Progress Bar */
  .quota-track {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 999px;
    overflow: hidden;
    position: relative;
    margin: 8px 0 6px;
  }

  .quota-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .quota-fill-google {
    background: linear-gradient(90deg, #059669, #34d399);
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
  }

  .quota-fill-codex {
    background: linear-gradient(90deg, #0284c7, #38bdf8);
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
  }

  /* Alert / Anomaly Banner */
  .alert-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 8px;
    margin-top: 18px;
    font-size: 13px;
    transition: all 0.2s ease;
  }

  .alert-banner.state-normal {
    background: var(--bg-chassis);
    border: 1px solid var(--border-hairline);
    color: var(--text-sub);
  }

  .alert-banner.state-normal .alert-title {
    color: var(--success-text);
    font-weight: 500;
  }

  .alert-banner.state-anomaly {
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid var(--warning-border);
    color: var(--warning-text);
  }

  .alert-banner.state-anomaly .alert-title {
    color: var(--warning-text);
    font-weight: 600;
  }

  .alert-banner-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .alert-banner-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    color: var(--text-sub);
    font-size: 12px;
  }

  /* Home Channel Navigation Cards */
  .home-links {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }

  .home-link {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 125px;
    padding: 18px 20px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-panel);
    color: var(--text-main);
    text-decoration: none;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    transition: transform 0.15s ease, border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
    position: relative;
  }

  .home-link:hover {
    transform: translateY(-2px);
    border-color: var(--border-strong);
    background: var(--bg-panel-hover);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 20px -2px rgba(0, 0, 0, 0.6);
  }

  .home-link-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .home-link-icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: var(--bg-chassis);
    border: 1px solid var(--border-hairline);
    color: var(--primary-bright);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  }

  .home-link-arrow {
    color: var(--text-muted);
    transition: transform 0.15s ease, color 0.15s ease;
  }

  .home-link:hover .home-link-arrow {
    color: var(--primary-bright);
    transform: translate(2px, -2px);
  }

  .home-link strong {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-pure);
    margin-bottom: 4px;
  }

  .home-link span {
    color: var(--text-sub);
    font-size: 12px;
    line-height: 1.4;
  }

  .section-anchor {
    scroll-margin-top: 76px;
  }

  /* Tactical Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 13px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
  }

  .btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .btn-primary {
    background: #0e7490;
    border: 1px solid #22d3ee;
    color: #ffffff;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 2px 8px var(--primary-glow);
  }

  .btn-primary:hover:not(:disabled) {
    background: #0891b2;
    border-color: #67e8f9;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 4px 12px var(--primary-glow);
  }

  .btn-secondary {
    background: var(--bg-chassis);
    color: #cbd5e1;
    border: 1px solid var(--border-subtle);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-surface-elevated);
    border-color: var(--border-strong);
    color: var(--text-pure);
  }

  .btn-danger {
    background: var(--danger-subtle);
    color: var(--danger-text);
    border: 1px solid var(--danger-border);
  }

  .btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .btn-sm {
    padding: 3px 9px;
    font-size: 12px;
    border-radius: 5px;
  }

  /* Form Inputs & Selects */
  select, input, textarea {
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    color: var(--text-main);
    border-radius: 6px;
    padding: 6px 11px;
    font-size: 13px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  select:focus-visible, input:focus-visible, textarea:focus-visible {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px var(--primary-glow), inset 0 1px 2px rgba(0, 0, 0, 0.4);
  }

  /* Data Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  th {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--border-hairline);
    vertical-align: middle;
    font-variant-numeric: tabular-nums;
    color: #e2e8f0;
  }

  tbody tr {
    transition: background-color 0.12s ease;
  }

  tbody tr:hover td {
    background-color: rgba(255, 255, 255, 0.025);
  }

  tr:last-child td {
    border-bottom: none;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .table-sort {
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: color 0.15s ease;
  }

  .table-sort:hover {
    color: var(--text-pure);
  }

  /* Status Badges */
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
  }

  .tag-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .tag-active {
    background: var(--success-subtle);
    color: var(--success-text);
    border: 1px solid var(--success-border);
  }

  .tag-cooling {
    background: var(--warning-subtle);
    color: var(--warning-text);
    border: 1px solid var(--warning-border);
  }

  .tag-disabled {
    background: rgba(148, 163, 184, 0.06);
    color: var(--text-sub);
    border: 1px solid rgba(148, 163, 184, 0.15);
  }

  .tag-invalid {
    background: var(--danger-subtle);
    color: var(--danger-text);
    border: 1px solid var(--danger-border);
  }

  .tag-test-passed {
    background: var(--success-subtle);
    color: var(--success-text);
    border: 1px solid var(--success-border);
  }

  .tag-test-failed {
    background: var(--danger-subtle);
    color: var(--danger-text);
    border: 1px solid var(--danger-border);
  }

  .tag-test-running {
    background: var(--primary-subtle);
    color: var(--primary-bright);
    border: 1px solid var(--primary-border);
  }

  /* Request ID Cell Chip */
  .request-id-cell {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 210px;
    background: var(--bg-input);
    border: 1px solid var(--border-hairline);
    padding: 2px 6px;
    border-radius: 5px;
  }

  .request-id-text {
    display: inline-block;
    max-width: 145px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    font-family: var(--font-mono);
    color: #94a3b8;
    font-size: 11px;
  }

  .copy-id-btn {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: var(--bg-chassis);
    color: var(--text-sub);
    cursor: pointer;
    font-size: 10px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .copy-id-btn:hover {
    color: var(--text-pure);
    background: var(--bg-surface-elevated);
  }

  /* Filter Toolbars */
  .filter-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }

  .filter-toolbar input[type="search"] {
    min-width: 200px;
  }

  /* Log Detail Panel */
  .log-detail-panel {
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-chassis);
  }

  .log-detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
  }

  .log-detail-event {
    border: 1px solid var(--border-hairline);
    border-radius: 6px;
    margin: 8px 0;
    background: var(--bg-input);
  }

  .log-detail-event summary {
    cursor: pointer;
    padding: 8px 12px;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 500;
  }

  .log-detail-event pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 540px;
    overflow: auto;
    padding: 12px;
    border-top: 1px solid var(--border-hairline);
    font-size: 11px;
    color: #cbd5e1;
    font-family: var(--font-mono);
    background: #050609;
  }

  /* Usage Trend Chart */
  .usage-chart {
    height: 165px;
    display: flex;
    align-items: end;
    gap: 8px;
    padding: 10px 4px 8px;
    border-bottom: 1px solid var(--border-subtle);
    overflow-x: auto;
    overscroll-behavior: contain;
  }

  .usage-day-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    height: 100%;
    justify-content: flex-end;
    min-width: 28px;
  }

  .usage-day-label {
    color: var(--text-muted);
    font-size: 10px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .usage-bar {
    min-width: 6px;
    flex: 1;
    background: linear-gradient(180deg, #22d3ee, #0891b2);
    border-radius: 3px 3px 0 0;
    box-shadow: 0 0 10px var(--primary-glow);
    transition: height 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .usage-bar:hover {
    background: linear-gradient(180deg, #67e8f9, #06b6d4);
  }

  /* Code Boxes */
  pre {
    margin: 0;
  }

  .code-box {
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 14px 16px;
    font-size: 12px;
    position: relative;
    overflow-x: auto;
    margin-top: 8px;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  }

  .copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: var(--bg-chassis);
    color: #cbd5e1;
    border: 1px solid var(--border-subtle);
    padding: 3px 8px;
    border-radius: 5px;
    font-size: 11px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .copy-btn:hover {
    background: var(--bg-surface-elevated);
    color: var(--text-pure);
  }

  /* Playground */
  .playground-box {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .response-area {
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 14px;
    font-size: 13px;
    min-height: 120px;
    max-height: 320px;
    overflow-y: auto;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    color: #e2e8f0;
    line-height: 1.6;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  /* Native Dialogs */
  dialog {
    margin: auto;
    border: none;
    background: transparent;
    padding: 0;
    color: inherit;
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(6px);
  }

  .modal-box {
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    padding: 22px;
    width: 480px;
    max-width: 90vw;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 20px 40px rgba(0, 0, 0, 0.75);
  }

  /* Toast Stack */
  .toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 360px;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 11px 13px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 10px 25px rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    color: var(--text-pure);
    animation: toastEnter 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes toastEnter {
    from { opacity: 0; transform: translateY(-8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .toast-icon {
    flex: 0 0 auto;
    margin-top: 1px;
  }

  .toast-content {
    flex: 1;
    line-height: 1.4;
  }

  .toast-close {
    flex: 0 0 auto;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 2px;
    transition: color 0.15s ease;
  }

  .toast-close:hover {
    color: var(--text-pure);
  }

  /* Responsive Design - Tablet & Mobile */
  @media (max-width: 900px) {
    .app-layout {
      flex-direction: column;
    }

    .app-sidebar {
      width: 100%;
      min-width: 0;
      flex: 0 0 auto;
      height: auto;
      position: static;
      border-right: none;
      border-bottom: 1px solid var(--border-subtle);
      padding: 14px 16px;
    }

    .sidebar-brand {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      border-bottom: none;
      padding-bottom: 8px;
    }

    .sidebar-status-box {
      display: none;
    }

    .sidebar-nav {
      flex-direction: row;
      overflow-x: auto;
      padding-bottom: 4px;
      margin-top: 6px;
      gap: 4px;
    }

    .nav-section-label {
      display: none;
    }

    .nav-link {
      flex: 0 0 auto;
      white-space: nowrap;
      padding: 6px 11px;
    }

    .nav-link.active::before {
      display: none;
    }

    .nav-link.active::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 15%;
      right: 15%;
      height: 2px;
      background: var(--primary-bright);
      border-radius: 1px;
    }

    .sidebar-footer {
      display: none;
    }

    .app-topbar {
      padding: 0 16px;
      height: 46px;
    }

    .content-body {
      padding: 16px 16px 32px;
    }
  }

  @media (max-width: 720px) {
    .col-8, .col-6, .col-4 { grid-column: span 12; }
    .card { padding: 16px; }
    .card-title { flex-direction: column; align-items: flex-start; gap: 10px; }
    .card-title > div { width: 100%; }
    .filter-toolbar input[type="search"] { min-width: 0; flex: 1 1 100%; width: 100%; }
    .filter-toolbar select { flex: 1 1 45%; }
  }

  /* Prefers Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;
