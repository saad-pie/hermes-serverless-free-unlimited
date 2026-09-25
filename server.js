import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import chatHandler from './api/chat.js';
import modelsHandler from './api/models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

// In-memory cache for models endpoint
let cachedModels = null;
let cachedModelsTimestamp = 0;
const MODELS_CACHE_TTL = 60 * 1000; // 60 seconds

// Helper to bridge Express (req, res) to standard Web Request / Response handler
async function routeToWebHandler(handler, req, res, isModelsEndpoint = false) {
  try {
    if (isModelsEndpoint && req.method === 'GET' && cachedModels && (Date.now() - cachedModelsTimestamp < MODELS_CACHE_TTL)) {
      res.status(200);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cachedModels);
    }

    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const url = new URL(req.originalUrl || req.url, `${protocol}://${host}`);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    const init = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (typeof req.body === 'string') {
        init.body = req.body;
      } else if (req.body && Object.keys(req.body).length > 0) {
        init.body = JSON.stringify(req.body);
      }
    }

    const webReq = new Request(url.toString(), init);
    const webRes = await handler(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    if (webRes.body) {
      const buffer = Buffer.from(await webRes.arrayBuffer());
      if (isModelsEndpoint && webRes.status === 200) {
        cachedModels = buffer;
        cachedModelsTimestamp = Date.now();
        res.setHeader('X-Cache', 'MISS');
      }
      res.send(buffer);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Error handling route:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  }
}

// API Routes
app.all('/api/chat', (req, res) => routeToWebHandler(chatHandler, req, res));
app.all('/v1/chat/completions', (req, res) => routeToWebHandler(chatHandler, req, res));

app.all('/api/models', (req, res) => routeToWebHandler(modelsHandler, req, res, true));
app.all('/v1/models', (req, res) => routeToWebHandler(modelsHandler, req, res, true));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Full Page Routes
app.get('/models', (req, res) => {
  res.sendFile(path.join(__dirname, 'models.html'));
});
app.get('/playground', (req, res) => {
  res.sendFile(path.join(__dirname, 'playground.html'));
});
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs.html'));
});

// Static files
app.use(express.static(__dirname));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
