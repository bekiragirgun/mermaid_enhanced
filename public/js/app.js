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

  // ── Theme toggle ─────────────────────────────────────
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  function getMermaidTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';
  }

  // ── Mermaid init ──────────────────────────────────────
  mermaid.initialize({
    startOnLoad: false,
    theme: getMermaidTheme(),
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
  let cleanupNodeDrag = null;
  let diagramModified = false; // true when nodes have been dragged

  function renderPreview() {
    diagramModified = false;
    if (cleanupNodeDrag) { cleanupNodeDrag(); cleanupNodeDrag = null; }

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
        cleanupNodeDrag = enableNodeDragging();
      })
      .catch((err) => {
        preview.innerHTML = '';
        previewError.textContent = err.message || 'Render hatası';
        previewError.style.display = 'block';
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
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function getModifiedSVGString() {
    const svg = preview.querySelector('svg');
    if (!svg) return null;
    const clone = svg.cloneNode(true);

    // Copy computed font styles inline (avoids cross-origin taint on canvas)
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = `text, .label { font-family: sans-serif; }`;
    clone.insertBefore(styleEl, clone.firstChild);

    // Expand viewBox on the clone to fit all dragged nodes (for export only)
    const vbAttr = clone.getAttribute('viewBox');
    const origVB = vbAttr ? vbAttr.split(/[\s,]+/).map(Number) : [0, 0, 500, 500];
    let minX = origVB[0], minY = origVB[1];
    let maxX = origVB[0] + origVB[2], maxY = origVB[1] + origVB[3];
    const pad = 40;

    clone.querySelectorAll('g.node').forEach((g) => {
      const bbox = g.getBBox();
      const t = g.getAttribute('transform') || '';
      let tx = 0, ty = 0;
      const matches = t.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/g);
      if (matches) {
        matches.forEach((m) => {
          const parts = m.match(/-?[\d.]+/g);
          if (parts && parts.length >= 2) { tx += parseFloat(parts[0]); ty += parseFloat(parts[1]); }
        });
      }
      const nMinX = bbox.x + tx - pad;
      const nMinY = bbox.y + ty - pad;
      const nMaxX = bbox.x + bbox.width + tx + pad;
      const nMaxY = bbox.y + bbox.height + ty + pad;
      if (nMinX < minX) minX = nMinX;
      if (nMinY < minY) minY = nMinY;
      if (nMaxX > maxX) maxX = nMaxX;
      if (nMaxY > maxY) maxY = nMaxY;
    });

    const w = maxX - minX;
    const h = maxY - minY;
    clone.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);

    return new XMLSerializer().serializeToString(clone);
  }

  function exportModifiedSVG(format) {
    const svgString = getModifiedSVGString();
    if (!svgString) { showToast('SVG bulunamadı', 'error'); return Promise.resolve(); }

    if (format === 'svg') {
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      downloadBlob(blob, 'diagram.svg');
      showToast('SVG indirildi', 'success');
      return Promise.resolve();
    }

    // PNG: render SVG to canvas using inline data URI (avoids tainted canvas)
    return new Promise((resolve) => {
      const img = new Image();
      const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

      img.onload = () => {
        const scale = 2; // retina quality
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth * scale;
        canvas.height = img.naturalHeight * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            downloadBlob(pngBlob, 'diagram.png');
            showToast('PNG indirildi', 'success');
          } else {
            showToast('PNG oluşturulamadı', 'error');
          }
          resolve();
        }, 'image/png');
      };

      img.onerror = () => {
        showToast('PNG oluşturulamadı', 'error');
        resolve();
      };

      img.src = dataUri;
    });
  }

  document.querySelectorAll('.btn-export').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const format = btn.dataset.format;
      const code = editor.getValue().trim();
      if (!code) return showToast('Editör boş', 'error');

      btn.disabled = true;
      try {
        // If diagram layout was modified by dragging, export from current SVG DOM
        if (diagramModified && (format === 'png' || format === 'svg')) {
          await exportModifiedSVG(format);
          return;
        }

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
        downloadBlob(blob, `diagram.${format}`);
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
    updateModelBadge();
  }

  // ── Model badge ─────────────────────────────────────
  const modelBadge = $('#modelBadge');
  const modelBadgeText = $('#modelBadgeText');

  function updateModelBadge() {
    const s = loadSettings();
    if (s.model) {
      modelBadgeText.textContent = s.model;
      modelBadge.classList.remove('no-model');
    } else {
      modelBadgeText.textContent = 'Model ayarlanmadı';
      modelBadge.classList.add('no-model');
    }
  }

  modelBadge.addEventListener('click', () => {
    const s = loadSettings();
    $('#settingBaseUrl').value = s.baseUrl;
    $('#settingApiKey').value = s.apiKey;
    setModelSelectValue(s.model);
    settingsModal.style.display = 'flex';
  });

  updateModelBadge();

  const modelSelect = $('#settingModel');

  function setModelSelectValue(model) {
    // If model exists as option, select it; otherwise add it
    if (model && ![...modelSelect.options].some(o => o.value === model)) {
      const opt = document.createElement('option');
      opt.value = model;
      opt.textContent = model;
      modelSelect.appendChild(opt);
    }
    modelSelect.value = model || '';
  }

  $('#btnSettings').addEventListener('click', () => {
    const s = loadSettings();
    $('#settingBaseUrl').value = s.baseUrl;
    $('#settingApiKey').value = s.apiKey;
    setModelSelectValue(s.model);
    settingsModal.style.display = 'flex';
  });

  $('#btnCloseSettings').addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.style.display = 'none';
  });

  $('#btnFetchModels').addEventListener('click', async () => {
    const baseUrl = $('#settingBaseUrl').value.trim();
    const apiKey = $('#settingApiKey').value.trim();
    if (!baseUrl) return showToast('Önce Base URL girin', 'error');

    const btn = $('#btnFetchModels');
    btn.disabled = true;
    btn.textContent = '…';

    try {
      const res = await fetch('/api/models', {
        headers: {
          'X-AI-Base-URL': baseUrl,
          ...(apiKey ? { 'X-AI-API-Key': apiKey } : {}),
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Model listesi alınamadı');
      }

      const models = await res.json();
      const currentVal = modelSelect.value;

      // Clear existing options except placeholder
      modelSelect.innerHTML = '<option value="">— Model seçin —</option>';
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        modelSelect.appendChild(opt);
      });

      // Restore previous selection if still available
      if (currentVal && [...modelSelect.options].some(o => o.value === currentVal)) {
        modelSelect.value = currentVal;
      }

      showToast(`${models.length} model bulundu`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Getir';
    }
  });

  $('#btnSaveSettings').addEventListener('click', () => {
    const selectedModel = modelSelect.value || $('#settingBaseUrl').value.trim() ? modelSelect.value : '';
    saveSettings({
      baseUrl: $('#settingBaseUrl').value.trim(),
      apiKey: $('#settingApiKey').value.trim(),
      model: selectedModel,
    });
    settingsModal.style.display = 'none';
    showToast('Ayarlar kaydedildi', 'success');
    updateModelBadge();
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

  // Tab switching in Open modal
  const tabDiagrams = $('#tabDiagrams');
  const tabHistory = $('#tabHistory');
  const historyList = $('#historyList');
  const historyEmpty = $('#historyEmpty');

  diagramsModal.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      diagramsModal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.tab === 'diagrams') {
        tabDiagrams.style.display = '';
        tabHistory.style.display = 'none';
      } else {
        tabDiagrams.style.display = 'none';
        tabHistory.style.display = '';
        loadHistoryList();
      }
    });
  });

  $('#btnOpen').addEventListener('click', () => {
    // Reset to diagrams tab
    diagramsModal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    diagramsModal.querySelector('[data-tab="diagrams"]').classList.add('active');
    tabDiagrams.style.display = '';
    tabHistory.style.display = 'none';
    loadDiagramList();
  });
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

  // ── Chat History ───────────────────────────────────
  async function loadHistoryList() {
    historyList.innerHTML = '<div class="diagrams-loading">Yükleniyor…</div>';
    historyEmpty.style.display = 'none';
    try {
      const res = await fetch('/api/history');
      const items = await res.json();
      if (!items.length) {
        historyList.innerHTML = '';
        historyEmpty.style.display = 'block';
        return;
      }
      historyEmpty.style.display = 'none';
      historyList.innerHTML = items.map((h) => `
        <div class="diagram-item" data-id="${h.id}">
          <div class="diagram-item-info">
            <span class="diagram-item-name">${escapeHtml(h.title)}</span>
            <span class="history-item-preview">${escapeHtml(h.preview)}</span>
            <span class="history-item-meta">${h.messageCount} mesaj · ${new Date(h.updatedAt).toLocaleString('tr-TR')}</span>
          </div>
          <div class="diagram-item-actions">
            <button class="btn btn-open-diagram" data-id="${h.id}" title="Yükle">Yükle</button>
            <button class="btn btn-delete-diagram" data-id="${h.id}" title="Sil">Sil</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      historyList.innerHTML = '<div class="diagrams-loading">Hata: ' + escapeHtml(err.message) + '</div>';
    }
  }

  historyList.addEventListener('click', async (e) => {
    const openBtn = e.target.closest('.btn-open-diagram');
    const deleteBtn = e.target.closest('.btn-delete-diagram');

    if (openBtn) {
      const id = openBtn.dataset.id;
      try {
        const res = await fetch(`/api/history/${id}`);
        if (!res.ok) throw new Error('Geçmiş bulunamadı');
        const data = await res.json();

        // Restore diagram code
        if (data.diagramCode) {
          editor.setValue(data.diagramCode);
          renderPreview();
        }

        // Restore chat messages
        chatHistory = data.messages || [];
        chatMessages.innerHTML = '';
        for (const msg of chatHistory) {
          if (msg.role === 'user') {
            addChatMessage('user', escapeHtml(msg.content));
          } else if (msg.role === 'assistant') {
            const mermaidCode = extractMermaidCode(msg.content);
            let html = renderMarkdown(msg.content);
            if (mermaidCode) {
              html += `<button class="btn-apply" data-code="${encodeURIComponent(mermaidCode)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Kodu Uygula
              </button>`;
            }
            addChatMessage('assistant', html);
          }
        }

        diagramsModal.style.display = 'none';
        showToast(`"${data.title}" yüklendi`, 'success');
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
        const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Silme başarısız');
        item.remove();
        if (!historyList.children.length) historyEmpty.style.display = 'block';
        showToast('Geçmiş silindi', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  // Auto-save chat after each AI response
  function autoSaveChatHistory() {
    if (chatHistory.length < 2) return; // at least 1 user + 1 assistant
    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        diagramCode: editor.getValue(),
      }),
    }).catch(() => {}); // silent save
  }

  // ── Stop & Clear ────────────────────────────────────
  const btnStop = $('#btnStop');
  const btnClear = $('#btnClear');
  let currentAbort = null;

  function showStopBtn(show) {
    btnStop.style.display = show ? 'inline-flex' : 'none';
  }

  btnStop.addEventListener('click', () => {
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
    }
  });

  btnClear.addEventListener('click', () => {
    editor.setValue('');
    renderPreview();
    showToast('Editör temizlendi', 'success');
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
    showStopBtn(true);

    const abortController = new AbortController();
    currentAbort = abortController;

    const assistantBubble = addChatMessage('assistant', '');
    let fullResponse = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal: abortController.signal,
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
      if (err.name === 'AbortError') {
        fullResponse += '\n[Durduruldu]';
      } else {
        fullResponse += `\n[Bağlantı hatası: ${err.message}]`;
      }
    }

    currentAbort = null;
    showStopBtn(false);

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
    autoSaveChatHistory();
  }

  // Apply code from chat — with auto-fix on error
  chatMessages.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-apply');
    if (!btn) return;
    const code = decodeURIComponent(btn.dataset.code);
    editor.setValue(code);

    const id = 'mermaid-apply-' + Date.now();
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        preview.innerHTML = svg;
        previewError.style.display = 'none';
        diagramModified = false;
        if (cleanupNodeDrag) { cleanupNodeDrag(); cleanupNodeDrag = null; }
        cleanupNodeDrag = enableNodeDragging();
        showToast('Kod uygulandı', 'success');
      })
      .catch((err) => {
        preview.innerHTML = '';
        const errorMsg = err.message || 'Render hatası';
        previewError.textContent = errorMsg;
        previewError.style.display = 'block';
        document.querySelectorAll('#d' + id).forEach((el) => el.remove());

        // Auto-fix: send error back to AI
        showToast('Render hatası — AI düzeltme isteniyor…', 'error');
        const fixPrompt = `Ürettiğin mermaid kodu render hatası verdi. Hatayı oku, kodu düzelt ve tekrar gönder.

HATA:
${errorMsg}

HATALI KOD:
\`\`\`mermaid
${code}
\`\`\`

Kurallar:
- Sadece düzeltilmiş kodu \`\`\`mermaid bloğu içinde döndür
- Diyagramın yapısını ve içeriğini değiştirme, sadece sözdizimini düzelt
- Kısa bir açıklama ekle (ne düzelttin)`;

        chatInput.value = fixPrompt;
        sendChat();
      });
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

  // ── Node Dragging ───────────────────────────────────
  function enableNodeDragging() {
    const svg = preview.querySelector('svg');
    if (!svg) return null;

    const nodeGroups = [...svg.querySelectorAll('g.node')];
    if (!nodeGroups.length) return null;

    // Allow SVG content to overflow its viewBox
    svg.style.overflow = 'visible';
    svg.style.maxWidth = 'none';

    // Parse original viewBox
    const vbAttr = svg.getAttribute('viewBox');
    const origVB = vbAttr ? vbAttr.split(/[\s,]+/).map(Number) : [0, 0, 500, 500];

    // Store node data (original transform + center)
    const nodeMap = new Map();
    nodeGroups.forEach((g) => {
      const bbox = g.getBBox();
      nodeMap.set(g, {
        origTransform: g.getAttribute('transform') || '',
        cx: bbox.x + bbox.width / 2,
        cy: bbox.y + bbox.height / 2,
      });
      g.style.cursor = 'move';
    });

    // Parse edges — Mermaid v11: paths are direct children of g.edgePaths
    // Path IDs follow pattern L_{source}_{target}_{index}
    const edges = [];
    const edgePathEls = [...svg.querySelectorAll('g.edgePaths > path')];
    const edgeLabelEls = [...svg.querySelectorAll('g.edgeLabels > g.edgeLabel')];

    edgePathEls.forEach((pathEl, i) => {
      const d = pathEl.getAttribute('d');
      if (!d) return;

      // Try to resolve source/target from path ID (e.g. "L_A_B_0")
      let source = null, target = null;
      const idMatch = pathEl.id && pathEl.id.match(/^L_(.+?)_(.+?)_\d+$/);
      if (idMatch) {
        const srcKey = idMatch[1];
        const tgtKey = idMatch[2];
        for (const [g] of nodeMap) {
          if (g.id.includes(`-${srcKey}-`)) source = g;
          if (g.id.includes(`-${tgtKey}-`)) target = g;
        }
      }

      // Fallback: proximity-based matching
      if (!source || !target) {
        const nums = d.match(/-?\d+\.?\d*/g);
        if (!nums || nums.length < 4) return;
        const sx = parseFloat(nums[0]), sy = parseFloat(nums[1]);
        const ex = parseFloat(nums[nums.length - 2]), ey = parseFloat(nums[nums.length - 1]);
        let minDS = Infinity, minDT = Infinity;
        for (const [g, data] of nodeMap) {
          const ds = Math.hypot(sx - data.cx, sy - data.cy);
          const dt = Math.hypot(ex - data.cx, ey - data.cy);
          if (!source || ds < minDS) { minDS = ds; source = g; }
          if (!target || dt < minDT) { minDT = dt; target = g; }
        }
      }

      const labelEl = i < edgeLabelEls.length ? edgeLabelEls[i] : null;
      edges.push({
        pathEl,
        originalD: d,
        source,
        target,
        labelEl,
        labelOrigTransform: labelEl ? (labelEl.getAttribute('transform') || '') : '',
      });
    });

    // Drag state
    let activeNode = null;
    let startSVGX = 0, startSVGY = 0;

    function screenToSVG(cx, cy) {
      const pt = svg.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    // Capture the initial CTM at drag start so that viewBox changes
    // during the drag don't distort the coordinate mapping.
    let dragCTMInverse = null;
    let startScreenX = 0, startScreenY = 0;

    function onMouseDown(e) {
      const nodeG = e.target.closest('g.node');
      if (!nodeG || !nodeMap.has(nodeG)) return;
      e.stopPropagation();
      e.preventDefault();
      activeNode = nodeG;

      // Lock the CTM at drag start — prevents feedback loop
      dragCTMInverse = svg.getScreenCTM().inverse();
      startScreenX = e.clientX;
      startScreenY = e.clientY;

      const svgPt = svg.createSVGPoint();
      svgPt.x = e.clientX;
      svgPt.y = e.clientY;
      const p = svgPt.matrixTransform(dragCTMInverse);
      startSVGX = p.x;
      startSVGY = p.y;
    }

    function onMouseMove(e) {
      if (!activeNode || !dragCTMInverse) return;
      e.preventDefault();

      // Use the LOCKED CTM from drag start for consistent mapping
      const svgPt = svg.createSVGPoint();
      svgPt.x = e.clientX;
      svgPt.y = e.clientY;
      const p = svgPt.matrixTransform(dragCTMInverse);
      const dx = p.x - startSVGX;
      const dy = p.y - startSVGY;

      lastDx = dx;
      lastDy = dy;

      const data = nodeMap.get(activeNode);
      activeNode.setAttribute('transform', `${data.origTransform} translate(${dx}, ${dy})`);

      // Update connected edges
      edges.forEach((ed) => {
        let srcDx = 0, srcDy = 0, tgtDx = 0, tgtDy = 0;
        if (ed.source === activeNode) { srcDx = dx; srcDy = dy; }
        if (ed.target === activeNode) { tgtDx = dx; tgtDy = dy; }
        if (srcDx === 0 && srcDy === 0 && tgtDx === 0 && tgtDy === 0) return;

        ed.pathEl.setAttribute('d', shiftPathEnds(ed.originalD, srcDx, srcDy, tgtDx, tgtDy));

        // Move edge label with midpoint of shift
        if (ed.labelEl) {
          const midDx = (srcDx + tgtDx) / 2;
          const midDy = (srcDy + tgtDy) / 2;
          ed.labelEl.setAttribute('transform', `${ed.labelOrigTransform} translate(${midDx}, ${midDy})`);
        }
      });

      // Don't expand viewBox during drag — only on commit
    }

    function expandViewBox() {
      let minX = origVB[0], minY = origVB[1];
      let maxX = origVB[0] + origVB[2], maxY = origVB[1] + origVB[3];
      const pad = 40;

      for (const [g, data] of nodeMap) {
        const bbox = g.getBBox();
        const t = g.getAttribute('transform') || '';
        // Extract total translate offset from transform
        let tx = 0, ty = 0;
        const matches = t.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/g);
        if (matches) {
          matches.forEach((m) => {
            const parts = m.match(/-?[\d.]+/g);
            if (parts && parts.length >= 2) { tx += parseFloat(parts[0]); ty += parseFloat(parts[1]); }
          });
        }

        const nodeMinX = bbox.x + tx - pad;
        const nodeMinY = bbox.y + ty - pad;
        const nodeMaxX = bbox.x + bbox.width + tx + pad;
        const nodeMaxY = bbox.y + bbox.height + ty + pad;

        if (nodeMinX < minX) minX = nodeMinX;
        if (nodeMinY < minY) minY = nodeMinY;
        if (nodeMaxX > maxX) maxX = nodeMaxX;
        if (nodeMaxY > maxY) maxY = nodeMaxY;
      }

      svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    }

    let lastDx = 0, lastDy = 0;

    function commitDrag() {
      if (!activeNode) return;
      diagramModified = true;
      const data = nodeMap.get(activeNode);

      // Commit position
      data.origTransform = activeNode.getAttribute('transform');
      data.cx += lastDx;
      data.cy += lastDy;

      // Update edge original data
      edges.forEach((ed) => {
        if (ed.source === activeNode || ed.target === activeNode) {
          ed.originalD = ed.pathEl.getAttribute('d');
          if (ed.labelEl) {
            ed.labelOrigTransform = ed.labelEl.getAttribute('transform');
          }
        }
      });

      // Don't expand viewBox for preview — overflow:visible handles it
      // ViewBox expansion is done only at export time in getModifiedSVGString()

      activeNode = null;
      dragCTMInverse = null;
      lastDx = 0;
      lastDy = 0;
    }

    svg.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', commitDrag);

    // Return cleanup function
    return () => {
      svg.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', commitDrag);
    };
  }

  // Shift SVG path endpoints with gradient interpolation
  function shiftPathEnds(d, srcDx, srcDy, tgtDx, tgtDy) {
    const numRegex = /-?\d+\.?\d*/g;
    const nums = [];
    let match;
    while ((match = numRegex.exec(d)) !== null) {
      nums.push({ val: parseFloat(match[0]), idx: match.index, len: match[0].length });
    }

    const numPairs = Math.floor(nums.length / 2);
    if (numPairs < 2) return d;

    // Apply gradient: first pair → source offset, last pair → target offset
    for (let i = 0; i < nums.length - 1; i += 2) {
      const t = (i / 2) / (numPairs - 1);
      nums[i].val += srcDx * (1 - t) + tgtDx * t;
      nums[i + 1].val += srcDy * (1 - t) + tgtDy * t;
    }

    // Rebuild from back to front to preserve indices
    let result = d;
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      result = result.substring(0, n.idx) + n.val.toFixed(2) + result.substring(n.idx + n.len);
    }
    return result;
  }

  // ── File Upload (PDF, TXT, MD, CSV) ─────────────────
  const fileInput = $('#fileInput');
  const btnAttach = $('#btnAttach');

  btnAttach.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = ''; // reset for re-upload

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      showToast('Dosya çok büyük (max 10MB)', 'error');
      return;
    }

    const settings = loadSettings();
    if (!settings.baseUrl || !settings.apiKey) {
      showToast('Önce AI ayarlarını yapılandırın', 'error');
      return;
    }

    showToast(`"${file.name}" okunuyor…`);

    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch('/api/parse-document', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': file.name,
        },
        body: buffer,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Dosya okunamadı');
      }

      const data = await res.json();

      if (!data.text || !data.text.trim()) {
        showToast('Dosyadan metin çıkarılamadı', 'error');
        return;
      }

      showToast(`${data.charCount} karakter okundu`, 'success');

      // Send to AI chat with a diagram generation prompt
      const prompt = `Aşağıdaki dokümanı analiz et ve içeriğine uygun bir Mermaid diyagramı oluştur.
Doküman türüne göre en uygun diyagram tipini seç (flowchart, sequence, class, ER, mindmap, timeline vb.).
Doküman ana konularını, ilişkileri ve akışları diyagrama yansıt.

Dosya: ${file.name}

Doküman İçeriği:
---
${data.text}
---`;

      chatInput.value = prompt;
      sendChat();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ── Voice Input (Web Speech API) ─────────────────────
  const btnMic = $('#btnMic');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecording = false;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = true;

    let finalTranscript = '';

    recognition.onstart = () => {
      isRecording = true;
      btnMic.classList.add('recording');
      btnMic.title = 'Dinleniyor… (durdurmak için tıklayın)';
      chatStatus.textContent = 'Dinleniyor…';
    };

    recognition.onresult = (e) => {
      let interim = '';
      finalTranscript = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      chatInput.value = finalTranscript || interim;
      autoResize();
    };

    recognition.onend = () => {
      isRecording = false;
      btnMic.classList.remove('recording');
      btnMic.title = 'Sesli Komut';
      chatStatus.textContent = '';
      if (finalTranscript.trim()) {
        sendChat();
      }
    };

    recognition.onerror = (e) => {
      isRecording = false;
      btnMic.classList.remove('recording');
      chatStatus.textContent = '';
      if (e.error === 'not-allowed') {
        showToast('Mikrofon erişimi reddedildi', 'error');
      } else if (e.error !== 'aborted') {
        showToast('Ses tanıma hatası: ' + e.error, 'error');
      }
    };

    btnMic.addEventListener('click', () => {
      if (isRecording) {
        recognition.stop();
      } else {
        finalTranscript = '';
        chatInput.value = '';
        recognition.start();
      }
    });
  } else {
    btnMic.style.display = 'none';
  }

  // ── Zoom & Pan ──────────────────────────────────────
  let zoomScale = 1.0;
  const zoomStep = 0.1;
  const zoomMin = 0.2;
  const zoomMax = 3.0;
  const zoomLevelEl = $('#zoomLevel');
  const previewContainer = $('#previewContainer');

  let panX = 0;
  let panY = 0;

  function applyTransform() {
    preview.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    preview.style.transformOrigin = 'center center';
    zoomLevelEl.textContent = Math.round(zoomScale * 100) + '%';
  }

  $('#btnZoomIn').addEventListener('click', () => {
    zoomScale = Math.min(zoomMax, +(zoomScale + zoomStep).toFixed(1));
    applyTransform();
  });

  $('#btnZoomOut').addEventListener('click', () => {
    zoomScale = Math.max(zoomMin, +(zoomScale - zoomStep).toFixed(1));
    applyTransform();
  });

  $('#btnZoomReset').addEventListener('click', () => {
    zoomScale = 1.0;
    panX = 0;
    panY = 0;
    applyTransform();
  });

  // Mouse wheel zoom
  previewContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
    zoomScale = Math.max(zoomMin, Math.min(zoomMax, +(zoomScale + delta).toFixed(1)));
    applyTransform();
  }, { passive: false });

  // Drag to pan
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  previewContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    previewContainer.classList.add('grabbing');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    previewContainer.classList.remove('grabbing');
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

  // ── Panel resizer ────────────────────────────────────
  const panelResizer = $('#panelResizer');
  const mainLayout = $('.main-layout');

  let isResizing = false;

  panelResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    panelResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const rect = mainLayout.getBoundingClientRect();
    const offset = e.clientX - rect.left;
    const total = rect.width;
    const pct = Math.max(20, Math.min(80, (offset / total) * 100));
    mainLayout.style.gridTemplateColumns = `${pct}% 4px 1fr`;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing && !isVResizing) return;
    if (isResizing) {
      isResizing = false;
      panelResizer.classList.remove('dragging');
    }
    if (isVResizing) {
      isVResizing = false;
      editorChatResizer.classList.remove('dragging');
      editor.refresh(); // recalculate CodeMirror layout
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ── Editor-Chat vertical resizer ───────────────────
  const editorChatResizer = $('#editorChatResizer');
  const editorSection = $('.editor-section');
  const chatSection = $('.chat-section');
  let isVResizing = false;

  editorChatResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isVResizing = true;
    editorChatResizer.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isVResizing) return;
    const parent = editorSection.parentElement;
    const rect = parent.getBoundingClientRect();
    const offset = e.clientY - rect.top;
    const total = rect.height;
    const pct = Math.max(15, Math.min(85, (offset / total) * 100));
    editorSection.style.flex = 'none';
    chatSection.style.flex = 'none';
    editorSection.style.height = `calc(${pct}% - 2px)`;
    chatSection.style.height = `calc(${100 - pct}% - 2px)`;
  });

  // ── Theme toggle handler ─────────────────────────────
  $('#btnTheme').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    // Re-init mermaid with matching theme and re-render
    mermaid.initialize({
      startOnLoad: false,
      theme: next === 'light' ? 'default' : 'dark',
      securityLevel: 'loose',
      fontFamily: 'JetBrains Mono, monospace',
    });
    renderPreview();
  });

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

  // ── 1. Template Gallery ──────────────────────────────
  const templates = [
    {
      name: 'Akış Şeması (Flowchart)',
      code: `graph TD
    A["Başlangıç"] --> B{"Karar?"}
    B -->|Evet| C["İşlem 1"]
    B -->|Hayır| D["İşlem 2"]
    C --> E["Son"]
    D --> E`
    },
    {
      name: 'Sıra Diyagramı (Sequence)',
      code: `sequenceDiagram
    participant K as Kullanici
    participant S as Sunucu
    participant VT as Veritabani
    K->>S: İstek gönder
    activate S
    S->>VT: Sorgu
    VT-->>S: Sonuç
    S-->>K: Yanıt
    deactivate S`
    },
    {
      name: 'Sınıf Diyagramı (Class)',
      code: `classDiagram
    class Hayvan {
        +String isim
        +int yas
        +sesCikar() String
    }
    class Kedi {
        +miyavla()
    }
    class Kopek {
        +havla()
    }
    Hayvan <|-- Kedi
    Hayvan <|-- Kopek`
    },
    {
      name: 'ER Diyagramı',
      code: `erDiagram
    KULLANICI ||--o{ SIPARIS : verir
    SIPARIS ||--|{ URUN : icerir
    KULLANICI {
        int id PK
        string ad
        string email
    }
    SIPARIS {
        int id PK
        date tarih
        float toplam
    }
    URUN {
        int id PK
        string ad
        float fiyat
    }`
    },
    {
      name: 'Gantt Şeması',
      code: `gantt
    title Proje Plani
    dateFormat YYYY-MM-DD
    section Tasarim
        Analiz           :a1, 2024-01-01, 7d
        Wireframe        :a2, after a1, 5d
    section Gelistirme
        Backend          :b1, after a2, 14d
        Frontend         :b2, after a2, 10d
    section Test
        Test             :c1, after b1, 7d`
    },
    {
      name: 'Durum Diyagramı (State)',
      code: `stateDiagram-v2
    [*] --> Bekliyor
    Bekliyor --> Isleniyor : istek geldi
    Isleniyor --> Tamamlandi : basarili
    Isleniyor --> Hata : hata olustu
    Hata --> Bekliyor : tekrar dene
    Tamamlandi --> [*]`
    },
    {
      name: 'Pasta Grafik (Pie)',
      code: `pie title Bütçe Dağılımı
    "Geliştirme" : 40
    "Tasarım" : 25
    "Test" : 20
    "Yönetim" : 15`
    },
    {
      name: 'Zihin Haritası (Mindmap)',
      code: `mindmap
    root((Proje))
        Planlama
            Gereksinimler
            Zaman Çizelgesi
        Gelistirme
            Frontend
            Backend
            Veritabani
        Test
            Birim Test
            Entegrasyon
        Dagitim`
    }
  ];

  const templateModal = $('#templateModal');
  const templateGrid = $('#templateGrid');

  function renderTemplateGallery() {
    templateGrid.innerHTML = templates.map((t, i) => `
      <div class="template-card" data-idx="${i}">
        <span class="template-card-title">${escapeHtml(t.name)}</span>
        <div class="template-card-preview" id="tplPreview${i}"></div>
        <button class="template-card-btn" data-idx="${i}">Kullan</button>
      </div>
    `).join('');

    // Render small previews
    templates.forEach((t, i) => {
      const container = $(`#tplPreview${i}`);
      const previewId = 'tpl-' + Date.now() + '-' + i;
      mermaid.render(previewId, t.code).then(({ svg }) => {
        container.innerHTML = svg;
      }).catch(() => {
        container.innerHTML = '<span style="color:var(--overlay0);font-size:11px">Önizleme yok</span>';
        document.querySelectorAll('#d' + previewId).forEach(el => el.remove());
      });
    });
  }

  function openTemplateGallery() {
    renderTemplateGallery();
    templateModal.style.display = 'flex';
  }

  $('#btnTemplates').addEventListener('click', openTemplateGallery);
  $('#btnCloseTemplates').addEventListener('click', () => { templateModal.style.display = 'none'; });
  templateModal.addEventListener('click', (e) => {
    if (e.target === templateModal) templateModal.style.display = 'none';
  });

  templateGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.template-card-btn') || e.target.closest('.template-card');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (isNaN(idx) || !templates[idx]) return;

    // Load template into active tab
    editor.setValue(templates[idx].code);
    renderPreview();
    templateModal.style.display = 'none';

    // Update tab name
    const activeTab = document.querySelector('.editor-tab.active');
    if (activeTab) {
      const title = activeTab.querySelector('.tab-title');
      if (title) title.textContent = templates[idx].name;
      const tabId = activeTab.dataset.tabId;
      const tab = tabs.find(t => t.id === tabId);
      if (tab) tab.name = templates[idx].name;
    }

    showToast(`"${templates[idx].name}" yüklendi`, 'success');
  });

  // ── 2. Keyboard Shortcuts ────────────────────────────
  const shortcutsModal = $('#shortcutsModal');
  $('#btnCloseShortcuts').addEventListener('click', () => { shortcutsModal.style.display = 'none'; });
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) shortcutsModal.style.display = 'none';
  });

  function closeAllModals() {
    settingsModal.style.display = 'none';
    saveModal.style.display = 'none';
    diagramsModal.style.display = 'none';
    templateModal.style.display = 'none';
    shortcutsModal.style.display = 'none';
    const versionsModal = $('#versionsModal');
    if (versionsModal) versionsModal.style.display = 'none';

    // Exit fullscreen if active
    const previewPanel = $('.preview-panel');
    if (previewPanel.classList.contains('fullscreen-preview')) {
      toggleFullscreen();
    }
  }

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    // Escape → close modals / exit fullscreen
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAllModals();
      return;
    }

    // ? → shortcuts help (only when not in input)
    if (e.key === '?' && !mod && !e.target.closest('textarea, input, .CodeMirror')) {
      e.preventDefault();
      shortcutsModal.style.display = 'flex';
      return;
    }

    if (!mod) return;

    // Ctrl+S → Save
    if (e.key === 's' && !e.shiftKey) {
      e.preventDefault();
      $('#btnSave').click();
      return;
    }

    // Ctrl+O → Open
    if (e.key === 'o' && !e.shiftKey) {
      e.preventDefault();
      $('#btnOpen').click();
      return;
    }

    // Ctrl+E → PNG export
    if (e.key === 'e' && !e.shiftKey) {
      e.preventDefault();
      document.querySelector('.btn-export[data-format="png"]').click();
      return;
    }

    // Ctrl+Enter → send chat
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
      return;
    }

    // Ctrl+Shift+F → fullscreen
    if (e.key === 'F' && e.shiftKey) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    // Ctrl+T → templates
    if (e.key === 't' && !e.shiftKey) {
      e.preventDefault();
      openTemplateGallery();
      return;
    }

    // Ctrl+L → theme toggle
    if (e.key === 'l' && !e.shiftKey) {
      e.preventDefault();
      $('#btnTheme').click();
      return;
    }

    // Ctrl+/ → shortcuts help
    if (e.key === '/') {
      e.preventDefault();
      shortcutsModal.style.display = 'flex';
      return;
    }
  });

  // ── 3. Fullscreen Preview ────────────────────────────
  const previewPanel = $('.preview-panel');

  // Add exit button to preview panel
  const fullscreenExitBtn = document.createElement('button');
  fullscreenExitBtn.className = 'fullscreen-exit-btn';
  fullscreenExitBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
    Çık (ESC)
  `;
  previewPanel.appendChild(fullscreenExitBtn);

  function toggleFullscreen() {
    previewPanel.classList.toggle('fullscreen-preview');
    // Preserve zoom controls in fullscreen
  }

  $('#btnFullscreen').addEventListener('click', toggleFullscreen);
  fullscreenExitBtn.addEventListener('click', toggleFullscreen);

  // ── 4. Version History ───────────────────────────────
  const versionsModal = $('#versionsModal');
  const versionsList = $('#versionsList');
  const versionsEmpty = $('#versionsEmpty');

  $('#btnCloseVersions').addEventListener('click', () => { versionsModal.style.display = 'none'; });
  versionsModal.addEventListener('click', (e) => {
    if (e.target === versionsModal) versionsModal.style.display = 'none';
  });

  async function openVersionHistory(diagramId) {
    versionsModal.style.display = 'flex';
    versionsList.innerHTML = '<div class="diagrams-loading">Yükleniyor…</div>';
    versionsEmpty.style.display = 'none';

    try {
      const res = await fetch(`/api/diagrams/${diagramId}/versions`);
      const versions = await res.json();

      if (!versions.length) {
        versionsList.innerHTML = '';
        versionsEmpty.style.display = 'block';
        return;
      }

      versionsEmpty.style.display = 'none';
      versionsList.innerHTML = versions.map(v => `
        <div class="diagram-item" data-diagram-id="${diagramId}" data-version-id="${v.id}">
          <div class="diagram-item-info">
            <span class="diagram-item-date">${new Date(parseInt(v.id)).toLocaleString('tr-TR')}</span>
            <span class="version-item-code">${escapeHtml(v.codePreview)}</span>
          </div>
          <div class="diagram-item-actions">
            <button class="btn btn-open-diagram btn-restore-version" data-diagram-id="${diagramId}" data-version-id="${v.id}">Yükle</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      versionsList.innerHTML = '<div class="diagrams-loading">Hata: ' + escapeHtml(err.message) + '</div>';
    }
  }

  versionsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-restore-version');
    if (!btn) return;
    const diagramId = btn.dataset.diagramId;
    const versionId = btn.dataset.versionId;

    try {
      const res = await fetch(`/api/diagrams/${diagramId}/versions/${versionId}`);
      if (!res.ok) throw new Error('Versiyon bulunamadı');
      const data = await res.json();
      editor.setValue(data.code);
      renderPreview();
      versionsModal.style.display = 'none';
      diagramsModal.style.display = 'none';
      showToast('Eski versiyon yüklendi', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add "Geçmiş" button dynamically when diagrams modal opens
  const diagramsObserver = new MutationObserver(() => {
    diagramsList.querySelectorAll('.diagram-item').forEach(item => {
      const id = item.dataset.id;
      const actions = item.querySelector('.diagram-item-actions');
      if (actions && !actions.querySelector('.btn-versions')) {
        const vBtn = document.createElement('button');
        vBtn.className = 'btn btn-versions';
        vBtn.dataset.id = id;
        vBtn.textContent = 'Geçmiş';
        vBtn.title = 'Sürüm Geçmişi';
        vBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openVersionHistory(id);
        });
        actions.insertBefore(vBtn, actions.firstChild);
      }
    });
  });
  diagramsObserver.observe(diagramsList, { childList: true });

  // ── 5. Multi-tab Editor ──────────────────────────────
  const editorTabs = $('#editorTabs');
  let tabCounter = 1;
  const tabs = [
    { id: 'tab-1', name: 'Adsız', code: editor.getValue(), scrollPos: { left: 0, top: 0 } }
  ];
  let activeTabId = 'tab-1';

  function renderTabs() {
    const tabsHtml = tabs.map(t => `
      <div class="editor-tab ${t.id === activeTabId ? 'active' : ''}" data-tab-id="${t.id}">
        <span class="tab-title">${escapeHtml(t.name)}</span>
        ${tabs.length > 1 ? '<button class="tab-close" title="Kapat">&times;</button>' : ''}
      </div>
    `).join('');
    editorTabs.innerHTML = tabsHtml + '<button class="tab-add" id="btnAddTab" title="Yeni Sekme">+</button>';

    // Re-bind add button
    $('#btnAddTab').addEventListener('click', addNewTab);
  }

  function switchTab(tabId) {
    // Save current tab state
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab) {
      currentTab.code = editor.getValue();
      const scrollInfo = editor.getScrollInfo();
      currentTab.scrollPos = { left: scrollInfo.left, top: scrollInfo.top };
    }

    // Switch to new tab
    activeTabId = tabId;
    const newTab = tabs.find(t => t.id === tabId);
    if (newTab) {
      editor.setValue(newTab.code);
      editor.scrollTo(newTab.scrollPos.left, newTab.scrollPos.top);
      renderPreview();
    }
    renderTabs();
  }

  function addNewTab() {
    if (tabs.length >= 10) {
      showToast('Maksimum 10 sekme açılabilir', 'error');
      return;
    }

    // Save current tab
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab) {
      currentTab.code = editor.getValue();
    }

    tabCounter++;
    const newTab = {
      id: 'tab-' + tabCounter,
      name: 'Adsız',
      code: defaultCode,
      scrollPos: { left: 0, top: 0 }
    };
    tabs.push(newTab);
    activeTabId = newTab.id;
    editor.setValue(newTab.code);
    renderPreview();
    renderTabs();
  }

  function closeTab(tabId) {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    tabs.splice(idx, 1);

    if (activeTabId === tabId) {
      // Switch to adjacent tab
      const newIdx = Math.min(idx, tabs.length - 1);
      activeTabId = tabs[newIdx].id;
      editor.setValue(tabs[newIdx].code);
      editor.scrollTo(tabs[newIdx].scrollPos.left, tabs[newIdx].scrollPos.top);
      renderPreview();
    }
    renderTabs();
  }

  editorTabs.addEventListener('click', (e) => {
    // "+" button
    if (e.target.closest('.tab-add')) {
      addNewTab();
      return;
    }
    const closeBtn = e.target.closest('.tab-close');
    if (closeBtn) {
      const tabEl = closeBtn.closest('.editor-tab');
      closeTab(tabEl.dataset.tabId);
      return;
    }
    const tabEl = e.target.closest('.editor-tab');
    if (tabEl && tabEl.dataset.tabId !== activeTabId) {
      switchTab(tabEl.dataset.tabId);
    }
  });

  // Update tab name when diagram is opened
  diagramsList.addEventListener('click', (e) => {
    const openBtn = e.target.closest('.btn-open-diagram');
    if (!openBtn) return;
    // After loading diagram, update tab name
    const id = openBtn.dataset.id;
    const item = openBtn.closest('.diagram-item');
    if (item) {
      const nameEl = item.querySelector('.diagram-item-name');
      if (nameEl) {
        // Will update tab name after the diagram loads
        setTimeout(() => {
          const currentTab = tabs.find(t => t.id === activeTabId);
          if (currentTab) {
            currentTab.name = nameEl.textContent;
            renderTabs();
          }
        }, 100);
      }
    }
  });

  // ── 6. Drag-to-Code Sync ─────────────────────────────
  // After each drag, store positions and append to code.
  function syncDragToCode() {
    const svg = preview.querySelector('svg');
    if (!svg || !diagramModified) return;

    const nodeGroups = [...svg.querySelectorAll('g.node')];
    if (!nodeGroups.length) return;

    const positions = {};
    nodeGroups.forEach(g => {
      const t = g.getAttribute('transform') || '';
      const matches = t.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/g);
      if (matches && matches.length > 1) {
        // Multiple translates mean the node was dragged
        let tx = 0, ty = 0;
        // Skip first translate (original position), sum the rest (drag offset)
        matches.slice(1).forEach(m => {
          const parts = m.match(/-?[\d.]+/g);
          if (parts && parts.length >= 2) {
            tx += parseFloat(parts[0]);
            ty += parseFloat(parts[1]);
          }
        });
        if (Math.abs(tx) > 1 || Math.abs(ty) > 1) {
          // Extract node ID from group ID (e.g., "flowchart-A-123" → "A")
          const nodeId = g.id.replace(/^flowchart-/, '').replace(/-\d+$/, '');
          if (nodeId) {
            positions[nodeId] = { x: Math.round(tx), y: Math.round(ty) };
          }
        }
      }
    });

    if (Object.keys(positions).length === 0) return;

    // Update code: remove old position comments, add new ones
    let code = editor.getValue();
    code = code.replace(/\n%% positions: \{.*\}$/m, '');
    code = code.trimEnd() + '\n%% positions: ' + JSON.stringify(positions);
    editor.setValue(code);
  }

  // Listen for mouseup on preview to sync drag to code
  previewContainer.addEventListener('mouseup', () => {
    // Small delay to let commitDrag run first
    setTimeout(syncDragToCode, 50);
  });

  // Apply saved positions after render
  const origRenderPreview = renderPreview;
  // We can't easily override renderPreview since it's used before this point.
  // Instead, use a MutationObserver to apply positions after render.
  const positionObserver = new MutationObserver(() => {
    const code = editor.getValue();
    const posMatch = code.match(/%% positions: (\{.*\})$/m);
    if (!posMatch) return;

    try {
      const positions = JSON.parse(posMatch[1]);
      const svg = preview.querySelector('svg');
      if (!svg) return;

      // Apply positions after a small delay to ensure render is complete
      setTimeout(() => {
        Object.entries(positions).forEach(([nodeId, pos]) => {
          const nodeG = svg.querySelector(`g.node[id*="-${nodeId}-"]`);
          if (nodeG) {
            const currentTransform = nodeG.getAttribute('transform') || '';
            nodeG.setAttribute('transform', `${currentTransform} translate(${pos.x}, ${pos.y})`);
          }
        });
      }, 50);
    } catch { /* ignore parse errors */ }
  });

  positionObserver.observe(preview, { childList: true, subtree: true });

})();
