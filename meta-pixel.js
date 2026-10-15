(function () {
  const DEFAULT_PIXEL_ID = '1103618278174331';
  const CONFIG_URL = 'https://eegqobqhrfdkmjyjnqvp.supabase.co/rest/v1/site_configuracoes?chave=eq.meta_pixel_id&select=valor';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys';
  const eventQueue = [];
  let ready = false;

  function isInternalAccess() {
    const params = new URLSearchParams(location.search);
    if (params.get('interno') === '1') return true;
    if (params.get('interno') === '0') return false;
    try { return localStorage.getItem('tioNanInternalAccess') === '1'; } catch (_) { return false; }
  }

  if (isInternalAccess()) {
    window.TioNanPixel = {
      ready: Promise.resolve(false),
      isEnabled: () => false,
      viewContent() {}, addToCart() {}, initiateCheckout() {}, addPaymentInfo() {}, purchase() {}
    };
    return;
  }

  function validPixelId(value) {
    const normalized = String(value || '').trim();
    return /^\d{5,25}$/.test(normalized) ? normalized : '';
  }

  async function loadPixelId() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(CONFIG_URL, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Configuração indisponível (${response.status})`);
      const data = await response.json();
      return validPixelId(data?.[0]?.valor) || DEFAULT_PIXEL_ID;
    } catch (_) {
      return DEFAULT_PIXEL_ID;
    } finally {
      clearTimeout(timeout);
    }
  }

  function startPixel(pixelId) {
    if (!pixelId) return false;

  if (!window.fbq) {
    const fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    window.fbq = fbq;
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }

    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    ready = true;
    while (eventQueue.length) eventQueue.shift()();
    return true;
  }

  function runWhenReady(callback) {
    if (ready) callback();
    else eventQueue.push(callback);
  }

  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const id = value => String(value ?? '').trim();
  const contents = items => (Array.isArray(items) ? items : []).map(item => ({
    id: id(item.id || item.produto_id),
    quantity: Math.max(1, number(item.quantity || item.quantidade || item.qtd || 1)),
    item_price: number(item.item_price || item.price || item.preco || 0)
  })).filter(item => item.id);

  function sessionOnce(key) {
    try {
      const storageKey = `tioNanMeta:${key}`;
      if (sessionStorage.getItem(storageKey)) return false;
      sessionStorage.setItem(storageKey, '1');
    } catch (_) {}
    return true;
  }

  function purchaseOnce(reference) {
    if (!reference) return false;
    try {
      const storageKey = `tioNanMetaPurchase:${reference}`;
      if (localStorage.getItem(storageKey)) return false;
      localStorage.setItem(storageKey, new Date().toISOString());
    } catch (_) {}
    return true;
  }

  const api = {
    ready: null,
    isEnabled: () => ready,
    viewContent(product) {
      if (!product) return;
      runWhenReady(() => window.fbq('track', 'ViewContent', {
        content_ids: [id(product.id)],
        content_name: product.name || product.nome || '',
        content_category: product.category || product.categoria || 'Cachaças',
        content_type: 'product',
        value: number(product.value ?? product.preco),
        currency: 'BRL'
      }));
    },
    addToCart(product, quantity = 1) {
      if (!product) return;
      const item = { id: product.id, quantity, item_price: number(product.value ?? product.preco ?? product.price) };
      runWhenReady(() => window.fbq('track', 'AddToCart', {
        content_ids: [id(product.id)],
        content_name: product.name || product.nome || '',
        content_type: 'product',
        contents: contents([item]),
        value: item.item_price * Math.max(1, number(quantity)),
        currency: 'BRL'
      }));
    },
    initiateCheckout(payload = {}) {
      const list = contents(payload.items);
      const fingerprint = list.map(item => `${item.id}:${item.quantity}`).join('|');
      if (!sessionOnce(`InitiateCheckout:${fingerprint}`)) return;
      runWhenReady(() => window.fbq('track', 'InitiateCheckout', {
        content_ids: list.map(item => item.id),
        content_type: 'product',
        contents: list,
        num_items: list.reduce((sum, item) => sum + item.quantity, 0),
        value: number(payload.value),
        currency: 'BRL'
      }));
    },
    addPaymentInfo(payload = {}) {
      const list = contents(payload.items);
      const method = id(payload.method || 'não informado');
      const fingerprint = `${method}:${list.map(item => `${item.id}:${item.quantity}`).join('|')}`;
      if (!sessionOnce(`AddPaymentInfo:${fingerprint}`)) return;
      runWhenReady(() => window.fbq('track', 'AddPaymentInfo', {
        content_ids: list.map(item => item.id),
        content_type: 'product',
        contents: list,
        payment_method: method,
        value: number(payload.value),
        currency: 'BRL'
      }));
    },
    purchase(payload = {}) {
      const reference = id(payload.reference || payload.orderId);
      if (!purchaseOnce(reference)) return;
      const list = contents(payload.items);
      runWhenReady(() => window.fbq('track', 'Purchase', {
        content_ids: list.map(item => item.id),
        content_type: 'product',
        contents: list,
        value: number(payload.value),
        currency: 'BRL',
        order_id: reference
      }, { eventID: `purchase-${reference}` }));
    }
  };

  window.TioNanPixel = api;
  api.ready = loadPixelId().then(startPixel);
})();
