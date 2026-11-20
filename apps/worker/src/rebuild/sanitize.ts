import * as cheerio from 'cheerio';

export interface ValidationResult {
  html: string;
  /** Classes that were not in the store's whitelist and were removed (repair pass). */
  removedClasses: string[];
  /** True when the section was wrapped in a scoped style block because too many classes were unusable. */
  usedScopedStyle: boolean;
  /** Dangerous markup that was stripped (scripts, event handlers, javascript: links, iframes). */
  strippedUnsafe: number;
}

const OWN_PREFIX = 'rf-';
const URL_ATTRS = ['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'data'];

/**
 * Model-written HTML is untrusted. This removes anything executable, then enforces the class whitelist (spec F6.2):
 * classes the store does not define are removed (repair pass); if most were unusable the section falls back to a
 * scoped style block so it still looks deliberate. Classes starting with `rf-` are RankForge's own and always allowed.
 */
export function sanitizeAndValidateSection(html: string, whitelist: Iterable<string>): ValidationResult {
  const allowed = new Set(whitelist);
  const $ = cheerio.load(html, null, false);
  let strippedUnsafe = 0;

  $('script, iframe, object, embed, link[rel="import"], base, meta[http-equiv], form').each((_, el) => {
    strippedUnsafe++;
    $(el).remove();
  });
  // Keep inline <style> out: styling comes from whitelisted classes, rf- classes or the scoped fallback.
  $('style').each((_, el) => {
    strippedUnsafe++;
    $(el).remove();
  });
  $('*').each((_, el) => {
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attribs)) {
      const lower = name.toLowerCase();
      if (lower === 'style') {
        $(el).removeAttr(name);
        strippedUnsafe++;
      } else if (lower.startsWith('on')) {
        $(el).removeAttr(name);
        strippedUnsafe++;
      } else if (URL_ATTRS.includes(lower) && /^\s*(javascript|data|vbscript):/i.test(value) && !(lower === 'src' && /^\s*data:image\//i.test(value))) {
        $(el).removeAttr(name);
        strippedUnsafe++;
      }
    }
  });

  const removed = new Set<string>();
  let total = 0;
  $('[class]').each((_, el) => {
    const kept: string[] = [];
    for (const cls of ($(el).attr('class') ?? '').split(/\s+/).filter(Boolean)) {
      total++;
      if (cls.startsWith(OWN_PREFIX) || allowed.has(cls)) kept.push(cls);
      else removed.add(cls);
    }
    if (kept.length) $(el).attr('class', kept.join(' '));
    else $(el).removeAttr('class');
  });

  const ratio = total === 0 ? 0 : removed.size / total;
  const usedScopedStyle = ratio > 0.5;
  let out = $.html();
  if (usedScopedStyle) {
    out = `<div class="rf-scoped">${out}</div>`;
  }
  return { html: out, removedClasses: [...removed], usedScopedStyle, strippedUnsafe };
}

/** RankForge's own minimal styles for `rf-` classes, injected once into the optimised page. */
export const RF_STYLES = `
.rf-section{margin:24px 0;padding:16px;border:1px solid rgba(128,128,128,.25);border-radius:8px;font:inherit;color:inherit;position:relative}
.rf-section h2{font-size:1.25em;margin:0 0 12px}.rf-section h3{font-size:1.05em;margin:12px 0 6px}
.rf-list{list-style:none;margin:0;padding:0}.rf-list li{padding:6px 0;display:flex;gap:8px;align-items:flex-start}
.rf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.rf-card{padding:12px;border:1px solid rgba(128,128,128,.25);border-radius:8px}
.rf-table{width:100%;border-collapse:collapse}.rf-table th,.rf-table td{padding:8px;border-bottom:1px solid rgba(128,128,128,.25);text-align:left}
.rf-faq details{border-bottom:1px solid rgba(128,128,128,.25);padding:8px 0}.rf-faq summary{cursor:pointer;font-weight:600}
.rf-stars{color:#f5a623;letter-spacing:1px}
.rf-sample-chip{display:inline-block;font-size:11px;font-weight:600;line-height:1;padding:3px 6px;border-radius:4px;background:#fff3cd;color:#664d03;border:1px solid #ffda6a;margin-left:6px;vertical-align:middle}
.rf-sticky{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff;color:#111;border-top:1px solid #ddd;box-shadow:0 -2px 8px rgba(0,0,0,.08)}
.rf-sticky button{min-height:48px;padding:0 20px;border:0;border-radius:6px;background:#111;color:#fff;font-weight:600;cursor:pointer}
.rf-scoped{font-family:inherit;color:inherit;line-height:1.5}
.rf-scoped *{max-width:100%}
`;
