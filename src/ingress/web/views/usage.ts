import { icon } from '../icons.ts';

export function renderUsageView(): string {
  return `
    <div class="grid">
      <div class="col-12">
        <div class="card section-anchor" id="usage">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('chart', 18)}
              <span>用量统计与负载趋势 (Usage Analytics)</span>
            </span>
            <div class="filter-toolbar" style="margin: 0;">
              <select id="usage-range" aria-label="统计时间范围" onchange="applyUsageRange()">
                <option value="7">近 7 天</option>
                <option value="1">今天</option>
                <option value="30">近 30 天</option>
                <option value="all">全部历史</option>
                <option value="custom">自定义时间</option>
              </select>
              <input type="date" id="usage-from" aria-label="开始日期（UTC）" title="日期按 UTC 日志日期筛选" onchange="customUsageDateChanged()">
              <span class="stat-hint" style="margin-top: 0;" aria-hidden="true">至</span>
              <input type="date" id="usage-to" aria-label="结束日期（UTC）" title="日期按 UTC 日志日期筛选" onchange="customUsageDateChanged()">
              <button class="btn btn-secondary btn-sm" onclick="refreshRequestAnalytics()" aria-label="重新拉取统计数据">
                ${icon('refresh', 13)}
                <span>刷新统计</span>
              </button>
            </div>
          </div>

          <div id="request-index-status" role="status" aria-live="polite" style="font-size: 12px; color: var(--text-muted); margin: -6px 0 16px;">正在读取请求索引…</div>

          <div class="stat-row" style="margin-bottom: 22px; flex-wrap: wrap;">
            <div class="stat-item">
              <div class="stat-label">请求总数</div>
              <div class="stat-value tabular-nums" id="usage-requests">—</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">交付成功率</div>
              <div class="stat-value tabular-nums" id="usage-success">—</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">输入 Token（上游实报）</div>
              <div class="stat-value tabular-nums" id="usage-input-tokens">—</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">输出 Token（上游实报）</div>
              <div class="stat-value tabular-nums" id="usage-output-tokens">—</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">已返回 Token 占比</div>
              <div class="stat-value tabular-nums" id="usage-reported">—</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">异常与失败</div>
              <div class="stat-value tabular-nums" id="usage-errors" style="color: var(--danger-text);">—</div>
            </div>
          </div>

          <div class="grid" style="margin-bottom: 16px;">
            <div class="col-6">
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 10px;">每日请求吞吐量趋势</div>
              <div id="usage-chart" class="usage-chart" role="region" aria-label="每日请求趋势柱状图"></div>
            </div>
            <div class="col-6">
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 10px;">模型用量分布明细</div>
              <div class="table-wrap" style="max-height: 200px; overflow-y: auto;">
                <table>
                  <caption class="sr-only">按模型聚合的请求与 Token 用量统计</caption>
                  <thead>
                    <tr>
                      <th scope="col"><button class="table-sort" onclick="sortUsageTable('models','name')" aria-label="按模型名称排序">模型 ↕</button></th>
                      <th scope="col"><button class="table-sort" onclick="sortUsageTable('models','requests')" aria-label="按请求次数排序">请求 ↕</button></th>
                      <th scope="col"><button class="table-sort" onclick="sortUsageTable('models','inputTokens')" aria-label="按输入 Token 排序">输入 Token ↕</button></th>
                      <th scope="col"><button class="table-sort" onclick="sortUsageTable('models','outputTokens')" aria-label="按输出 Token 排序">输出 Token ↕</button></th>
                    </tr>
                  </thead>
                  <tbody id="usage-models">
                    <tr><td colspan="4" style="color: var(--text-muted); text-align: center; padding: 24px;">加载中…</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 20px 0 10px;">上游专线用量细分</div>
          <div class="table-wrap" style="max-height: 180px; overflow-y: auto;">
            <table>
              <caption class="sr-only">按上游提供商聚合的用量统计</caption>
              <thead>
                <tr>
                  <th scope="col"><button class="table-sort" onclick="sortUsageTable('providers','name')" aria-label="按上游名称排序">上游 ↕</button></th>
                  <th scope="col"><button class="table-sort" onclick="sortUsageTable('providers','requests')" aria-label="按请求次数排序">请求 ↕</button></th>
                  <th scope="col"><button class="table-sort" onclick="sortUsageTable('providers','inputTokens')" aria-label="按输入 Token 排序">输入 Token ↕</button></th>
                  <th scope="col"><button class="table-sort" onclick="sortUsageTable('providers','outputTokens')" aria-label="按输出 Token 排序">输出 Token ↕</button></th>
                </tr>
              </thead>
              <tbody id="usage-providers">
                <tr><td colspan="4" style="color: var(--text-muted); text-align: center; padding: 24px;">加载中…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}
