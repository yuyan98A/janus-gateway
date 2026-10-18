export const accountsScript = `
  let googleQuotasMap = Object.create(null);
  let googleQuotaLoading = false;

  async function loadAccounts(autoFetch = true) {
    try {
      const res = await fetch('/v1/admin/google/accounts', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const tbody = document.getElementById('accounts-tbody');
      if (!tbody) return;
      if (!data.data || data.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-sub);">暂无配置的 Google 账号</td></tr>';
        return;
      }

      tbody.innerHTML = data.data.map((acc) => {
        let statusTag = '<span class="tag tag-active"><span class="tag-dot"></span>活跃</span>';
        if (acc.isInvalid) {
          statusTag = '<span class="tag tag-invalid"><span class="tag-dot"></span>失效</span>';
        } else if (!acc.enabled) {
          statusTag = '<span class="tag tag-disabled"><span class="tag-dot"></span>已停用</span>';
        }

        const safeId = escapeHtml(acc.id);
        const safeEmail = escapeHtml(acc.email);
        const safeLabel = escapeHtml(acc.label || 'ID: ' + acc.id);
        const safeProject = escapeHtml(acc.projectId || '尚未获取');

        // Quota column rendering - all core models + view all modal button
        const quotaInfo = googleQuotasMap[acc.id] || googleQuotasMap[acc.email.toLowerCase()];
        let quotaHtml = '<span style="color: var(--text-muted); font-size: 11px;">配额同步中…</span>';

        if (quotaInfo) {
          if (quotaInfo.status === 'error') {
            quotaHtml = '<span style="color: var(--danger-text); font-size: 11px;" title="' + escapeHtml(quotaInfo.error || '') + '">获取失败</span>';
          } else {
            const allModels = Object.values(quotaInfo.models || {}) as any[];
            if (allModels.length > 0) {
              const priority = [
                'claude-sonnet-4-6',
                'claude-opus-4-6-thinking',
                'gemini-3.8-flash-tiered',
                'gemini-2.5-pro'
              ];
              // Pick representative models
              const keyModels = priority.map(p => quotaInfo.models?.[p]).filter(Boolean);
              if (keyModels.length === 0) {
                keyModels.push(...allModels.slice(0, 3));
              }

              const barsHtml = keyModels.map((m: any) => {
                const pct = Math.round(m.remainingPercent * 10) / 10;
                let barBg = 'linear-gradient(90deg, #059669, #34d399)';
                let color = 'var(--google-text)';
                if (pct < 20) {
                  barBg = 'var(--danger)';
                  color = 'var(--danger-text)';
                } else if (pct < 50) {
                  barBg = 'var(--warning)';
                  color = 'var(--warning-text)';
                }
                const shortName = m.model.replace('gemini-', '').replace('claude-', '');
                return '<div style="display: flex; flex-direction: column; gap: 2px;" title="' + escapeHtml(m.model + (m.resetTime ? ' · 重置: ' + formatDateTime(m.resetTime) : '')) + '">' +
                  '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px;">' +
                    '<span style="color: var(--text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">' + escapeHtml(shortName) + '</span>' +
                    '<strong class="tabular-nums" style="color: ' + color + ';">' + pct.toFixed(1) + '%</strong>' +
                  '</div>' +
                  '<div class="quota-track" style="margin: 1px 0 3px; max-width: 170px; height: 4px;">' +
                    '<div class="quota-fill quota-fill-google" style="width: ' + Math.min(100, Math.max(0, pct)) + '%; background: ' + barBg + ';"></div>' +
                  '</div>' +
                '</div>';
              }).join('');

              quotaHtml = '<div style="display: flex; flex-direction: column; gap: 2px;">' +
                barsHtml +
                '<button type="button" class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 1px 6px; align-self: flex-start; margin-top: 3px;" onclick="openAccountQuotaModal(\\'' + safeId + '\\')">' +
                  '查看全部 (' + allModels.length + ' 模型) →' +
                '</button>' +
              '</div>';
            } else {
              quotaHtml = '<span style="color: var(--text-muted); font-size: 11px;">无模型配额数据</span>';
            }
          }
        }

        return '<tr>' +
          '<td>' +
            '<div style="font-weight: 500;">' + safeEmail + '</div>' +
            '<div style="font-size: 11px; color: var(--text-sub);">' + safeLabel + '</div>' +
          '</td>' +
          '<td>' + statusTag + '</td>' +
          '<td style="font-family: var(--font-mono); font-size: 12px; color: #94a3b8;">' + safeProject + '</td>' +
          '<td>' + quotaHtml + '</td>' +
          '<td style="text-align: right;">' +
            '<button class="btn btn-secondary btn-sm" onclick="toggleAccount(\\'' + safeId + '\\', ' + (!acc.enabled) + ')" aria-label="' + (acc.enabled ? '停用此账号' : '启用此账号') + '">' +
              (acc.enabled ? '停用' : '启用') +
            '</button>' +
            '<button class="btn btn-danger btn-sm" style="margin-left: 6px;" onclick="deleteAccount(\\'' + safeId + '\\', \\'' + safeEmail + '\\')" aria-label="删除此账号">' +
              '删除' +
            '</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      const searchInput = document.getElementById('account-search');
      if (searchInput && searchInput.value) {
        filterTableRows('accounts-tbody', searchInput.value);
      }

      // Auto-fetch quota in background if not yet loaded
      if (autoFetch && Object.keys(googleQuotasMap).length === 0 && !googleQuotaLoading) {
        refreshGoogleQuotas(true);
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
      const tbody = document.getElementById('accounts-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger-text);">账号列表读取失败：' + escapeHtml(err.message) + '</td></tr>';
      }
      toast.error('Google 账号读取失败：' + err.message);
    }
  }

  async function refreshGoogleQuotas(silent = false) {
    if (googleQuotaLoading) return;
    googleQuotaLoading = true;
    const btn = document.getElementById('btn-refresh-google-quota');
    const summaryEl = document.getElementById('google-quota-summary');
    if (btn) btn.disabled = true;

    if (summaryEl && !silent) {
      summaryEl.style.display = 'block';
      summaryEl.innerHTML = '<span style="color: var(--primary-bright);">正在连接上游 Google Cloud Code PA 接口查询所有账号专线配额…</span>';
    }

    try {
      const res = await fetch('/v1/admin/google/quota', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      googleQuotasMap = Object.create(null);
      for (const acc of data.accounts || []) {
        googleQuotasMap[acc.id] = acc;
        if (acc.email) googleQuotasMap[acc.email.toLowerCase()] = acc;
      }

      await loadAccounts(false);

      if (summaryEl) {
        summaryEl.style.display = 'block';
        const pm = data.summary?.primaryModelQuota;
        let summaryText = '✓ 配额同步完成，共获取 ' + (data.summary?.activeAccounts ?? 0) + '/' + (data.summary?.totalAccounts ?? 0) + ' 个账号配额';
        if (pm) {
          summaryText += ' · 主力模型 <strong>' + escapeHtml(pm.model) + '</strong> 当前最高剩余 <strong style="color: var(--google-text);">' + pm.remainingPercent.toFixed(1) + '%</strong> (来自 ' + escapeHtml(pm.sourceAccount) + ')';
        }
        summaryEl.innerHTML = '<span style="color: var(--success-text);">' + summaryText + '</span>';
      }
      if (!silent) toast.success('Google 专线实时配额已刷新');
    } catch (err) {
      console.error('Failed to refresh Google quota:', err);
      if (summaryEl && !silent) {
        summaryEl.style.display = 'block';
        summaryEl.innerHTML = '<span style="color: var(--danger-text);">配额查询失败：' + escapeHtml(err.message) + '</span>';
      }
      if (!silent) toast.error('查询配额失败：' + err.message);
    } finally {
      googleQuotaLoading = false;
      if (btn) btn.disabled = false;
    }
  }

  function openAccountQuotaModal(accountId) {
    const modal = document.getElementById('all-quotas-modal');
    const metaEl = document.getElementById('all-quotas-modal-meta');
    const tbody = document.getElementById('all-quotas-tbody');
    if (!modal) return;

    const quota = googleQuotasMap[accountId];
    if (!quota) {
      toast.warning('该账号暂无同步的配额数据');
      return;
    }

    if (metaEl) {
      metaEl.innerHTML = '<strong>账号:</strong> ' + escapeHtml(quota.email || quota.id) +
        ' · <strong>项目 ID:</strong> ' + escapeHtml(quota.projectId || 'N/A') +
        ' · <strong>状态:</strong> ' + (quota.status === 'ok' ? '<span style="color: var(--success-text);">健康正常</span>' : '<span style="color: var(--danger-text);">异常</span>') +
        ' · <strong>更新时间:</strong> ' + escapeHtml(formatDateTime(quota.checkedAt));
    }

    if (tbody) {
      const models = Object.values(quota.models || {}) as any[];
      if (models.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">上游未返回任何模型配额</td></tr>';
      } else {
        const priority = ['claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gemini-3.8-flash-tiered', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gpt-oss-120b-medium'];
        models.sort((a, b) => {
          const pa = priority.indexOf(a.model);
          const pb = priority.indexOf(b.model);
          if (pa !== -1 && pb !== -1) return pa - pb;
          if (pa !== -1) return -1;
          if (pb !== -1) return 1;
          return a.model.localeCompare(b.model);
        });

        tbody.innerHTML = models.map((m: any) => {
          const pct = Math.round(m.remainingPercent * 10) / 10;
          let color = 'var(--google-text)';
          let barBg = 'linear-gradient(90deg, #059669, #34d399)';
          if (pct < 20) {
            color = 'var(--danger-text)';
            barBg = 'var(--danger)';
          } else if (pct < 50) {
            color = 'var(--warning-text)';
            barBg = 'var(--warning)';
          }
          return '<tr>' +
            '<td style="font-weight: 500; color: var(--text-pure);">' + escapeHtml(m.displayName || m.model) + '</td>' +
            '<td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-sub);">' + escapeHtml(m.model) + '</td>' +
            '<td>' +
              '<div style="display: flex; align-items: center; gap: 8px;">' +
                '<div class="quota-track" style="margin: 0; width: 80px; height: 5px;">' +
                  '<div class="quota-fill quota-fill-google" style="width: ' + pct + '%; background: ' + barBg + ';"></div>' +
                '</div>' +
                '<strong class="tabular-nums" style="font-size: 11px; color: ' + color + ';">' + pct.toFixed(1) + '%</strong>' +
              '</div>' +
            '</td>' +
            '<td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">' + (typeof m.remainingFraction === 'number' ? m.remainingFraction.toFixed(4) : '—') + '</td>' +
            '<td style="font-size: 11px; color: var(--text-sub);">' + (m.resetTime ? escapeHtml(formatDateTime(m.resetTime)) : '—') + '</td>' +
          '</tr>';
        }).join('');
      }
    }

    if (typeof modal.showModal === 'function') {
      modal.showModal();
    }
  }

  function closeAllQuotasModal() {
    const modal = document.getElementById('all-quotas-modal');
    if (modal && typeof modal.close === 'function') {
      modal.close();
    }
  }

  async function toggleAccount(id, enabled) {
    try {
      const res = await fetch('/v1/admin/google/accounts/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY
        },
        body: JSON.stringify({ enabled })
      });
      if (res.ok) {
        toast.success(enabled ? '账号已成功启用' : '账号已停用');
        loadAccounts();
      } else {
        const errText = await res.text();
        toast.error('更新账号状态失败: ' + errText);
      }
    } catch (err) {
      toast.error('网络请求异常: ' + err.message);
    }
  }

  async function deleteAccount(id, email) {
    const confirmed = await showConfirmModal({
      title: '删除 Google 账号凭据',
      message: '确定要从账号池中删除账号 ' + (email || id) + ' 吗？删除后将无法通过此凭据调度上游算力。',
      confirmText: '确认删除',
      isDanger: true
    });
    if (!confirmed) return;

    try {
      const res = await fetch('/v1/admin/google/accounts/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (res.ok) {
        toast.success('账号已成功删除');
        loadAccounts();
      } else {
        const errText = await res.text();
        toast.error('删除账号失败: ' + errText);
      }
    } catch (err) {
      toast.error('网络请求异常: ' + err.message);
    }
  }

  function openAddModal() {
    const modal = document.getElementById('add-modal');
    if (modal && typeof modal.showModal === 'function') {
      modal.showModal();
    }
  }

  function closeAddModal() {
    const modal = document.getElementById('add-modal');
    if (modal && typeof modal.close === 'function') {
      modal.close();
    }
  }

  async function submitAddAccount() {
    const tokenEl = document.getElementById('add-token');
    const labelEl = document.getElementById('add-label');
    const projectEl = document.getElementById('add-project');

    const token = tokenEl?.value.trim() || '';
    const label = labelEl?.value.trim() || '';
    const project = projectEl?.value.trim() || '';

    if (!token) {
      toast.error('请输入有效 Refresh Token');
      if (tokenEl) tokenEl.focus();
      return;
    }

    try {
      const res = await fetch('/v1/admin/google/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY
        },
        body: JSON.stringify({ refreshToken: token, label, projectId: project })
      });
      if (res.ok) {
        closeAddModal();
        if (tokenEl) tokenEl.value = '';
        if (labelEl) labelEl.value = '';
        if (projectEl) projectEl.value = '';
        toast.success('Google 账号已成功导入并验证！');
        loadAccounts();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error('添加失败: ' + (err.error?.message || '上游校验未通过'));
      }
    } catch (err) {
      toast.error('网络请求异常: ' + err.message);
    }
  }

  async function startOAuthLogin() {
    try {
      const res = await fetch('/v1/admin/google/accounts/oauth-url', {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      const data = await res.json();
      if (data.url) {
        closeAddModal();
        window.open(data.url, '_blank');
        toast.info('已在新窗口打开 Google 授权登录页面，请按指引完成授权。');
      } else {
        throw new Error('未返回授权跳转 URL');
      }
    } catch (err) {
      toast.error('启动 Google 授权失败: ' + err.message);
    }
  }

  // Check if returning from Google OAuth redirect flow
  function checkOAuthRedirect() {
    if (DASHBOARD_PAGE === 'google-accounts' && window.location.search.includes('login=success')) {
      toast.success('🎉 Google 账号已成功授权并加入网关账号池！', 6000);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
`;
