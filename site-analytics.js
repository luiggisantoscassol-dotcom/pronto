(function () {
  const SUPABASE_URL = 'https://eegqobqhrfdkmjyjnqvp.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys';
  const internalAccessKey = 'tioNanInternalAccess';
  const sessionKey = 'tioNanAnalyticsSessionV2';
  const geoCacheKey = 'visitorGeo';
  const geoCacheTtl = 60 * 60 * 1000;
  const sessionTimeout = 30 * 60 * 1000;
  const initialParams = new URLSearchParams(location.search);
  const internalAccessParam = initialParams.get('interno');

  if (internalAccessParam === '1') {
    localStorage.setItem(internalAccessKey, '1');
  } else if (internalAccessParam === '0') {
    localStorage.removeItem(internalAccessKey);
  }

  const isInternalAccess = localStorage.getItem(internalAccessKey) === '1';
  window.TioNanInternalAccess = isInternalAccess;
  if (internalAccessParam !== null) {
    initialParams.delete('interno');
    const cleanQuery = initialParams.toString();
    history.replaceState(null, '', `${location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${location.hash}`);
  }

  if (isInternalAccess) {
    window.TioNanAnalytics = {
      track: async () => {},
      attribution: () => ({}),
      sessionId: null,
      deviceId: localStorage.getItem('tioNanDeviceId'),
      isInternal: true
    };
    return;
  }

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

  function newId(prefix) {
    return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
  }

  function currentSessionId() {
    const now = Date.now();
    let session = {};
    try { session = JSON.parse(localStorage.getItem(sessionKey) || '{}'); } catch (_) {}
    if (!session.id || !session.last_activity || now - Number(session.last_activity) > sessionTimeout) {
      session = { id: newId('ses'), last_activity: now };
    } else {
      session.last_activity = now;
    }
    localStorage.setItem(sessionKey, JSON.stringify(session));
    return session.id;
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

  function captureAttribution(activeSessionId) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(attributionKey) || '{}'); } catch (_) {}
    const hasCampaign = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','gbraid','wbraid'].some(key => params.has(key));
    if (hasCampaign || saved.session_id !== activeSessionId) {
      saved = {
        session_id: activeSessionId,
        source: sourceFromUrl(),
        medium: params.get('utm_medium') || (params.get('fbclid') || params.get('gclid') || params.get('gbraid') || params.get('wbraid') ? 'paid' : ''),
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

  let deviceId = localStorage.getItem('tioNanDeviceId');
  if (!deviceId) {
    deviceId = newId('dev');
    localStorage.setItem('tioNanDeviceId', deviceId);
  }
  let sessionId = currentSessionId();
  let attribution = captureAttribution(sessionId);

  function deviceType() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Macintosh/i.test(ua)) return 'Mac';
    return 'Outro';
  }

  function cleanGeoText(value, maxLength = 80) {
    return String(value || '')
      .replace(/[^\p{L}\p{N}\s.'’\-]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function stateAbbreviation(value) {
    const state = cleanGeoText(value, 40);
    if (!state) return '';
    if (/^[a-z]{2}$/i.test(state)) return state.toUpperCase();
    const normalized = state.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const states = {
      acre:'AC', alagoas:'AL', amapa:'AP', amazonas:'AM', bahia:'BA', ceara:'CE',
      'distrito federal':'DF', 'espirito santo':'ES', goias:'GO', maranhao:'MA',
      'mato grosso':'MT', 'mato grosso do sul':'MS', 'minas gerais':'MG', para:'PA',
      paraiba:'PB', parana:'PR', pernambuco:'PE', piaui:'PI', 'rio de janeiro':'RJ',
      'rio grande do norte':'RN', 'rio grande do sul':'RS', rondonia:'RO', roraima:'RR',
      'santa catarina':'SC', 'sao paulo':'SP', sergipe:'SE', tocantins:'TO'
    };
    return states[normalized] || state.slice(0, 2).toUpperCase();
  }

  function normalizeGeo(city, state) {
    const cidade = cleanGeoText(city);
    const estado = stateAbbreviation(state);
    if (!cidade || /oculta|localiza/i.test(cidade)) return null;
    return { cidade, estado, timestamp:Date.now() };
  }

  function readCachedGeo() {
    try {
      const cached = JSON.parse(localStorage.getItem(geoCacheKey) || 'null');
      if (!cached || Date.now() - Number(cached.timestamp || 0) > geoCacheTtl) return null;
      return normalizeGeo(cached.cidade, cached.estado);
    } catch (_) {
      return null;
    }
  }

  async function fetchGeoJson(url, timeout = 2500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        mode:'cors',
        cache:'no-store',
        credentials:'omit',
        referrerPolicy:'no-referrer',
        signal:controller.signal
      });
      if (!response.ok) throw new Error(`Geo HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  let approximateGeo = readCachedGeo();
  let geoPromise = null;

  async function getApproximateGeo() {
    if (approximateGeo) return approximateGeo;
    if (geoPromise) return geoPromise;
    geoPromise = (async () => {
      const providers = [
        async () => {
          const data = await fetchGeoJson('https://ipwho.is/');
          if (data.success === false) throw new Error('Geo indisponível');
          return normalizeGeo(data.city, data.region_code || data.region);
        },
        async () => {
          const data = await fetchGeoJson('https://ipinfo.io/json');
          return normalizeGeo(data.city, data.region);
        },
        async () => {
          const data = await fetchGeoJson('https://free.freeipapi.com/api/v1/json');
          return normalizeGeo(data.cityName, data.regionName);
        }
      ];
      for (const provider of providers) {
        try {
          const geo = await provider();
          if (!geo) continue;
          approximateGeo = geo;
          localStorage.setItem(geoCacheKey, JSON.stringify(geo));
          return geo;
        } catch (_) {}
      }
      return null;
    })();
    return geoPromise;
  }

  function formattedLocation(geo = approximateGeo) {
    if (!geo?.cidade) return '';
    return `DISP_${deviceType()} ${geo.cidade}${geo.estado ? `, ${geo.estado}` : ''}`;
  }

  async function track(evento, details = {}) {
    const activeSessionId = currentSessionId();
    if (activeSessionId !== sessionId) {
      sessionId = activeSessionId;
      attribution = captureAttribution(sessionId);
    }
    const action = details.acao ? `${details.acao}: ` : '';
    const label = details.label || details.produto_nome || evento;
    const legacy = {
      device_id: deviceId,
      produto_nome: `${action}${label}`,
      cliente_nome: details.cliente_nome || localStorage.getItem('visitorName') || 'Anônimo',
      ip: details.ip || `DISP_${deviceType()} Oculto`,
      local: details.local || formattedLocation() || `DISP_${deviceType()} Localização não informada`
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

  window.TioNanAnalytics = { track, attribution: () => ({ ...attribution }), sessionId: () => sessionId, deviceId, isInternal: false };
  track('page_view', { label: location.pathname === '/' || location.pathname.endsWith('/index.html') ? 'Página inicial' : document.title });
  if (!approximateGeo) {
    getApproximateGeo().then(geo => {
      if (!geo) return;
      track('location_update', {
        label:'Localização aproximada identificada',
        local:formattedLocation(geo),
        metadata:{ automatico:true, origem:'ip' }
      });
    });
  }
})();
