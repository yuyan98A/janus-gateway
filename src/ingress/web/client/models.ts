export const modelsScript = `
  let modelTestBusy = false;
  const modelTestResults = Object.create(null);
  const EFFORT_CHOICES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  const GOOGLE_EFFORT_CHOICES = ['low', 'medium', 'high'];
  const reasoningStates = Object.create(null);
  let codexModelIds = [];
  let reasoningBatchBusy = false;

  const CATEGORY_MAP = {
    chat: { label: '通用对话', color: '#60a5fa', bg: 'rgba(59,130,246,0.15)' },
    code_completion: { label: '代码补全', color: '#c084fc', bg: 'rgba(192,132,252,0.15)' },
    image: { label: '图像生成', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
    audio: { label: '语音转录', color: '#2dd4bf', bg: 'rgba(45,212,191,0.15)' },
    internal: { label: '内部测试', color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
    command: { label: '指令模型', color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
    review: { label: '代码审核', color: '#f472b6', bg: 'rgba(244,114,182,0.15)' }
  };

  function initModelsFiltersFromUrl() {
    if (DASHBOARD_PAGE !== 'models') return;
    const search = getUrlParam('search');
    const category = getUrlParam('category');
    const searchInput = document.getElementById('model-search');
    const catSelect = document.getElementById('model-category-filter');
    if (search && searchInput) searchInput.value = search;
    if (category && catSelect) catSelect.value = category;
  }

  function applyModelFilters() {
    const searchInput = document.getElementById('model-search');
    const catSelect = document.getElementById('model-category-filter');
    const searchVal = (searchInput?.value || '').trim().toLowerCase();
    const catVal = catSelect?.value || '';

    if (DASHBOARD_PAGE === 'models') {
      updateUrlParams({
        search: searchVal,
        category: catVal
      });
    }

    document.querySelectorAll('#models-tbody tr').forEach(row => {
      const rowCat = row.dataset.category || '';
      const rowText = row.textContent.toLowerCase();
      const matchSearch = !searchVal || rowText.includes(searchVal);
      const matchCat = !catVal || rowCat === catVal;
      row.style.display = matchSearch && matchCat ? '' : 'none';
    });
  }

  async function loadModels() {
    try {
      const res = await fetch('/v1/models', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const models = data.data || [];
      const homeCount = document.getElementById('stat-models');
      if (homeCount) homeCount.textContent = models.length + ' 个';
      const sysModels = document.getElementById('sys-models-count');
      if (sysModels) sysModels.textContent = models.length + ' 个已装载';
      codexModelIds = [...new Set(models
        .filter(model => model.owned_by?.includes('codex'))
        .map(model => model.id))];

      const modelsCount = document.getElementById('models-count');
      if (modelsCount) modelsCount.innerText = '共 ' + models.length + ' 个已装载模型';
      const tbody = document.getElementById('models-tbody');
      if (!tbody) return;

      tbody.innerHTML = models.map(m => {
        const modelId = escapeHtml(m.id);
        const cat = m.category || (m.owned_by?.includes('codex') ? (m.id.includes('review') ? 'review' : 'chat') : 'chat');
        const catCfg = CATEGORY_MAP[cat] || { label: cat, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' };
        const catBadge = '<span style="display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; color: ' + catCfg.color + '; background: ' + catCfg.bg + '; border: 1px solid ' + catCfg.color + '40;">' + escapeHtml(catCfg.label) + '</span>';

        let source = '<span style="color: var(--success-text);">Google 专线</span>';
        let proto = 'Anthropic & OpenAI 兼容接口';
        let desc = m.display_name ? escapeHtml(m.display_name) : '支持思考/工具调用，享 Prompt Cache 加速';
        if (typeof m.quota_info?.remaining_fraction === 'number') {
          desc += '<div style="margin-top: 4px;" class="tabular-nums">上游配额剩余 ' + Math.round(m.quota_info.remaining_fraction * 1000) / 10 + '%</div>';
        }

        if (m.owned_by?.includes('codex')) {
          source = '<span style="color: #60a5fa;">Codex 算力专线</span>';
          desc = m.description ? escapeHtml(m.description) : '通过 ChatGPT / Codex 订阅调用';
          const state = reasoningStates[m.id] || (reasoningStates[m.id] = { savedEfforts: [], results: Object.create(null), message: '' });
          state.savedEfforts = Array.isArray(m.reasoning_efforts) ? m.reasoning_efforts : [];
          desc += '<div data-reasoning-controls="' + escapeHtml(m.id) + '" style="margin-top: 8px; padding: 8px; border: 1px solid var(--card-border); border-radius: 6px;">' + renderReasoningControls(m.id, state) + '</div>';
        } else {
          const state = reasoningStates[m.id] || (reasoningStates[m.id] = { savedEfforts: [], results: Object.create(null), message: '' });
          state.provider = 'google';
          state.mode = state.mode || m.reasoning_control || 'budget';
          state.savedEfforts = Array.isArray(m.reasoning_efforts) ? m.reasoning_efforts : [];
          desc += '<div data-reasoning-controls="' + escapeHtml(m.id) + '" style="margin-top: 8px; padding: 8px; border: 1px solid var(--card-border); border-radius: 6px;">' + renderReasoningControls(m.id, state) + '</div>';
        }

        return '<tr data-model-row="' + modelId + '" data-category="' + escapeHtml(cat) + '">' +
          '<td><code style="color: #67e8f9; font-weight: 600;">' + modelId + '</code></td>' +
          '<td>' + catBadge + '</td>' +
          '<td>' + source + '</td>' +
          '<td style="color: var(--text-sub); font-size: 12px;">' + proto + '</td>' +
          '<td style="color: var(--text-sub); font-size: 12px;">' + desc + '</td>' +
          '<td data-model-status="' + modelId + '"><span class="tag tag-disabled"><span class="tag-dot"></span>未测试</span></td>' +
          '<td style="text-align: right;"><button class="btn btn-secondary btn-sm" data-test-model="' + modelId + '" aria-label="测试模型 ' + modelId + ' 可用性">测试</button></td>' +
        '</tr>';
      }).join('');

      tbody.querySelectorAll('[data-test-model]').forEach(button => {
        button.addEventListener('click', () => runModelTest(button.dataset.testModel));
      });
      applyModelFilters();
      bindReasoningControls(tbody);
      renderModelTestStates();
    } catch (err) {
      console.error('Failed to load models:', err);
      const homeCount = document.getElementById('stat-models');
      const modelBody = document.getElementById('models-tbody');
      if (homeCount) homeCount.textContent = '读取失败';
      if (modelBody) modelBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger-text);">模型列表读取失败：' + escapeHtml(err.message) + '</td></tr>';
      toast.error('模型清单读取失败：' + err.message);
    }
  }

  async function refreshAllModels() {
    const button = document.getElementById('btn-refresh-models');
    const summary = document.getElementById('model-test-summary');
    const originalLabel = button?.textContent || '🔄 手动刷新全部模型';
    if (button) {
      button.disabled = true;
      button.textContent = '正在从上游刷新…';
    }
    if (summary) {
      summary.innerHTML = '<span style="color: #60a5fa;">正在调用上游接口拉取最新模型目录并比对差异…</span>';
    }
    try {
      const res = await fetch('/v1/admin/models/refresh', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'all' })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || 'HTTP ' + res.status);
      await loadModels();
      if (result.updatedAt) {
        const timeEl = document.getElementById('models-updated-at');
        if (timeEl) timeEl.textContent = '· 缓存时间: ' + new Date(result.updatedAt).toLocaleTimeString();
      }
      if (summary) {
        if (result.updated) {
          summary.innerHTML = '<span style="color: var(--success-text); font-weight: 500;">✓ ' + escapeHtml(result.summary) + '</span>';
        } else {
          summary.innerHTML = '<span style="color: var(--text-sub);">ℹ ' + escapeHtml(result.summary) + '</span>';
        }
      }
      toast.success(result.updated ? '模型已更新：' + result.summary : '模型目录已是最新');
      if (button) button.textContent = result.updated ? '已保存更新' : '无更新条目';
      setTimeout(() => { if (button) button.textContent = originalLabel; }, 3000);
    } catch (error) {
      console.error('Failed to refresh models:', error);
      if (summary) summary.innerHTML = '<span style="color: var(--danger-text);">刷新失败：' + escapeHtml(error.message) + '</span>';
      toast.error('刷新模型失败：' + error.message);
      if (button) button.textContent = '刷新失败';
      setTimeout(() => { if (button) button.textContent = originalLabel; }, 3000);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderReasoningControls(model, state) {
    const saved = state.savedEfforts || [];
    const statusText = state.message ? '<div style="margin-top: 6px;">' + escapeHtml(state.message) + '</div>' : '';
    const efforts = state.provider === 'google' ? GOOGLE_EFFORT_CHOICES : EFFORT_CHOICES;
    const modePicker = state.provider === 'google'
      ? '<label style="margin-right: 8px;">PA 控制方式 <select data-google-mode="' + escapeHtml(model) + '" aria-label="选择 Google PA 控制方式"><option value="budget"' + (state.mode === 'budget' ? ' selected' : '') + '>思考预算</option><option value="level"' + (state.mode === 'level' ? ' selected' : '') + '>原生档位</option></select></label>'
      : '';
    const options = efforts.map(effort => {
      const result = state.results[effort];
      const isSaved = saved.includes(effort);
      const selectable = isSaved || result?.status === 'accepted';
      const label = result?.status === 'accepted' ? '已接受' : result?.status === 'rejected' ? '不支持' : result?.status === 'failed' ? '探测失败' : isSaved ? '已登记' : '未探测';
      const color = result?.status === 'accepted' || isSaved ? 'var(--success-text)' : result?.status === 'rejected' ? 'var(--danger-text)' : 'var(--text-sub)';
      return '<label style="display: inline-flex; align-items: center; gap: 3px; margin: 3px 7px 3px 0; color: ' + color + '; white-space: nowrap;">' +
        '<input type="checkbox" data-effort-option="' + effort + '" ' + (isSaved ? 'checked ' : '') + (!selectable ? 'disabled ' : '') + 'style="accent-color: var(--primary);" aria-label="档位 ' + effort + '">' +
        effort + ' <span style="font-size: 10px;">' + label + '</span></label>';
    }).join('');
    return '<div style="font-size: 11px; color: var(--text-sub); margin-bottom: 5px;">推理强度（先探测，再勾选并保存）</div>' + modePicker +
      '<div>' + options + '</div>' +
      '<div style="display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap;">' +
        '<button class="btn btn-secondary btn-sm" data-probe-efforts="' + escapeHtml(model) + '" ' + (state.busy || reasoningBatchBusy ? 'disabled ' : '') + '>探测档位</button>' +
        '<button class="btn btn-primary btn-sm" data-save-efforts="' + escapeHtml(model) + '" ' + (state.busy || reasoningBatchBusy ? 'disabled ' : '') + '>保存配置</button>' +
        '<button class="btn btn-primary btn-sm" data-probe-save-efforts="' + escapeHtml(model) + '" ' + (state.busy || reasoningBatchBusy ? 'disabled ' : '') + '>一键探测并保存</button>' +
      '</div>' + statusText;
  }

  function bindReasoningControls(root) {
    root.querySelectorAll('[data-google-mode]').forEach(select => {
      select.addEventListener('change', () => {
        const state = reasoningStates[select.dataset.googleMode];
        state.mode = select.value;
        state.results = Object.create(null);
        state.message = '控制方式已切换，请重新探测并保存。';
        loadModels();
      });
    });
    root.querySelectorAll('[data-probe-efforts]').forEach(button => {
      button.addEventListener('click', () => probeModelEfforts(button.dataset.probeEfforts));
    });
    root.querySelectorAll('[data-save-efforts]').forEach(button => {
      button.addEventListener('click', () => saveModelEfforts(button.dataset.saveEfforts, button));
    });
    root.querySelectorAll('[data-probe-save-efforts]').forEach(button => {
      button.addEventListener('click', () => probeAndSaveModelEfforts(button.dataset.probeSaveEfforts));
    });
  }

  async function runAllCodexEffortSetup() {
    if (reasoningBatchBusy) return;
    const models = [...new Set(codexModelIds)];
    const summary = document.getElementById('model-test-summary');
    const button = document.getElementById('btn-probe-save-all-codex');
    if (models.length === 0) {
      if (summary) summary.textContent = '当前没有已装载的 Codex 专线模型。';
      toast.info('没有需要探测的 Codex 模型');
      return;
    }

    const maximumRequests = models.length * EFFORT_CHOICES.length;
    const confirmed = await showConfirmModal({
      title: '批量探测并保存 Codex 模型',
      message: '将顺序探测并保存全部 ' + models.length + ' 个不同的 Codex 上游模型。最多发送 ' + maximumRequests + ' 条短请求并消耗订阅额度。继续操作吗？',
      confirmText: '开始探测',
      isDanger: false
    });
    if (!confirmed) return;

    reasoningBatchBusy = true;
    if (button) {
      button.disabled = true;
      button.innerText = '正在批量探测…';
    }
    await loadModels();
    const results = [];
    try {
      for (let index = 0; index < models.length; index++) {
        const model = models[index];
        if (summary) {
          summary.textContent = '正在批量探测并保存 (' + (index + 1) + '/' + models.length + ')：' + model + '；最多 ' + maximumRequests + ' 条短请求…';
        }
        results.push(await probeAndSaveModelEfforts(model, { refresh: false }));
      }
    } finally {
      reasoningBatchBusy = false;
      if (button) {
        button.disabled = false;
        button.innerText = '一键探测并保存全部 Codex 模型';
      }
      await loadModels();
    }

    const saved = results.filter(result => result.status === 'saved').length;
    const preserved = results.filter(result => result.status === 'preserved').length;
    const failed = results.filter(result => result.status === 'failed');
    const details = failed.map(result => result.model + '：' + result.error).join('；');
    const msg = '批量探测完成：' + saved + '/' + models.length + ' 个模型已保存' +
      (preserved ? '，' + preserved + ' 个因探测异常保留原配置' : '') +
      (failed.length ? '，' + failed.length + ' 个处理失败' + (details ? '（' + details + '）' : '') : '') + '。';
    if (summary) summary.textContent = msg;
    toast.success('批量探测完成，已保存 ' + saved + ' 个模型配置');
  }

  async function probeAndSaveModelEfforts(model, options = {}) {
    const state = reasoningStates[model] || (reasoningStates[model] = { savedEfforts: [], results: Object.create(null), message: '' });
    const probeEfforts = state.provider === 'google' ? GOOGLE_EFFORT_CHOICES : EFFORT_CHOICES;
    const previousEfforts = [...(state.savedEfforts || [])];
    state.busy = true;
    state.message = '正在逐档探测；随后自动保存…';
    if (options.refresh !== false) await loadModels();
    try {
      const probeResponse = await fetch('/v1/admin/models/reasoning-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model, efforts: probeEfforts, ...(state.provider === 'google' ? { mode: state.mode } : {}) })
      });
      const probeData = await probeResponse.json();
      if (!probeResponse.ok) throw new Error(probeData.error?.message || '探测 HTTP ' + probeResponse.status);

      state.results = Object.create(null);
      for (const result of probeData.results || []) state.results[result.effort] = result;
      const results = probeData.results || [];
      const accepted = results.filter(result => result.status === 'accepted').map(result => result.effort);
      const failed = results.filter(result => result.status === 'failed');
      const rejected = results.filter(result => result.status === 'rejected');
      if (accepted.length === 0 && failed.length > 0) {
        state.message = '未保存：本次没有档位探测成功，至少一项因连接、认证或额度问题失败；原配置已保留。';
        return { model, status: 'preserved', error: '未探测到可保存档位' };
      }

      const uncertainSaved = previousEfforts.filter(effort =>
        !state.results[effort] || state.results[effort].status === 'failed'
      );
      const efforts = [...new Set([...accepted, ...uncertainSaved])];
      const saveResponse = await fetch('/v1/admin/models/reasoning-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model, efforts })
      });
      const saveData = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveData.error?.message || '保存 HTTP ' + saveResponse.status);

      const details = [];
      details.push('已保存：' + (efforts.join(', ') || '无档位'));
      if (rejected.length) details.push('拒绝 ' + rejected.map(result => result.effort).join(', '));
      if (failed.length) details.push('探测失败且保留旧登记 ' + uncertainSaved.join(', '));
      state.message = details.join('；');
      return { model, status: 'saved', efforts };
    } catch (err) {
      state.message = '探测或保存失败：' + err.message;
      return { model, status: 'failed', error: err.message };
    } finally {
      state.busy = false;
      if (options.refresh !== false) await loadModels();
    }
  }

  async function probeModelEfforts(model) {
    const state = reasoningStates[model];
    const probeEfforts = state.provider === 'google' ? GOOGLE_EFFORT_CHOICES : EFFORT_CHOICES;
    state.busy = true;
    state.message = '正在逐档调用上游探测；请求会消耗额度…';
    await loadModels();
    try {
      const res = await fetch('/v1/admin/models/reasoning-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model, efforts: probeEfforts, ...(state.provider === 'google' ? { mode: state.mode } : {}) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
      state.results = Object.create(null);
      for (const result of data.results || []) state.results[result.effort] = result;
      const accepted = (data.results || []).filter(result => result.status === 'accepted').map(result => result.effort);
      state.message = '探测完成：接受 ' + (accepted.join(', ') || '无') + '。请核对后保存。';
      toast.success(model + ' 探测完成，可支持档位：' + (accepted.join(', ') || '无'));
    } catch (err) {
      state.message = '探测失败：' + err.message;
      toast.error(model + ' 探测失败：' + err.message);
    } finally {
      state.busy = false;
      await loadModels();
    }
  }

  async function saveModelEfforts(model, button) {
    const state = reasoningStates[model];
    const panel = document.querySelector('[data-reasoning-controls="' + CSS.escape(model) + '"]');
    const efforts = Array.from(panel.querySelectorAll('[data-effort-option]:checked')).map(input => input.dataset.effortOption);
    state.busy = true;
    if (button) button.disabled = true;
    state.message = '正在保存配置…';
    try {
      const res = await fetch('/v1/admin/models/reasoning-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model, efforts })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
      state.message = efforts.length ? '已保存：' + efforts.join(', ') : '已清除该模型的档位登记。';
      toast.success(model + ' 推理档位已持久化保存');
    } catch (err) {
      state.message = '保存失败：' + err.message;
      toast.error(model + ' 保存失败：' + err.message);
    } finally {
      state.busy = false;
      await loadModels();
    }
  }

  function renderModelTestStates() {
    document.querySelectorAll('[data-model-status]').forEach(cell => {
      const state = modelTestResults[cell.dataset.modelStatus];
      if (!state) return;
      const tag = document.createElement('span');
      tag.className = state.status === 'passed' ? 'tag tag-test-passed tabular-nums'
        : state.status === 'failed' ? 'tag tag-test-failed' : 'tag tag-test-running';
      const dot = document.createElement('span');
      dot.className = 'tag-dot';
      const label = document.createTextNode(state.status === 'passed' ? ' 可用 (' + state.elapsedMs + 'ms)'
        : state.status === 'failed' ? ' ' + (state.errorCode || '失败')
        : ' 测试中…');
      tag.append(dot, label);
      tag.title = state.error || state.sample || '';
      cell.replaceChildren(tag);
      if (state.status === 'failed' && state.error) {
        const details = document.createElement('div');
        details.style.cssText = 'color: #fca5a5; font-size: 11px; line-height: 1.4; margin-top: 4px; max-width: 320px; white-space: normal; overflow-wrap: anywhere;';
        details.textContent = (state.errorCode ? 'HTTP ' + state.errorCode + ': ' : '') + state.error;
        cell.append(details);
      }
    });

    document.querySelectorAll('[data-test-model]').forEach(button => {
      button.disabled = modelTestBusy;
    });
    const allButton = document.getElementById('btn-test-all-models');
    if (allButton) allButton.disabled = modelTestBusy;
  }

  async function requestModelTest(model) {
    const res = await fetch('/v1/admin/models/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify({ model })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
    if (!data.results?.[0]) throw new Error('测试接口没有返回结果');
    return data.results[0];
  }

  async function runModelTest(model) {
    if (!model || modelTestBusy) return;
    modelTestBusy = true;
    modelTestResults[model] = { status: 'testing' };
    const summary = document.getElementById('model-test-summary');
    if (summary) summary.textContent = '正在测试 ' + model + '…';
    renderModelTestStates();
    try {
      modelTestResults[model] = await requestModelTest(model);
      const result = modelTestResults[model];
      if (summary) {
        summary.textContent = result.status === 'passed'
          ? model + ' 可用，耗时 ' + result.elapsedMs + 'ms。'
          : model + ' 测试失败：' + result.error;
      }
      if (result.status === 'passed') {
        toast.success(model + ' 测试通过 (' + result.elapsedMs + 'ms)');
      } else {
        toast.error(model + ' 测试未通过: ' + result.error);
      }
    } catch (err) {
      modelTestResults[model] = { status: 'failed', error: err.message };
      if (summary) summary.textContent = model + ' 测试失败：' + err.message;
      toast.error(model + ' 测试发生异常: ' + err.message);
    } finally {
      modelTestBusy = false;
      renderModelTestStates();
    }
  }

  async function runAllModelTests() {
    if (modelTestBusy) return;
    const models = Array.from(document.querySelectorAll('#models-tbody [data-test-model]'))
      .map(button => button.dataset.testModel);
    if (models.length === 0) return;

    modelTestBusy = true;
    const summary = document.getElementById('model-test-summary');
    models.forEach(model => { modelTestResults[model] = { status: 'testing' }; });
    if (summary) summary.textContent = '正在并发测试全部 ' + models.length + ' 个模型…';
    renderModelTestStates();

    try {
      const res = await fetch('/v1/admin/models/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY
        },
        body: JSON.stringify({ all: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);

      for (const result of data.results || []) {
        modelTestResults[result.model] = result;
      }
      const passed = data.passed || 0;
      const failed = data.failed || 0;
      if (summary) {
        summary.textContent = '并发测试完成：' + passed + ' 个可用，' + failed + ' 个失败，共 ' + (data.total || models.length) + ' 个模型。';
      }
      toast.info('全部模型测试完成：' + passed + ' 可用 / ' + failed + ' 失败');
    } catch (err) {
      models.forEach(model => {
        if (modelTestResults[model]?.status === 'testing') {
          modelTestResults[model] = { status: 'failed', error: err.message };
        }
      });
      if (summary) summary.textContent = '批量测试请求失败：' + err.message;
      toast.error('批量测试失败：' + err.message);
    } finally {
      modelTestBusy = false;
      renderModelTestStates();
    }
  }
`;
