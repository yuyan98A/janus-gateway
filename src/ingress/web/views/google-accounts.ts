import { icon } from '../icons.ts';

export function renderGoogleAccountsView(): string {
  return `
    <div class="grid">
      <div class="col-12">
        <div class="card">
          <div class="card-title">
            <span class="card-title-text">
              ${icon('users', 18)}
              <span>Google 多账号池管理 (Antigravity Account Pool)</span>
            </span>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">固定账号粘性优先</span>
              <button class="btn btn-secondary btn-sm" id="btn-refresh-google-quota" onclick="refreshGoogleQuotas()" aria-label="查询所有账号的实时配额">
                ${icon('activity', 13)}
                <span>查询专线配额</span>
              </button>
              <button class="btn btn-primary btn-sm" onclick="startOAuthLogin()" aria-label="跳转 Google OAuth 登录页面">
                ${icon('external', 13)}
                <span>浏览器快捷授权</span>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openAddModal()" aria-label="打开手动导入凭据弹窗">
                ${icon('plus', 13)}
                <span>手动导入凭据</span>
              </button>
            </div>
          </div>

          <div id="google-quota-summary" style="display: none; font-size: 12px; color: var(--text-sub); margin-bottom: 14px; padding: 10px 14px; background: var(--bg-chassis); border: 1px solid var(--border-hairline); border-radius: 6px;"></div>

          <div class="filter-toolbar">
            <input type="search" id="account-search" placeholder="搜索账号邮箱、标签备注或状态…" aria-label="搜索 Google 账号" oninput="filterTableRows('accounts-tbody',this.value)">
            <span class="stat-hint" style="margin-top: 0;">支持按邮箱前缀、备注标签或健康状态实时过滤</span>
          </div>

          <div class="table-wrap">
            <table>
              <caption class="sr-only">已配置的 Google Antigravity 账号列表与状态</caption>
              <thead>
                <tr>
                  <th scope="col">账号 / 标签</th>
                  <th scope="col">健康状态</th>
                  <th scope="col">绑定项目 ID</th>
                  <th scope="col" style="min-width: 280px;">全模型专线配额 (All Models Quotas)</th>
                  <th scope="col" style="text-align: right;">操作</th>
                </tr>
              </thead>
              <tbody id="accounts-tbody">
                <tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">加载账号池数据中…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderAddAccountModal(): string {
  return `
  <dialog id="add-modal" aria-labelledby="add-modal-title">
    <div class="modal-box">
      <h3 id="add-modal-title" style="font-size: 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
        ${icon('users', 18)}
        <span>添加 Google Antigravity 凭据</span>
      </h3>

      <!-- 方式一：快捷授权跳转 -->
      <div style="background: var(--google-subtle); border: 1px solid var(--google-border); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;">
        <div style="font-weight: 600; font-size: 13px; color: var(--google-text); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
          ${icon('globe', 14)}
          <span>方式一：浏览器官方授权跳转（推荐）</span>
        </div>
        <div style="font-size: 12px; color: var(--text-sub); margin-bottom: 12px; line-height: 1.4;">点击按钮在浏览器中打开 Google 官方授权页面，完成授权后将自动回填绑定至本地账号池。</div>
        <button class="btn btn-primary" style="width: 100%; background: #059669; border-color: #34d399;" onclick="startOAuthLogin()">
          ${icon('external', 14)}
          <span>立即前往 Google 授权登录</span>
        </button>
      </div>

      <div style="text-align: center; font-size: 12px; color: var(--text-muted); margin-bottom: 14px; position: relative;" aria-hidden="true">
        <span style="background: var(--bg-panel); padding: 0 10px; position: relative; z-index: 1;">或者手动录入凭据</span>
        <div style="position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--border-subtle); z-index: 0;"></div>
      </div>

      <!-- 方式二：手动输入 -->
      <form onsubmit="event.preventDefault(); submitAddAccount();" style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label for="add-token" style="font-size: 12px; color: var(--text-sub); display: block; margin-bottom: 6px;">Refresh Token (必填)</label>
          <textarea id="add-token" rows="3" required style="width: 100%; font-family: var(--font-mono); font-size: 12px;" placeholder="粘贴 1//0e… 格式的 Google Refresh Token"></textarea>
        </div>
        <div>
          <label for="add-label" style="font-size: 12px; color: var(--text-sub); display: block; margin-bottom: 6px;">账号标签 / 备注 (可选)</label>
          <input type="text" id="add-label" style="width: 100%;" placeholder="例如: 个人主力号">
        </div>
        <div>
          <label for="add-project" style="font-size: 12px; color: var(--text-sub); display: block; margin-bottom: 6px;">Google Cloud 项目 ID (可选)</label>
          <input type="text" id="add-project" style="width: 100%;" placeholder="个人账号通常留空，由系统自动发现分配">
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
          <button class="btn btn-secondary" type="button" onclick="closeAddModal()">取消</button>
          <button class="btn btn-primary" type="submit">校验并保存</button>
        </div>
      </form>
    </div>
  </dialog>
  `;
}

export function renderAllQuotasModal(): string {
  return `
  <dialog id="all-quotas-modal" aria-labelledby="all-quotas-modal-title" style="max-width: 780px; width: 92%;">
    <div class="modal-box" style="max-width: 100%;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid var(--border-hairline); padding-bottom: 12px;">
        <h3 id="all-quotas-modal-title" style="font-size: 16px; display: flex; align-items: center; gap: 8px; margin: 0; color: var(--text-pure);">
          ${icon('activity', 18)}
          <span>Google 账号全模型配额明细</span>
        </h3>
        <button class="btn btn-secondary btn-sm" type="button" onclick="closeAllQuotasModal()" aria-label="关闭弹窗">关闭</button>
      </div>

      <div id="all-quotas-modal-meta" style="font-size: 12px; color: var(--text-sub); margin-bottom: 14px; background: var(--bg-chassis); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-hairline);"></div>

      <div class="table-wrap" style="max-height: 420px; overflow-y: auto;">
        <table>
          <thead>
            <tr>
              <th scope="col">模型名称</th>
              <th scope="col">模型 ID</th>
              <th scope="col" style="min-width: 140px;">剩余配额水线</th>
              <th scope="col">剩余比例</th>
              <th scope="col">下次重置时间</th>
            </tr>
          </thead>
          <tbody id="all-quotas-tbody">
            <tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">暂无配额数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </dialog>
  `;
}
