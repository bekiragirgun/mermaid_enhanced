/* ========== Mermaid Diagram Editor – Frontend ========== */
(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const preview = $('#mermaidPreview');
  const previewError = $('#previewError');
  const chatMessages = $('#chatMessages');
  const chatInput = $('#chatInput');
  const btnSend = $('#btnSend');
  const chatStatus = $('#chatStatus');
  const settingsModal = $('#settingsModal');
  const toast = $('#toast');

  // ── Mermaid init ──────────────────────────────────────
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    fontFamily: 'JetBrains Mono, monospace',
  });

  // ── CodeMirror ────────────────────────────────────────
  const defaultCode = `graph TD
    A[Başlangıç] --> B{Karar}
    B -->|Evet| C[İşlem 1]
    B -->|Hayır| D[İşlem 2]
    C --> E[Son]
    D --> E`;

  const editor = CodeMirror.fromTextArea($('#codeEditor'), {
    mode: 'markdown',
    theme: 'material-darker',
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentWithTabs: false,
    autofocus: true,
  });
  editor.setValue(defaultCode);

  // ── Live preview (debounced) ──────────────────────────
  let debounceTimer = null;

  function renderPreview() {
    const code = editor.getValue().trim();
    if (!code) {
      preview.innerHTML = '';
      previewError.style.display = 'none';
      return;
    }

    const id = 'mermaid-' + Date.now();
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        preview.innerHTML = svg;
        previewError.style.display = 'none';
      })
      .catch((err) => {
        preview.innerHTML = '';
        previewError.textContent = err.message || 'Render hatası';
        previewError.style.display = 'block';
        // mermaid leaves error container in DOM
        document.querySelectorAll('#d' + id).forEach((el) => el.remove());
      });
  }

  editor.on('change', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderPreview, 300);
  });

  // Initial render
  setTimeout(renderPreview, 200);

  // ── Export ─────────────────────────────────────────────
  document.querySelectorAll('.btn-export').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const format = btn.dataset.format;
      const code = editor.getValue().trim();
      if (!code) return showToast('Editör boş', 'error');

      btn.disabled = true;
      try {
        const res = await fetch('/api/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, format, theme: 'dark' }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Export başarısız');
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diagram.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast(`${format.toUpperCase()} indirildi`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // ── Settings ──────────────────────────────────────────
  function loadSettings() {
    return {
      baseUrl: localStorage.getItem('ai_base_url') || '',
      apiKey: localStorage.getItem('ai_api_key') || '',
      model: localStorage.getItem('ai_model') || '',
    };
  }

  function saveSettings(s) {
    localStorage.setItem('ai_base_url', s.baseUrl);
    localStorage.setItem('ai_api_key', s.apiKey);
    localStorage.setItem('ai_model', s.model);
  }

  $('#btnSettings').addEventListener('click', () => {
    const s = loadSettings();
    $('#settingBaseUrl').value = s.baseUrl;
    $('#settingApiKey').value = s.apiKey;
    $('#settingModel').value = s.model;
    settingsModal.style.display = 'flex';
  });

  $('#btnCloseSettings').addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.style.display = 'none';
  });

  $('#btnSaveSettings').addEventListener('click', () => {
    saveSettings({
      baseUrl: $('#settingBaseUrl').value.trim(),
      apiKey: $('#settingApiKey').value.trim(),
      model: $('#settingModel').value.trim(),
    });
    settingsModal.style.display = 'none';
    showToast('Ayarlar kaydedildi', 'success');
  });

  // ── Diagram Save/Load ───────────────────────────────
  const saveModal = $('#saveModal');
  const diagramsModal = $('#diagramsModal');
  const diagramsList = $('#diagramsList');
  const diagramsEmpty = $('#diagramsEmpty');

  $('#btnSave').addEventListener('click', () => {
    $('#saveDiagramName').value = '';
    saveModal.style.display = 'flex';
    setTimeout(() => $('#saveDiagramName').focus(), 50);
  });

  $('#btnCloseSave').addEventListener('click', () => { saveModal.style.display = 'none'; });
  saveModal.addEventListener('click', (e) => { if (e.target === saveModal) saveModal.style.display = 'none'; });

  $('#saveDiagramName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmSave(); }
  });

  $('#btnConfirmSave').addEventListener('click', confirmSave);

  async function confirmSave() {
    const name = $('#saveDiagramName').value.trim();
    if (!name) return showToast('Diyagram adı girin', 'error');
    const code = editor.getValue().trim();
    if (!code) return showToast('Editör boş', 'error');

    try {
      const res = await fetch('/api/diagrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Kayıt başarısız');
      }
      saveModal.style.display = 'none';
      showToast('Diyagram kaydedildi', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  $('#btnOpen').addEventListener('click', loadDiagramList);
  $('#btnCloseDiagrams').addEventListener('click', () => { diagramsModal.style.display = 'none'; });
  diagramsModal.addEventListener('click', (e) => { if (e.target === diagramsModal) diagramsModal.style.display = 'none'; });

  async function loadDiagramList() {
    diagramsModal.style.display = 'flex';
    diagramsList.innerHTML = '<div class="diagrams-loading">Yükleniyor…</div>';
    diagramsEmpty.style.display = 'none';

    try {
      const res = await fetch('/api/diagrams');
      const diagrams = await res.json();

      if (!diagrams.length) {
        diagramsList.innerHTML = '';
        diagramsEmpty.style.display = 'block';
        return;
      }

      diagramsEmpty.style.display = 'none';
      diagramsList.innerHTML = diagrams.map((d) => `
        <div class="diagram-item" data-id="${d.id}">
          <div class="diagram-item-info">
            <span class="diagram-item-name">${escapeHtml(d.name)}</span>
            <span class="diagram-item-date">${new Date(d.updatedAt).toLocaleString('tr-TR')}</span>
          </div>
          <div class="diagram-item-actions">
            <button class="btn btn-open-diagram" data-id="${d.id}" title="Aç">Aç</button>
            <button class="btn btn-delete-diagram" data-id="${d.id}" title="Sil">Sil</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      diagramsList.innerHTML = '<div class="diagrams-loading">Hata: ' + escapeHtml(err.message) + '</div>';
    }
  }

  diagramsList.addEventListener('click', async (e) => {
    const openBtn = e.target.closest('.btn-open-diagram');
    const deleteBtn = e.target.closest('.btn-delete-diagram');

    if (openBtn) {
      const id = openBtn.dataset.id;
      try {
        const res = await fetch(`/api/diagrams/${id}`);
        if (!res.ok) throw new Error('Diyagram bulunamadı');
        const data = await res.json();
        editor.setValue(data.code);
        renderPreview();
        diagramsModal.style.display = 'none';
        showToast(`"${data.name}" yüklendi`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const item = deleteBtn.closest('.diagram-item');
      const name = item.querySelector('.diagram-item-name').textContent;
      if (!confirm(`"${name}" silinecek. Emin misiniz?`)) return;

      try {
        const res = await fetch(`/api/diagrams/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Silme başarısız');
        item.remove();
        if (!diagramsList.children.length) diagramsEmpty.style.display = 'block';
        showToast('Diyagram silindi', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  // ── Chat ──────────────────────────────────────────────
  let chatHistory = [];
  let isStreaming = false;

  function addChatMessage(role, html) {
    // Remove welcome message on first chat
    const welcome = chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.innerHTML = html;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  function extractMermaidCode(text) {
    const match = text.match(/```mermaid\s*\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  }

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text || isStreaming) return;

    const settings = loadSettings();
    if (!settings.baseUrl || !settings.apiKey) {
      showToast('Önce AI ayarlarını yapılandırın', 'error');
      return;
    }

    // User message
    chatHistory.push({ role: 'user', content: text });
    addChatMessage('user', escapeHtml(text));
    chatInput.value = '';
    autoResize();

    isStreaming = true;
    chatStatus.textContent = 'Yanıt alınıyor…';
    btnSend.disabled = true;

    const assistantBubble = addChatMessage('assistant', '');
    let fullResponse = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Base-URL': settings.baseUrl,
          'X-AI-API-Key': settings.apiKey,
          'X-AI-Model': settings.model || 'gpt-3.5-turbo',
        },
        body: JSON.stringify({
          messages: chatHistory,
          currentCode: editor.getValue(),
        }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              fullResponse += `\n[Hata: ${parsed.error}]`;
              break;
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) fullResponse += delta;
          } catch {
            // skip unparseable chunks
          }
        }

        assistantBubble.innerHTML = renderMarkdown(fullResponse);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    } catch (err) {
      fullResponse += `\n[Bağlantı hatası: ${err.message}]`;
    }

    // Final render with apply button
    const mermaidCode = extractMermaidCode(fullResponse);
    let html = renderMarkdown(fullResponse);
    if (mermaidCode) {
      html += `<button class="btn-apply" data-code="${encodeURIComponent(mermaidCode)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Kodu Uygula
      </button>`;
    }
    assistantBubble.innerHTML = html;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    chatHistory.push({ role: 'assistant', content: fullResponse });
    isStreaming = false;
    chatStatus.textContent = '';
    btnSend.disabled = false;
  }

  // Apply code from chat
  chatMessages.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-apply');
    if (!btn) return;
    const code = decodeURIComponent(btn.dataset.code);
    editor.setValue(code);
    renderPreview();
    showToast('Kod uygulandı', 'success');
  });

  btnSend.addEventListener('click', sendChat);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // Auto-resize textarea
  function autoResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
  }
  chatInput.addEventListener('input', autoResize);

  // ── Zoom ─────────────────────────────────────────────
  let zoomScale = 1.0;
  const zoomStep = 0.1;
  const zoomMin = 0.2;
  const zoomMax = 3.0;
  const zoomLevelEl = $('#zoomLevel');

  function applyZoom() {
    preview.style.transform = `scale(${zoomScale})`;
    preview.style.transformOrigin = 'center center';
    zoomLevelEl.textContent = Math.round(zoomScale * 100) + '%';
  }

  $('#btnZoomIn').addEventListener('click', () => {
    zoomScale = Math.min(zoomMax, +(zoomScale + zoomStep).toFixed(1));
    applyZoom();
  });

  $('#btnZoomOut').addEventListener('click', () => {
    zoomScale = Math.max(zoomMin, +(zoomScale - zoomStep).toFixed(1));
    applyZoom();
  });

  $('#btnZoomReset').addEventListener('click', () => {
    zoomScale = 1.0;
    applyZoom();
  });

  // ── Utilities ─────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    // Simple markdown: code blocks, inline code, bold, newlines
    return escapeHtml(text)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  let toastTimer = null;
  function showToast(msg, type = '') {
    toast.textContent = msg;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 2500);
  }
})();
