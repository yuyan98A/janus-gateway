export const requestsScript = `
  let requestLogOffset = 0;
  let requestLogTotal = 0;
  const REQUEST_LOG_PAGE_SIZE = 50;

  function initRequestsFiltersFromUrl() {
    if (DASHBOARD_PAGE !== 'requests') return;
    const reqId = getUrlParam('requestId');
    const model = getUrlParam('model');
    const provider = getUrlParam('provider');
    const result = getUrlParam('result');
    const offset = getUrlParam('offset');
    const from = getUrlParam('from');
    const to = getUrlParam('to');

    if (reqId) {
      const el = document.getElementById('log-request-id');
      if (el) el.value = reqId;
    }
    if (model) {
      const el = document.getElementById('log-model');
      if (el) el.value = model;
    }
    if (provider) {
      const el = document.getElementById('log-provider');
      if (el) el.value = provider;
    }
    if (result) {
      const el = document.getElementById('log-result');
      if (el) el.value = result;
    }
    if (from) {
      const el = document.getElementById('logs-from');
      if (el) el.value = from;
    }
    if (to) {
      const el = document.getElementById('logs-to');
      if (el) el.value = to;
    }
    if (offset) {
      requestLogOffset = Math.max(0, parseInt(offset, 10) || 0);
    }
  }

  function requestLogDateChanged() {
    requestLogOffset = 0;
    syncRequestsUrl();
    loadRequestLogs();
  }

  function syncRequestsUrl() {
    if (DASHBOARD_PAGE !== 'requests') return;
    const requestId = document.getElementById('log-request-id')?.value.trim() || '';
    const model = document.getElementById('log-model')?.value.trim() || '';
    const provider = document.getElementById('log-provider')?.value || '';
    const result = document.getElementById('log-result')?.value || '';
    const from = document.getElementById('logs-from')?.value || '';
    const to = document.getElementById('logs-to')?.value || '';

    updateUrlParams({
      requestId,
      model,
      provider,
      result,
      from,
      to,
      offset: requestLogOffset > 0 ? requestLogOffset : ''
    });
  }

  async function loadRequestLogs() {
    syncRequestsUrl();
    const params = analyticsQuery();
    params.set('limit', String(REQUEST_LOG_PAGE_SIZE));
    params.set('offset', String(requestLogOffset));

    const requestId = document.getElementById('log-request-id')?.value.trim() || '';
    const model = document.getElementById('log-model')?.value.trim() || '';
    const provider = document.getElementById('log-provider')?.value || '';
    const result = document.getElementById('log-result')?.value || '';

    if (requestId) params.set('requestId', requestId);
    if (model) params.set('model', model);
    if (provider) params.set('provider', provider);
    if (result) params.set('result', result);

    const tbody = document.getElementById('request-logs-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-sub);">读取日志中…</td></tr>';

    try {
      const res = await fetch('/v1/admin/requests?' + params.toString(), {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      requestLogTotal = data.total || 0;
      renderIndexStatus(data.indexing);
      const rows = data.data || [];
      tbody.innerHTML = rows.length ? rows.map(item => {
        const badge = item.result === 'success'
          ? '<span class="tag tag-active"><span class="tag-dot"></span>成功</span>'
          : item.result === 'error'
          ? '<span class="tag tag-invalid"><span class="tag-dot"></span>失败</span>'
          : '<span class="tag tag-cooling"><span class="tag-dot"></span>中断</span>';
        const tokens = item.usageSource === 'upstream'
          ? '<span class="tabular-nums" style="color: #f1f5f9;">' + formatTokens(item.inputTokens) + '</span> <span style="color: var(--text-muted);">/</span> <span class="tabular-nums" style="color: #f1f5f9;">' + formatTokens(item.outputTokens) + '</span>'
          : '<span style="color: var(--text-muted); font-size: 11px;">未返回</span>';
        const duration = item.durationMs === undefined
          ? '—'
          : '<span class="tabular-nums">' + formatTokens(item.durationMs) + '</span> <span style="color: var(--text-muted); font-size: 11px;">ms</span>';
        const providerColor = item.provider === 'codex' ? '#60a5fa' : item.provider === 'google' ? '#34d399' : 'var(--text-sub)';

        return '<tr>' +
          '<td class="tabular-nums" style="white-space: nowrap; color: var(--text-sub); font-size: 12px;">' + escapeHtml(formatDateTime(item.timestamp)) + '</td>' +
          '<td><div class="request-id-cell" title="' + escapeHtml(item.requestId) + '"><code class="request-id-text">' + escapeHtml(item.requestId) + '</code><button class="copy-id-btn" data-request-id="' + escapeHtml(item.requestId) + '" onclick="copyRequestId(this.dataset.requestId,this)" aria-label="复制请求 ID">复制</button></div></td>' +
          '<td><span style="color: ' + providerColor + '; font-weight: 500;">' + escapeHtml(item.provider || '未知') + '</span> <span style="color: rgba(255,255,255,0.15); margin: 0 4px;">/</span> <code style="color: #cbd5e1;">' + escapeHtml(item.model || '未知') + '</code></td>' +
          '<td title="' + escapeHtml(item.error || '') + '">' + badge + (item.statusCode ? ' <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: 4px;">' + item.statusCode + '</span>' : '') + '</td>' +
          '<td>' + duration + '</td>' +
          '<td>' + tokens + '</td>' +
          '<td style="text-align: right;"><button class="btn btn-secondary btn-sm" data-request-id="' + escapeHtml(item.requestId) + '" onclick="loadRequestDetail(this.dataset.requestId)" aria-label="查看请求详情">查看</button></td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">没有匹配的请求日志</td></tr>';

      const countEl = document.getElementById('request-logs-count');
      if (countEl) {
        countEl.textContent = requestLogTotal
          ? '共 ' + formatTokens(requestLogTotal) + ' 条，第 ' + (Math.floor(requestLogOffset / REQUEST_LOG_PAGE_SIZE) + 1) + ' 页'
          : '共 0 条';
      }
      const prevBtn = document.getElementById('logs-prev');
      const nextBtn = document.getElementById('logs-next');
      if (prevBtn) prevBtn.disabled = requestLogOffset <= 0;
      if (nextBtn) nextBtn.disabled = requestLogOffset + REQUEST_LOG_PAGE_SIZE >= requestLogTotal;
    } catch (error) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger-text);">日志读取失败：' + escapeHtml(error.message) + '</td></tr>';
      toast.error('请求日志加载失败：' + error.message);
    }
  }

  function changeLogPage(direction) {
    requestLogOffset = Math.max(0, requestLogOffset + direction * REQUEST_LOG_PAGE_SIZE);
    syncRequestsUrl();
    loadRequestLogs();
  }

  async function loadRequestDetail(encodedRequestId) {
    const requestId = encodedRequestId;
    const container = document.getElementById('request-log-detail');
    if (!container) return;
    container.style.display = 'block';
    container.textContent = '正在读取请求详情和关联原始日志…';

    try {
      const res = await fetch('/v1/admin/requests/' + encodeURIComponent(requestId), {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      container.innerHTML = '<div class="log-detail-header"><span class="log-detail-title"></span><span class="log-detail-controls" style="display:flex;gap:6px;"></span></div>';
      container.querySelector('.log-detail-title').textContent = '请求详情 · ' + requestId;
      const controls = container.querySelector('.log-detail-controls');

      const copyButton = document.createElement('button');
      copyButton.className = 'btn btn-secondary btn-sm';
      copyButton.textContent = '复制 ID';
      copyButton.setAttribute('aria-label', '复制请求 ID');
      copyButton.addEventListener('click', () => copyRequestId(requestId, copyButton));

      const closeButton = document.createElement('button');
      closeButton.className = 'btn btn-secondary btn-sm';
      closeButton.textContent = '关闭';
      closeButton.setAttribute('aria-label', '关闭详情抽屉');
      closeButton.addEventListener('click', closeRequestDetail);

      controls.append(copyButton, closeButton);

      const events = data.events || [];
      for (const event of events) {
        const details = document.createElement('details');
        details.className = 'log-detail-event';
        const summary = document.createElement('summary');
        summary.textContent = (formatDateTime(event.timestamp) || '') + '  ·  ' + (event.event || '日志事件');
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(event, null, 2);
        details.append(summary, pre);
        container.appendChild(details);
      }
      if (!events.length) {
        container.appendChild(document.createTextNode('未找到对应的原始日志事件。'));
      }
    } catch (error) {
      container.textContent = '详情读取失败：' + error.message;
      toast.error('请求详情读取失败：' + error.message);
    }
  }

  function closeRequestDetail() {
    const container = document.getElementById('request-log-detail');
    if (container) {
      container.style.display = 'none';
      container.innerHTML = '';
    }
  }
`;
