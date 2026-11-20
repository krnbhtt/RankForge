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
  'Access-Control-Allow-Origin': '*',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

/**
 * Scroll bridge injected into served HTML (never stored). The studio embeds two previews on a
 * different origin and cannot read their scroll position, so each page reports and accepts a
 * 0..1 scroll ratio via postMessage.
 */
export const SCROLL_SYNC_SCRIPT =
  '<script data-rf-sync>(function(){var lock=false,t;function max(){var d=document.documentElement;return d.scrollHeight-window.innerHeight}' +
  "addEventListener('scroll',function(){if(lock)return;var m=max();parent.postMessage({source:'rf-preview',type:'scroll',ratio:m>0?window.scrollY/m:0},'*')},{passive:true});" +
  "addEventListener('message',function(e){var d=e.data;if(!d||d.source!=='rf-studio'||d.type!=='scroll-to')return;lock=true;window.scrollTo(0,d.ratio*max());clearTimeout(t);t=setTimeout(function(){lock=false},80)})})();</script>";

/**
 * Annotation tags (spec F7.3): a numbered dot on every section the rebuild added, with a pop-over giving the tag
 * (Ranking, Conversion or Both), a Sample chip where content is illustrative, and the evidence. Built with textContent
 * only, from data-rf-* attributes written by the patch applier. Injected at serve time, never stored.
 */
export const ANNOTATION_SCRIPT =
  '<script data-rf-annotate>(function(){function run(){var els=[].slice.call(document.querySelectorAll("[data-rf-section]"));' +
  'var st=document.createElement("style");st.textContent=".rf-ann{position:absolute;top:-10px;right:-10px;z-index:2147483001;width:28px;height:28px;border-radius:50%;border:2px solid #fff;background:#2563eb;color:#fff;font:700 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35)}.rf-ann[data-tag=Ranking]{background:#7c3aed}.rf-ann[data-tag=Both]{background:#0f766e}.rf-pop{position:absolute;top:22px;right:0;z-index:2147483002;width:260px;padding:10px;border-radius:8px;background:#111;color:#fff;font:12px/1.4 system-ui,sans-serif;text-align:left;box-shadow:0 4px 16px rgba(0,0,0,.35)}.rf-pop b{display:inline-block;margin-right:6px;padding:2px 6px;border-radius:4px;background:#2563eb;font-size:10px}.rf-pop i{display:inline-block;padding:2px 6px;border-radius:4px;background:#fff3cd;color:#664d03;font-size:10px;font-style:normal}";' +
  'document.head.appendChild(st);els.forEach(function(el,i){if(el.querySelector(":scope > .rf-ann"))return;var cs=getComputedStyle(el);if(cs.position==="static")el.style.position="relative";' +
  'var dot=document.createElement("button");dot.type="button";dot.className="rf-ann";dot.textContent=String(i+1);dot.setAttribute("data-tag",el.getAttribute("data-rf-tag")||"");dot.setAttribute("aria-label","Why this section was added");' +
  'var pop=null;dot.addEventListener("click",function(e){e.stopPropagation();if(pop){pop.remove();pop=null;return}pop=document.createElement("div");pop.className="rf-pop";' +
  'var tag=document.createElement("b");tag.textContent=el.getAttribute("data-rf-tag")||"";pop.appendChild(tag);' +
  'if(el.getAttribute("data-rf-sample")==="true"){var s=document.createElement("i");s.textContent="Sample";pop.appendChild(s)}' +
  'var p=document.createElement("div");p.style.marginTop="6px";p.textContent=el.getAttribute("data-rf-reason")||"";pop.appendChild(p);el.appendChild(pop)});el.appendChild(dot)})}' +
  'if(document.readyState==="complete")run();else window.addEventListener("load",run)})();</script>';

export function injectAnnotations(html: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${ANNOTATION_SCRIPT}</body>`) : html + ANNOTATION_SCRIPT;
}

export function injectScrollSync(html: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${SCROLL_SYNC_SCRIPT}</body>`) : html + SCROLL_SYNC_SCRIPT;
}

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
    const wantsStatic = req.query.static === '1' && (relative === '' || relative === 'index.html');
    if (relative === '' || relative.endsWith('/')) relative += wantsStatic ? 'static.html' : 'index.html';
    else if (wantsStatic) relative = 'static.html';

    const key = `${auditId}/${folder}/${relative}`;
    try {
      assertSafeKey(key);
    } catch {
      res.status(400).type('text/plain').send('Bad request');
      return;
    }

    try {
      let object = await storage.get(key);
      // The optimised page reuses the assets proxied for the reproduction, which live under target/assets.
      if (!object && variant === 'optimised' && relative.startsWith('assets/')) {
        const sharedKey = `${auditId}/target/${relative}`;
        assertSafeKey(sharedKey);
        object = await storage.get(sharedKey);
      }
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
      const isEntry = relative === 'index.html' || relative === 'static.html';
      res.setHeader('Content-Type', object.contentType || contentTypeForKey(relative));
      res.setHeader('Cache-Control', isHtml ? 'no-store' : 'public, max-age=86400, immutable');
      let body: string | Buffer = object.body;
      if (isHtml && isEntry) {
        body = injectScrollSync(object.body.toString('utf8'));
        if (variant === 'optimised' && req.query.annotate === '1') body = injectAnnotations(body);
      }
      res.status(200).send(body);
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
