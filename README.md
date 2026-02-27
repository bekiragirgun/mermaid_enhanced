# Mermaid Diagram Editor

Tarayıcı tabanlı, canlı önizlemeli Mermaid diyagram editörü. AI destekli sohbet ile diyagramlarınızı sesli veya yazılı komutlarla oluşturun ve düzenleyin.

![Mermaid Editor](https://img.shields.io/badge/Mermaid-v11-blue) ![Node.js](https://img.shields.io/badge/Node.js-Express-green) ![License](https://img.shields.io/badge/License-MIT-yellow)

## Özellikler

- **Canlı Önizleme** — Kod yazarken diyagram anında güncellenir (300ms debounce)
- **CodeMirror Editör** — Sözdizimi vurgulama, satır numaraları, markdown modu
- **AI Chat** — OpenAI uyumlu herhangi bir API ile diyagram oluşturma/düzenleme (SSE streaming)
- **Akıllı Hata Düzeltme** — AI hatalı kod üretirse render hatası otomatik olarak AI'ya gönderilir ve düzeltme istenir
- **Kapsamlı Mermaid Referansı** — AI system prompt'unda 10 diyagram tipi, stil/biçimlendirme referansı ve yaygın hata listesi
- **Sesli Komut** — Mikrofon ile Türkçe konuşarak diyagram tarif edin (Web Speech API)
- **Diyagram Kaydetme/Yükleme** — Oluşturduğunuz diyagramları kaydedin, istediğiniz zaman geri açın
- **Chat Geçmişi** — AI sohbetleri otomatik kaydedilir, Open modalından geri yüklenebilir
- **Export** — PNG, PDF, SVG formatlarında dışa aktarım (sürüklenmiş düzen korunur)
- **Düğüm Sürükleme** — Önizlemede düğümleri tek tek sürükleyin, oklar takip eder
- **Ayarlanabilir Panel** — Önizleme ve editör arası bölme çizgisi sürüklenebilir
- **Zoom** — %20 ile %300 arası yakınlaştırma/uzaklaştırma + sürükleyerek kaydırma
- **Gece/Gündüz Modu** — Catppuccin Mocha (karanlık) ve Catppuccin Latte (aydınlık) temaları
- **Model Göstergesi** — Toolbar'da aktif AI modelini gösterir, tıklayınca ayarlar açılır

## Kurulum

```bash
# Depoyu klonlayın
git clone git@github.com:bekiragirgun/mermaid_enhanced.git
cd mermaid_enhanced

# Bağımlılıkları yükleyin
npm install

# Mermaid CLI gerekli (export için)
npm install -g @mermaid-js/mermaid-cli
```

## Kullanım

```bash
# Sunucuyu başlat
./manage.sh start

# Tarayıcıda aç
open http://localhost:3000

# Diğer komutlar
./manage.sh stop       # Durdur
./manage.sh restart    # Yeniden başlat
./manage.sh status     # Durum kontrolü

# Geliştirme modu (auto-reload)
npm run dev
```

## AI Yapılandırması

1. Toolbar'daki **model göstergesi** veya **ayarlar** butonuna tıklayın
2. Yapılandırma:
   - **Base URL**: OpenAI uyumlu API adresi (ör. `http://localhost:11434` Ollama için)
   - **API Key**: API anahtarı (Ollama için herhangi bir değer, ör. `ollama`)
   - **Model**: "Getir" butonuyla modelleri çekin, listeden seçin

### Desteklenen Sağlayıcılar

| Sağlayıcı | Base URL | Notlar |
|-----------|----------|--------|
| Ollama | `http://localhost:11434` | Yerel, ücretsiz |
| OpenAI | `https://api.openai.com` | API key gerekli |
| OpenRouter | `https://openrouter.ai/api` | Çoklu model |

## Sesli Komut

Chat alanındaki mikrofon butonuna tıklayın ve diyagramınızı Türkçe olarak tarif edin. Konuşmanız bittiğinde otomatik olarak AI'ya gönderilir.

> Örnek: _"Kullanıcı giriş akışı çiz. Önce kullanıcı adı ve şifre girsin, sonra doğrulama yapılsın, başarılıysa ana sayfaya yönlendir, değilse hata göster."_

**Not:** Chrome/Edge tarayıcılarda en iyi çalışır (Web Speech API desteği).

## Diyagram Kaydetme & Chat Geçmişi

- **Kaydet**: Toolbar'daki Save butonuna tıklayın, diyagrama bir isim verin
- **Aç**: Open butonuna tıklayın — iki sekme görünür:
  - **Diyagramlar**: Kayıtlı diyagramlarınız
  - **Chat Geçmişi**: Önceki AI sohbetleriniz (otomatik kaydedilir)
- **Yükle**: Bir geçmiş kaydına tıklayın — hem chat mesajları hem diyagram kodu geri yüklenir
- **Sil**: İstemediğiniz kayıtları silin

Diyagramlar `diagrams/`, chat geçmişi `chat_history/` klasörüne JSON olarak saklanır.

## Mimari

```
mermaid_enhanced/
├── server.js              # Express sunucu (API endpoints)
├── manage.sh              # Sunucu yönetim scripti
├── package.json
├── public/
│   ├── index.html         # Ana sayfa
│   ├── css/style.css      # Catppuccin Mocha/Latte tema
│   └── js/app.js          # Frontend (vanilla JS, IIFE)
├── diagrams/              # Kayıtlı diyagramlar (JSON)
├── chat_history/          # Chat geçmişi (JSON)
└── tmp/                   # Geçici export dosyaları
```

### API Endpoints

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `POST` | `/api/export` | Diyagramı PNG/PDF/SVG olarak dışa aktar |
| `POST` | `/api/chat` | AI chat proxy (SSE streaming) |
| `GET` | `/api/models` | AI sağlayıcıdan model listesi çek |
| `GET` | `/api/diagrams` | Kayıtlı diyagramları listele |
| `POST` | `/api/diagrams` | Yeni diyagram kaydet |
| `GET` | `/api/diagrams/:id` | Tek diyagram getir |
| `DELETE` | `/api/diagrams/:id` | Diyagram sil |
| `GET` | `/api/history` | Chat geçmişini listele |
| `POST` | `/api/history` | Chat geçmişi kaydet |
| `GET` | `/api/history/:id` | Tek chat geçmişi getir |
| `DELETE` | `/api/history/:id` | Chat geçmişi sil |

## Teknolojiler

- **Backend**: Node.js, Express
- **Frontend**: Vanilla JavaScript (framework yok)
- **Editör**: CodeMirror 5
- **Diyagram**: Mermaid v11
- **Tema**: Catppuccin Mocha / Latte
- **Ses Tanıma**: Web Speech API
