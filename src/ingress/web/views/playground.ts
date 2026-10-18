import { icon } from '../icons.ts';

export function renderPlaygroundView(): string {
  return `
    <div class="grid">
      <div class="col-12">
        <div class="card section-anchor" id="tools">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('terminal', 18)}
              <span>实时流式推理测试台 (Interactive Playground)</span>
            </span>
          </div>
          <div class="playground-box">
            <div>
              <label for="test-model" style="font-size: 12px; font-weight: 500; color: var(--text-sub); display: block; margin-bottom: 6px;">目标测试模型 (Target Model)</label>
              <select id="test-model" style="width: 100%; font-family: var(--font-mono); font-size: 13px;" aria-label="选择用于测试的模型">
                <option value="">正在发现可用模型…</option>
              </select>
            </div>
            <div>
              <label for="test-prompt" style="font-size: 12px; font-weight: 500; color: var(--text-sub); display: block; margin-bottom: 6px;">输入提示词 (User Prompt)</label>
              <textarea id="test-prompt" rows="3" style="width: 100%; resize: vertical;" placeholder="输入测试问题或指令…" aria-label="测试提示词">请用一句话介绍你自己和当前所用模型。</textarea>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <button class="btn btn-primary" id="btn-send-test" onclick="runPlaygroundTest()" aria-label="向选定模型发送流式推理请求">
                ${icon('play', 13)}
                <span>发起流式推理请求</span>
              </button>
              <div id="test-status" role="status" aria-live="polite" style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">就绪</div>
            </div>
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em;">流式响应终端 (SSE Stream Output)</span>
              </div>
              <div class="response-area" id="test-output" role="region" aria-label="模型实时推理输出">点击“发起流式推理请求”验证双通道模型响应…</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
