import { icon } from '../icons.ts';

export function renderHomeView(): string {
  return `
    <!-- Plate 1: Compact Gateway Runtime Status Strip -->
    <div class="status-strip section-anchor" id="overview">
      <div class="status-strip-group">
        <div class="status-strip-item">
          <span class="service-status" id="strip-service-status" data-state="checking">
            <span class="pulse-dot" aria-hidden="true"></span>
            <span id="strip-status-text">正在检查…</span>
          </span>
        </div>
        <div class="status-strip-divider"></div>
        <div class="status-strip-item">
          <span>工作进程:</span>
          <strong id="strip-pid" class="tabular-nums">PID —</strong>
          <span style="color: var(--text-muted); font-size: 11px;">(<span id="strip-mode">Cluster Worker</span>)</span>
        </div>
        <div class="status-strip-divider"></div>
        <div class="status-strip-item">
          <span>连续运行:</span>
          <strong id="strip-uptime" class="tabular-nums">—</strong>
        </div>
      </div>

      <div class="status-strip-group">
        <div class="status-strip-item">
          <span>活跃长连接:</span>
          <strong id="strip-inflight" class="tabular-nums" style="color: var(--primary-bright);">0</strong>
          <span style="font-size: 11px; color: var(--text-muted);">In-Flight</span>
        </div>
        <div class="status-strip-divider"></div>
        <div class="status-strip-item">
          <span>堆内存:</span>
          <strong id="strip-mem" class="tabular-nums">—</strong>
        </div>
        <div class="status-strip-divider"></div>
        <button class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;" onclick="refreshCurrentPage()" aria-label="刷新状态">
          ${icon('refresh', 11)}
          <span>刷新</span>
        </button>
      </div>
    </div>

    <!-- Plate 2: Dual Upstream Pipelines Lifeline & Quota (C 位算力生命线) -->
    <div class="grid">
      <!-- 1. Google Antigravity Lifeline -->
      <div class="col-6">
        <div class="card" style="border-top: 2px solid var(--google-accent); height: 100%; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div class="card-title" style="margin-bottom: 14px;">
              <span class="card-title-text" style="color: var(--google-text);">
                ${icon('globe', 16)}
                <span>Google Antigravity 专线生命线</span>
              </span>
              <span class="tag tag-active" id="home-google-tag">
                <span class="tag-dot"></span>
                <span id="home-google-status">专线检测中…</span>
              </span>
            </div>

            <!-- Account Pool Status -->
            <div style="background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">账号池状态</span>
                <span id="home-google-accounts-count" class="tabular-nums" style="font-size: 12px; font-weight: 600; color: var(--text-pure);">读取中…</span>
              </div>
              <div id="home-google-accounts-detail" style="font-size: 12px; color: var(--text-sub);">正在读取账号健康与轮换策略…</div>
            </div>

            <!-- Google Upstream Quotas Section (All Models) -->
            <div style="background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">专线上游全模型配额 (All Models Quota)</span>
                <span id="home-google-quota-summary-tag" class="tabular-nums" style="font-size: 11px; color: var(--google-text);">自动同步中…</span>
              </div>
              <div id="home-google-quota-list" style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 12px; color: var(--text-sub); text-align: center; padding: 12px;">正在探测 Google 上游全模型配额…</div>
              </div>
              <div id="home-google-more-wrapper" style="display: none; margin-top: 8px; border-top: 1px dashed var(--border-hairline); padding-top: 8px;">
                <div id="home-google-more-list" style="display: none; flex-direction: column; gap: 8px; margin-bottom: 6px;"></div>
                <div style="text-align: center;">
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 2px 10px;" onclick="toggleHomeGoogleMore()" id="btn-home-google-more">
                    展开其余全部模型配额 ▼
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border-hairline);">
            <a href="/google-accounts" class="btn btn-secondary btn-sm" style="flex: 1; text-decoration: none;">
              ${icon('users', 13)}
              <span>Google 账号池</span>
            </a>
            <button class="btn btn-primary btn-sm" onclick="startOAuthLogin()" aria-label="跳转 Google 授权">
              ${icon('external', 13)}
              <span>快速授权跳转</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 2. OpenAI Codex Compute Lifeline -->
      <div class="col-6">
        <div class="card" style="border-top: 2px solid var(--codex-accent); height: 100%; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div class="card-title" style="margin-bottom: 14px;">
              <span class="card-title-text" style="color: var(--codex-text);">
                ${icon('key', 16)}
                <span>OpenAI Codex 算力专线生命线</span>
              </span>
              <span class="tag tag-active" id="home-codex-tag" style="background: var(--codex-subtle); color: var(--codex-text); border-color: var(--codex-border);">
                <span class="tag-dot"></span>
                <span id="home-codex-status">专线检测中…</span>
              </span>
            </div>

            <!-- Auth Status -->
            <div style="background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">本地登录态与凭据</span>
                <span id="home-codex-auth-badge" class="tabular-nums" style="font-size: 12px; font-weight: 600; color: var(--codex-text);">读取中…</span>
              </div>
              <div id="home-codex-auth-detail" style="font-size: 12px; color: var(--text-sub);">正在读取 ~/.codex/auth.json 会话状态…</div>
            </div>

            <!-- Subscription Quota Windows (All Windows) -->
            <div style="background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">订阅使用窗口全景 (All Windows)</span>
                <span id="home-codex-plan-tag" class="tabular-nums" style="font-size: 11px; color: var(--codex-text);">自动同步中…</span>
              </div>
              <div id="home-codex-quota-list" style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 12px; color: var(--text-sub); text-align: center; padding: 12px;">正在获取 Codex 订阅配额窗口…</div>
              </div>
              <div id="home-codex-extra-hint" style="font-size: 11px; color: var(--text-muted); line-height: 1.4; margin-top: 6px; border-top: 1px dashed var(--border-hairline); padding-top: 6px;">
                显示 5 小时会话与周周期所有使用窗口 · gpt-6.1-sol / gpt-6-astra 消耗 ChatGPT 订阅算力
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border-hairline);">
            <a href="/codex" class="btn btn-secondary btn-sm" style="flex: 1; text-decoration: none;">
              ${icon('key', 13)}
              <span>Codex 账号与额度</span>
            </a>
            <button class="btn btn-primary btn-sm" id="btn-home-codex-check" onclick="checkCodexConnection()" aria-label="检查上游真实连接">
              ${icon('activity', 13)}
              <span>检查真实连接</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Plate 3: Today's Requests & Token Throughput (今日调用与吞吐小结) -->
    <div class="grid">
      <div class="col-12">
        <div class="card">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('chart', 16)}
              <span>今日调用吞吐与交付表现 (Today's Telemetry Summary)</span>
            </span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">UTC 日期统计</span>
              <a href="/usage" class="btn btn-secondary btn-sm" style="text-decoration: none; font-size: 11px; padding: 2px 7px;">
                <span>详细用量走势 →</span>
              </a>
            </div>
          </div>

          <div class="stat-row" style="grid-template-columns: repeat(4, 1fr);">
            <div class="stat-item">
              <div class="stat-label">今日请求量</div>
              <div class="stat-value tabular-nums" id="home-today-requests">0</div>
              <div class="stat-hint">已调度流式与单次调用</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">交付成功率</div>
              <div class="stat-value tabular-nums" id="home-today-success">—</div>
              <div class="stat-hint">完成流式交付请求占比</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">Token 吞吐 (输入 / 输出)</div>
              <div class="stat-value tabular-nums" id="home-today-tokens" style="font-size: 16px;">0 / 0</div>
              <div class="stat-hint">上游厂商实报计费 Token 汇总</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">异常与中断次数</div>
              <div class="stat-value tabular-nums" id="home-today-errors" style="color: var(--success-text);">0</div>
              <div class="stat-hint" id="home-today-errors-hint">今日无报错与中断</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Plate 4: Recent Anomaly & Health Horizon Banner (最近异常与健康横幅) -->
    <div id="home-alert-banner" class="alert-banner state-normal">
      <div class="alert-banner-left">
        <span id="home-alert-icon" style="color: var(--success-text);">${icon('checkCircle', 18)}</span>
        <div>
          <span class="alert-title" id="home-alert-title">全系统专线运行正常</span>
          <span class="alert-banner-desc" id="home-alert-desc">今日全链路请求平稳交付，双专线状态健康，无未捕获异常。</span>
        </div>
      </div>
      <div>
        <a href="/requests" id="home-alert-action" class="btn btn-secondary btn-sm" style="text-decoration: none; font-size: 11px; padding: 3px 9px;">
          <span>查看全链路日志 →</span>
        </a>
      </div>
    </div>
  `;
}
