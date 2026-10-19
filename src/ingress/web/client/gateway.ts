export const gatewayScript = `
  function formatUptime(seconds) {
    if (!seconds || seconds < 0) return '0 秒';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return d + '天 ' + h + '小时 ' + m + '分';
    if (h > 0) return h + '小时 ' + m + '分 ' + s + '秒';
    if (m > 0) return m + '分 ' + s + '秒';
    return s + ' 秒';
  }

  function formatMemoryMB(bytes) {
    if (!bytes || typeof bytes !== 'number') return '—';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function refreshGatewayHealth() {
    const badge = document.getElementById('service-status');
    const label = document.getElementById('service-status-text');
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const health = await res.json();
      if (badge) badge.dataset.state = health.status === 'ok' ? 'online' : 'offline';
      if (label) label.textContent = health.status === 'ok' ? '服务运行中 · ' + Math.floor(health.uptime / 60) + ' 分钟' : '服务状态异常';

      // Status strip updates on Home Dashboard
      if (DASHBOARD_PAGE === 'home') {
        const stripStatus = document.getElementById('strip-service-status');
        const stripText = document.getElementById('strip-status-text');
        const stripPid = document.getElementById('strip-pid');
        const stripMode = document.getElementById('strip-mode');
        const stripUptime = document.getElementById('strip-uptime');
        const stripInflight = document.getElementById('strip-inflight');
        const stripMem = document.getElementById('strip-mem');

        if (stripStatus) stripStatus.dataset.state = health.status === 'ok' ? 'online' : 'offline';
        if (stripText) stripText.textContent = health.status === 'ok' ? '正常运行' : '异常';
        if (stripPid) stripPid.textContent = 'PID ' + (health.pid || '—');
        if (stripMode) stripMode.textContent = health.mode === 'cluster-worker' ? 'Cluster Worker' : 'Standalone';
        if (stripUptime) stripUptime.textContent = formatUptime(health.uptime);
        if (stripInflight) stripInflight.textContent = String(health.inFlightRequests || 0);
        if (stripMem && health.memory) stripMem.textContent = formatMemoryMB(health.memory.heapUsed);

        const googleTag = document.getElementById('home-google-status');
        if (googleTag) googleTag.textContent = health.providers?.google ? '专线活跃' : '未就绪';
        const codexTag = document.getElementById('home-codex-status');
        if (codexTag) codexTag.textContent = health.providers?.codex ? '专线活跃' : '未就绪';
      }
    } catch (error) {
      if (badge) badge.dataset.state = 'offline';
      if (label) label.textContent = '无法连接网关';
      if (DASHBOARD_PAGE === 'home') {
        const stripStatus = document.getElementById('strip-service-status');
        const stripText = document.getElementById('strip-status-text');
        if (stripStatus) stripStatus.dataset.state = 'offline';
        if (stripText) stripText.textContent = '无法连接';
      }
    }
  }

  // --- Home Dashboard: Google Antigravity Lifeline & All Quotas ---
  async function loadHomeGoogleLifeline() {
    if (DASHBOARD_PAGE !== 'home') return;
    const countEl = document.getElementById('home-google-accounts-count');
    const detailEl = document.getElementById('home-google-accounts-detail');
    const summaryTag = document.getElementById('home-google-quota-summary-tag');
    const quotaList = document.getElementById('home-google-quota-list');

    try {
      // 1. Google Accounts Pool State
      const accRes = await fetch('/v1/admin/google/accounts', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (accRes.ok) {
        const accData = await accRes.json();
        const accounts = accData.data || [];
        const valid = accounts.filter(a => a.enabled && !a.isInvalid).length;
        const invalid = accounts.filter(a => a.isInvalid).length;

        if (countEl) countEl.textContent = valid + ' / ' + accounts.length + ' 账号活跃';
        if (detailEl) {
          if (accounts.length === 0) {
            detailEl.textContent = '暂无配置账号，可点击下方“快速授权”登录';
          } else {
            const first = accounts[0];
            detailEl.textContent = '首选调度: ' + escapeHtml(first.email || first.id) + (invalid > 0 ? ' (' + invalid + ' 个失效)' : ' · 粘性负载就绪');
          }
        }
      }

      // Fetch subscription pool windows independently for each account.
      const quotaRes = await fetch('/v1/admin/google/quota', {
        headers: { 'Authorization': 'Bearer ' + API_KEY },
        cache: 'no-store'
      });
      if (!quotaRes.ok) throw new Error('配额查询 HTTP ' + quotaRes.status);
      const quotaData = await quotaRes.json();
      const accounts = quotaData.accounts || [];
      if (summaryTag) summaryTag.textContent = '按账号展示算力池窗口';
      if (quotaList) {
        quotaList.innerHTML = accounts.length ? accounts.map(account => {
          const plan = account.subscription?.tierName;
          const body = account.status === 'ok'
            ? renderGoogleQuotaPools(account, true)
            : '<div style="color: var(--danger-text); font-size: 12px;">配额查询失败：' + escapeHtml(account.error || '未知错误') + '</div>';
          return '<div style="border: 1px solid var(--border-hairline); border-radius: 8px; padding: 10px 12px;">' +
            '<div style="font-size: 12px; font-weight: 600; overflow-wrap: anywhere;">' + escapeHtml(account.email || account.id) + '</div>' +
            (plan ? '<div style="font-size: 10px; color: var(--google-text);">' + escapeHtml(plan) + '</div>' : '') +
            body + '<a href="/google-accounts" style="font-size: 11px;">查看此账号算力池窗口 →</a>' +
          '</div>';
        }).join('') : '<div style="font-size: 12px; color: var(--text-muted);">没有可查询的账号</div>';
      }
    } catch (err) {
      if (countEl) countEl.textContent = '读取失败';
      if (detailEl) detailEl.textContent = '状态读取异常：' + err.message;
      if (summaryTag) summaryTag.textContent = '读取失败';
      if (quotaList) quotaList.innerHTML = '<div style="color: var(--warning-text); font-size: 12px;">配额读取失败：' + escapeHtml(err.message) + '</div>';
    }
  }

  // --- Home Dashboard: OpenAI Codex Compute Lifeline & All Usage Windows ---
  async function loadHomeCodexLifeline() {
    if (DASHBOARD_PAGE !== 'home') return;
    const badgeEl = document.getElementById('home-codex-auth-badge');
    const detailEl = document.getElementById('home-codex-auth-detail');
    const planTag = document.getElementById('home-codex-plan-tag');
    const quotaList = document.getElementById('home-codex-quota-list');
    const extraHint = document.getElementById('home-codex-extra-hint');

    try {
      // 1. Fetch Auth & Base Status
      const res = await fetch('/v1/admin/codex/status', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);

      const auth = data.auth || {};
      let usage = data.lastUsage;
      const check = data.lastConnectionCheck;

      if (badgeEl) {
        const statusMap = {
          ready: '● 登录有效',
          expired: '● 令牌已过期',
          missing: '● 未配置登录态'
        };
        badgeEl.textContent = statusMap[auth.status] || auth.status || '就绪';
        badgeEl.style.color = auth.status === 'ready' ? 'var(--codex-text)' : 'var(--danger-text)';
      }

      if (detailEl) {
        const accountStr = auth.accountIdMasked ? '账号: ' + escapeHtml(auth.accountIdMasked) : '本地登录态有效';
        const refreshStr = auth.hasRefreshToken ? ' · 刷新令牌可用' : '';
        const checkStr = check ? (check.status === 'connected' ? ' · 上游检查成功' : ' · 上游检查异常') : '';
        detailEl.textContent = accountStr + refreshStr + checkStr;
      }

      // If lastUsage is not available yet, fetch live usage windows automatically
      if (!usage || usage.status !== 'available' || !usage.windows || usage.windows.length === 0) {
        try {
          const uRes = await fetch('/v1/admin/codex/usage', {
            headers: { 'Authorization': 'Bearer ' + API_KEY }
          });
          if (uRes.ok) {
            usage = await uRes.json();
          }
        } catch (e) {
          // ignore transient background usage fetch failure
        }
      }

      if (usage && usage.status === 'available' && usage.windows && usage.windows.length > 0) {
        if (planTag) {
          planTag.textContent = 'ChatGPT ' + (usage.planType ? usage.planType.toUpperCase() : '订阅');
        }

        const windowLabel = (w) => {
          const seconds = Number(w.windowSeconds);
          if (seconds >= 172800) return '周周期订阅配额 (Weekly Window)';
          if (seconds > 0 && seconds <= 172800) return Math.max(1, Math.round(seconds / 3600)) + ' 小时会话窗口 (Session Window)';
          return w.id === 'primary' ? '主配额窗口' : '次配额窗口';
        };

        const renderWindow = (w) => {
          const pct = Math.round(w.remainingPercent || 0);
          let barBg = 'linear-gradient(90deg, #0284c7, #38bdf8)';
          let color = 'var(--codex-text)';
          if (pct < 15) {
            barBg = 'linear-gradient(90deg, #dc2626, #ef4444)';
            color = 'var(--danger-text)';
          } else if (pct < 40) {
            barBg = 'linear-gradient(90deg, #d97706, #f59e0b)';
            color = 'var(--warning-text)';
          }

          const resetText = w.resetAt ? formatDateTime(w.resetAt) : '—';
          return '<div style="background: var(--bg-panel); border: 1px solid var(--border-hairline); border-radius: 6px; padding: 8px 10px;">' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">' +
              '<span style="font-weight: 500; font-size: 12px; color: var(--text-pure); display: flex; align-items: center; gap: 6px;">' +
                '<span style="color: var(--codex-text); font-size: 10px;">●</span>' +
                '<span>' + escapeHtml(windowLabel(w)) + '</span>' +
              '</span>' +
              '<strong class="tabular-nums" style="font-size: 12px; color: ' + color + ';">剩余 ' + pct + '%</strong>' +
            '</div>' +
            '<div class="quota-track" style="margin: 4px 0 3px;">' +
              '<div class="quota-fill quota-fill-codex" style="width: ' + Math.min(100, Math.max(0, pct)) + '%; background: ' + barBg + ';"></div>' +
            '</div>' +
            '<div style="font-size: 10px; color: var(--text-muted); display: flex; justify-content: space-between;">' +
              '<span>重置时间: ' + resetText + '</span>' +
              '<span>已消耗 ' + Math.round(w.usedPercent || (100 - pct)) + '%</span>' +
            '</div>' +
          '</div>';
        };

        if (quotaList) {
          quotaList.innerHTML = usage.windows.map(renderWindow).join('');
        }

        if (extraHint) {
          let extra = '显示 5 小时会话与周周期所有使用窗口 · gpt-6.1-sol / gpt-6-astra 消耗订阅算力';
          if (Number.isFinite(usage.availableResetCredits)) {
            extra = '可用额度重置机会: <strong>' + usage.availableResetCredits + ' 次</strong> · ' + extra;
          }
          extraHint.innerHTML = extra;
        }
      } else {
        if (planTag) planTag.textContent = '暂无窗口数据';
        if (quotaList) {
          quotaList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px;">' +
            (usage?.error || '上游额度信息同步中，可点击“检查真实连接”或前往 Codex 专区刷新') +
          '</div>';
        }
      }
    } catch (err) {
      if (badgeEl) badgeEl.textContent = '读取失败';
      if (detailEl) detailEl.textContent = '无法读取状态：' + err.message;
      if (quotaList) {
        quotaList.innerHTML = '<div style="font-size: 12px; color: var(--danger-text); text-align: center; padding: 12px;">读取异常：' + escapeHtml(err.message) + '</div>';
      }
    }
  }

  // --- Home Dashboard: Today's Requests & Telemetry Metrics ---
  async function loadHomeTodayMetrics() {
    if (DASHBOARD_PAGE !== 'home') return;
    try {
      const today = utcDateString(new Date());
      const res = await fetch('/v1/admin/requests/summary?from=' + today + '&to=' + today, {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const totals = data.totals || {};

      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setText('home-today-requests', formatTokens(totals.requests || 0));
      setText('home-today-success', ((totals.successRate || 1) * 100).toFixed(1) + '%');
      setText('home-today-tokens', formatTokens(totals.inputTokens || 0) + ' / ' + formatTokens(totals.outputTokens || 0));

      const errors = (totals.error || 0) + (totals.interrupted || 0);
      const errorsEl = document.getElementById('home-today-errors');
      const errorsHint = document.getElementById('home-today-errors-hint');

      if (errorsEl) {
        errorsEl.textContent = formatTokens(errors);
        errorsEl.style.color = errors > 0 ? 'var(--danger-text)' : 'var(--success-text)';
      }
      if (errorsHint) {
        errorsHint.textContent = errors > 0
          ? totals.error + ' 次执行失败，' + totals.interrupted + ' 次客户端中断'
          : '今日无报错与中断';
      }
    } catch (err) {
      console.error('Failed to load today metrics:', err);
    }
  }

  // --- Home Dashboard: Recent Anomaly & Health Horizon Banner ---
  async function loadHomeAlertBanner() {
    if (DASHBOARD_PAGE !== 'home') return;
    const banner = document.getElementById('home-alert-banner');
    const iconEl = document.getElementById('home-alert-icon');
    const titleEl = document.getElementById('home-alert-title');
    const descEl = document.getElementById('home-alert-desc');
    const actionEl = document.getElementById('home-alert-action');
    if (!banner) return;

    try {
      const res = await fetch('/v1/admin/requests?limit=10', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const rows = data.data || [];

      // Find the most recent anomaly (error or interrupted)
      const anomaly = rows.find(r => r.result === 'error' || r.result === 'interrupted');

      if (anomaly) {
        banner.className = 'alert-banner state-anomaly';
        if (iconEl) {
          iconEl.innerHTML = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        }
        if (titleEl) {
          titleEl.textContent = '最近异常检测 (' + formatDateTime(anomaly.timestamp).slice(11) + ')';
        }
        if (descEl) {
          const detail = anomaly.error || (anomaly.result === 'interrupted' ? '客户端中断连接 (Client Abort)' : '调用未交付');
          descEl.textContent = '[' + (anomaly.provider || '专线') + '] 模型 ' + (anomaly.model || '未知') + ': ' + detail;
        }
        if (actionEl) {
          actionEl.href = '/requests?requestId=' + encodeURIComponent(anomaly.requestId);
          actionEl.className = 'btn btn-danger btn-sm';
          actionEl.innerHTML = '<span>排查此条日志 →</span>';
        }
      } else {
        banner.className = 'alert-banner state-normal';
        if (iconEl) {
          iconEl.innerHTML = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        }
        if (titleEl) {
          titleEl.textContent = '全系统专线运行正常';
        }
        if (descEl) {
          descEl.textContent = '今日全链路请求平稳交付，双专线状态健康，无未捕获异常。';
        }
        if (actionEl) {
          actionEl.href = '/requests';
          actionEl.className = 'btn btn-secondary btn-sm';
          actionEl.innerHTML = '<span>查看全链路日志 →</span>';
        }
      }
    } catch (err) {
      console.error('Failed to load alert banner:', err);
    }
  }

  async function refreshCurrentPage() {
    await refreshGatewayHealth();
    switch (DASHBOARD_PAGE) {
      case 'home':
        await Promise.all([
          loadModels(),
          loadHomeGoogleLifeline(),
          loadHomeCodexLifeline(),
          loadHomeTodayMetrics(),
          loadHomeAlertBanner()
        ]);
        break;
      case 'usage':
        applyUsageRange();
        break;
      case 'requests':
        await loadRequestLogs();
        break;
      case 'google-accounts':
        await loadAccounts();
        break;
      case 'codex':
        await loadCodexStatus();
        break;
      case 'models':
        await loadModels();
        break;
      case 'playground':
        await loadPlaygroundModels();
        break;
    }
  }
`;
