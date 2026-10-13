(function () {
  const PIXEL_ID = '1103618278174331';

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

  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');

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

  window.TioNanPixel = {
    viewContent(product) {
      if (!product) return;
      window.fbq('track', 'ViewContent', {
        content_ids: [id(product.id)],
        content_name: product.name || product.nome || '',
        content_category: product.category || product.categoria || 'Cachaças',
        content_type: 'product',
        value: number(product.value ?? product.preco),
        currency: 'BRL'
      });
    },
    addToCart(product, quantity = 1) {
      if (!product) return;
      const item = { id: product.id, quantity, item_price: number(product.value ?? product.preco ?? product.price) };
      window.fbq('track', 'AddToCart', {
        content_ids: [id(product.id)],
        content_name: product.name || product.nome || '',
        content_type: 'product',
        contents: contents([item]),
        value: item.item_price * Math.max(1, number(quantity)),
        currency: 'BRL'
      });
    },
    initiateCheckout(payload = {}) {
      const list = contents(payload.items);
      const fingerprint = list.map(item => `${item.id}:${item.quantity}`).join('|');
      if (!sessionOnce(`InitiateCheckout:${fingerprint}`)) return;
      window.fbq('track', 'InitiateCheckout', {
        content_ids: list.map(item => item.id),
        content_type: 'product',
        contents: list,
        num_items: list.reduce((sum, item) => sum + item.quantity, 0),
        value: number(payload.value),
        currency: 'BRL'
      });
    },
    addPaymentInfo(payload = {}) {
      const list = contents(payload.items);
      const method = id(payload.method || 'não informado');
      const fingerprint = `${method}:${list.map(item => `${item.id}:${item.quantity}`).join('|')}`;
      if (!sessionOnce(`AddPaymentInfo:${fingerprint}`)) return;
      window.fbq('track', 'AddPaymentInfo', {
        content_ids: list.map(item => item.id),
        content_type: 'product',
        contents: list,
        payment_method: method,
        value: number(payload.value),
        currency: 'BRL'
      });
    },
    purchase(payload = {}) {
      const reference = id(payload.reference || payload.orderId);
      if (!purchaseOnce(reference)) return;
      const list = contents(payload.items);
      window.fbq('track', 'Purchase', {
        content_ids: list.map(item => item.id),
        content_type: 'product',
        contents: list,
        value: number(payload.value),
        currency: 'BRL',
        order_id: reference
      }, { eventID: `purchase-${reference}` });
    }
  };
})();
