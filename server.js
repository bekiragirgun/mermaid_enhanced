const express = require('express');
const { execFile } = require('child_process');
const { writeFile, readFile, unlink, mkdir, readdir, stat } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
const MMDC_PATH = process.env.MMDC_PATH || '/opt/homebrew/bin/mmdc';
const TMP_DIR = path.join(__dirname, 'tmp');
const DIAGRAMS_DIR = path.join(__dirname, 'diagrams');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
mkdir(TMP_DIR, { recursive: true }).catch(() => {});
mkdir(DIAGRAMS_DIR, { recursive: true }).catch(() => {});

// ── Diagram persistence endpoints ─────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// List saved diagrams
app.get('/api/diagrams', async (req, res) => {
  try {
    const files = await readdir(DIAGRAMS_DIR);
    const diagrams = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(path.join(DIAGRAMS_DIR, file), 'utf-8');
        const data = JSON.parse(content);
        diagrams.push({ id: file.replace('.json', ''), name: data.name, createdAt: data.createdAt, updatedAt: data.updatedAt });
      } catch { /* skip invalid files */ }
    }
    diagrams.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(diagrams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save diagram
app.post('/api/diagrams', async (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'name and code are required' });

  const slug = slugify(name);
  if (!slug) return res.status(400).json({ error: 'Invalid name' });

  const filePath = path.join(DIAGRAMS_DIR, `${slug}.json`);
  const now = new Date().toISOString();

  let data;
  try {
    const existing = await readFile(filePath, 'utf-8');
    data = JSON.parse(existing);
    data.code = code;
    data.name = name;
    data.updatedAt = now;
  } catch {
    data = { name, code, createdAt: now, updatedAt: now };
  }

  try {
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ id: slug, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single diagram
app.get('/api/diagrams/:id', async (req, res) => {
  try {
    const filePath = path.join(DIAGRAMS_DIR, `${req.params.id}.json`);
    const content = await readFile(filePath, 'utf-8');
    res.json({ id: req.params.id, ...JSON.parse(content) });
  } catch {
    res.status(404).json({ error: 'Diagram not found' });
  }
});

// Delete diagram
app.delete('/api/diagrams/:id', async (req, res) => {
  try {
    await unlink(path.join(DIAGRAMS_DIR, `${req.params.id}.json`));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Diagram not found' });
  }
});

// Export endpoint
app.post('/api/export', async (req, res) => {
  const { code, format = 'png', theme = 'dark' } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  if (!['png', 'pdf', 'svg'].includes(format)) {
    return res.status(400).json({ error: 'format must be png, pdf, or svg' });
  }

  const id = crypto.randomUUID();
  const inputPath = path.join(TMP_DIR, `${id}.mmd`);
  const outputPath = path.join(TMP_DIR, `${id}.${format}`);

  try {
    await writeFile(inputPath, code, 'utf-8');

    await new Promise((resolve, reject) => {
      const args = ['-i', inputPath, '-o', outputPath, '-t', theme, '-b', 'transparent'];
      if (format === 'pdf') args.push('-f');

      const child = execFile(MMDC_PATH, args, { timeout: 15000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const data = await readFile(outputPath);
    const mimeTypes = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' };
    res.setHeader('Content-Type', mimeTypes[format]);
    res.setHeader('Content-Disposition', `attachment; filename="diagram.${format}"`);
    res.send(data);
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  } finally {
    unlink(inputPath).catch(() => {});
    unlink(outputPath).catch(() => {});
  }
});

// Chat proxy endpoint (SSE streaming)
app.post('/api/chat', async (req, res) => {
  const { messages, currentCode } = req.body;
  const baseUrl = req.headers['x-ai-base-url'];
  const apiKey = req.headers['x-ai-api-key'];
  const model = req.headers['x-ai-model'] || 'gpt-3.5-turbo';

  if (!baseUrl || !apiKey) {
    return res.status(400).json({ error: 'AI configuration missing. Set base URL and API key in settings.' });
  }

  const systemPrompt = `Sen bir mermaid diyagram uzmanısın. Kullanıcının mevcut diyagramını anlayıp istediği değişikliği yap.
Güncel mermaid kodunu \`\`\`mermaid bloğu içinde döndür. Kısa açıklama ekle.

Mevcut diyagram kodu:
\`\`\`mermaid
${currentCode || ''}
\`\`\``;

  const payload = JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: true,
  });

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const hasPath = /\/v1(\/|$)/.test(cleanBase);
  const targetUrl = hasPath ? cleanBase + '/chat/completions' : cleanBase + '/v1/chat/completions';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const proxyRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: payload,
    });

    if (!proxyRes.ok) {
      const body = await proxyRes.text();
      res.write(`data: ${JSON.stringify({ error: `AI API error ${proxyRes.status}: ${body}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(proxyRes.body);
    nodeStream.pipe(res);
    req.on('close', () => nodeStream.destroy());
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Mermaid Editor running at http://localhost:${PORT}`);
});
