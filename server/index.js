const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = Number(process.env.PORT || 4173);

const OBJECTSTORE_WORKER_URL = (process.env.OBJECTSTORE_WORKER_URL || 'https://objectstore.grudge-studio.com').replace(/\/$/, '');
const OBJECTSTORE_STATIC_URL = (process.env.OBJECTSTORE_STATIC_URL || 'https://molochdagod.github.io/ObjectStore').replace(/\/$/, '');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'grudge-game-editor-node',
    puterTokenConfigured: !!process.env.PUTER_AUTH_TOKEN,
    objectStoreWorker: OBJECTSTORE_WORKER_URL,
    time: new Date().toISOString(),
  });
});

// ── Puter AI (real, no mock) ────────────────────────────────────────
let puterClient = null;
let puterInitPromise = null;

async function getPuterClient() {
  if (puterClient) return puterClient;
  if (puterInitPromise) return puterInitPromise;
  if (!process.env.PUTER_AUTH_TOKEN) {
    throw new Error('PUTER_AUTH_TOKEN is not configured on this server');
  }

  puterInitPromise = (async () => {
    // Node init path from Puter SDK docs/blog examples
    const puter = require('@heyputer/puter.js/src/init.cjs');
    await puter.init(process.env.PUTER_AUTH_TOKEN);
    puterClient = puter;
    return puterClient;
  })();

  return puterInitPromise;
}

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { messages, model, temperature, max_tokens, tools } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'messages[] is required' });
    }

    const puter = await getPuterClient();
    const response = await puter.ai.chat(messages, {
      model: model || undefined,
      temperature: typeof temperature === 'number' ? temperature : undefined,
      max_tokens: typeof max_tokens === 'number' ? max_tokens : undefined,
      tools: Array.isArray(tools) ? tools : undefined,
    });

    res.json({ ok: true, response });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err.message || String(err),
      hint: 'Configure PUTER_AUTH_TOKEN in .env for server-side AI, or use browser-side Puter AI directly.',
    });
  }
});

// ── ObjectStore proxy routes ────────────────────────────────────────
app.get('/api/objectstore/health', async (_req, res) => {
  try {
    const response = await fetch(`${OBJECTSTORE_WORKER_URL}/health`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.get('/api/objectstore/assets', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    const response = await fetch(`${OBJECTSTORE_WORKER_URL}/v1/assets?${params.toString()}`, {
      headers: process.env.OBJECTSTORE_API_KEY
        ? { 'X-API-Key': process.env.OBJECTSTORE_API_KEY }
        : {},
    });
    const text = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.get('/api/objectstore/static/:dataset', async (req, res) => {
  try {
    const dataset = (req.params.dataset || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!dataset) return res.status(400).json({ error: 'dataset is required' });
    const url = `${OBJECTSTORE_STATIC_URL}/api/v1/${dataset}.json`;
    const response = await fetch(url);
    const text = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: err.message || String(err) });
  }
});

// ── Static app hosting ──────────────────────────────────────────────
const rootDir = path.join(__dirname, '..');
app.use(express.static(rootDir));

// SPA fallback for supported routes
app.get(['/', '/animations', '/character-studio', '/agent-playground', '/assets', '/game-data', '/scenes', '/import', '/characters'], (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[grudge-game-editor] listening on http://localhost:${PORT}`);
});
