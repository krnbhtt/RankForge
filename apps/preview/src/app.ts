import express, { type Request, type Response } from 'express';
import { assertSafeKey, contentTypeForKey, type ArtifactStorage } from '@rankforge/storage';

const AUDIT_ID = /^[a-zA-Z0-9_-]+$/;

/** Maps the public variant name to the storage folder (spec 6.2). */
const VARIANT_FOLDERS: Record<string, string> = {
  current: 'target',
  optimised: 'optimised',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const NOT_READY_HTML = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>` +
  `<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#444;background:#fafafa}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;line-height:1.5}</style>` +
  `</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

function applyHeaders(res: Response): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

function logRequest(entry: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', service: 'rf-preview', ...entry })}\n`);
}

export function createPreviewApp(storage: ArtifactStorage) {
  const app = express();
  app.disable('x-powered-by');
  app.enable('strict routing');

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'rf-preview', uptimeSeconds: Math.round(process.uptime()) });
  });

  // Redirect so relative asset URLs (assets/…) resolve under the variant folder.
  app.get('/preview/:auditId/:variant', (req: Request, res: Response) => {
    applyHeaders(res);
    res.redirect(301, `${req.path}/`);
  });

  app.get(/^\/preview\/([^/]+)\/([^/]+)\/(.*)$/, async (req: Request, res: Response) => {
    const started = Date.now();
    applyHeaders(res);
    const params = req.params as Record<string, string | undefined>;
    const auditId = params['0'] ?? '';
    const variant = params['1'] ?? '';
    const rawPath = params['2'] ?? '';

    const folder = VARIANT_FOLDERS[variant];
    if (!AUDIT_ID.test(auditId) || !folder) {
      res.status(404).type('html').send(NOT_READY_HTML('Preview not found', 'This preview link is not valid.'));
      return;
    }

    let relative: string;
    try {
      relative = decodeURIComponent(rawPath);
    } catch {
      res.status(400).type('text/plain').send('Bad request');
      return;
    }
    if (relative === '' || relative.endsWith('/')) relative += 'index.html';

    const key = `${auditId}/${folder}/${relative}`;
    try {
      assertSafeKey(key);
    } catch {
      res.status(400).type('text/plain').send('Bad request');
      return;
    }

    try {
      const object = await storage.get(key);
      if (!object) {
        const isIndex = relative === 'index.html';
        res
          .status(404)
          .type('html')
          .send(
            isIndex
              ? NOT_READY_HTML(
                  variant === 'optimised' ? 'Optimised page is still being built' : 'Reproduction not ready yet',
                  'This preview will appear here as soon as it has been generated.'
                )
              : NOT_READY_HTML('File not found', 'That file is not part of this preview.')
          );
        return;
      }
      const isHtml = relative.endsWith('.html');
      res.setHeader('Content-Type', object.contentType || contentTypeForKey(relative));
      res.setHeader('Cache-Control', isHtml ? 'no-store' : 'public, max-age=86400, immutable');
      res.status(200).send(object.body);
      logRequest({ auditId, variant, path: relative, status: 200, durationMs: Date.now() - started });
    } catch (err) {
      logRequest({
        level: 'error',
        auditId,
        variant,
        path: relative,
        status: 500,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).type('html').send(NOT_READY_HTML('Preview unavailable', 'Please reload in a moment.'));
    }
  });

  app.use((_req, res) => {
    applyHeaders(res);
    res.status(404).type('text/plain').send('Not found');
  });

  return app;
}
