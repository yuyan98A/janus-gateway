export const codexScript = `
  async function loadCodexStatus() {
    const output = document.getElementById('codex-account-status');
    const refreshButton = document.getElementById('btn-refresh-codex-status');
    if (refreshButton) refreshButton.disabled = true;
    try {
      const res = await fetch('/v1/admin/codex/status', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
      renderCodexUsage(data.lastUsage);
      if (!data.enabled) {
        if (output) output.innerHTML = '<span style="color: var(--warning-text);">Codex 专线已停用</span>';
        return;
      }
      const auth = data.auth || {};
      const labels = {
        missing: '未找到登录文件',
        invalid: '登录文件无法读取',
        missing_access_token: '缺少访问令牌',
        expired: '访问令牌已过期',
        expiring: '访问令牌即将过期',
        ready: '登录有效',
        unknown_expiry: '令牌有效期未知'
      };
      const colors = {
        ready: 'var(--success-text)',
        unknown_expiry: 'var(--warning-text)',
        expiring: 'var(--warning-text)',
        expired: 'var(--danger-text)',
        invalid: 'var(--danger-text)',
        missing: 'var(--danger-text)',
        missing_access_token: 'var(--danger-text)'
      };
      const last = data.lastConnectionCheck;
      if (output) {
        output.innerHTML = '<div><span style="color: ' + (colors[auth.status] || 'var(--text-sub)') + ';">● ' + escapeHtml(labels[auth.status] || auth.status || '未知') + '</span></div>' +
          '<div style="margin-top: 5px;">账号：' + escapeHtml(auth.accountIdMasked || '未读取到') + (auth.authMode ? ' · ' + escapeHtml(auth.authMode) : '') + '</div>' +
          '<div>刷新令牌：' + (auth.hasRefreshToken ? '可用' : '未配置') + '</div>' +
          (auth.expiresAt ? '<div>访问令牌到期：<span class="tabular-nums">' + escapeHtml(formatDateTime(auth.expiresAt)) + '</span></div>' : '') +
          (auth.lastRefresh ? '<div>最近刷新：<span class="tabular-nums">' + escapeHtml(formatDateTime(auth.lastRefresh)) + '</span></div>' : '') +
          (last ? '<div style="margin-top: 7px; color: ' + (last.status === 'connected' ? 'var(--success-text)' : 'var(--danger-text)') + ';">最近连接检查：' + (last.status === 'connected' ? '成功' : '失败') + ' · <span class="tabular-nums">' + escapeHtml(formatDateTime(last.checkedAt)) + '</span>' + (last.error ? '<br>' + escapeHtml(last.error) : '') + '</div>' : '<div style="margin-top: 7px;">尚未执行上游连接检查</div>');
      }
    } catch (err) {
      if (output) output.textContent = '状态读取失败：' + err.message;
      toast.error('Codex 状态读取失败：' + err.message);
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  function renderCodexUsage(usage) {
    const output = document.getElementById('codex-usage');
    if (!output) return;
    if (!usage) {
      output.textContent = '尚未获取额度信息。';
      return;
    }
    if (usage.status !== 'available') {
      output.innerHTML = '<span style="color: var(--warning-text);">额度暂不可用：' + escapeHtml(usage.error || '上游未返回额度窗口') + '</span>' +
        (usage.checkedAt ? '<div style="margin-top: 3px;">检查时间：<span class="tabular-nums">' + escapeHtml(formatDateTime(usage.checkedAt)) + '</span></div>' : '');
      return;
    }
    const windowLabel = window => {
      const seconds = Number(window.windowSeconds);
      if (seconds >= 172800) return '周周期';
      if (seconds > 0 && seconds <= 172800) return Math.max(1, Math.round(seconds / 3600)) + ' 小时周期';
      return window.id === 'primary' ? '主额度窗口' : '次额度窗口';
    };
    const rows = (usage.windows || []).map(window =>
      '<div style="display: flex; justify-content: space-between; gap: 8px; margin-top: 4px;">' +
        '<span>' + escapeHtml(windowLabel(window)) + '</span>' +
        '<strong class="tabular-nums" style="color: ' + (window.remainingPercent <= 10 ? 'var(--danger-text)' : 'var(--success-text)') + ';">剩余 ' + Math.round(window.remainingPercent) + '%</strong>' +
      '</div>' +
      (window.resetAt ? '<div style="font-size: 10px;">重置：<span class="tabular-nums">' + escapeHtml(formatDateTime(window.resetAt)) + '</span></div>' : '')
    ).join('');
    output.innerHTML = (usage.planType ? '<div>方案：' + escapeHtml(usage.planType) + '</div>' : '') +
      rows +
      (usage.allowed === false || usage.limitReached === true ? '<div style="color: var(--danger-text); margin-top: 5px;">上游当前提示已达到使用限制</div>' : '') +
      (Number.isFinite(usage.availableResetCredits) ? '<div style="margin-top: 4px;">可用额度重置次数：<span class="tabular-nums">' + usage.availableResetCredits + '</span></div>' : '') +
      '<div style="font-size: 10px; margin-top: 5px;">最近更新：<span class="tabular-nums">' + escapeHtml(formatDateTime(usage.checkedAt)) + '</span></div>';
  }

  async function refreshCodexUsage() {
    const button = document.getElementById('btn-refresh-codex-usage');
    if (button) {
      button.disabled = true;
      button.innerText = '读取中…';
    }
    try {
      const res = await fetch('/v1/admin/codex/usage', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
      renderCodexUsage(data);
      toast.success('Codex 额度信息已更新');
    } catch (err) {
      const output = document.getElementById('codex-usage');
      if (output) output.textContent = '额度读取失败：' + err.message;
      toast.error('Codex 额度刷新失败：' + err.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.innerText = '刷新额度';
      }
    }
  }

  async function checkCodexConnection() {
    const button = document.getElementById('btn-check-codex-connection');
    if (button) {
      button.disabled = true;
      button.innerText = '正在检查…';
    }
    try {
      const res = await fetch('/v1/admin/codex/status/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: 'gpt-6.1-sol' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
      await loadCodexStatus();
      toast.success('Codex 上游连接检查通过');
    } catch (err) {
      const output = document.getElementById('codex-account-status');
      if (output) output.textContent = '连接检查失败：' + err.message;
      toast.error('Codex 连接检查未通过：' + err.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.innerText = '检查上游连接';
      }
    }
  }
`;
