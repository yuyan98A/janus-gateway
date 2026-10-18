import { icon } from '../icons.ts';

export function renderConnectView(host: string, port: number, apiKey: string): string {
  return `
    <div class="grid">
      <div class="col-12">
        <div class="card">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('plug', 18)}
              <span>下游 Agent 客户端快速接入指南</span>
            </span>
          </div>

          <!-- Section 1: Claude Code CLI -->
          <div style="margin-bottom: 24px;">
            <div style="font-size: 14px; font-weight: 600; color: var(--text-pure); margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
              ${icon('terminal', 16)}
              <span>1. Claude Code CLI 对接 (原生 Anthropic Messages 协议)</span>
            </div>
            <div style="font-size: 12px; color: var(--text-sub); margin-bottom: 10px;">
              直接将本地终端环境变量指向本网关，可无缝消耗 Google One Antigravity 专线配额与 Claude 4.6 模型算力：
            </div>

            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Windows PowerShell:</div>
            <div class="code-box">
              <button class="copy-btn" onclick="copyText(this, 'claude-cmd-pwsh')" aria-label="复制 PowerShell 环境变量配置">
                ${icon('copy', 12)}
                <span>复制命令</span>
              </button>
              <pre id="claude-cmd-pwsh">$env:ANTHROPIC_BASE_URL="http://${host}:${port}"
$env:ANTHROPIC_AUTH_TOKEN="${apiKey}"
$env:ANTHROPIC_MODEL="claude-sonnet-4-6"
claude</pre>
            </div>

            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin: 12px 0 4px;">macOS / Linux Bash / Zsh:</div>
            <div class="code-box">
              <button class="copy-btn" onclick="copyText(this, 'claude-cmd-sh')" aria-label="复制 Bash 环境变量配置">
                ${icon('copy', 12)}
                <span>复制命令</span>
              </button>
              <pre id="claude-cmd-sh">export ANTHROPIC_BASE_URL="http://${host}:${port}"
export ANTHROPIC_AUTH_TOKEN="${apiKey}"
export ANTHROPIC_MODEL="claude-sonnet-4-6"
claude</pre>
            </div>
          </div>

          <!-- Section 2: OpenAI Compatible Tools -->
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-pure); margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
              ${icon('box', 16)}
              <span>2. Cursor / Cline / Aider (OpenAI 协议兼容接口)</span>
            </div>
            <div style="font-size: 12px; color: var(--text-sub); margin-bottom: 10px;">
              在各类支持自定义 OpenAI API 的 Agent 工具中填入下方参数，可直接调用 Codex 订阅模型（如 gpt-6.1-sol）或 Google 专线模型：
            </div>
            <div class="code-box">
              <button class="copy-btn" onclick="copyText(this, 'cursor-cmd')" aria-label="复制 OpenAI 兼容配置">
                ${icon('copy', 12)}
                <span>复制参数</span>
              </button>
              <pre id="cursor-cmd">Base URL : http://${host}:${port}/v1
API Key  : ${apiKey}
Model    : gpt-6.1-sol (Codex 专线) 或 claude-sonnet-4-6 (Google 专线)</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
