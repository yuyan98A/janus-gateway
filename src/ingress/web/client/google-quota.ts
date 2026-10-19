export const googleQuotaScript = `
  function googleQuotaResetText(bucket, offsetMs = 0) {
    if (!bucket.resetTime) return '重置时间未知';
    const diffMs = Date.parse(bucket.resetTime) - (Date.now() + offsetMs);
    if (!Number.isFinite(diffMs)) return '重置时间未知';
    if (diffMs <= 0) return '已到重置时间，请刷新配额';
    const minutes = Math.ceil(diffMs / 60000);
    return '距重置 ' + Math.floor(minutes / 60) + '小时 ' + (minutes % 60) + '分';
  }

  function renderGoogleQuotaPools(quota, compact = false) {
    const groups = quota.groups || [];
    if (!groups.length) return '<div style="color: var(--text-muted); font-size: 12px;">上游未提供有效算力池窗口，配额未知</div>';
    return groups.map(group => {
      const buckets = [...(group.buckets || [])].sort((a, b) =>
        (a.window === 'weekly' ? 0 : a.window === '5h' ? 1 : 2) - (b.window === 'weekly' ? 0 : b.window === '5h' ? 1 : 2));
      const rows = buckets.map(bucket => {
        const known = typeof bucket.remainingPercent === 'number' && Number.isFinite(bucket.remainingPercent);
        const pct = known ? Math.max(0, Math.min(100, bucket.remainingPercent)) : null;
        const color = !known ? 'var(--text-muted)' : pct <= 15 ? 'var(--danger-text)' : pct < 40 ? 'var(--warning-text)' : 'var(--google-text)';
        const name = bucket.window === 'weekly' ? '周额度' : bucket.window === '5h' ? '5 小时额度' : (bucket.displayName || bucket.window || '额度窗口');
        const blocked = bucket.available === false && bucket.remainingFraction > 0 ? ' · 周额度已耗尽' : '';
        return '<div style="margin: 7px 0;">' +
          '<div style="display: flex; justify-content: space-between; gap: 10px; font-size: 11px;">' +
            '<span title="' + escapeHtml(bucket.displayName || name) + '">' + escapeHtml(name) + '</span>' +
            '<strong class="tabular-nums" style="color: ' + color + '; white-space: nowrap;">' + (known ? '剩余 ' + pct.toFixed(2) + '%' : '配额未知') + '</strong>' +
          '</div>' +
          (known ? '<div class="quota-track" style="margin: 4px 0; height: 4px;"><div class="quota-fill quota-fill-google" style="width: ' + pct + '%; background: ' + color + ';"></div></div>' : '') +
          '<div style="font-size: 10px; color: var(--text-muted);">' + escapeHtml(googleQuotaResetText(bucket, quota.serverTimeOffsetMs || 0) + blocked) +
            (bucket.resetTime ? ' · ' + escapeHtml(formatDateTime(bucket.resetTime)) : '') + '</div>' +
        '</div>';
      }).join('');
      return '<div style="margin: 8px 0; padding: 8px; border: 1px solid var(--border-hairline); border-radius: 6px;">' +
        '<div style="font-size: 12px; font-weight: 600;">' + escapeHtml(group.displayName) + '</div>' +
        (!compact && group.description ? '<div style="font-size: 10px; color: var(--text-muted);">' + escapeHtml(group.description) + '</div>' : '') +
        (rows || '<div style="font-size: 11px; color: var(--text-muted);">上游未返回额度窗口</div>') +
      '</div>';
    }).join('');
  }
`;
