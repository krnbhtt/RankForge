/**
 * Browser-side scripts, kept as plain strings so no build step (esbuild name helpers etc.)
 * can inject references that do not exist inside the page context.
 */

/** Scrolls through the page to trigger lazy loading, then returns to the top. */
export const AUTO_SCROLL_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
  const deadline = Date.now() + 4000;
  let y = 0;
  let lastHeight = 0;
  while (Date.now() < deadline) {
    window.scrollTo(0, y);
    await sleep(120);
    const height = document.documentElement.scrollHeight;
    if (y + window.innerHeight >= height && height === lastHeight) break;
    lastHeight = height;
    y += step;
    if (y > 30000) break;
  }
  window.scrollTo(0, 0);
  await sleep(200);
  return document.documentElement.scrollHeight;
})()`;

/** Reads framework markers from the live page. */
export const FRAMEWORK_MARKERS_SCRIPT = `(() => {
  const w = window;
  const signals = [];
  let framework = 'none';
  const set = (f, s) => {
    signals.push(s);
    if (framework === 'none' || f === 'next' || f === 'nuxt' || f === 'hydrogen') framework = f;
  };
  if (w.__NEXT_DATA__ || document.getElementById('__next')) set('next', '__NEXT_DATA__ / #__next');
  if (w.__NUXT__ || document.getElementById('__nuxt')) set('nuxt', '__NUXT__ / #__nuxt');
  if (w.__remixContext || w.__reactRouterContext) set('hydrogen', 'remix / react-router context');
  const els = Array.from(document.querySelectorAll('body *')).slice(0, 400);
  if (els.some((el) => Object.keys(el).some((k) => k.startsWith('__reactContainer') || k.startsWith('_reactRootContainer')))) {
    set('react', 'React root container');
  }
  if (document.querySelector('[data-reactroot]')) set('react', 'data-reactroot');
  if (document.querySelector('[data-v-app]') || w.__VUE__ || document.querySelector('[data-server-rendered]')) set('vue', 'Vue app marker');
  if (document.querySelector('[ng-version]')) set('angular', 'ng-version attribute');
  if (document.querySelector('[data-svelte-h], [class*="svelte-"]')) set('svelte', 'Svelte marker');
  return { framework, signals };
})()`;

/** Collects layout-dependent facts from the rendered product page. */
export const LAYOUT_SCRIPT = `(() => {
  const VIEW_H = window.innerHeight;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const unique = (s) => { try { return document.querySelectorAll(s).length === 1; } catch (e) { return false; } };
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && unique('#' + esc(el.id))) return '#' + esc(el.id);
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && depth < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && unique('#' + esc(cur.id))) { parts.unshift('#' + esc(cur.id)); break; }
      const cls = Array.from(cur.classList).filter((c) => /^[a-zA-Z][\\w-]{0,40}$/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map(esc).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (unique(candidate)) return candidate;
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  };
  const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const classesOf = (el) => {
    const out = new Set();
    const add = (n) => n.classList && n.classList.forEach((c) => out.add(c));
    add(el);
    el.querySelectorAll('*').forEach((n, i) => { if (i < 60) add(n); });
    return Array.from(out).slice(0, 40);
  };

  // ---- images
  const imgEls = Array.from(document.images).filter((img) => {
    const r = img.getBoundingClientRect();
    const src = img.currentSrc || img.src;
    return src && !src.startsWith('data:') && visible(img) && (r.width >= 48 && r.height >= 48);
  });
  const area = (img) => { const r = img.getBoundingClientRect(); return r.width * r.height; };
  const top = (img) => img.getBoundingClientRect().top + window.scrollY;
  const heroEl = imgEls.filter((i) => top(i) < 1400).sort((a, b) => area(b) - area(a))[0] || null;
  let galleryRoot = null;
  if (heroEl) {
    let cur = heroEl.parentElement;
    for (let d = 0; cur && d < 7; d++, cur = cur.parentElement) {
      if (imgEls.filter((i) => cur.contains(i)).length >= 3) { galleryRoot = cur; break; }
    }
  }
  const images = imgEls.slice(0, 80).map((img) => ({
    src: img.currentSrc || img.src,
    alt: img.getAttribute('alt') || '',
    role: img === heroEl ? 'hero' : (galleryRoot && galleryRoot.contains(img) ? 'gallery' : 'other'),
    width: img.naturalWidth || Math.round(img.getBoundingClientRect().width),
    height: img.naturalHeight || Math.round(img.getBoundingClientRect().height),
  }));

  // ---- price
  const priceNodes = Array.from(document.querySelectorAll('[itemprop="price"], [class*="price" i], [data-price], [id*="price" i]'))
    .filter((el) => visible(el) && top(el) < 3000)
    .map((el) => ({ el, t: text(el) || el.getAttribute('content') || '' }))
    .filter((x) => x.t.length > 0 && x.t.length <= 120 && /\\d/.test(x.t));
  const leafPriceNodes = priceNodes.filter((x) => !priceNodes.some((y) => y.el !== x.el && x.el.contains(y.el)));
  const priceCandidates = leafPriceNodes.slice(0, 12).map((x) => ({
    text: x.t,
    struck: !!x.el.closest('del, s, strike, [class*="compare" i], [class*="mrp" i], [class*="was-" i], [class*="old-" i], [class*="regular" i]'),
    selector: sel(x.el),
  }));
  const currencyMeta = document.querySelector('[itemprop="priceCurrency"]');
  const priceCurrency = currencyMeta ? (currencyMeta.getAttribute('content') || currencyMeta.textContent || '').trim() : '';

  // ---- variants
  const variants = [];
  const labelFor = (el) => {
    const id = el.id;
    const l = id ? document.querySelector('label[for="' + esc(id) + '"]') : null;
    return (l && text(l)) || el.getAttribute('aria-label') || el.getAttribute('data-option-name') || el.getAttribute('name') || '';
  };
  Array.from(document.querySelectorAll('select')).forEach((s) => {
    if (!visible(s) && !s.closest('form[action*="cart" i]')) return;
    const values = Array.from(s.options).map((o) => (o.textContent || '').trim()).filter((v) => v && !/^(select|choose|--)/i.test(v));
    const name = labelFor(s);
    if (values.length >= 2 && /size|colo|variant|option|style|material|pack|flavo|weight|model|capacity/i.test(name + ' ' + (s.name || '') + ' ' + s.id)) {
      variants.push({ name: name.replace(/\\s+/g, ' ').trim() || 'Option', values, selector: sel(s) });
    }
  });
  const radioGroups = new Map();
  Array.from(document.querySelectorAll('input[type="radio"]')).forEach((r) => {
    if (!r.name || /pay|ship|deliver|rating|star/i.test(r.name)) return;
    if (!radioGroups.has(r.name)) radioGroups.set(r.name, []);
    radioGroups.get(r.name).push(r);
  });
  radioGroups.forEach((radios, name) => {
    const values = radios.map((r) => {
      const l = r.id ? document.querySelector('label[for="' + esc(r.id) + '"]') : r.closest('label');
      return ((l && text(l)) || r.value || '').trim();
    }).filter(Boolean);
    if (values.length >= 2) {
      const group = radios[0].closest('fieldset') || radios[0].parentElement;
      const legend = group && group.querySelector('legend');
      variants.push({ name: ((legend && text(legend)) || radios[0].getAttribute('data-option-name') || name).replace(/\\s+/g, ' ').trim(), values: Array.from(new Set(values)), selector: sel(group) });
    }
  });

  // ---- CTA
  const CTA_RE = /add\\s*to\\s*(cart|bag|basket|trolley)|buy\\s*(it\\s*)?now|order\\s*now|add\\s*to\\s*my\\s*bag/i;
  const ctaEls = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"], a.button, a.btn, [name="add"]'))
    .filter((el) => visible(el) && CTA_RE.test(text(el) + ' ' + (el.value || '') + ' ' + (el.getAttribute('aria-label') || '')));
  const sticky = (el) => { for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const ctas = ctaEls.slice(0, 8).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      text: (text(el) || el.value || el.getAttribute('aria-label') || '').slice(0, 80),
      selector: sel(el),
      top: Math.round(r.top + window.scrollY),
      aboveFold: r.bottom <= VIEW_H && r.top >= 0,
      sticky: sticky(el),
    };
  });

  // ---- design tokens
  const rgbToHex = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    if (p.length === 4 && p[3] === 0) return null;
    return '#' + p.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  };
  const tally = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
  const colors = new Map(); const fonts = new Map(); const radii = new Map();
  Array.from(document.querySelectorAll('body *')).filter((el) => visible(el)).slice(0, 700).forEach((el) => {
    const cs = getComputedStyle(el);
    tally(colors, rgbToHex(cs.color)); tally(colors, rgbToHex(cs.backgroundColor));
    const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
    tally(fonts, fam);
    const br = parseFloat(cs.borderTopLeftRadius);
    if (br > 0) tally(radii, String(Math.round(br)));
  });
  const topN = (map, n) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
  const designTokens = {
    fontFamilies: topN(fonts, 3).map((e) => e[0]),
    baseFontSizePx: parseFloat(getComputedStyle(document.body).fontSize) || 16,
    colors: topN(colors, 8).map((e) => ({ value: e[0], count: e[1] })),
    borderRadiiPx: topN(radii, 4).map((e) => Number(e[0])),
  };

  // ---- component inventory
  const components = [];
  const addComp = (kind, el) => { if (el) components.push({ kind, selector: sel(el), classes: classesOf(el) }); };
  addComp('gallery', galleryRoot || (heroEl && heroEl.parentElement));
  variants.slice(0, 3).forEach((v) => { const el = v.selector ? document.querySelector(v.selector) : null; addComp('variantSelector', el); });
  if (ctaEls[0]) addComp('addToCart', ctaEls[0]);
  if (leafPriceNodes[0]) addComp('price', leafPriceNodes[0].el.closest('[class*="price" i]') || leafPriceNodes[0].el);
  addComp('reviews', document.querySelector('[class*="review" i][class*="widget" i], [id*="review" i], [class*="reviews" i], [data-review]'));
  addComp('description', document.querySelector('[class*="product__description" i], [class*="product-description" i], #description, [itemprop="description"], [class*="description" i]'));
  addComp('accordion', document.querySelector('details, [class*="accordion" i]'));
  addComp('breadcrumb', document.querySelector('nav[aria-label*="bread" i], [class*="breadcrumb" i]'));
  addComp('header', document.querySelector('header'));
  addComp('footer', document.querySelector('footer'));

  return { images, priceCandidates, priceCurrency, variants, ctas, designTokens, components, pageHeight: document.documentElement.scrollHeight };
})()`;

/**
 * Hides time-dependent overlays (cookie banners, newsletter and country pop-ups, their backdrops)
 * and releases scroll locks, so the captured page shows the product rather than a transient modal.
 * Returns how many elements were hidden.
 */
export const NEUTRALISE_OVERLAYS_SCRIPT = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  let hidden = 0;
  const hide = (el) => { el.setAttribute('data-rf-hidden-overlay', '1'); el.style.setProperty('display', 'none', 'important'); hidden++; };
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    if (el.hasAttribute('data-rf-hidden-overlay')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const isDialog = el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog' || el.getAttribute('aria-modal') === 'true';
    const fixed = cs.position === 'fixed';
    const z = parseInt(cs.zIndex, 10) || 0;
    const coversViewport = r.width >= vw * 0.9 && r.height >= vh * 0.9;
    const looksLikeBar = r.top <= 2 && r.height < 140;
    if (isDialog && r.width > 0) { hide(el); continue; }
    if (!fixed) continue;
    const text = (el.innerText || '').trim();
    const cls = (el.className && el.className.toString ? el.className.toString() : '') + ' ' + (el.id || '');
    const modalish = /modal|popup|pop-up|overlay|backdrop|cookie|consent|newsletter|subscribe|gdpr|banner-lightbox|lightbox|drawer-mask|country/i.test(cls);
    if (coversViewport && text.length < 40) { hide(el); continue; }
    if (modalish && !looksLikeBar && r.width > 150 && r.height > 80) { hide(el); continue; }
    if (z >= 1000 && !looksLikeBar && r.width >= 280 && r.height >= 160 && r.width < vw * 0.98) { hide(el); continue; }
    if (/cookie|consent|gdpr/i.test(cls) && r.bottom >= vh - 4) { hide(el); continue; }
  }
  for (const node of [document.documentElement, document.body]) {
    node.style.setProperty('overflow', 'auto', 'important');
    node.style.removeProperty('position');
    node.classList.remove('no-scroll', 'modal-open', 'overflow-hidden', 'scroll-lock', 'is-locked');
  }
  return hidden;
})()`;
