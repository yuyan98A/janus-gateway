import { icon } from '../icons.ts';

export function renderModelsView(): string {
  return `
    <div class="grid">
      <div class="col-12">
        <div class="card section-anchor" id="models">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('box', 18)}
              <span>可用模型矩阵与调度目录 (Models Hub)</span>
            </span>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);" id="models-count" class="tabular-nums"></span>
              <span style="font-size: 12px; color: var(--text-muted);" id="models-updated-at"></span>
              <button class="btn btn-secondary btn-sm" id="btn-refresh-models" onclick="refreshAllModels()" aria-label="从上游接口拉取最新模型目录">
                ${icon('refresh', 13)}
                <span>差量刷新</span>
              </button>
              <button class="btn btn-secondary btn-sm" id="btn-probe-save-all-codex" onclick="runAllCodexEffortSetup()" aria-label="批量探测并持久化保存全部 Codex 模型推理强度">
                ${icon('activity', 13)}
                <span>探测 Codex 档位</span>
              </button>
              <button class="btn btn-primary btn-sm" id="btn-test-all-models" onclick="runAllModelTests()" aria-label="并发测试全部模型的实际可用性">
                ${icon('play', 13)}
                <span>测试全部可用性</span>
              </button>
            </div>
          </div>

          <div id="model-test-summary" role="status" aria-live="polite" style="font-size: 12px; color: var(--text-sub); margin: -4px 0 16px; padding: 10px 14px; background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 6px;">
            单模型测试可快速检查连通性；“探测 Codex 档位”会按序检查不同上游模型，每个模型最多发送 6 条探测请求并消耗少许订阅额度。
          </div>

          <div class="filter-toolbar">
            <input type="search" id="model-search" placeholder="搜索模型 ID、上游专线或功能特点…" aria-label="搜索模型 ID、上游或特点" oninput="applyModelFilters()" style="flex: 1; min-width: 220px;">
            <select id="model-category-filter" aria-label="按模型类别筛选" onchange="applyModelFilters()">
              <option value="">全部类别</option>
              <option value="chat">通用对话 (chat)</option>
              <option value="code_completion">代码补全 (code_completion)</option>
              <option value="image">图像生成 (image)</option>
              <option value="audio">语音转录 (audio)</option>
              <option value="internal">内部测试 (internal)</option>
              <option value="command">指令模型 (command)</option>
              <option value="review">代码审核 (review)</option>
            </select>
            <span class="stat-hint" style="margin-top: 0;">支持按模型 ID、分类或上游专线实时模糊过滤</span>
          </div>

          <div class="table-wrap">
            <table>
              <caption class="sr-only">可用模型与推理档位配置列表</caption>
              <thead>
                <tr>
                  <th scope="col">模型 ID (Model)</th>
                  <th scope="col">分类</th>
                  <th scope="col">算力专线</th>
                  <th scope="col">协议兼容</th>
                  <th scope="col">配置与特点</th>
                  <th scope="col">健康状态</th>
                  <th scope="col" style="text-align: right;">操作</th>
                </tr>
              </thead>
              <tbody id="models-tbody">
                <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">正在加载可用模型…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}
