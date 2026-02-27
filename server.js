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

const HISTORY_DIR = path.join(__dirname, 'chat_history');

// Ensure directories exist
mkdir(TMP_DIR, { recursive: true }).catch(() => {});
mkdir(DIAGRAMS_DIR, { recursive: true }).catch(() => {});
mkdir(HISTORY_DIR, { recursive: true }).catch(() => {});

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

// ── Chat history endpoints ────────────────────────────

app.get('/api/history', async (req, res) => {
  try {
    const files = await readdir(HISTORY_DIR);
    const items = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const filePath = path.join(HISTORY_DIR, f);
      const s = await stat(filePath);
      const data = JSON.parse(await readFile(filePath, 'utf-8'));
      items.push({
        id: f.replace('.json', ''),
        title: data.title || 'Adsız Sohbet',
        preview: data.preview || '',
        messageCount: data.messages ? data.messages.length : 0,
        createdAt: data.createdAt || s.birthtime.toISOString(),
        updatedAt: data.updatedAt || s.mtime.toISOString(),
      });
    }
    items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(items);
  } catch {
    res.json([]);
  }
});

app.post('/api/history', async (req, res) => {
  const { title, messages, diagramCode } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: 'No messages' });

  const id = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  const firstUserMsg = messages.find(m => m.role === 'user');
  const autoTitle = title || (firstUserMsg ? firstUserMsg.content.slice(0, 60) : 'Adsız Sohbet');
  const preview = firstUserMsg ? firstUserMsg.content.slice(0, 100) : '';
  const now = new Date().toISOString();

  const data = { title: autoTitle, preview, messages, diagramCode, createdAt: now, updatedAt: now };
  await writeFile(path.join(HISTORY_DIR, id + '.json'), JSON.stringify(data, null, 2));
  res.json({ id, title: autoTitle });
});

app.get('/api/history/:id', async (req, res) => {
  try {
    const filePath = path.join(HISTORY_DIR, req.params.id + '.json');
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

app.delete('/api/history/:id', async (req, res) => {
  try {
    await unlink(path.join(HISTORY_DIR, req.params.id + '.json'));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// Fetch available models from AI provider
app.get('/api/models', async (req, res) => {
  const baseUrl = req.headers['x-ai-base-url'];
  const apiKey = req.headers['x-ai-api-key'];
  if (!baseUrl) return res.status(400).json({ error: 'Base URL required' });

  const cleanBase = baseUrl.replace(/\/+$/, '');

  // Try OpenAI-compatible /models first, then Ollama /api/tags
  const hasVersion = /\/v\d+(\/|$)/.test(cleanBase);
  const urls = [
    cleanBase + (hasVersion ? '/models' : '/v1/models'),
    cleanBase + '/api/tags',
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) continue;

      const data = await response.json();

      // OpenAI format: { data: [{ id: "model-name" }] }
      if (data.data && Array.isArray(data.data)) {
        return res.json(data.data.map(m => ({ id: m.id, name: m.id })));
      }
      // Ollama format: { models: [{ name: "model:tag" }] }
      if (data.models && Array.isArray(data.models)) {
        return res.json(data.models.map(m => ({ id: m.name, name: m.name })));
      }
    } catch { /* try next URL */ }
  }

  res.status(502).json({ error: 'Model listesi alınamadı' });
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

  const systemPrompt = `Sen bir Mermaid v11 diyagram uzmanısın. Kullanıcının istediği diyagramı oluştur veya mevcut diyagramı düzenle.

# KURALLAR
- Yanıtında MUTLAKA tek bir \`\`\`mermaid kod bloğu olmalı
- Kısa Türkçe açıklama ekle
- Geçersiz sözdizimi KULLANMA. Aşağıdaki referansa kesinlikle uy.
- Node ID'lerinde Türkçe karakter (ş,ç,ğ,ü,ö,ı) KULLANMA, sadece İngilizce harf/rakam/alt çizgi kullan
- Türkçe metinleri tırnak veya köşeli parantez içinde yaz: A["Türkçe Metin"]
- Her satırda yalnızca bir bağlantı tanımla
- Stil değişikliklerinde mevcut diyagram yapısını KORU, sadece style/classDef/linkStyle satırları ekle veya düzenle
- Kullanıcı "kalın çizgi", "renkli ok" gibi görsel değişiklik isterse diyagram kodunu DEĞİŞTİRME, sadece ilgili style/linkStyle satırlarını ekle

# MERMAID v11 SÖZDİZİMİ REFERANSI

## Flowchart
\`\`\`
graph TD
    A["Başla"] --> B{"Koşul?"}
    B -->|Evet| C["İşlem 1"]
    B -->|Hayır| D["İşlem 2"]
    C --> E["Son"]
    D --> E
\`\`\`
Yön: TD (yukarıdan aşağı), LR (soldan sağa), BT, RL
Düğüm şekilleri: A["dikdörtgen"], B("yuvarlak"), C{"eşkenar dörtgen"}, D(["stadyum"]), E[["alt rutin"]], F[("veritabanı")], G(("daire")), H>"bayrak"]
Ok tipleri: --> (düz), -.-> (kesikli), ==> (kalın), --o (daire uç), --x (çarpı uç)
Etiketli ok: A -->|metin| B veya A -- metin --> B

## Sequence Diagram
\`\`\`
sequenceDiagram
    participant A as Kullanıcı
    participant B as Sunucu
    participant C as Veritabanı
    A->>B: İstek gönder
    activate B
    B->>C: Sorgu
    C-->>B: Sonuç
    B-->>A: Yanıt
    deactivate B
    Note over A,B: Bu bir not
    alt Başarılı
        B->>A: 200 OK
    else Hata
        B->>A: 500 Error
    end
    loop Her 5 saniye
        A->>B: Ping
    end
\`\`\`
Ok: ->> (düz), -->> (kesikli), -) (async), --) (kesikli async)

## Class Diagram
\`\`\`
classDiagram
    class Hayvan {
        +String isim
        +int yas
        +sesCikar() String
    }
    class Kedi {
        +miyavla()
    }
    Hayvan <|-- Kedi : kalıtım
    Hayvan "1" --> "*" Yem : yer
\`\`\`
İlişkiler: <|-- (kalıtım), *-- (kompozisyon), o-- (agregasyon), --> (ilişki), ..> (bağımlılık), ..|> (gerçekleme)

## State Diagram
\`\`\`
stateDiagram-v2
    [*] --> Bekliyor
    Bekliyor --> Isleniyor : istek geldi
    Isleniyor --> Tamamlandi : başarılı
    Isleniyor --> Hata : hata oluştu
    Hata --> Bekliyor : tekrar dene
    Tamamlandi --> [*]
    state Isleniyor {
        [*] --> Dogrulama
        Dogrulama --> Kaydetme
        Kaydetme --> [*]
    }
\`\`\`

## ER Diagram
\`\`\`
erDiagram
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
\`\`\`
İlişki: ||--|| (bire-bir), ||--o{ (bire-çok), }o--o{ (çoka-çok)

## Gantt Chart
\`\`\`
gantt
    title Proje Planı
    dateFormat YYYY-MM-DD
    section Tasarım
        Analiz           :a1, 2024-01-01, 7d
        Wireframe        :a2, after a1, 5d
    section Geliştirme
        Backend          :b1, after a2, 14d
        Frontend         :b2, after a2, 10d
    section Test
        Test             :c1, after b1, 7d
\`\`\`

## Pie Chart
\`\`\`
pie title Dağılım
    "Kategori A" : 40
    "Kategori B" : 30
    "Kategori C" : 20
    "Kategori D" : 10
\`\`\`

## Mindmap
\`\`\`
mindmap
    root((Ana Konu))
        Dal 1
            Alt dal 1a
            Alt dal 1b
        Dal 2
            Alt dal 2a
        Dal 3
\`\`\`

## Timeline
\`\`\`
timeline
    title Zaman Çizelgesi
    2020 : Olay 1 : Olay 2
    2021 : Olay 3
    2022 : Olay 4 : Olay 5 : Olay 6
\`\`\`

## Git Graph
\`\`\`
gitGraph
    commit
    branch gelistirme
    checkout gelistirme
    commit
    commit
    checkout main
    merge gelistirme
    commit
\`\`\`

# STİL VE BİÇİMLENDİRME (Flowchart)

## Tek düğüm stilleme
\`\`\`
style A fill:#f9f,stroke:#333,stroke-width:4px,color:#000
style B fill:#bbf,stroke:#f66,stroke-width:2px,stroke-dasharray: 5 5
\`\`\`

## Sınıf tanımlama ve uygulama (classDef/class)
\`\`\`
classDef onemli fill:#f96,stroke:#333,stroke-width:3px,color:#fff
classDef varsayilan fill:#29b,stroke:#fff,stroke-width:1px,color:#fff
class A,C onemli
class B,D varsayilan
\`\`\`

## Ok/çizgi stilleme (linkStyle)
\`\`\`
linkStyle default stroke-width:3px
linkStyle 0 stroke:#ff3,stroke-width:4px
linkStyle 1,2 stroke:#f00,stroke-width:2px
\`\`\`
- "default" tüm okları etkiler
- Numara: okların tanım sırasına göre 0'dan başlayan indeksi (ilk --> 0, ikinci --> 1, ...)
- Virgülle birden fazla indeks verilebilir: linkStyle 0,1,2

## Subgraph
\`\`\`
subgraph Baslik["Alt Grup Başlığı"]
    A --> B
end
\`\`\`

## Tam örnek (düğüm + çizgi stilleme)
\`\`\`
graph TD
    A["Başla"] --> B{"Kontrol"}
    B -->|Evet| C["İşlem"]
    B -->|Hayır| D["Son"]
    C --> D
    style A fill:#4CAF50,stroke:#333,stroke-width:2px,color:#fff
    style B fill:#FF9800,stroke:#333,stroke-width:2px,color:#fff
    classDef sonuc fill:#2196F3,stroke:#fff,stroke-width:2px,color:#fff
    class C,D sonuc
    linkStyle default stroke-width:3px
    linkStyle 0 stroke:#4CAF50,stroke-width:4px
\`\`\`

## Stil özellikleri (kullanılabilir CSS özellikleri)
- fill: arka plan rengi (#hex veya rgb)
- stroke: kenarlık rengi
- stroke-width: kenarlık kalınlığı (px)
- stroke-dasharray: kesikli çizgi (ör: 5 5)
- color: metin rengi
- font-weight: kalın metin (bold)
- font-size: metin boyutu

## ÖNEMLİ KURALLAR
- style/classDef/linkStyle satırları düğüm ve bağlantı tanımlarından SONRA yazılmalı
- linkStyle indeksleri 0'dan başlar ve bağlantı tanım sırası ile eşleşir
- Renk kodları MUTLAKA # ile başlamalı (#f00, #ff0000)
- style satırında özellikler virgülle ayrılır (boşluk yok): fill:#f00,stroke:#333
- "linkStyle default" TÜM oklara uygulanır, belirli oklar için numara kullan

# YAYGIN HATALAR — BUNLARI YAPMA
- ❌ graph TD; A-->B (noktalı virgül kullanma, yeni satır kullan)
- ❌ A[Türkçe şçğüöı] (tırnak olmadan Türkçe → hata verir)
- ❌ A["metin"] --> B["metin"] --> C (zincirleme ok — her satırda tek bağlantı)
- ❌ style bloğunda geçersiz CSS (renk kodları # ile başlamalı)
- ❌ subgraph içinde yön belirtme (subgraph direction LR → bazı tiplerde hata)
- ❌ Node ID'de boşluk veya özel karakter (A B, İşlem-1 → hata)
- ❌ linkStyle 0 stroke-width:3px (YANLIŞ — özellikler arası virgül kullan)
- ❌ linkStyle satırını bağlantılardan ÖNCE yazma (önce bağlantılar, sonra linkStyle)
- ❌ style satırında boşluklu değerler: stroke-width: 4px (boşluk olmamalı: stroke-width:4px)

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
  const hasVersionedPath = /\/v\d+(\/|$)/.test(cleanBase);
  const targetUrl = hasVersionedPath ? cleanBase + '/chat/completions' : cleanBase + '/v1/chat/completions';

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
