export const usageScript = `
  let currentUsageSummary = null;
  const usageSort = {
    models: { key: 'requests', direction: -1 },
    providers: { key: 'requests', direction: -1 }
  };

  function initUsageFiltersFromUrl() {
    if (DASHBOARD_PAGE !== 'usage') return;
    const range = getUrlParam('range');
    const from = getUrlParam('from');
    const to = getUrlParam('to');

    const rangeSelect = document.getElementById('usage-range');
    const fromInput = document.getElementById('usage-from');
    const toInput = document.getElementById('usage-to');

    if (range && rangeSelect) {
      rangeSelect.value = range;
    }
    if (range === 'custom' || (!range && (from || to))) {
      if (rangeSelect) rangeSelect.value = 'custom';
      if (fromInput) {
        fromInput.disabled = false;
        if (from) fromInput.value = from;
      }
      if (toInput) {
        toInput.disabled = false;
        if (to) toInput.value = to;
      }
    }
  }

  function applyUsageRange() {
    const rangeEl = document.getElementById('usage-range');
    if (!rangeEl) return;
    const range = rangeEl.value;
    const fromInput = document.getElementById('usage-from');
    const toInput = document.getElementById('usage-to');
    const custom = range === 'custom';

    if (fromInput) fromInput.disabled = !custom && range === 'all';
    if (toInput) toInput.disabled = !custom && range === 'all';

    if (range === 'all') {
      if (fromInput) fromInput.value = '';
      if (toInput) toInput.value = '';
    } else if (!custom) {
      const today = new Date();
      const from = new Date(today);
      from.setUTCDate(today.getUTCDate() - (Number(range) - 1));
      if (fromInput) fromInput.value = utcDateString(from);
      if (toInput) toInput.value = utcDateString(today);
    }

    if (DASHBOARD_PAGE === 'usage') {
      updateUrlParams({
        range,
        from: fromInput ? fromInput.value : '',
        to: toInput ? toInput.value : ''
      });
    }

    refreshRequestAnalytics();
  }

  function customUsageDateChanged() {
    const rangeEl = document.getElementById('usage-range');
    if (rangeEl) rangeEl.value = 'custom';
    const fromInput = document.getElementById('usage-from');
    const toInput = document.getElementById('usage-to');
    if (fromInput) fromInput.disabled = false;
    if (toInput) toInput.disabled = false;

    if (DASHBOARD_PAGE === 'usage') {
      updateUrlParams({
        range: 'custom',
        from: fromInput ? fromInput.value : '',
        to: toInput ? toInput.value : ''
      });
    }

    refreshRequestAnalytics();
  }

  function analyticsQuery() {
    const params = new URLSearchParams();
    let from = '';
    let to = '';
    if (DASHBOARD_PAGE === 'usage') {
      from = document.getElementById('usage-from')?.value || '';
      to = document.getElementById('usage-to')?.value || '';
    } else if (DASHBOARD_PAGE === 'requests') {
      from = document.getElementById('logs-from')?.value || '';
      to = document.getElementById('logs-to')?.value || '';
    } else if (DASHBOARD_PAGE === 'home') {
      const today = utcDateString(new Date());
      from = today;
      to = today;
    }
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params;
  }

  function renderIndexStatus(status) {
    const output = document.getElementById('request-index-status');
    if (!output) return;
    if (status?.error) {
      output.innerHTML = '<span style="color: var(--danger-text);">历史日志索引失败：' + escapeHtml(status.error) + '</span>';
    } else if (status?.running) {
      output.textContent = '正在回填历史日志：' + status.processedFiles + '/' + status.totalFiles + ' 个日志文件；已新增索引 ' + formatTokens(status.indexedRequests) + ' 条请求。' + (status.currentFile ? ' 当前：' + status.currentFile : '');
    } else {
      output.textContent = '历史日志索引完成；本次启动回填 ' + formatTokens(status?.indexedRequests || 0) + ' 条请求。原始 JSONL 日志仍保留。';
    }
  }

  async function refreshRequestAnalytics() {
    try {
      const params = analyticsQuery();
      const res = await fetch('/v1/admin/requests/summary?' + params.toString(), {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      currentUsageSummary = data;
      const totals = data.totals || {};
      const setText = (id, value) => { const output = document.getElementById(id); if (output) output.textContent = value; };
      setText('usage-requests', formatTokens(totals.requests));
      setText('usage-success', ((totals.successRate || 0) * 100).toFixed(1) + '%');
      setText('usage-input-tokens', formatTokens(totals.inputTokens));
      setText('usage-output-tokens', formatTokens(totals.outputTokens));
      setText('usage-reported', formatTokens(totals.reportedRequests) + ' / ' + formatTokens(totals.requests));
      setText('usage-errors', formatTokens(totals.error + totals.interrupted));
      setText('home-requests', formatTokens(totals.requests));
      setText('home-success', ((totals.successRate || 0) * 100).toFixed(1) + '%');
      renderIndexStatus(data.indexing);

      const chart = document.getElementById('usage-chart');
      const days = data.byDay || [];
      const maxRequests = Math.max(1, ...days.map(day => day.requests));
      if (chart) {
        chart.innerHTML = days.length ? days.map(day => {
          const height = Math.max(4, Math.round((day.requests / maxRequests) * 110));
          return '<div class="usage-day" title="' + escapeHtml(day.date + '：' + formatTokens(day.requests) + ' 次请求') + '">' +
            '<span style="font-size: 10px; color: var(--text-sub);" class="tabular-nums">' + formatTokens(day.requests) + '</span>' +
            '<div class="usage-bar" style="height: ' + height + 'px; width: 22px; flex: 0 0 auto;"></div>' +
            '<span class="usage-day-label">' + escapeHtml(day.date.slice(5)) + '</span></div>';
        }).join('') : '<span style="font-size: 12px; color: var(--text-sub); margin: auto;">该时间范围暂无请求</span>';
      }
      renderUsageBreakdowns();
    } catch (error) {
      const status = document.getElementById('request-index-status');
      if (status) status.textContent = '统计读取失败：' + error.message;
      const homeRequests = document.getElementById('home-requests');
      if (homeRequests) homeRequests.textContent = '读取失败';
      const homeSuccess = document.getElementById('home-success');
      if (homeSuccess) homeSuccess.textContent = '读取失败';
    }
  }

  function sortUsageTable(group, key) {
    const state = usageSort[group];
    if (!state) return;
    state.direction = state.key === key ? -state.direction : (key === 'name' ? 1 : -1);
    state.key = key;
    renderUsageBreakdowns();
  }

  function renderUsageBreakdowns() {
    if (!currentUsageSummary) return;
    if (!document.getElementById('usage-models') || !document.getElementById('usage-providers')) return;
    const renderRows = (items, state, emptyLabel) => {
      const rows = [...(items || [])].sort((a, b) => {
        const left = a[state.key] ?? '';
        const right = b[state.key] ?? '';
        const compared = typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'zh-CN', { numeric: true, sensitivity: 'base' });
        return compared * state.direction;
      });
      return rows.length ? rows.map(item =>
        '<tr><td>' + escapeHtml(item.name) + '</td><td class="tabular-nums">' + formatTokens(item.requests) + '</td><td class="tabular-nums">' + formatTokens(item.inputTokens) + '</td><td class="tabular-nums">' + formatTokens(item.outputTokens) + '</td></tr>'
      ).join('') : '<tr><td colspan="4" style="color: var(--text-sub); text-align: center;">' + emptyLabel + '</td></tr>';
    };
    document.getElementById('usage-models').innerHTML = renderRows(currentUsageSummary.byModel, usageSort.models, '该时间范围暂无模型请求');
    document.getElementById('usage-providers').innerHTML = renderRows(currentUsageSummary.byProvider, usageSort.providers, '该时间范围暂无上游请求');
  }
`;
