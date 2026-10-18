export const playgroundScript = `
  async function loadPlaygroundModels() {
    const select = document.getElementById('test-model');
    if (!select) return;
    const selectedModel = select.value;
    try {
      const res = await fetch('/v1/models', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const models = data.data || [];
      select.innerHTML = models.map(model => {
        const name = model.display_name ? model.id + ' — ' + model.display_name : model.id;
        const quota = typeof model.quota_info?.remaining_fraction === 'number'
          ? ' · 配额 ' + Math.round(model.quota_info.remaining_fraction * 100) + '%'
          : '';
        return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(name + quota) + '</option>';
      }).join('');
      if (models.some(model => model.id === selectedModel)) select.value = selectedModel;
      if (models.length === 0) select.innerHTML = '<option value="">未发现可用模型</option>';
    } catch (err) {
      select.innerHTML = '<option value="">模型发现失败</option>';
      const statusEl = document.getElementById('test-status');
      if (statusEl) statusEl.innerText = '模型发现失败：' + err.message;
      toast.error('模型加载失败：' + err.message);
    }
  }

  async function runPlaygroundTest() {
    const modelEl = document.getElementById('test-model');
    const promptEl = document.getElementById('test-prompt');
    const output = document.getElementById('test-output');
    const status = document.getElementById('test-status');
    const btn = document.getElementById('btn-send-test');

    const model = modelEl?.value;
    const prompt = promptEl?.value;

    if (!model) {
      toast.error('请选择有效的测试模型');
      return;
    }
    if (!prompt) {
      toast.error('请输入测试提示词');
      if (promptEl) promptEl.focus();
      return;
    }

    if (btn) btn.disabled = true;
    if (output) output.innerText = '正在建立流式连接…\\n';
    if (status) status.innerText = '发送请求中…';

    const startTime = Date.now();
    try {
      const res = await fetch('/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ': ' + await res.text());
      }

      if (output) output.innerText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                if (output) output.innerText += parsed.delta.text;
              }
            } catch (_) {}
          }
        }
      }

      const elapsed = Date.now() - startTime;
      if (status) status.innerHTML = '<span style="color: var(--success-text);">✓ 完成 (耗时: <span class="tabular-nums">' + elapsed + '</span> ms)</span>';
      toast.success('流式推理已完成 (' + elapsed + 'ms)');
    } catch (err) {
      if (output) output.innerText = '请求失败:\\n' + err.message;
      if (status) status.innerHTML = '<span style="color: var(--danger-text);">✗ 发生错误</span>';
      toast.error('推理请求失败: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
`;
