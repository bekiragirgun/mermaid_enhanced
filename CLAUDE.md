# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Start server (background, with PID tracking)
./manage.sh start

# Stop / restart / status
./manage.sh stop
./manage.sh restart
./manage.sh status

# Start in foreground (with auto-reload on changes)
npm run dev
```

Server runs at `http://localhost:3000` (configurable via `PORT` env var).

## Architecture

Single-page Mermaid diagram editor with Express backend. No build step — static files served directly from `public/`.

### Backend (`server.js`)

Express server with two API endpoints:
- **`POST /api/export`** — Takes mermaid `code`, `format` (png/pdf/svg), `theme`. Shells out to `mmdc` CLI (`/opt/homebrew/bin/mmdc`) for rendering. Temp files in `tmp/`.
- **`POST /api/chat`** — SSE streaming proxy to any OpenAI-compatible API. AI config (base URL, API key, model) comes from request headers (`X-AI-Base-URL`, `X-AI-API-Key`, `X-AI-Model`), stored client-side in localStorage.

### Frontend (vanilla JS, no framework)

- **`public/index.html`** — Layout: left panel (preview + zoom), right panel (editor 70% + chat 30%), toolbar with export buttons and settings modal
- **`public/js/app.js`** — IIFE module handling: CodeMirror editor, Mermaid live preview (300ms debounce), export downloads, AI chat with SSE streaming, zoom controls (%20–%300)
- **`public/css/style.css`** — Catppuccin Mocha dark theme, CSS custom properties in `:root`

### External Dependencies (CDN)

- CodeMirror 5.65.18 (editor + markdown mode + material-darker theme)
- Mermaid v11 (diagram rendering)

### Key Patterns

- AI chat extracts `\`\`\`mermaid` blocks from responses and shows a "Kodu Uygula" (Apply Code) button
- System prompt includes the user's current diagram code for context-aware AI responses
- All UI text is in Turkish

## UI Testing

When making UI changes, verify them using Playwright MCP browser automation as specified in the parent project's CLAUDE.md.
