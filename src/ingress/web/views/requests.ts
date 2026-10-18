import { icon } from '../icons.ts';

export function renderRequestsView(): string {
  return `
    <div class="grid">
      <div class="col-12">
        <div class="card section-anchor" id="request-logs-panel">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('log', 18)}
              <span>全链路请求日志追踪 (Telemetry Traces)</span>
            </span>
            <button class="btn btn-secondary btn-sm" onclick="loadRequestLogs()" aria-label="重新拉取请求日志">
              ${icon('refresh', 13)}
              <span>刷新日志</span>
            </button>
          </div>

          <div class="filter-toolbar">
            <input type="search" id="log-request-id" placeholder="按请求 ID 检索…" style="min-width: 220px;" aria-label="按请求 ID 搜索" onkeydown="if(event.key==='Enter')loadRequestLogs()">
            <input type="search" id="log-model" placeholder="按模型名称检索…" style="min-width: 170px;" aria-label="按模型名称搜索" onkeydown="if(event.key==='Enter')loadRequestLogs()">
            <select id="log-provider" aria-label="按上游提供商筛选">
              <option value="">全部上游专线</option>
              <option value="codex">Codex 算力专线</option>
              <option value="google">Google Antigravity</option>
            </select>
            <select id="log-result" aria-label="按执行结果筛选">
              <option value="">全部状态</option>
              <option value="success">成功 (200)</option>
              <option value="error">异常 (Error)</option>
              <option value="interrupted">流式中断 (Interrupted)</option>
            </select>
            <button class="btn btn-primary btn-sm" onclick="loadRequestLogs()" aria-label="执行筛选">
              ${icon('filter', 13)}
              <span>应用筛选</span>
            </button>
          </div>

          <div class="filter-toolbar" style="margin-bottom: 16px;">
            <label for="logs-from" class="stat-hint" style="margin-top: 0; color: var(--text-muted);">UTC 时间范围:</label>
            <input type="date" id="logs-from" aria-label="开始日期（UTC）" onchange="requestLogDateChanged()">
            <span class="stat-hint" style="margin-top: 0;" aria-hidden="true">至</span>
            <input type="date" id="logs-to" aria-label="结束日期（UTC）" onchange="requestLogDateChanged()">
          </div>

          <div class="table-wrap">
            <table>
              <caption class="sr-only">网关请求日志详细追踪记录</caption>
              <thead>
                <tr>
                  <th scope="col">时间戳 (UTC)</th>
                  <th scope="col">请求 ID</th>
                  <th scope="col">专线 / 目标模型</th>
                  <th scope="col">交付状态</th>
                  <th scope="col">链路耗时</th>
                  <th scope="col">输入 / 输出 Token</th>
                  <th scope="col" style="text-align: right;">操作</th>
                </tr>
              </thead>
              <tbody id="request-logs-tbody">
                <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">加载请求日志中…</td></tr>
              </tbody>
            </table>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; flex-wrap: wrap; gap: 10px;">
            <span id="request-logs-count" class="tabular-nums" style="font-size: 12px; color: var(--text-muted);" role="status" aria-live="polite"></span>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" id="logs-prev" onclick="changeLogPage(-1)" aria-label="上一页日志">上一页</button>
              <button class="btn btn-secondary btn-sm" id="logs-next" onclick="changeLogPage(1)" aria-label="下一页日志">下一页</button>
            </div>
          </div>

          <div id="request-log-detail" class="log-detail-panel" role="region" aria-live="polite" style="margin-top: 16px; display: none;"></div>
        </div>
      </div>
    </div>
  `;
}
