import { icon } from '../icons.ts';

export function renderCodexView(): string {
  return `
    <div class="grid">
      <div class="col-12">
        <div class="card section-anchor" id="codex-status" style="border-top: 2px solid var(--codex-accent);">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('key', 18)}
              <span>Codex 专线凭据与订阅额度窗口</span>
            </span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-secondary btn-sm" id="btn-refresh-codex-status" onclick="loadCodexStatus()" aria-label="刷新 Codex 状态">
                ${icon('refresh', 13)}
                <span>刷新状态</span>
              </button>
            </div>
          </div>

          <div style="background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em; margin-bottom: 8px;">本地登录态检测 (~/.codex/auth.json)</div>
            <div id="codex-account-status" style="font-size: 13px; color: var(--text-sub);" role="status" aria-live="polite">正在读取本地 Codex 会话状态…</div>
          </div>

          <div style="background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
              <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em;">订阅配额窗口 (Usage Windows)</div>
              <button class="btn btn-secondary btn-sm" id="btn-refresh-codex-usage" onclick="refreshCodexUsage()" aria-label="刷新 Codex 订阅额度窗口">
                ${icon('refresh', 12)}
                <span>刷新额度</span>
              </button>
            </div>
            <div id="codex-usage" style="font-size: 13px; color: var(--text-sub);" role="status" aria-live="polite">点击“刷新额度”读取 Codex 使用窗口。</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; line-height: 1.4;">显示上游实际额度窗口剩余百分比与重置时间点，消耗属于 ChatGPT 订阅算力，无按 Token 扣费账单。</div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" id="btn-check-codex-connection" onclick="checkCodexConnection()" aria-label="发送探测请求检查上游连接">
              ${icon('activity', 13)}
              <span>检查上游真实连接</span>
            </button>
            <span style="font-size: 11px; color: var(--text-muted);">注：真实连接检查会向上游下发一条极简测试消息，将消耗 1 次请求额度。</span>
          </div>
        </div>
      </div>
    </div>
  `;
}
