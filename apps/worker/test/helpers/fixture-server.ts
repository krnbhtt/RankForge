import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PNG } from 'pngjs';

function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const img = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(img);
}

const THEME_CSS = `
body{font-family:Inter,Arial,sans-serif;margin:0;color:#222;background:#fff;font-size:16px}
header.site-header{padding:16px 24px;background:#111;color:#fff}
.page-width{max-width:1200px;margin:0 auto;padding:24px}
.product{display:grid;grid-template-columns:1fr 1fr;gap:32px}
@media (max-width:749px){.product{grid-template-columns:1fr}}
.product__media-list{display:flex;flex-wrap:wrap;gap:8px}
.product__media-main{width:100%;height:420px;object-fit:cover;background:#eee}
.product__thumb{width:72px;height:72px;border:2px solid transparent;cursor:pointer;border-radius:4px}
.product__thumb.is-active{border-color:#0a6}
.price{font-size:24px;margin:16px 0}
.price-item--regular{color:#888}
.price-item--sale{color:#b00;font-weight:700;margin-left:8px}
.btn{background:#0a6;color:#fff;border:0;border-radius:6px;padding:14px 28px;font-size:16px;cursor:pointer}
.accordion summary{cursor:pointer;padding:12px 0;border-bottom:1px solid #ddd}
.product__description{line-height:1.6}
footer.site-footer{padding:32px;background:#f4f4f4;margin-top:48px}
.bg-hero{background-image:url(/img/bg.png);height:40px}
`;

const THEME_JS = `
(function(){
  var thumbs=document.querySelectorAll('.product__thumb');
  var main=document.getElementById('main-image');
  thumbs.forEach(function(t){t.addEventListener('click',function(){
    main.src=t.getAttribute('data-large');
    thumbs.forEach(function(x){x.classList.remove('is-active')});
    t.classList.add('is-active');
  })});
  var sel=document.getElementById('size');
  var out=document.getElementById('selected-variant');
  if(sel&&out){sel.addEventListener('change',function(){out.textContent='Selected: '+sel.value})}
  var atc=document.getElementById('add-to-cart');
  if(atc){atc.addEventListener('click',function(e){
    e.preventDefault();
    fetch('/cart/add.js',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
      .then(function(){atc.textContent='Added'});
  })}
})();
`;

export const PRODUCT_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Blue Ceramic Mug | Fixture Store</title>
<meta name="description" content="A hand-glazed blue ceramic mug.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="/products/blue-mug">
<link rel="preconnect" href="https://cdn.shopify.com">
<link rel="stylesheet" href="/assets/theme.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Blue Ceramic Mug","offers":{"@type":"Offer","price":"1499.00","priceCurrency":"INR"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"128"}}</script>
<script>window.Shopify={theme:{name:'Dawn'},shop:'fixture.myshopify.com'};</script>
<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-FIXTURE"></script>
<script src="/assets/theme.js" defer></script>
</head><body>
<header class="site-header">Fixture Store</header>
<main class="page-width">
  <nav aria-label="Breadcrumb" class="breadcrumb"><a href="/">Home</a> / <a href="/collections/mugs">Mugs</a></nav>
  <div class="product">
    <div class="product__media-list">
      <img id="main-image" class="product__media-main" src="/img/main.png" alt="Blue mug front">
      <img class="product__thumb is-active" src="/img/t1.png" data-large="/img/main.png" alt="Front">
      <img class="product__thumb" src="/img/t2.png" data-large="/img/alt.png" alt="Side">
      <img class="product__thumb" src="/img/t3.png" data-large="/img/alt.png" alt="Top">
      <img class="product__thumb" data-src="/img/t4.png" src="/img/t4.png" alt="Back" loading="lazy">
    </div>
    <div class="product__info">
      <h1>Blue Ceramic Mug</h1>
      <div class="price"><s class="price-item--regular">₹ 1,999.00</s><span class="price-item--sale">₹ 1,499.00</span></div>
      <form action="/cart/add" method="post">
        <fieldset><legend>Colour</legend>
          <label><input type="radio" name="colour" value="Blue" checked> Blue</label>
          <label><input type="radio" name="colour" value="Green"> Green</label>
        </fieldset>
        <label for="size">Size</label>
        <select id="size" name="options[Size]"><option>Small</option><option>Large</option></select>
        <p id="selected-variant">Selected: Small</p>
        <button id="add-to-cart" class="btn" type="submit" name="add">Add to cart</button>
      </form>
      <div class="product__description">
        <h2>About this mug</h2>
        <p>Hand-glazed stoneware with a comfortable handle. Microwave and dishwasher safe. Holds 350 ml.</p>
        <details class="accordion"><summary>Care instructions</summary><p>Hand wash recommended.</p></details>
      </div>
    </div>
  </div>
  <section class="reviews"><h2>Customer reviews</h2>
    <div class="review-item">Lovely mug, the glaze is gorgeous and it keeps coffee hot for ages.</div>
  </section>
</main>
<div class="bg-hero"></div>
<footer class="site-footer">© Fixture Store</footer>
</body></html>`;

const SHOPIFY_JSON = {
  product: {
    title: 'Blue Ceramic Mug',
    handle: 'blue-mug',
    vendor: 'Fixture',
    product_type: 'Mugs',
    tags: 'ceramic, mug',
    body_html: '<p>Hand-glazed stoneware.</p>',
    images: [{ src: 'https://cdn.example.org/main.png', alt: 'Blue mug' }],
    options: [{ name: 'Size', values: ['Small', 'Large'] }],
    variants: [{ id: 1001, title: 'Small', price: '1499.00', compare_at_price: '1999.00', sku: 'MUG-S', available: true }],
  },
};

export interface FixtureServer {
  origin: string;
  requests: { method: string; url: string }[];
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: { method: string; url: string }[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    requests.push({ method: req.method ?? 'GET', url });
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    const path = url.split('?')[0] ?? '/';
    switch (path) {
      case '/products/blue-mug':
        return send(200, 'text/html; charset=utf-8', PRODUCT_HTML);
      case '/products/blue-mug.json':
        return send(200, 'application/json', JSON.stringify(SHOPIFY_JSON));
      case '/assets/theme.css':
        return send(200, 'text/css', THEME_CSS);
      case '/assets/theme.js':
        return send(200, 'text/javascript', THEME_JS);
      case '/img/main.png':
        return send(200, 'image/png', png(600, 420, [30, 90, 200]));
      case '/img/alt.png':
        return send(200, 'image/png', png(600, 420, [200, 90, 30]));
      case '/img/bg.png':
        return send(200, 'image/png', png(40, 40, [120, 120, 120]));
      case '/img/t1.png':
      case '/img/t2.png':
      case '/img/t3.png':
      case '/img/t4.png':
        return send(200, 'image/png', png(72, 72, [60, 160, 120]));
      case '/forbidden':
        return send(403, 'text/html', '<html><body>Forbidden</body></html>');
      case '/too-many':
        return send(429, 'text/html', '<html><body>Slow down</body></html>');
      case '/challenge':
        return send(
          200,
          'text/html',
          '<html><head><title>Just a moment...</title></head><body><div id="cf-browser-verification">Checking your browser</div></body></html>'
        );
      case '/empty':
        return send(200, 'text/html', '<html><head></head><body></body></html>');
      case '/slow-images':
        return send(
          200,
          'text/html',
          `<html><head><title>Slow Images Product</title></head><body><main><h1>Slow Images Product</h1>${'<p>Plenty of descriptive text about this product so it counts as a real page. '.repeat(12)}</p><img src="/slow/a.png" alt="a"></main></body></html>`
        );
      case '/slow/a.png':
        setTimeout(() => send(200, 'image/png', png(10, 10, [0, 0, 0])), 60_000).unref();
        return;
      default:
        return send(404, 'text/plain', 'not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const allowLoopbackPolicy = async (url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isValid: false, error: 'bad protocol' };
  }
  return { isValid: true };
};
