export const coreScript = `
  // --- Core Utility: Safe HTML Escaping ---
  function escapeHtml(value) {
    const replacements = {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    };
    return String(value ?? '').replace(/[&<>"']/g, char => replacements[char]);
  }

  // --- Core Utility: Standardized Intl Formatters ---
  const numberFormatter = new Intl.NumberFormat('zh-CN');
  const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });

  function formatTokens(value) {
    return numberFormatter.format(Number(value || 0));
  }

  function formatDateTime(dateVal) {
    if (!dateVal) return '—';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return dateTimeFormatter.format(d);
    } catch (_) {
      return String(dateVal);
    }
  }

  function utcDateString(date) {
    return date.toISOString().slice(0, 10);
  }

  // --- Core Component: Non-blocking Accessible Toast Notification System ---
  const toast = {
    show(message, type = 'info', duration = 4000) {
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toastEl = document.createElement('div');
      toastEl.className = 'toast toast-' + type;
      toastEl.setAttribute('role', type === 'error' ? 'alert' : 'status');
      toastEl.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

      const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ'
      };

      const iconEl = document.createElement('span');
      iconEl.className = 'toast-icon';
      iconEl.setAttribute('aria-hidden', 'true');
      iconEl.textContent = icons[type] || 'ℹ';

      const contentEl = document.createElement('span');
      contentEl.className = 'toast-content';
      contentEl.textContent = message;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'toast-close';
      closeBtn.setAttribute('type', 'button');
      closeBtn.setAttribute('aria-label', '关闭通知');
      closeBtn.textContent = '×';

      toastEl.append(iconEl, contentEl, closeBtn);
      container.appendChild(toastEl);

      // Trigger entrance transition
      requestAnimationFrame(() => {
        toastEl.classList.add('show');
      });

      let timer = null;
      const startTimer = () => {
        if (duration > 0) {
          timer = setTimeout(dismiss, duration);
        }
      };
      const clearTimer = () => {
        if (timer) clearTimeout(timer);
      };

      const dismiss = () => {
        clearTimer();
        toastEl.classList.remove('show');
        toastEl.addEventListener('transitionend', () => {
          if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        }, { once: true });
      };

      closeBtn.addEventListener('click', dismiss);
      toastEl.addEventListener('mouseenter', clearTimer);
      toastEl.addEventListener('mouseleave', startTimer);
      startTimer();
    },
    success(msg, duration) { this.show(msg, 'success', duration); },
    error(msg, duration) { this.show(msg, 'error', duration || 5000); },
    info(msg, duration) { this.show(msg, 'info', duration); }
  };

  // --- Core Component: Native <dialog>-based Promise Confirm Modal ---
  function showConfirmModal(options) {
    const { title = '请确认操作', message, confirmText = '确认', cancelText = '取消', isDanger = false } = options;
    const dialog = document.getElementById('confirm-modal');
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(message));
    }

    const titleEl = document.getElementById('confirm-modal-title');
    const descEl = document.getElementById('confirm-modal-desc');
    const confirmBtn = document.getElementById('confirm-modal-confirm');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = message;
    if (confirmBtn) {
      confirmBtn.textContent = confirmText;
      confirmBtn.className = 'btn btn-sm ' + (isDanger ? 'btn-danger' : 'btn-primary');
    }
    if (cancelBtn) cancelBtn.textContent = cancelText;

    return new Promise((resolve) => {
      let resolved = false;

      const handleConfirm = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        dialog.close();
        resolve(true);
      };

      const handleCancel = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        dialog.close();
        resolve(false);
      };

      const handleClose = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        dialog.removeEventListener('close', handleClose);
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      dialog.addEventListener('close', handleClose);

      dialog.showModal();
    });
  }

  // --- Core Utility: URL Search Parameters Sync ---
  function getUrlParam(key) {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  }

  function updateUrlParams(updates) {
    const url = new URL(window.location.href);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === undefined || val === '') {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, String(val));
      }
    }
    window.history.replaceState({}, document.title, url.toString());
  }

  // --- Core Utility: Clipboard Copy with Toast Feedback ---
  async function copyText(button, elementId) {
    const target = document.getElementById(elementId);
    if (!target) return;
    const text = target.innerText;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制到剪贴板');
      if (button) {
        const originalText = button.innerText;
        button.innerText = '已复制!';
        setTimeout(() => { button.innerText = originalText; }, 1800);
      }
    } catch (_) {
      toast.error('复制失败，请手动选择复制');
    }
  }

  async function copyRequestId(requestId, button) {
    try {
      await navigator.clipboard.writeText(requestId);
      toast.success('已复制请求 ID');
      if (button) {
        const originalText = button.innerText;
        button.innerText = '已复制';
        setTimeout(() => { button.innerText = originalText; }, 1800);
      }
    } catch (_) {
      toast.error('复制失败，请手动选择请求 ID');
    }
  }

  function filterTableRows(tbodyId, query) {
    const normalized = String(query || '').trim().toLocaleLowerCase();
    document.querySelectorAll('#' + tbodyId + ' tr').forEach(row => {
      row.style.display = !normalized || row.textContent.toLocaleLowerCase().includes(normalized) ? '' : 'none';
    });
  }
`;
