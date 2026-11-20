import * as cheerio from 'cheerio';
import type { PatchOp } from '@rankforge/schema';

export interface ApplyFailure {
  op: PatchOp;
  reason: string;
}

export interface ApplyResult {
  html: string;
  applied: PatchOp[];
  failed: ApplyFailure[];
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function annotate($: cheerio.CheerioAPI, fragment: string, op: PatchOp, index: number): string {
  const doc = cheerio.load(fragment, null, false);
  const roots = doc.root().children();
  let root: cheerio.Cheerio<any>;
  if (roots.length === 1 && roots.first().is('*')) {
    root = roots.first();
  } else {
    doc.root().wrapInner('<div></div>');
    root = doc.root().children().first();
  }
  root.attr('data-rf-section', op.sectionId);
  root.attr('data-rf-patch', `${op.sectionId}_${index}`);
  root.attr('data-rf-tag', op.tag);
  root.attr('data-rf-sample', String(op.sample));
  root.attr('data-rf-reason', op.reason);
  void $;
  return doc.html();
}

function selectorMatches($: cheerio.CheerioAPI, selector: string): number {
  try {
    return $(selector).length;
  } catch {
    return -1;
  }
}

/**
 * Applies patch operations to snapshot HTML in server mode. Each selector is verified against the DOM before use;
 * an operation whose target is missing or invalid is reported as failed and skipped, never guessed.
 */
export function applyPatchOps(html: string, ops: PatchOp[]): ApplyResult {
  const $ = cheerio.load(html);
  const applied: PatchOp[] = [];
  const failed: ApplyFailure[] = [];
  let index = 0;

  for (const op of ops) {
    index++;
    try {
      if (op.op === 'setHeadMeta') {
        if (op.target === 'title') {
          if ($('head title').length === 0) $('head').append('<title></title>');
          $('head title').first().text(op.html ?? '');
        } else {
          const match = op.target.match(/^meta\[name="([^"]+)"\]$/);
          if (!match) throw new Error('Unsupported head target');
          let meta = $(op.target).first();
          if (meta.length === 0) {
            $('head').append(`<meta name="${match[1]}" content="">`);
            meta = $(op.target).first();
          }
          meta.attr('content', op.html ?? '');
        }
        applied.push(op);
        continue;
      }

      if (op.op === 'injectJsonLd') {
        const json = JSON.parse(op.html ?? '');
        if (op.replaceType) {
          $('script[type="application/ld+json"]').each((_, el) => {
            const text = $(el).contents().text();
            if (text.includes(`"${op.replaceType}"`)) $(el).remove();
          });
        }
        $('head').append(`<script type="application/ld+json" data-rf-patch="${op.sectionId}_${index}">${JSON.stringify(json).replace(/</g, '\\u003c')}</script>`);
        applied.push(op);
        continue;
      }

      let selector = op.target;
      let count = selectorMatches($, selector);
      if (count < 0) throw new Error(`Invalid selector "${selector}"`);
      if (count === 0 && op.fallbackTarget && selectorMatches($, op.fallbackTarget) > 0) {
        selector = op.fallbackTarget;
        count = selectorMatches($, selector);
      }
      if (count === 0) throw new Error(`Selector "${op.target}" matched nothing`);
      const targets = op.all ? $(selector) : $(selector).first();

      switch (op.op) {
        case 'setText':
          targets.text(op.html ?? '');
          break;
        case 'setAttr': {
          if (!op.attr) throw new Error('setAttr needs attr');
          const attr = op.attr;
          targets.each((i, el) => {
            $(el).attr(attr.name, attr.value.replace('{n}', String(i + 1)));
          });
          break;
        }
        case 'insertBefore':
        case 'insertAfter': {
          if (!op.html) throw new Error('Insert needs html');
          const fragment = annotate($, op.html, op, index);
          if (op.op === 'insertBefore') targets.before(fragment);
          else targets.after(fragment);
          break;
        }
        case 'move': {
          if (!op.to || selectorMatches($, op.to) < 1) throw new Error('move needs a valid destination');
          const el = targets.first();
          $(op.to).first().after(el);
          break;
        }
        case 'remove':
          targets.remove();
          break;
        default:
          throw new Error(`Unsupported op ${String(op.op)}`);
      }
      applied.push(op);
    } catch (err) {
      failed.push({ op, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { html: $.html(), applied, failed };
}

/** Escapes text for use inside an inserted HTML fragment. */
export const escapeForHtml = escapeHtml;

/**
 * Runtime patch mode (spec F2.6): for storefronts that discard server-side edits when they hydrate. The same
 * operations are applied in the browser after load and re-applied with a MutationObserver if the page removes them.
 * Plain JS string so no build step can change it.
 */
export function runtimePatchScript(ops: PatchOp[]): string {
  const payload = JSON.stringify(ops).replace(/</g, '\\u003c');
  return `(function(){
  var ops = ${payload};
  function annotate(html, op, i) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var root = t.content.children.length === 1 ? t.content.firstElementChild : null;
    if (!root) { root = document.createElement('div'); root.innerHTML = html; }
    root.setAttribute('data-rf-section', op.sectionId);
    root.setAttribute('data-rf-patch', op.sectionId + '_' + i);
    root.setAttribute('data-rf-tag', op.tag);
    root.setAttribute('data-rf-sample', String(op.sample));
    root.setAttribute('data-rf-reason', op.reason);
    return root;
  }
  function apply() {
    ops.forEach(function(op, idx) {
      var i = idx + 1;
      try {
        if (op.op === 'setHeadMeta') {
          if (op.target === 'title') { if (document.title !== (op.html || '')) document.title = op.html || ''; return; }
          var m = op.target.match(/^meta\\[name="([^"]+)"\\]$/); if (!m) return;
          var meta = document.querySelector(op.target);
          if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', m[1]); document.head.appendChild(meta); }
          if (meta.getAttribute('content') !== (op.html || '')) meta.setAttribute('content', op.html || ''); return;
        }
        if (op.op === 'injectJsonLd') {
          if (document.querySelector('script[data-rf-patch="' + op.sectionId + '_' + i + '"]')) return;
          var s = document.createElement('script'); s.type = 'application/ld+json'; s.setAttribute('data-rf-patch', op.sectionId + '_' + i); s.textContent = op.html; document.head.appendChild(s); return;
        }
        if ((op.op === 'insertBefore' || op.op === 'insertAfter') && document.querySelector('[data-rf-patch="' + op.sectionId + '_' + i + '"]')) return;
        var sel = op.target; if (!document.querySelector(sel) && op.fallbackTarget) sel = op.fallbackTarget;
        var targets = op.all ? Array.prototype.slice.call(document.querySelectorAll(sel)) : [document.querySelector(sel)];
        targets = targets.filter(Boolean); if (!targets.length) return;
        if (op.op === 'setText') targets.forEach(function(el){ if (el.textContent !== (op.html || '')) el.textContent = op.html || ''; });
        else if (op.op === 'setAttr') targets.forEach(function(el, n){ var v = op.attr.value.replace('{n}', String(n + 1)); if (el.getAttribute(op.attr.name) !== v) el.setAttribute(op.attr.name, v); });
        else if (op.op === 'insertBefore') targets[0].parentNode.insertBefore(annotate(op.html, op, i), targets[0]);
        else if (op.op === 'insertAfter') targets[0].parentNode.insertBefore(annotate(op.html, op, i), targets[0].nextSibling);
        else if (op.op === 'remove') targets.forEach(function(el){ el.remove(); });
        else if (op.op === 'move') { var to = document.querySelector(op.to); if (to && to.nextSibling !== targets[0]) to.parentNode.insertBefore(targets[0], to.nextSibling); }
      } catch (e) { if (window.console) console.warn('rf patch failed', op.sectionId, e && e.message); }
    });
  }
  var pending = false;
  function schedule() { if (pending) return; pending = true; setTimeout(function(){ pending = false; apply(); }, 50); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
  window.addEventListener('load', function(){ setTimeout(apply, 300); });
  new MutationObserver(function(){ schedule(); }).observe(document.documentElement, { childList: true, subtree: true });
})();`;
}

/** Injects the runtime patch script into snapshot HTML. */
export function applyRuntimeMode(html: string, ops: PatchOp[]): string {
  const script = `<script id="rf-runtime-patch">${runtimePatchScript(ops)}</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : html + script;
}
