(function () {
  const SUPABASE_URL = 'https://eegqobqhrfdkmjyjnqvp.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys';
  if (!window.supabase) return;

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const params = new URLSearchParams(location.search);
  const attributionKey = 'tioNanAttribution';
  const sessionKey = 'tioNanAnalyticsSession';

  function id(storage, key, prefix) {
    let value = storage.getItem(key);
    if (!value) {
      value = `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
      storage.setItem(key, value);
    }
    return value;
  }

  function sourceFromUrl() {
    if (params.get('utm_source')) return params.get('utm_source').toLowerCase();
    if (params.get('fbclid')) return 'facebook';
    if (params.get('gclid') || params.get('gbraid') || params.get('wbraid')) return 'google';
    const ref = document.referrer.toLowerCase();
    if (ref.includes('facebook.') || ref.includes('instagram.')) return ref.includes('instagram.') ? 'instagram' : 'facebook';
    if (ref.includes('google.')) return 'google';
    return ref && !ref.includes(location.hostname) ? 'referencia' : 'direto';
  }

  function captureAttribution() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(attributionKey) || '{}'); } catch (_) {}
    const hasCampaign = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','gbraid','wbraid'].some(key => params.has(key));
    if (hasCampaign || !saved.source) {
      saved = {
        source: sourceFromUrl(),
        medium: params.get('utm_medium') || (params.get('fbclid') || params.get('gclid') ? 'paid' : ''),
        campaign: params.get('utm_campaign') || '',
        content: params.get('utm_content') || '',
        term: params.get('utm_term') || '',
        click_id: params.get('fbclid') || params.get('gclid') || params.get('gbraid') || params.get('wbraid') || '',
        landing_page: location.pathname + location.search,
        captured_at: new Date().toISOString()
      };
      localStorage.setItem(attributionKey, JSON.stringify(saved));
    }
    return saved;
  }

  const attribution = captureAttribution();
  const deviceId = id(localStorage, 'tioNanDeviceId', 'dev');
  const sessionId = id(sessionStorage, sessionKey, 'ses');

  function deviceType() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Macintosh/i.test(ua)) return 'Mac';
    return 'Outro';
  }

  async function track(evento, details = {}) {
    const action = details.acao ? `${details.acao}: ` : '';
    const label = details.label || details.produto_nome || evento;
    const legacy = {
      device_id: deviceId,
      produto_nome: `${action}${label}`,
      cliente_nome: details.cliente_nome || localStorage.getItem('visitorName') || 'Anônimo',
      ip: details.ip || `DISP_${deviceType()} Oculto`,
      local: details.local || `DISP_${deviceType()} Localização não informada`
    };
    const payload = {
      ...legacy,
      session_id: sessionId,
      evento,
      pagina: details.pagina || document.title || location.pathname,
      url_path: location.pathname,
      referrer: document.referrer || null,
      origem: attribution.source || sourceFromUrl(),
      utm_source: attribution.source || null,
      utm_medium: attribution.medium || null,
      utm_campaign: attribution.campaign || null,
      utm_content: attribution.content || null,
      utm_term: attribution.term || null,
      click_id: attribution.click_id || null,
      produto_id: details.produto_id ? String(details.produto_id) : null,
      valor: Number.isFinite(Number(details.valor)) ? Number(details.valor) : null,
      metadata: details.metadata || {}
    };
    const { error } = await client.from('rastreio_carrinho').insert([payload]);
    if (error && /column|schema cache/i.test(error.message || '')) {
      const { error: legacyError } = await client.from('rastreio_carrinho').insert([legacy]);
      if (legacyError) console.warn('Analytics Tio Nan:', legacyError.message);
    } else if (error) {
      console.warn('Analytics Tio Nan:', error.message);
    }
  }

  window.TioNanAnalytics = { track, attribution: () => ({ ...attribution }), sessionId, deviceId };
  track('page_view', { label: location.pathname === '/' || location.pathname.endsWith('/index.html') ? 'Página inicial' : document.title });
})();
