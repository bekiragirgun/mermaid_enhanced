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

    // Set explicit dimensions from viewBox for correct canvas rendering
    const vb = clone.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      clone.setAttribute('width', parts[2]);
      clone.setAttribute('height', parts[3]);
    }
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
  }

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
    saveSettings({
      baseUrl: $('#settingBaseUrl').value.trim(),
      apiKey: $('#settingApiKey').value.trim(),
      model: modelSelect.value,
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

    function onMouseDown(e) {
      const nodeG = e.target.closest('g.node');
      if (!nodeG || !nodeMap.has(nodeG)) return;
      e.stopPropagation();
      e.preventDefault();
      activeNode = nodeG;
      const svgPt = screenToSVG(e.clientX, e.clientY);
      startSVGX = svgPt.x;
      startSVGY = svgPt.y;
    }

    function onMouseMove(e) {
      if (!activeNode) return;
      e.preventDefault();
      const svgPt = screenToSVG(e.clientX, e.clientY);
      const dx = svgPt.x - startSVGX;
      const dy = svgPt.y - startSVGY;

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

      // Expand viewBox to fit all moved nodes
      expandViewBox();
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

      activeNode = null;
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
