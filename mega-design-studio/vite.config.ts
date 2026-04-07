import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function skinFileApi(): Plugin {
  const skinsRoot = path.resolve(__dirname, 'skins');

  function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  return {
    name: 'skin-file-api',
    configureServer(server) {
      // Increase payload limit for large base64 skin data
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/api/skins/') && req.method === 'PUT') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            (req as any)._body = body;
            next();
          });
        } else {
          next();
        }
      });

      // GET /api/skins/slots or /api/skins/banners
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET') return next();

        const match = req.url?.match(/^\/api\/skins\/(slots|banners)$/);
        if (!match) return next();

        const category = match[1];
        const dir = path.join(skinsRoot, category);
        ensureDir(dir);

        try {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
          const skins = files.map(f => {
            const content = fs.readFileSync(path.join(dir, f), 'utf-8');
            return JSON.parse(content);
          });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(skins));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // PUT /api/skins/slots/:id or /api/skins/banners/:id
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'PUT') return next();

        const match = req.url?.match(/^\/api\/skins\/(slots|banners)\/(.+)$/);
        if (!match) return next();

        const category = match[1];
        const id = decodeURIComponent(match[2]);
        const dir = path.join(skinsRoot, category);
        ensureDir(dir);

        const body = (req as any)._body;
        if (!body) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Empty body' }));
          return;
        }

        try {
          const filePath = path.join(dir, `${id}.json`);
          fs.writeFileSync(filePath, body, 'utf-8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // DELETE /api/skins/slots/:id or /api/skins/banners/:id
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'DELETE') return next();

        const match = req.url?.match(/^\/api\/skins\/(slots|banners)\/(.+)$/);
        if (!match) return next();

        const category = match[1];
        const id = decodeURIComponent(match[2]);
        const filePath = path.join(skinsRoot, category, `${id}.json`);

        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [skinFileApi(), react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        }
      }
    };
});
