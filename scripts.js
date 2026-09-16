
document.addEventListener('touchstart', function (event) { if (event.touches.length > 1) { event.preventDefault(); } }, { passive: false });
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

// A entrada no site exige apenas a confirmação de maioridade.
// Remove nomes antigos usados pelo modal anterior para não personalizar a sessão.
localStorage.removeItem('visitorName');

// Proteção Global de Fontes
if ("fonts" in document) {
    document.fonts.ready.then(() => {
        document.body.classList.add('fonts-loaded');
    });
} else {
    window.onload = () => document.body.classList.add('fonts-loaded');
}

function verifyAge(isMajor) {
    if (isMajor) {
        localStorage.removeItem('visitorName');
        localStorage.setItem('ageVerified', 'true');

        const overlay = document.getElementById('age-verification-overlay');
        if (overlay) overlay.style.display = 'none';

        updateWelcome();
        rastrearAcao("Idade Verificada", "🔞");

        // Esconde o loader após verificar a idade
        const loader = document.getElementById('loader-wrapper');
        if (loader) {
            setTimeout(() => {
                loader.classList.add('hidden');
            }, 500);
        }
    } else {
        alert("A apreciação de uma boa cachaça é um prazer reservado a adultos. 🔞");
        window.location.href = "https://www.google.com";
    }
}

// Verifica se já foi verificado ao carregar
document.addEventListener('DOMContentLoaded', () => {
    aplicarRotulosCheckout();
    const isVerified = localStorage.getItem('ageVerified');
    const overlay = document.getElementById('age-verification-overlay');
    if (isVerified === 'true') {
        if (overlay) overlay.style.display = 'none';
        // Se já verificou, o loader pode sumir direto pelo loadProducts()
    } else {
        if (overlay) overlay.style.display = 'flex';
    }

    // Eventos de swipe no lightbox
    const lightboxEl = document.getElementById('review-lightbox');
    if (lightboxEl) {
        lightboxEl.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        lightboxEl.addEventListener('touchend', e => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
    }
});

function aplicarRotulosCheckout() {
    const campos = {
        'cliente-email': 'E-mail',
        'cep': 'CEP',
        'cliente-cpf': 'CPF',
        'cliente-telefone': 'Telefone (WhatsApp)',
        'cliente-nome': 'Nome completo',
        'rua': 'Rua',
        'numero': 'Número',
        'apto': 'Complemento (opcional)',
        'bairro': 'Bairro',
        'cidade': 'Cidade',
        'estado': 'Estado',
        'troco': 'Troco para quanto? (opcional)',
        'cupom-input': 'Cupom de desconto',
        'metodo-pagamento': 'Forma de pagamento'
    };

    Object.entries(campos).forEach(([id, texto]) => {
        const campo = document.getElementById(id);
        if (!campo || campo.closest('.cart-field-group')) return;

        const grupo = document.createElement('div');
        grupo.className = 'cart-field-group';
        const larguraOriginal = campo.style.width;
        if (larguraOriginal) {
            grupo.style.width = larguraOriginal;
            campo.style.width = '100%';
        }

        const pai = campo.parentElement;
        if (pai && getComputedStyle(pai).display === 'flex') {
            pai.classList.add('checkout-inline-fields');
            if (!larguraOriginal) grupo.style.flex = '1';
        }

        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = texto;
        campo.removeAttribute('placeholder');
        campo.before(grupo);
        grupo.append(label, campo);
    });
}

function updateWelcome() {
    const titleEl = document.getElementById('hero-title');
    if (titleEl) titleEl.innerText = "Seja bem vindo à Tio Nan";

    const cartTitle = document.getElementById('cart-title');
    if (cartTitle) cartTitle.innerText = 'Seu carrinho';

    const welcomeHeader = document.getElementById('header-user-welcome');
    if (welcomeHeader) welcomeHeader.innerText = '';

    // O nome salvo para a saudação não identifica necessariamente quem está
    // comprando (especialmente em dispositivos compartilhados). O checkout
    // deve começar vazio e receber apenas os dados informados nesta compra.
}

const supabaseUrl = 'https://eegqobqhrfdkmjyjnqvp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys';
const MERCADO_PAGO_BRICK_TEST = true;
const MERCADO_PAGO_TEST_PUBLIC_KEY = 'TEST-481bc042-5346-46e0-8567-c2fc4346ce41';
let paymentBrickController = null;
let statusScreenBrickController = null;
let mercadoPagoBricksBuilder = null;
let db;
// Variáveis do Lightbox de avaliações
let lightboxUrls = [];
let lightboxCurrentIndex = 0;
let touchStartX = 0;
let touchEndX = 0;
try {
    db = window.supabase.createClient(supabaseUrl, supabaseKey);
} catch (e) {
    console.error("Erro Supabase:", e);
}

let userIP = 'Oculto';
async function fetchIP() {
    try {
        const r1 = await fetch('https://api.ipify.org?format=json');
        const d1 = await r1.json();
        userIP = d1.ip;
    } catch (e) {
        try {
            const r2 = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
            const text = await r2.text();
            const ipLine = text.split('\n').find(l => l.startsWith('ip='));
            if (ipLine) userIP = ipLine.split('=')[1];
        } catch (e2) {
            console.warn('Não foi possível obter o IP.');
        }
    }
}
fetchIP();

// --- SISTEMA DE PRESENÇA EM TEMPO REAL ---
let canalPresenca;
if (db) {
    canalPresenca = db.channel('online_users', { config: { presence: { key: getDeviceId() } } });
    canalPresenca.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            const visitorName = localStorage.getItem('visitorName') || 'Anônimo';
            await canalPresenca.track({
                nome: visitorName,
                device: getDeviceInfo(),
                ip: userIP,
                device_id: deviceId,
                online_at: new Date().toISOString()
            });
        }
    });
}

let heartbeatCount = 0;
setInterval(() => {
    const idadeConfirmada = localStorage.getItem('ageVerified') === 'true';

    if (canalPresenca && idadeConfirmada) {
        atualizarPresenca();
        heartbeatCount++;
        if (heartbeatCount >= 6) {
            rastrearAcao("Site", "💓 Pulso");
            heartbeatCount = 0;
        }
    }
}, 20000);

async function atualizarPresenca() {
    const visitorName = localStorage.getItem('visitorName') || 'Anônimo';
    const geo = await getGeoLocation();
    const localBase = geo.cidade + (geo.estado ? ", " + geo.estado : "");
    const localComAparelho = localBase.includes('(') ? localBase : `${localBase} (${getDeviceInfo()})`;

    const cityEl = document.getElementById('header-city-name');
    if (cityEl) cityEl.innerText = localBase;

    if (canalPresenca) {
        canalPresenca.track({
            nome: visitorName,
            device: getDeviceInfo(),
            local: localComAparelho,
            online_at: new Date().toISOString()
        });
    }
}

function getDeviceId() {
    let id = localStorage.getItem('tioNanDeviceId');
    if (!id) {
        id = 'dev-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
        localStorage.setItem('tioNanDeviceId', id);
    }
    return id;
}
const deviceId = getDeviceId();

function getDeviceInfo() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone";
    if (/Android/i.test(ua)) return "Android";
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/Macintosh/i.test(ua)) return "Mac";
    return "Mobile/Desktop";
}

function converterEstadoParaSigla(nome) {
    if (!nome) return "";
    if (nome.length === 2) return nome.toUpperCase();

    const estadosBR = {
        "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM", "Bahia": "BA", "Ceará": "CE",
        "Distrito Federal": "DF", "Espírito Santo": "ES", "Goiás": "GO", "Maranhão": "MA", "Mato Grosso": "MT",
        "Mato Grosso do Sul": "MS", "Minas Gerais": "MG", "Pará": "PA", "Paraíba": "PB", "Paraná": "PR",
        "Pernambuco": "PE", "Piauí": "PI", "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN",
        "Rio Grande do Sul": "RS", "Rondônia": "RO", "Roraima": "RR", "Santa Catarina": "SC",
        "São Paulo": "SP", "Sergipe": "SE", "Tocantins": "TO"
    };
    return estadosBR[nome] || nome.substring(0, 2).toUpperCase();
}

async function getGeoLocation() {
    return new Promise((resolve) => {
        const now = Date.now();
        const cachedRaw = localStorage.getItem('visitorGeo');

        if (cachedRaw) {
            const p = JSON.parse(cachedRaw);
            const age = now - (p.timestamp || 0);
            const umasHora = 60 * 60 * 1000;

            if (age < umasHora && p.cidade !== "Cidade Oculta" && p.cidade !== "Localização...") {
                return resolve(p);
            }
        }

        if (window.alreadyAskedGPS) {
            if (cachedRaw) return resolve(JSON.parse(cachedRaw));
            return resolve({ cidade: "Localização...", estado: "" });
        }

        if ("geolocation" in navigator) {
            window.alreadyAskedGPS = true;
            navigator.geolocation.getCurrentPosition(async (position) => {
                try {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
                    const data = await res.json();

                    const iso = data.address["ISO3166-2-lvl4"] || "";
                    let estadoSigla = "";
                    if (iso.includes("-")) {
                        estadoSigla = iso.split("-")[1].toUpperCase();
                    } else {
                        estadoSigla = converterEstadoParaSigla(data.address.state);
                    }

                    const geo = {
                        cidade: data.address.city || data.address.town || data.address.village || data.address.suburb || data.address.municipality || data.address.county || "Cidade Oculta",
                        estado: estadoSigla,
                        timestamp: now
                    };
                    localStorage.setItem('visitorGeo', JSON.stringify(geo));
                    resolve(geo);
                } catch (e) {
                    const fallback = await fetchFallbackGeo();
                    fallback.timestamp = now;
                    localStorage.setItem('visitorGeo', JSON.stringify(fallback));
                    resolve(fallback);
                }
            }, async (err) => {
                const fallback = await fetchFallbackGeo();
                fallback.timestamp = now;
                localStorage.setItem('visitorGeo', JSON.stringify(fallback));
                resolve(fallback);
            }, { timeout: 10000, maximumAge: 3600000 });
        } else {
            fetchFallbackGeo().then(resolve);
        }
    });
}

async function fetchFallbackGeo() {
    try {
        const res = await fetch('https://ipwho.is/');
        const data = await res.json();
        if (data.success) return { cidade: data.city, estado: converterEstadoParaSigla(data.region_code) };
    } catch (e) { }

    try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        if (data.city) return { cidade: data.city, estado: converterEstadoParaSigla(data.region) };
    } catch (e) { }

    try {
        const res = await fetch('https://freeipapi.com/api/json');
        const data = await res.json();
        if (data.cityName) return { cidade: data.cityName, estado: converterEstadoParaSigla(data.regionName) };
    } catch (e) { }

    try {
        const res = await fetch('https://ipinfo.io/json');
        const data = await res.json();
        if (data.city) return { cidade: data.city, estado: converterEstadoParaSigla(data.region) };
    } catch (e) { }

    return { cidade: "Cidade Oculta", estado: "" };
}

function getReferrer() {
    const ref = document.referrer;
    const ua = navigator.userAgent;
    const params = new URLSearchParams(window.location.search);

    if (params.get('utm_source')) return params.get('utm_source').toUpperCase();
    if (ua.includes('WhatsApp') || ref.includes('whatsapp.com') || ref.includes('android-app://com.whatsapp')) {
        return "WHATSAPP";
    }
    if (ref.includes('instagram.com') || ref.includes('android-app://com.instagram.android')) return "INSTAGRAM";
    if (ref.includes('facebook.com') || ref.includes('android-app://com.facebook.katana')) return "FACEBOOK";
    if (ref.includes('google.com')) return "GOOGLE";
    if (ref === "" || ref.includes(window.location.hostname)) {
        return "DIRETO";
    }
    return "OUTRO";
}

async function rastrearAcao(label, acao = "") {
    try {
        const visitorName = localStorage.getItem('visitorName') || 'Anônimo';
        const geo = await getGeoLocation();
        const localBase = geo.cidade + (geo.estado ? ", " + geo.estado : "");
        const infoAparelho = `DISP_${getDeviceInfo()}`;
        const localStr = `${infoAparelho} ${localBase}`;
        const origem = getReferrer();
        const prefixoOrigem = (origem && origem !== "DIRETO") ? `[${origem}] ` : "";

        if (db) {
            const { error } = await db.from('rastreio_carrinho').insert([{
                device_id: deviceId,
                produto_nome: acao ? `${acao}: ${label}` : label,
                cliente_nome: prefixoOrigem + (visitorName === 'Anônimo' ? `${infoAparelho} Anônimo` : visitorName),
                ip: `${infoAparelho} ${userIP}`,
                local: localStr
            }]);
            if (error) console.warn("Erro rastreio:", error.message);
        }

        if (canalPresenca) atualizarPresenca();
    } catch (e) { }
}

function searchProducts() {
    const query = document.getElementById('search-input').value.toLowerCase();
    if (query.length > 2) {
        rastrearAcao(query, "🔍 Buscou");
    }

    const cards = document.querySelectorAll('.card-produto');
    cards.forEach(card => {
        const nome = card.querySelector('.prod-nome').innerText.toLowerCase();
        if (nome.includes(query)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

const CIDADES_PERMITIDAS = ["Porto Alegre", "Viamão", "Canoas"];
const SABORES_ATIVOS_AVALIACOES = ['gengibre guaco e mel', 'ouro', 'prata'];
let freteMelhorEnvioSelecionado = null;

function entregaPorTransportadora(valor = document.getElementById('metodo-entrega')?.value || '') {
    return String(valor).startsWith('melhor-envio:') || String(valor).startsWith('frenet:');
}

function atualizarPagamentoPorEntrega() {
    const pagamento = document.getElementById('metodo-pagamento');
    if (!pagamento) return;
    const opcaoDinheiro = [...pagamento.options].find(option => option.value === 'Dinheiro');
    const opcaoTeste = [...pagamento.options].find(option => option.value === 'Teste');
    const ambienteLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (opcaoDinheiro) {
        opcaoDinheiro.hidden = false;
        opcaoDinheiro.disabled = false;
    }
    if (opcaoTeste) {
        opcaoTeste.hidden = !ambienteLocal;
        opcaoTeste.disabled = !ambienteLocal;
    }
    if (!ambienteLocal && pagamento.value === 'Teste') pagamento.value = 'Mercado Pago';
}

function valorFreteAtual() {
    const entrega = document.getElementById('metodo-entrega')?.value;
    if (entrega === 'tele') return 15;
    if (entregaPorTransportadora(entrega)) return Number(freteMelhorEnvioSelecionado?.preco || 0);
    return 0;
}

function normalizarNomeSabor(nome = '') {
    return nome
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/^cachaca\s+(de\s+)?/, '')
        .trim();
}

function slugProduto(nome = '') {
    return String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function urlProduto(produto = {}) {
    const ambienteLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return ambienteLocal
        ? `produto.html?id=${encodeURIComponent(produto.id)}`
        : `/produtos/${slugProduto(produto.nome)}`;
}

function chaveSaborAvaliacao(nome = '') {
    const normalizado = normalizarNomeSabor(nome);
    if (normalizado.includes('gengibre') && normalizado.includes('guaco') && normalizado.includes('mel')) return 'gengibre guaco e mel';
    if (normalizado.includes('ouro')) return 'ouro';
    if (normalizado.includes('prata')) return 'prata';
    return normalizado;
}

function avaliacaoDeSaborAtivo(nome) {
    return SABORES_ATIVOS_AVALIACOES.includes(chaveSaborAvaliacao(nome));
}

new Swiper('.swiper-hero', {
    loop: true,
    pagination: { el: '.hero-pagination', clickable: true },
    navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
    autoplay: { delay: 5000, disableOnInteraction: false }
});

let cart = JSON.parse(sessionStorage.getItem('tioNanCart') || '[]');

// Mantém carrinhos criados antes da padronização alinhados ao catálogo do admin.
cart = cart.map((item) => ({
    ...item,
    name: String(item?.name || '').replace(/750\s*ml/gi, '700 ml')
}));
sessionStorage.setItem('tioNanCart', JSON.stringify(cart));

const unidadesFisicasItem = item => Math.max(1, Number(item?.unidadesPorKit || item?.unidades_por_kit || 1));
const quantidadeGarrafasCarrinho = () => cart.reduce((total, item) => total + Number(item.qtd || 0) * unidadesFisicasItem(item), 0);
// O indicador visual representa produtos/embalagens adicionados. Um kit é um
// item no carrinho, embora suas garrafas continuem valendo para estoque e frete.
const quantidadeItensCarrinho = () => cart.reduce((total, item) => total + Number(item.qtd || item.quantidade || 0), 0);

function toggleMenu() {
    const menu = document.getElementById('site-menu');
    const button = document.getElementById('menu-toggle');
    if (!menu || !button) return;
    const aberto = menu.classList.toggle('active');
    button.classList.toggle('active', aberto);
    button.setAttribute('aria-expanded', String(aberto));
}

function closeMenu() {
    const menu = document.getElementById('site-menu');
    const button = document.getElementById('menu-toggle');
    if (menu) menu.classList.remove('active');
    if (button) {
        button.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
    }
}

function atualizarCabecalhoCompacto() {
    const header = document.querySelector('.header-main');
    if (header) header.classList.toggle('compact', window.scrollY > 8);
}

window.addEventListener('scroll', atualizarCabecalhoCompacto, { passive: true });
document.addEventListener('DOMContentLoaded', atualizarCabecalhoCompacto);

function mascaraCEP(t) {
    let v = t.value.replace(/\D/g, "");
    if (v.length > 5) v = v.substring(0, 5) + "-" + v.substring(5, 8);
    t.value = v;
}

// Globais
const urlParams = new URLSearchParams(window.location.search);

function mascaraTelefone(t) {
    let v = t.value.replace(/\D/g, "");
    if (v.length > 11) v = v.substring(0, 11);
    if (v.length > 10) {
        t.value = `(${v.substring(0, 2)}) ${v.substring(2, 7)}-${v.substring(7, 11)}`;
    } else if (v.length > 6) {
        t.value = `(${v.substring(0, 2)}) ${v.substring(2, 6)}-${v.substring(6, 10)}`;
    } else if (v.length > 2) {
        t.value = `(${v.substring(0, 2)}) ${v.substring(2)}`;
    } else if (v.length > 0) {
        t.value = `(${v}`;
    }
}

function mascaraCPF(input) {
    const digits = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = digits
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function cpfValido(value) {
    const cpf = value.replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    const calcular = (length) => {
        let sum = 0;
        for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
        const remainder = (sum * 10) % 11;
        return remainder === 10 ? 0 : remainder;
    };
    return calcular(9) === Number(cpf[9]) && calcular(10) === Number(cpf[10]);
}

let checkoutEtapaAtual = 'carrinho';

function mostrarEtapaCheckout(etapa) {
    const etapasValidas = ['carrinho', 'entrega', 'pagamento'];
    if (!etapasValidas.includes(etapa)) return;
    if (cart.length === 0) etapa = 'carrinho';

    checkoutEtapaAtual = etapa;
    const checkoutForm = document.getElementById('checkout-form');
    const titulo = document.getElementById('cart-title');
    const indiceAtual = etapasValidas.indexOf(etapa);

    document.getElementById('etapa-carrinho').style.display = etapa === 'carrinho' ? 'block' : 'none';
    document.getElementById('etapa-entrega').style.display = etapa === 'entrega' ? 'block' : 'none';
    document.getElementById('etapa-pagamento').style.display = etapa === 'pagamento' ? 'block' : 'none';
    if (checkoutForm) checkoutForm.style.display = etapa === 'carrinho' ? 'none' : 'block';
    if (titulo) titulo.textContent = etapa === 'carrinho' ? 'Seu Carrinho' : etapa === 'entrega' ? 'Dados de Entrega' : 'Pagamento';

    document.querySelectorAll('[data-checkout-step]').forEach((item, indice) => {
        item.classList.toggle('is-active', indice === indiceAtual);
        item.classList.toggle('is-complete', indice < indiceAtual);
    });

    const overlay = document.getElementById('cart-overlay');
    if (overlay) overlay.dataset.currentStep = etapa;
    if (overlay) overlay.scrollTo({ top: 0, behavior: 'smooth' });
}

function limparErroEtapaCheckout() {
    const aviso = document.getElementById('erro-etapa-entrega');
    if (aviso) {
        aviso.textContent = '';
        aviso.style.display = 'none';
    }
}

function marcarErroCheckout(elementId, mensagem = 'Revise o campo destacado para continuar.') {
    const el = document.getElementById(elementId);
    if (!el) return false;
    el.classList.add('input-error');
    const aviso = document.getElementById('erro-etapa-entrega');
    if (aviso) {
        aviso.textContent = mensagem;
        aviso.style.display = 'flex';
    }
    el.focus();
    // Mantém a explicação visível; o campo já recebe foco e destaque.
    if (aviso) aviso.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return false;
}

async function irParaEntrega() {
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    const email = document.getElementById('cliente-email').value.trim().toLowerCase();
    const cep = document.getElementById('cep').value.replace(/\D/g, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return marcarErroCheckout('cliente-email');
    if (cep.length !== 8) return marcarErroCheckout('cep');
    try {
        await buscaCEP();
    } catch (error) {
        console.warn('Não foi possível consultar o CEP antes de avançar:', error);
    }
    if (document.getElementById('metodo-entrega').value === 'none') {
        const resultado = document.getElementById('cep-resultado');
        if (resultado) {
            resultado.classList.add('needs-selection');
            resultado.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    mostrarEtapaCheckout('entrega');
}

function irParaPagamento() {
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    limparErroEtapaCheckout();
    const cpf = document.getElementById('cliente-cpf').value.replace(/\D/g, '');
    const email = document.getElementById('cliente-email').value.trim().toLowerCase();
    const telefone = document.getElementById('cliente-telefone').value.replace(/\D/g, '');
    const nome = document.getElementById('cliente-nome').value.trim();
    const entrega = document.getElementById('metodo-entrega').value;

    if (!cpfValido(cpf)) return marcarErroCheckout('cliente-cpf', 'Informe um CPF válido para continuar.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return marcarErroCheckout('cliente-email', 'Informe um e-mail válido para continuar.');
    if (telefone.length < 10 || telefone.length > 11) return marcarErroCheckout('cliente-telefone', 'Informe o telefone completo com DDD.');
    if (nome.length < 3) return marcarErroCheckout('cliente-nome', 'Informe o nome completo do comprador.');
    if (!entrega || entrega === 'none') return marcarErroCheckout('metodo-entrega', 'Selecione entrega ou retirada no carrinho.');
    if (entrega === 'tele' || entregaPorTransportadora(entrega)) {
        const valor = id => document.getElementById(id)?.value?.trim() || '';
        if (valor('cep').replace(/\D/g, '').length !== 8) return marcarErroCheckout('cep', 'Consulte um CEP válido antes de continuar.');
        if (!valor('rua')) return marcarErroCheckout('rua', 'Informe a rua do endereço de entrega.');
        if (!valor('numero')) return marcarErroCheckout('numero', 'Informe o número do endereço.');
        if (!valor('bairro')) return marcarErroCheckout('bairro', 'Informe o bairro do endereço.');
        if (!valor('cidade')) return marcarErroCheckout('cidade', 'A cidade não foi identificada. Consulte o CEP novamente.');
        if (!valor('estado')) return marcarErroCheckout('estado', 'O estado não foi identificado. Consulte o CEP novamente.');
        const normalizarCidade = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
        const cidadePermitida = CIDADES_PERMITIDAS.some(c => normalizarCidade(c) === normalizarCidade(valor('cidade')));
        if (entrega === 'tele' && !cidadePermitida) return marcarErroCheckout('cidade', `Ainda não realizamos entrega em ${valor('cidade')}. Escolha retirada na loja ou outro endereço.`);
    }

    mostrarEtapaCheckout('pagamento');
    atualizarPagamentoPorEntrega();
    handlePagamentoChange();
}

let identificacaoConsultada = '';
async function avancarIdentificacao() {
    const cpfInput = document.getElementById('cliente-cpf');
    const emailInput = document.getElementById('cliente-email');
    const button = document.getElementById('btn-identificacao');
    const details = document.getElementById('checkout-details');
    if (!cpfInput || !emailInput || !button || !details) return;

    const cpf = cpfInput.value.replace(/\D/g, '');
    const email = emailInput.value.trim().toLowerCase();
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    cpfInput.classList.toggle('input-error', !cpfValido(cpf));
    emailInput.classList.toggle('input-error', !emailValido);
    if (!cpfValido(cpf)) return cpfInput.focus();
    if (!emailValido) return emailInput.focus();

    const cpfGroup = cpfInput.closest('.cart-field-group');
    if (cpfGroup) cpfGroup.style.display = 'none';
    else cpfInput.style.display = 'none';
    button.style.display = 'none';
    details.style.display = window.matchMedia('(min-width: 900px)').matches ? 'grid' : 'block';
    const chave = `${cpf}:${email}`;
    if (identificacaoConsultada === chave) return;
    identificacaoConsultada = chave;
    await buscarClientePorEmail(cpf, email);
}

async function buscarClientePorEmail(cpfInformado, emailInformado) {
    const cpf = String(cpfInformado || '').replace(/\D/g, '');
    const email = String(emailInformado || '').trim().toLowerCase();
    const preencherCliente = async (salvo) => {
        if (!salvo) return false;
        const cepCampo = document.getElementById('cep');
        const cepInicial = String(cepCampo?.value || '').replace(/\D/g, '');
        const cepSalvo = String(salvo.cep || '').replace(/\D/g, '');
        const manterCepInicial = cepInicial.length === 8;
        const preencher = (id, valor) => {
            const campo = document.getElementById(id);
            if (campo && valor !== null && valor !== undefined && String(valor).trim()) campo.value = valor;
        };
        preencher('cliente-nome', salvo.nome);
        preencher('cliente-telefone', salvo.telefone);
        const telefoneCampo = document.getElementById('cliente-telefone');
        if (telefoneCampo?.value) mascaraTelefone(telefoneCampo);

        // O CEP escolhido no carrinho tem prioridade sobre o endereço do cadastro.
        // Evita trocar silenciosamente a cidade e recalcular o frete para um endereço antigo.
        if (manterCepInicial) {
            if (cepCampo) cepCampo.value = cepInicial.replace(/^(\d{5})(\d{3})$/, '$1-$2');
            const mesmoCep = cepInicial === cepSalvo;
            const numeroCampo = document.getElementById('numero');
            const aptoCampo = document.getElementById('apto');
            if (!mesmoCep) {
                if (numeroCampo) numeroCampo.value = '';
                if (aptoCampo) aptoCampo.value = '';
            }
            await buscaCEP();
            if (mesmoCep) {
                preencher('numero', salvo.numero);
                preencher('apto', salvo.apto);
            }
            return true;
        }

        preencher('cep', salvo.cep);
        preencher('rua', salvo.rua);
        preencher('numero', salvo.numero);
        preencher('apto', salvo.apto);
        preencher('bairro', salvo.bairro);
        preencher('cidade', salvo.cidade);
        preencher('estado', salvo.estado);
        if (String(salvo.cep || '').replace(/\D/g, '').length === 8) {
            const numero = salvo.numero;
            const apto = salvo.apto;
            await buscaCEP();
            preencher('numero', numero);
            preencher('apto', apto);
        }
        return true;
    };
    try {
        const { data, error } = await db.functions.invoke('buscar-cliente-checkout', { body: { cpf, email } });
        if (!error && data?.encontrado && await preencherCliente(data.cliente)) return;

        // Mantém o preenchimento local como contingência se a conexão falhar.
        const salvo = JSON.parse(localStorage.getItem('tioNanClienteRecente') || 'null');
        if (!salvo || salvo.cpf !== cpf || salvo.email !== email) return;
        await preencherCliente(salvo);
    } catch (error) {
        console.warn('Não foi possível recuperar o cadastro anterior.', error);
    }
}

function salvarClienteRecenteCheckout(cpf, email, nome, telefone, endereco = {}) {
    localStorage.setItem('tioNanClienteRecente', JSON.stringify({
        cpf: String(cpf || '').replace(/\D/g, ''),
        email: String(email || '').trim().toLowerCase(),
        nome, telefone,
        cep: endereco.cep || '', rua: endereco.rua || '', numero: endereco.numero || '',
        apto: endereco.apto || '', bairro: endereco.bairro || '', cidade: endereco.cidade || '', estado: endereco.estado || ''
    }));
}

let ultimoCepConsultado = '';
let recotacaoFreteTimer = null;

function consultarCEPQuandoCompleto(input) {
    const cep = input.value.replace(/\D/g, '');
    if (cep.length === 8) buscaCEP();
}

async function buscaCEP(forcarCotacao = false) {
    const cepInput = document.getElementById('cep');
    const resultado = document.getElementById('cep-resultado');
    const cep = cepInput.value.replace(/\D/g, '');
    if (cep.length !== 8) {
        ultimoCepConsultado = '';
        const metodoEntrega = document.getElementById('metodo-entrega');
        if (metodoEntrega) {
            metodoEntrega.value = 'none';
            delete metodoEntrega.dataset.cepSelecionado;
        }
        if (resultado) resultado.style.display = 'none';
        return false;
    }
    if (!forcarCotacao && cep === ultimoCepConsultado && resultado?.dataset.consultado === 'true') return true;

    const metodoEntrega = document.getElementById('metodo-entrega');
    // A consulta pode ocorrer no oninput e novamente no onblur. Não apague uma
    // escolha já feita para este mesmo CEP; só reinicie quando o CEP mudar.
    if (metodoEntrega && metodoEntrega.dataset.cepSelecionado !== cep) {
        metodoEntrega.value = 'none';
        delete metodoEntrega.dataset.cepSelecionado;
    }

    if (resultado) {
        resultado.className = 'cep-resultado is-loading';
        resultado.textContent = 'Consultando CEP…';
        resultado.style.display = 'block';
        resultado.dataset.consultado = 'false';
    }

    try {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        if (!res.ok) throw new Error('Falha na consulta do CEP');
        const d = await res.json();
        if (d.erro) {
            if (resultado) {
                resultado.className = 'cep-resultado is-error';
                resultado.textContent = 'CEP não encontrado. Confira os números digitados.';
            }
            return false;
        }

        ultimoCepConsultado = cep;
        const preencherEnderecoCEP = (id, valor) => {
            const campo = document.getElementById(id);
            if (!campo) return;
            campo.value = String(valor || '').trim();
            campo.classList.remove('input-error');
            campo.dispatchEvent(new Event('input', { bubbles: true }));
            campo.dispatchEvent(new Event('change', { bubbles: true }));
        };
        preencherEnderecoCEP('rua', d.logradouro);
        preencherEnderecoCEP('bairro', d.bairro);
        preencherEnderecoCEP('cidade', d.localidade);
        preencherEnderecoCEP('estado', d.uf);
        validarCidade(d.localidade);

        const cidadeAtendida = CIDADES_PERMITIDAS.some(cidade => cidade.toLowerCase() === d.localidade.toLowerCase());
        if (resultado) {
            resultado.dataset.consultado = 'true';
            resultado.className = 'cep-resultado is-success';
            const cidade = document.createElement('strong');
            cidade.textContent = `${d.localidade} - ${d.uf}`;
            const opcoes = document.createElement('div');
            opcoes.className = 'cep-opcoes-entrega';

            if (cidadeAtendida) {
                opcoes.appendChild(criarOpcaoEntregaCEP(
                    'tele',
                    'Frete fixo — R$ 15,00',
                    'Entrega de 3 a 5 dias úteis'
                ));
            }

            const cidadePortoAlegre = normalizarNomeSabor(d.localidade) === 'porto alegre';
            if (cidadePortoAlegre && entregaPorTransportadora(metodoEntrega?.value)) {
                metodoEntrega.value = 'none';
                delete metodoEntrega.dataset.cepSelecionado;
                freteMelhorEnvioSelecionado = null;
            }
            const carregando = document.createElement('span');
            carregando.className = 'cep-cidade-indisponivel is-loading';
            carregando.textContent = 'Calculando todas as opções de frete…';
            if (!cidadePortoAlegre) opcoes.appendChild(carregando);
            if (!cidadePortoAlegre) try {
                const quantidade = quantidadeGarrafasCarrinho();
                const valorPedido = cart.reduce((total, item) => total + Number(item.price || 0) * Number(item.qtd || 0), 0);
                const { data: cotacao, error: erroCotacao } = await db.functions.invoke('frenet-cotacao', { body: { cep, quantidade, valor_pedido: valorPedido } });
                if (erroCotacao) throw erroCotacao;
                const cotacoes = Array.isArray(cotacao?.cotacoes) ? cotacao.cotacoes : [];
                carregando.remove();
                cotacoes.forEach(frete => opcoes.appendChild(criarOpcaoEntregaCEP(
                    `frenet:${frete.id}`,
                    frete.nome,
                    `${frete.transportadora} · ${frete.prazo} ${Number(frete.prazo) === 1 ? 'dia útil' : 'dias úteis'}`,
                    frete
                )));
                const entregaSelecionada = String(metodoEntrega?.value || '');
                if (forcarCotacao && entregaPorTransportadora(entregaSelecionada)) {
                    const servicoSelecionado = entregaSelecionada.slice(entregaSelecionada.indexOf(':') + 1);
                    const freteAtualizado = cotacoes.find(frete => String(frete.id) === servicoSelecionado);
                    if (freteAtualizado) {
                        freteMelhorEnvioSelecionado = freteAtualizado;
                        const opcaoAtual = [...opcoes.querySelectorAll('input[name="entrega-cep"]')]
                            .find(input => input.value === `frenet:${servicoSelecionado}`);
                        if (opcaoAtual) opcaoAtual.checked = true;
                    } else {
                        metodoEntrega.value = 'none';
                        delete metodoEntrega.dataset.cepSelecionado;
                        freteMelhorEnvioSelecionado = null;
                        const avisoMudanca = document.createElement('span');
                        avisoMudanca.className = 'cep-cidade-indisponivel';
                        avisoMudanca.textContent = 'O frete escolhido não está disponível para a nova quantidade. Selecione outra opção.';
                        opcoes.prepend(avisoMudanca);
                    }
                    updateCart();
                }
                if (!cotacoes.length) {
                    const aviso = document.createElement('span');
                    aviso.className = 'cep-cidade-indisponivel';
                    aviso.textContent = 'Nenhuma opção de transportadora disponível para este CEP.';
                    opcoes.appendChild(aviso);
                }
            } catch (erroCotacao) {
                console.warn('Erro na cotação da Frenet:', erroCotacao);
                carregando.classList.remove('is-loading');
                carregando.textContent = 'Não foi possível calcular o frete agora. Tente consultar novamente.';
            }

            opcoes.appendChild(criarOpcaoEntregaCEP(
                'retirada',
                'Retirar na loja — grátis',
                'Av. Bento Gonçalves, 4321 — Porto Alegre'
            ));
            resultado.replaceChildren(cidade, opcoes);
        }
        return true;
    } catch (error) {
        ultimoCepConsultado = '';
        if (resultado) {
            resultado.className = 'cep-resultado is-error';
            resultado.textContent = 'Não foi possível consultar o CEP. Tente novamente.';
        }
        console.warn('Erro ao consultar CEP:', error);
        return false;
    }
}

function agendarAtualizacaoAutomaticaFrete() {
    const cep = document.getElementById('cep')?.value.replace(/\D/g, '') || '';
    const resultado = document.getElementById('cep-resultado');
    // Se o CEP já foi consultado, toda alteração no carrinho precisa refazer a
    // lista completa da Frenet, mesmo antes de o cliente escolher um serviço.
    if (!isCartOpen || !cart.length || cep.length !== 8 || resultado?.dataset.consultado !== 'true') return;
    clearTimeout(recotacaoFreteTimer);
    recotacaoFreteTimer = setTimeout(() => buscaCEP(true), 450);
}

function criarOpcaoEntregaCEP(valor, titulo, descricao, dadosFrete = null) {
    const label = document.createElement('label');
    label.className = 'cep-opcao-entrega';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'entrega-cep';
    radio.value = valor;
    radio.checked = document.getElementById('metodo-entrega').value === valor;
    radio.addEventListener('change', () => {
        const metodoEntrega = document.getElementById('metodo-entrega');
        if (![...metodoEntrega.options].some(option => option.value === valor)) {
            metodoEntrega.add(new Option(titulo, valor));
        }
        metodoEntrega.value = valor;
        metodoEntrega.dataset.cepSelecionado = document.getElementById('cep').value.replace(/\D/g, '');
        freteMelhorEnvioSelecionado = dadosFrete;
        atualizarPagamentoPorEntrega();
        document.getElementById('cep-resultado')?.classList.remove('needs-selection');
        limparErroEtapaCheckout();
        updateCart();
    });
    const texto = document.createElement('span');
    const destaque = document.createElement('b');
    const detalhe = document.createElement('small');
    const preco = document.createElement('strong');
    destaque.textContent = titulo;
    detalhe.textContent = descricao;
    preco.className = 'cep-opcao-preco';
    preco.textContent = dadosFrete ? `R$ ${Number(dadosFrete.preco).toFixed(2).replace('.', ',')}` : '';
    texto.append(destaque, detalhe);
    label.append(radio, texto, preco);
    return label;
}

function validarCidade(cidade) {
    const btn = document.getElementById('btn-finalizar');
    const aviso = document.getElementById('aviso-regiao');
    const entrega = document.getElementById('metodo-entrega').value;
    if (entrega === 'tele' || entregaPorTransportadora(entrega)) {
        const permitida = entregaPorTransportadora(entrega) || CIDADES_PERMITIDAS.some(c => c.toLowerCase() === cidade.toLowerCase());
        if (!permitida) {
            btn.disabled = true; btn.style.background = "#333"; btn.style.opacity = "0.5"; aviso.style.display = "block";
        } else { liberarBotao(); }
    } else { liberarBotao(); }
}

function liberarBotao() {
    const btn = document.getElementById('btn-finalizar');
    const aviso = document.getElementById('aviso-regiao');
    btn.disabled = false; btn.style.background = "var(--blue-navy)"; btn.style.opacity = "1"; aviso.style.display = "none";
}

const DESCRICOES_PREMIUM = {
    "Gengibre, Guaco e Mel": "Uma alquimia perfeita para quem aprecia intensidade e conforto. O calor picante do gengibre fresco desperta o paladar, enquanto o guaco traz notas herbais profundas que remetem à tradição do campo. A finalização fica por conta da doçura aveludada do mel, que suaviza a potência da cachaça e deixa um retrogosto acolhedor. Ideal para dias frios ou para momentos de puro relaxamento.",
    "Café": "O encontro perfeito entre o corpo robusto da cachaça artesanal e o aroma intenso do café torrado. Apresenta notas de chocolate amargo e um final persistente, ideal para paladares que buscam sofisticação em cada dose.",
    "Butiá": "Uma explosão de tropicalidade gaúcha. O sabor exótico e levemente ácido do butiá harmoniza perfeitamente com a doçura da cana, revelando aromas silvestres e uma refrescância incomparável.",
    "Morango com Pimenta": "A sedutora dança entre a doçura vibrante e o fogo sutil. O frescor suculento do morango maduro envolve a boca de imediato, preparando o terreno para a picância instigante da pimenta dedo-de-moça. É uma bebida de contrastes marcantes: começa doce e encerra com um toque levemente ardente que convida ao próximo gole.",
    "Jabuticaba": "O \"ouro negro\" brasileiro em forma de elixir. A jabuticaba traz uma adstringência elegante e uma doçura natural que dança com a suavidade da destilação artesanal, evocando tradição e frescor.",
    "Morango": "Frescor frutado e doçura equilibrada. O sabor puro do morango silvestre se funde à cachaça artesanal, resultando em uma bebida leve, aromática e extremamente agradável para qualquer ocasião."
};



function fixDrive(url) {
    if (!url || typeof url !== 'string' || !url.includes('drive.google')) return url.trim();
    const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) {
        return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w600`;
    }
    return url.trim();
}

function getLocalPhoto(nome, currentUrl, isFoto2 = false) {
    const nomeNorm = nome.toLowerCase().replace(/cachaça\s+de\s+/gi, "").replace(/cachaça\s+/gi, "").trim();

    // Corrige referências antigas que apontavam para arquivos .png inexistentes.
    const arquivoAtual = String(currentUrl || '').split('?')[0].split('/').pop().toLowerCase();
    if (nomeNorm.includes('gengibre') && ['gengibre.png', 'gengibre-2.png'].includes(arquivoAtual)) {
        return isFoto2 ? 'fotos/gengibre-2.webp' : 'fotos/gengibre-guaco-mel.webp?v=5';
    }

    // A foto salva no Admin sempre tem prioridade, seja local, Drive ou URL pública.
    if (currentUrl && !currentUrl.includes('via.placeholder.com')) return currentUrl;

    // 2. Mapeamento manual para compatibilidade com nomes antigos/especiais
    const LOCAL_PHOTOS = {
        "gengibre, guaco e mel": { f1: "fotos/gengibre.webp", f2: "fotos/gengibre-2.webp" },
        "café": { f1: "fotos/cafe.webp", f2: "fotos/cafe-2.webp" },
        "butiá": { f1: "fotos/butia.webp", f2: "fotos/butia-2.png" },
        "jabuticaba": { f1: "fotos/jabuticaba.webp", f2: "fotos/jabuticaba-2.webp" },
        "morango": { f1: "fotos/morango.webp", f2: "fotos/morango-2.webp" },
        "morango com pimenta": { f1: "fotos/morango-pimenta.webp", f2: "fotos/morango-pimenta-2.webp" },
        "abacaxi": { f1: "fotos/abacaxi.webp", f2: "fotos/abacaxi-2.webp" }
    };

    if (LOCAL_PHOTOS[nomeNorm]) {
        return isFoto2 ? LOCAL_PHOTOS[nomeNorm].f2 : LOCAL_PHOTOS[nomeNorm].f1;
    }

    // 3. Tenta encontrar por padrão de nome (slug) - Ex: Cachaça de Limão -> fotos/limao.webp
    // Nota: Como não podemos checar se o arquivo existe via JS sem request, 
    // mantemos o mapeamento ou o link original do Drive como prioridade segura.

    return currentUrl;
}

function fotoProdutoOficial(produto, isFoto2 = false) {
    const blingId = String(produto?.bling_id || '');
    const fotoCadastrada = fixDrive(isFoto2 ? produto?.foto_2 : produto?.foto_1);
    if (fotoCadastrada) return fotoCadastrada;
    if (produto?.tipo_produto === 'kit') return 'fotos/produto-em-breve.svg';
    if (blingId === '16699719562') return isFoto2 ? 'fotos/gengibre-2.webp' : 'fotos/gengibre-guaco-mel.webp?v=5';
    if (blingId === '16699660347') return 'fotos/cachaca-ouro.webp?v=2';
    if (blingId === '16687078597') return 'fotos/produto-em-breve.svg';
    return getLocalPhoto(produto?.nome || '', fixDrive(isFoto2 ? produto?.foto_2 : produto?.foto_1), isFoto2);
}

// O cadastro administrativo/Bling é a fonte oficial para a apresentação dos
// três produtos. Mantém a vitrine, o detalhe e novos itens do carrinho em
// 700 ml mesmo se um nome antigo de 750 ml ainda estiver salvo no banco.
function nomeProdutoOficial(produto) {
    return String(produto?.nome || '');
}


async function loadProducts() {
    try {
        if (!db) {
            console.warn("Supabase não inicializado.");
            return;
        }
        // Carrega todas as avaliações de uma vez para calcular médias na vitrine
        let avaliacoesVitrine = [];
        try {
            const { data } = await db.from('avaliacoes').select('produto_nome, estrelas');
            avaliacoesVitrine = (data || []).filter(avaliacao => avaliacaoDeSaborAtivo(avaliacao.produto_nome));
            atualizarSeloConfianca(avaliacoesVitrine);
        } catch (e) {
            console.warn("Erro ao buscar avaliações para vitrine:", e);
        }

        // Detect parameters from global urlParams
        const pId = urlParams.get('id');
        const pSlug = urlParams.get('p');
        const isVip = urlParams.get('v') === '1';

        // Hide free shipping incentives and adjust layout for VIPs
        if (isVip) {
            document.body.classList.add('vip-mode');
            const containerFrete = document.getElementById('container-frete');
            if (containerFrete) containerFrete.style.display = 'none';
        }


        let query = db.from('produtos').select('*').eq('excluido', false);
        
        if (pId) {
            query = query.eq('id', pId);
        } else if (!pSlug && !isVip) {
            query = query.or('visivel.eq.true,visivel.is.null');
        }

        const { data: produtos, error } = await query;
        if (error) throw error;

        const normalizarNomeProduto = (nome = '') => nome
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/^cachaca\s+(de\s+)?/, '')
            .trim();
        const ordemProdutosBling = ['16699719562', '16699660347', '16687078597'];
        const prioridadeProduto = new Map(ordemProdutosBling.map((id, indice) => [id, indice]));
        const produtosExibidos = (produtos || [])
            .filter(produto => ordemProdutosBling.includes(String(produto.bling_id || '')) || (produto.tipo_produto === 'kit' && produto.visivel === true))
            .sort((a, b) => {
                const prioridadeA = prioridadeProduto.get(String(a.bling_id || '')) ?? ordemProdutosBling.length;
                const prioridadeB = prioridadeProduto.get(String(b.bling_id || '')) ?? ordemProdutosBling.length;
                return prioridadeA - prioridadeB || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
            });

        let htmlDisp = ''; let htmlEsg = '';

        produtosExibidos.forEach(p => {
            const id = p.id;
            const nome = nomeProdutoOficial(p);

            // Calcula estrelas para a vitrine
            const chaveProduto = chaveSaborAvaliacao(nome);
            const avaliacoesDoProduto = avaliacoesVitrine.filter(a => chaveSaborAvaliacao(a.produto_nome) === chaveProduto);
            let estrelasVitrineHtml = '';
            if (avaliacoesDoProduto.length > 0) {
                const totalEstrelas = avaliacoesDoProduto.reduce((acc, a) => acc + a.estrelas, 0);
                const media = Math.round(totalEstrelas / avaliacoesDoProduto.length);
                estrelasVitrineHtml = `
                    <div class="stars-vitrine">
                        <span class="stars-filled">${"★".repeat(media)}</span><span class="stars-empty">${"☆".repeat(5 - media)}</span>
                        <span class="reviews-count">(${avaliacoesDoProduto.length})</span>
                    </div>
                `;
            } else {
                estrelasVitrineHtml = `
                    <div class="stars-vitrine">
                        <span class="stars-empty">☆☆☆☆☆</span>
                        <span class="reviews-count">(0)</span>
                    </div>
                `;
            }



            const foto1Raw = (p.foto_1 && p.foto_1.trim().length > 5)
                ? p.foto_1.trim()
                : (p.emBreve ? 'fotos/produto-em-breve.svg' : '');
            let foto1 = fotoProdutoOficial({ ...p, foto_1: foto1Raw }, false);

            const temFoto2 = (p.foto_2 && p.foto_2.trim().length > 5);
            let foto2 = temFoto2 ? fixDrive(p.foto_2.trim()) : foto1;

            const precoNum = parseFloat(p.preco);
            const precoOriginalNum = parseFloat(p.preco_original || 0);
            const temDesconto = precoOriginalNum > precoNum;
            const estoque = parseInt(p.estoque) || 0;
            const temEstoque = estoque > 0;
            const custoNum = parseFloat(p.custo || 0);

            let descricao = p.descricao || '';
            const nomeNormalizado = nome.trim().toLowerCase();
            const chavePremium = Object.keys(DESCRICOES_PREMIUM).find(k => k.toLowerCase() === nomeNormalizado);
            if (!descricao || descricao.includes("feita com muito carinho") || descricao.length < 10) {
                if (chavePremium) descricao = DESCRICOES_PREMIUM[chavePremium];
            }

            const teor = p.teor_alcoolico || '';
            const harmonizacao = p.harmonizacao || '';

            const slug = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
            const matches = (pId && id == pId) || (pSlug && slug == pSlug);
            const produtoUrl = urlProduto({ id, nome });
            
            // No modo VIP (p, id ou v=1 presente), mostramos apenas o produto do link + outros produtos OCULTOS
            if (pId || pSlug || isVip) {
                if (!matches && p.visivel !== false) return;
            }

            const tagEstoque = p.emBreve
                ? '<span class="tag-estoque-discreta">EM BREVE</span>'
                : ((temEstoque && estoque <= 5) ? `<span class="tag-estoque-discreta">🔥 Apenas ${estoque} unidades</span>` : '');
            const acaoDetalhes = (p.emBreve || (p.localOnly && normalizarNomeProduto(nome) !== 'ouro')) ? '' : `onclick="window.location.href='${produtoUrl}'" style="cursor:pointer;"`;
            const percentualDesconto = temDesconto ? Math.round((1 - precoNum / precoOriginalNum) * 100) : 0;
            const precoExibido = p.emBreve ? 'Em breve' : temDesconto
                ? `<small class="preco-original">De R$ ${precoOriginalNum.toFixed(2).replace('.', ',')}</small><span>Por R$ ${precoNum.toFixed(2).replace('.', ',')}</span><em class="desconto-produto">${percentualDesconto}% OFF</em>`
                : `R$ ${precoNum.toFixed(2).replace('.', ',')}`;

            const card = `
                <div class="card-produto ${temEstoque ? '' : 'esgotado-card'} ${p.emBreve ? 'em-breve-card' : ''}" id="card-${id}">
                    <div class="img-wrapper" ${acaoDetalhes}>
                        ${p.emBreve ? '<div class="faixa-esgotado-clean">Em breve</div>' : (temEstoque ? '' : '<div class="faixa-esgotado-clean">Volta Logo!</div>')}
                        <div class="desktop-only-images">
                            <img src="${foto1}" class="foto-1 prod-img">
                            <img src="${foto2}" class="foto-2" loading="lazy">
                        </div>
                        ${temFoto2 ? `<div class="swiper swiper-produto">
                            <div class="swiper-wrapper">
                                <div class="swiper-slide"><img src="${foto1}" class="prod-img" loading="eager" decoding="async" onerror="this.onerror=null;this.src='fotos/produto-em-breve.svg'"></div>
                                <div class="swiper-slide"><img src="${foto2}" class="prod-img" loading="eager" decoding="async" onerror="this.onerror=null;this.src='${foto1}'"></div>
                            </div>
                            <div class="swiper-pagination"></div>
                        </div>` : `<div class="swiper-produto swiper-produto-estatico"><img src="${foto1}" class="prod-img" loading="eager" decoding="async" onerror="this.onerror=null;this.src='fotos/produto-em-breve.svg'"></div>`}
                    </div>
                    <div ${acaoDetalhes}>
                        ${tagEstoque}
                        <h3 class="prod-nome">${nome}</h3>
                        ${estrelasVitrineHtml}
                        <span class="preco">${precoExibido}</span>
                    </div>
                    ${p.emBreve ? '<button class="btn-adicionar" disabled>Em breve</button>' : (temEstoque ? `<button class="btn-adicionar" onclick="add('${id}','${nome}',${precoNum}, ${custoNum}, event, ${Number(p.unidades_por_kit || 1)})">Comprar</button>` : `<button class="btn-adicionar" disabled>Esgotado</button>`)}
                </div>`;

            const slide = `<div class="swiper-slide">${card}</div>`;
            if (temEstoque) htmlDisp += slide; else htmlEsg += slide;
        });
        document.getElementById('vitrine').innerHTML = htmlDisp + htmlEsg;

        if (window.productsSwiper) window.productsSwiper.destroy(true, true);
        window.productsSwiper = new Swiper('.swiper-products', {
            slidesPerView: 1.42,
            spaceBetween: 8,
            centeredSlides: false,
            pagination: { el: '.products-pagination', clickable: true },
            navigation: { nextEl: '.products-next', prevEl: '.products-prev' },
            breakpoints: {
                640: { slidesPerView: 2, spaceBetween: 24, centeredSlides: false },
                1024: { slidesPerView: 3, spaceBetween: 30, centeredSlides: false }
            }
        });

        const swiperObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const tempo = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
                    new Swiper(el, {
                        loop: true,
                        effect: 'fade',
                        fadeEffect: { crossFade: true },
                        autoplay: { delay: tempo, disableOnInteraction: false },
                        pagination: { el: el.querySelector('.swiper-pagination'), clickable: true }
                    });
                    observer.unobserve(el);
                }
            });
        }, { rootMargin: '100px' });

        document.querySelectorAll('.swiper-produto.swiper').forEach(el => swiperObserver.observe(el));


        const highlightObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                // Se o elemento entra na área central, damos a ele o foco
                if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                    // Remove de todos antes para garantir que só um brilhe por vez
                    document.querySelectorAll('.card-produto.active-scroll').forEach(el => {
                        if (el !== entry.target) el.classList.remove('active-scroll');
                    });
                    entry.target.classList.add('active-scroll');
                } else if (!entry.isIntersecting || entry.intersectionRatio < 0.2) {
                    // Só remove se ele realmente sair bastante da área para evitar o tremor
                    entry.target.classList.remove('active-scroll');
                }
            });
        }, {
            threshold: [0.2, 0.5, 0.8],
            rootMargin: '-25% 0px -25% 0px'
        });


        document.querySelectorAll('.card-produto').forEach(card => highlightObserver.observe(card));

    } catch (error) {
        console.error("Erro ao carregar produtos:", error);
    } finally {
        const loader = document.getElementById("loader-wrapper");
        const isVerified = localStorage.getItem('ageVerified') === 'true';
        if (loader && isVerified) {
            loader.classList.add("hidden");
        }
    }
}



const SABOR_EMOJIS = {
    "Gengibre, Guaco e Mel": ["🫚", "🍯"],
    "Café": ["☕"],
    "Butiá": ["🌴"],
    "Morango com Pimenta": ["🍓", "🌶️"],
    "Jabuticaba": ["🍇"],
    "Morango": ["🍓"]
};

function lancarEmojiDaSacola(nomeSabor) {
    let emojis = ["✨"];
    const nomeNorm = nomeSabor.trim().toLowerCase();
    for (const [key, value] of Object.entries(SABOR_EMOJIS)) {
        if (key.toLowerCase() === nomeNorm) {
            emojis = value;
            break;
        }
    }

    const cartBtn = document.getElementById('cart-btn');
    if (!cartBtn) return;
    const rect = cartBtn.getBoundingClientRect();

    emojis.forEach((emoji, index) => {
        setTimeout(() => {
            const el = document.createElement('div');
            el.innerText = emoji;
            el.style.position = 'fixed';
            el.style.left = (rect.left + rect.width / 2 - 15 + (index * 10)) + 'px';
            el.style.top = (rect.top - 20) + 'px';
            el.style.fontSize = '2.5rem';
            el.style.pointerEvents = 'none';
            el.style.zIndex = '1000000';
            el.style.filter = 'drop-shadow(0 5px 15px rgba(0,0,0,0.2))';
            el.style.animation = 'emojiFloat 1.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 1200);
        }, index * 150); // Delay entre emojis
    });
}



function createParticles(x, y) {
    const particleCount = 30; // Mais partículas
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'particle';

        // Tamanho GRANDE para visibilidade
        const size = Math.random() * 12 + 6;
        p.style.width = size + 'px';
        p.style.height = size + 'px';

        // Posição inicial
        p.style.left = (x || window.innerWidth / 2) + 'px';
        p.style.top = (y || window.innerHeight / 2) + 'px';

        // Explosão mais ampla
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 150 + 80;
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity;

        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');

        const duration = Math.random() * 0.8 + 0.6;
        p.style.animation = `particleExplosion ${duration}s cubic-bezier(0.1, 1, 0.1, 1) forwards`;

        document.body.appendChild(p);
        setTimeout(() => p.remove(), duration * 1000);
    }
}

function add(id, name, price, cost, event, unidadesPorKit = 1) {
    try { fecharToastProvaSocial(); } catch (e) {}
    if (event) { createParticles(event.clientX, event.clientY); event.stopPropagation(); }
    const card = document.getElementById(`card-${id}`);
    const modalOverlay = document.getElementById('modal-produto-overlay');
    const isModalOpen = modalOverlay && modalOverlay.classList.contains('active');

    let sourceImg = null;
    if (isModalOpen) {
        sourceImg = document.getElementById('modal-foto');
    } else if (card) {
        if (window.innerWidth < 1024) {
            sourceImg = card.querySelector('.swiper-slide-active img') || card.querySelector('.swiper-slide img') || card.querySelector('img');
        } else {
            const f2 = card.querySelector('.desktop-only-images .foto-2');
            const f1 = card.querySelector('.desktop-only-images .foto-1');
            if (f2 && window.getComputedStyle(f2).opacity > 0) {
                sourceImg = f2;
            } else {
                sourceImg = f1 || card.querySelector('img');
            }
        }
    }

    const fotoUrl = sourceImg ? sourceImg.src : '';

    if (navigator.vibrate) navigator.vibrate(40);

    const item = cart.find(i => i.id === id);
    if (item) {
        item.qtd++;
        item.unidadesPorKit = Math.max(1, Number(unidadesPorKit || item.unidadesPorKit || 1));
        if (fotoUrl) item.foto = fotoUrl;
    } else {
        cart.push({ id, name, price, cost: cost, qtd: 1, foto: fotoUrl, unidadesPorKit: Math.max(1, Number(unidadesPorKit || 1)) });
    }
    updateCart();
    if (typeof isCartOpen !== 'undefined' && isCartOpen) agendarAtualizacaoAutomaticaFrete();
    const abrirCarrinhoAposAdicionar = () => {
        if (window.matchMedia('(min-width: 900px)').matches) {
            mostrarPreviewCarrinho(name, fotoUrl);
            return;
        }
        const overlay = document.getElementById('cart-overlay');
        if (overlay && !overlay.classList.contains('active')) openCart();
    };

    if (card) {
        const btnAdicionar = card.querySelector('.btn-adicionar');
        if (btnAdicionar) {
            btnAdicionar.classList.remove('animating');
            void btnAdicionar.offsetWidth;
            btnAdicionar.classList.add('animating');
            btnAdicionar.textContent = "Adicionado! ✓";
            clearTimeout(btnAdicionar.resetTimeout);
            btnAdicionar.resetTimeout = setTimeout(() => {
                btnAdicionar.textContent = "Comprar";
                btnAdicionar.classList.remove('animating');
            }, 1500);
        }
    }

    const btnModal = document.getElementById('modal-btn-add');
    if (btnModal) {
        btnModal.classList.remove('animating');
        void btnModal.offsetWidth;
        btnModal.classList.add('animating');
        btnModal.textContent = "Adicionado! ✓";
        clearTimeout(btnModal.resetTimeout);
        btnModal.resetTimeout = setTimeout(() => {
            btnModal.textContent = "Adicionar à Sacola";
            btnModal.classList.remove('animating');
            btnModal.style.background = "";
            btnModal.style.color = "";
        }, 1500);
    }

    const cartBtn = document.getElementById('cart-btn');

    if (sourceImg && cartBtn) {
        const rect = sourceImg.getBoundingClientRect();
        const cartRect = cartBtn.getBoundingClientRect();
        const clone = new Image();
        clone.src = sourceImg.src;

        clone.className = 'garrafa-voando';
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.transform = 'translate(0,0) scale(1) rotate(0deg)';
        clone.style.opacity = '1';
        document.body.appendChild(clone);

        const destX = (cartRect.left + cartRect.width / 2) - (rect.left + rect.width / 2);
        const destY = (cartRect.top + cartRect.height / 2) - (rect.top + rect.height / 2);

        const animation = clone.animate([
            { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
            { transform: `translate(${destX * 0.4}px, -120px) scale(0.6) rotate(180deg)`, opacity: 0.9 },
            { transform: `translate(${destX}px, ${destY}px) scale(0.1) rotate(720deg)`, opacity: 0 }
        ], { duration: 400, easing: 'ease-in', fill: 'forwards' });
        animation.onfinish = () => {
            clone.remove(); lancarEmojiDaSacola(name);
            sincronizarBadge();
            if (cartBtn) {
                cartBtn.style.animation = "none";
                void cartBtn.offsetWidth;
                cartBtn.style.animation = "bounceCart 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
            }
            const badge = document.getElementById("badge");
            if (badge) {
                badge.style.animation = "none";
                void badge.offsetWidth;
                badge.style.animation = "popBadge 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
            }
            const totalGarrafas = quantidadeGarrafasCarrinho();
            const nudge = document.getElementById("nudge-frete");
            if (nudge) {
                if (totalGarrafas === 2 && urlParams.get('v') !== '1') {
                    nudge.classList.add("active");
                    clearTimeout(window.nudgeTimeout);
                    window.nudgeTimeout = setTimeout(() => {
                        nudge.classList.remove("active");
                    }, 5000);
                } else {
                    nudge.classList.remove("active");
                }
            }
            setTimeout(abrirCarrinhoAposAdicionar, 120);
        };
    } else setTimeout(abrirCarrinhoAposAdicionar, 120);
    rastrearAcao(name, "🛒 Adicionou");
}

function mostrarPreviewCarrinho(nome, foto) {
    const preview = document.getElementById('desktop-cart-preview');
    const nomeEl = document.getElementById('desktop-cart-preview-name');
    const fotoEl = document.getElementById('desktop-cart-preview-image');
    if (!preview || !nomeEl || !fotoEl) return;
    nomeEl.textContent = nome;
    fotoEl.src = foto || 'fotos/produto-em-breve.svg';
    fotoEl.alt = nome;
    preview.classList.add('active');
    clearTimeout(window.desktopCartPreviewTimeout);
    window.desktopCartPreviewTimeout = setTimeout(() => preview.classList.remove('active'), 6500);
}

function abrirCarrinhoPeloPreview() {
    const preview = document.getElementById('desktop-cart-preview');
    if (preview) preview.classList.remove('active');
    clearTimeout(window.desktopCartPreviewTimeout);
    openCart();
}

function abrirModalProduto(dadosEncoded) {
    const p = JSON.parse(decodeURIComponent(dadosEncoded));

    rastrearAcao(p.nome, "👀 Viu");

    document.getElementById('modal-foto').src = p.foto1;
    document.getElementById('modal-nome').innerText = p.nome;
    document.getElementById('modal-preco').innerText = `R$ ${parseFloat(p.precoNum).toFixed(2).replace('.', ',')}`;

    let tagsHtml = '';
    if (p.teor) tagsHtml += `<span class="modal-tag">🥃 ${p.teor}</span>`;
    if (urlParams.get('v') === '1') {
        tagsHtml += `<span class="modal-tag" style="background:rgba(197,160,89,0.15); color:var(--gold-soft); border-color:var(--gold-soft); font-weight:700;">✨ EXCLUSIVO GRUPO VIP</span>`;
    }
    if (p.temEstoque && p.estoque <= 5) tagsHtml += `<span class="modal-tag" style="background:rgba(255,0,0,0.1); color:var(--red-premium); border-color:rgba(255,0,0,0.2);">🔥 ÚLTIMAS UNIDADES</span>`;
    document.getElementById('modal-tags').innerHTML = tagsHtml;

    document.getElementById('modal-desc').innerText = p.descricao || 'Uma cachaça artesanal feita com muito carinho pelo Tio Nan.';

    const harmWrapper = document.getElementById('modal-harm-wrapper');
    if (p.harmonizacao) {
        document.getElementById('modal-harm').innerText = p.harmonizacao;
        harmWrapper.style.display = 'block';
    } else {
        harmWrapper.style.display = 'none';
    }

    const btnAdd = document.getElementById('modal-btn-add');
    if (p.temEstoque) {
        btnAdd.disabled = false;
        btnAdd.innerText = "Adicionar à Sacola";
        btnAdd.onclick = (event) => {
            add(p.id, p.nome, p.precoNum, p.custoNum, event);
        };
    } else {
        btnAdd.disabled = true;
        btnAdd.innerText = "Produto Esgotado";
        btnAdd.onclick = null;
    }

    // Oculta o botão de scroll e estrelas do modal inicialmente
    const btnScroll = document.getElementById('modal-btn-scroll-reviews');
    if (btnScroll) btnScroll.style.display = 'none';
    const starsWrapper = document.getElementById('modal-stars-wrapper');
    if (starsWrapper) starsWrapper.style.display = 'none';

    // Carrega as avaliações deste sabor
    carregarReviewsProduto(p.nome);

    document.getElementById('modal-produto-overlay').classList.add('active');
    const modalBox = document.getElementById('modal-produto-box');
    if (modalBox) {
        modalBox.style.scrollBehavior = 'auto';
        modalBox.scrollTop = 0;
    }
    document.body.classList.add('stop-scroll');
}

// Compatibilidade com links antigos: detalhes agora abrem em página própria.
function abrirModalProduto(dadosEncoded) {
    const p = JSON.parse(decodeURIComponent(dadosEncoded));
    rastrearAcao(p.nome, "👀 Viu");
    window.location.href = urlProduto(p);
}

function abrirLightbox(url, event, allUrlsString) {
    if (event) event.stopPropagation();
    const lightbox = document.getElementById('review-lightbox');
    const img = document.getElementById('lightbox-img');
    if (!lightbox || !img) return;

    // Inicializa as URLs
    if (allUrlsString) {
        lightboxUrls = allUrlsString.split(',').map(u => u.trim()).filter(u => u.length > 0);
    } else {
        lightboxUrls = [url];
    }

    // Acha o índice atual
    lightboxCurrentIndex = lightboxUrls.indexOf(url);
    if (lightboxCurrentIndex === -1) lightboxCurrentIndex = 0;

    img.src = lightboxUrls[lightboxCurrentIndex];
    lightbox.style.display = 'flex';
    
    // Resolve o bug de stacking/compositing do iOS com backdrop-filter
    const modalOverlay = document.getElementById('modal-produto-overlay');
    if (modalOverlay) {
        modalOverlay.style.zIndex = '1000'; // Menor que o do lightbox
        modalOverlay.style.backdropFilter = 'none';
        modalOverlay.style.webkitBackdropFilter = 'none';
    }

    setTimeout(() => {
        lightbox.style.opacity = '1';
        img.style.transform = 'scale(1)';
    }, 10);
    
    document.body.classList.add('stop-scroll');

    // Atualiza a navegação
    atualizarLightboxNav();
}

function fecharLightbox() {
    const lightbox = document.getElementById('review-lightbox');
    const img = document.getElementById('lightbox-img');
    if (!lightbox || !img) return;

    lightbox.style.opacity = '0';
    img.style.transform = 'scale(0.9)';
    
    // Restaura o z-index e backdrop-filter do modal do produto
    const modalOverlay = document.getElementById('modal-produto-overlay');
    if (modalOverlay) {
        modalOverlay.style.zIndex = '';
        modalOverlay.style.backdropFilter = '';
        modalOverlay.style.webkitBackdropFilter = '';
    }

    setTimeout(() => {
        lightbox.style.display = 'none';
        img.src = '';
        
        // Só remove stop-scroll se o modal principal também não estiver ativo
        const modalProd = document.getElementById('modal-produto-overlay');
        if (!modalProd || !modalProd.classList.contains('active')) {
            document.body.classList.remove('stop-scroll');
        }
    }, 300);
}

function atualizarLightboxNav() {
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    const dotsContainer = document.getElementById('lightbox-dots');
    
    if (!prevBtn || !nextBtn || !dotsContainer) return;

    if (lightboxUrls.length > 1) {
        prevBtn.style.display = 'flex';
        nextBtn.style.display = 'flex';
        dotsContainer.style.display = 'flex';
        
        // Renderiza as bolinhas (dots)
        dotsContainer.innerHTML = lightboxUrls.map((_, index) => {
            const isActive = index === lightboxCurrentIndex;
            return `<span class="lightbox-dot ${isActive ? 'active' : ''}" onclick="lightboxIrPara(${index}, event)"></span>`;
        }).join('');
    } else {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        dotsContainer.style.display = 'none';
    }
}

function lightboxProximo(event) {
    if (event) event.stopPropagation();
    if (lightboxUrls.length <= 1) return;
    
    lightboxCurrentIndex = (lightboxCurrentIndex + 1) % lightboxUrls.length;
    atualizarImagemLightbox();
}

function lightboxAnterior(event) {
    if (event) event.stopPropagation();
    if (lightboxUrls.length <= 1) return;
    
    lightboxCurrentIndex = (lightboxCurrentIndex - 1 + lightboxUrls.length) % lightboxUrls.length;
    atualizarImagemLightbox();
}

function lightboxIrPara(index, event) {
    if (event) event.stopPropagation();
    if (index === lightboxCurrentIndex) return;
    
    lightboxCurrentIndex = index;
    atualizarImagemLightbox();
}

function atualizarImagemLightbox() {
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    
    img.style.opacity = '0';
    img.style.transform = 'scale(0.95)';
    
    setTimeout(() => {
        img.src = lightboxUrls[lightboxCurrentIndex];
        img.onload = () => {
            img.style.opacity = '1';
            img.style.transform = 'scale(1)';
        };
        atualizarLightboxNav();
    }, 150);
}

function handleSwipe() {
    const threshold = 50;
    const diff = touchEndX - touchStartX;
    if (Math.abs(diff) < threshold) return;
    
    if (diff < 0) {
        // Deslizou para a esquerda (próxima foto)
        lightboxProximo();
    } else {
        // Deslizou para a direita (foto anterior)
        lightboxAnterior();
    }
}

async function carregarReviewsProduto(produtoNome) {
    const container = document.getElementById('modal-reviews-section');
    if (!container) return;
    container.innerHTML = '<div style="font-size:0.9rem; opacity:0.6; text-align:center; padding:20px 10px; border-top:1px solid rgba(197,160,89,0.15); margin-top:20px; font-family:var(--font-body);">Carregando avaliações...</div>';
    
    try {
        if (!db) { container.innerHTML = ''; return; }
        const { data: avaliacoes, error } = await db.from('avaliacoes')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        const chaveProduto = chaveSaborAvaliacao(produtoNome);
        const data = (avaliacoes || []).filter(a => chaveSaborAvaliacao(a.produto_nome) === chaveProduto);
        
        if (data && data.length > 0) {
            data.sort((x, y) => {
                const getScore = (a) => {
                    const temComentario = a.comentario && a.comentario.trim() !== '';
                    const temFoto = a.foto_cliente_url && a.foto_cliente_url.trim() !== '';
                    if (temComentario && temFoto) return 3;
                    if (temComentario) return 2;
                    return 1;
                };

                const scoreX = getScore(x);
                const scoreY = getScore(y);

                if (scoreX !== scoreY) {
                    return scoreY - scoreX; // Prioridade maior primeiro
                }
                return new Date(y.created_at) - new Date(x.created_at); // Mais recente em caso de empate
            });
        }

        if (!data || data.length === 0) {
            container.innerHTML = '<div style="font-size:0.85rem; opacity:0.6; text-align:center; padding:20px 10px; border-top:1px solid rgba(197,160,89,0.15); margin-top:20px; font-family:var(--font-body);">Nenhuma avaliação para este sabor ainda. Seja o primeiro a avaliar! 🥃</div>';
            const btnScroll = document.getElementById('modal-btn-scroll-reviews');
            if (btnScroll) btnScroll.style.display = 'none';
            const starsWrapper = document.getElementById('modal-stars-wrapper');
            if (starsWrapper) starsWrapper.style.display = 'none';
            return;
        }

        const totalEstrelas = data.reduce((acc, a) => acc + a.estrelas, 0);
        const media = (totalEstrelas / data.length).toFixed(1);
        const numEstrelasCheias = Math.round(media);
        const estrelasMedia = "★".repeat(numEstrelasCheias) + "☆".repeat(5 - numEstrelasCheias);

        // Exibe estrelas de média no topo do modal
        const starsWrapper = document.getElementById('modal-stars-wrapper');
        if (starsWrapper) {
            const starsFilled = "★".repeat(numEstrelasCheias);
            const starsEmpty = "☆".repeat(5 - numEstrelasCheias);
            starsWrapper.innerHTML = `
                <div class="stars-vitrine" style="justify-content: flex-start; margin: 0; font-size: 1.05rem; cursor: pointer;" onclick="scrollToReviews()">
                    <span class="stars-filled">${starsFilled}</span><span class="stars-empty">${starsEmpty}</span>
                    <span class="reviews-count" style="font-size: 0.85rem; font-weight: 600; color: var(--gold-soft); margin-left: 5px;">(${data.length} avaliações)</span>
                </div>
            `;
            starsWrapper.style.display = 'block';
        }

        let html = `
            <div style="border-top:1px solid rgba(197,160,89,0.15); margin-top:20px; padding-top:20px; font-family:var(--font-body); text-align:left;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; gap: 10px;">
                    <h4 style="font-family:var(--font-premium); font-size:1.2rem; color:var(--blue-navy); margin:0;">Opinião dos Clientes</h4>
                    <div style="text-align:right;">
                        <span style="font-size:1.15rem; font-weight:800; color:var(--gold-soft);">${media} / 5</span>
                        <div style="font-size: 0.85rem; color: #ffc107; letter-spacing: 1px;">${estrelasMedia} <span style="font-size: 0.75rem; color: #888; font-weight: 500; font-family: var(--font-body);">(${data.length})</span></div>
                    </div>
                </div>
                <div class="modal-reviews-wrapper">
                    <div class="modal-reviews-list">
        `;

        data.forEach(a => {
            const dataF = new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const comentario = a.comentario ? `"${a.comentario}"` : '';
            const starsText = "★".repeat(a.estrelas) + "☆".repeat(5 - a.estrelas);
            const nomeExibicao = a.cliente_nome ? a.cliente_nome.trim().toUpperCase() : 'ANÔNIMO';
            
            html += `
                <div class="modal-review-row">
                    <div style="display:flex; justify-content:space-between; font-weight:700; color:var(--blue-navy); font-size:0.8rem; margin-bottom:3px;">
                        <span>${nomeExibicao}</span>
                        <span style="font-size:0.7rem; color:#888; font-weight:normal;">${dataF}</span>
                    </div>
                    <div style="color:#ffc107; font-size:0.85rem; margin-bottom:3px; letter-spacing:1px;">${starsText}</div>
                    ${comentario ? `<p style="font-style:italic; color:#555; line-height:1.3; margin:0; font-size:0.8rem;">${comentario}</p>` : `<p style="font-style:italic; color:#999; margin:0; font-size:0.75rem;">Avaliou sem comentário escrito.</p>`}
                    ${a.foto_cliente_url ? `
                        <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
                            ${a.foto_cliente_url.split(',').map(url => `
                                <img src="${url.trim()}" alt="Foto da garrafa enviada pelo cliente" style="width: 90px; height: 90px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(197, 160, 89, 0.2); cursor: pointer; display: block;" onclick="abrirLightbox('${url.trim()}', event, '${a.foto_cliente_url.replace(/'/g, "\\'")}')">
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        html += `
                    </div>
                </div>
                ${data.length > 2 ? `
                <div style="text-align: center; font-size: 0.72rem; color: var(--gold-soft); margin-top: 8px; opacity: 0.8; font-family: var(--font-body); font-weight: 600; letter-spacing: 0.5px; animation: bounce 2s infinite;">
                    Role para ver mais avaliações ↓
                </div>
                ` : ''}
            </div>
        `;
        container.innerHTML = html;

        // Exibe o botão de scroll se houver avaliações
        const btnScroll = document.getElementById('modal-btn-scroll-reviews');
        if (btnScroll) btnScroll.style.display = 'inline-flex';
    } catch (e) {
        console.error("Erro ao carregar avaliações do produto:", e);
        container.innerHTML = '';
    }
}

function fecharModalProduto(event) {
    if (event && event.target !== document.getElementById('modal-produto-overlay') && event.target.className !== 'modal-fechar' && event.target.className !== 'btn-continuar') return;
    document.getElementById('modal-produto-overlay').classList.remove('active');
    document.body.classList.remove('stop-scroll');
    setTimeout(() => {
        const box = document.getElementById('modal-produto-box');
        if (box) { box.style.scrollBehavior = 'auto'; box.scrollTop = 0; }
    }, 500);
}

function scrollToReviews() {
    const overlay = document.getElementById('modal-produto-overlay');
    const isModalOpen = overlay && overlay.classList.contains('active');
    
    if (isModalOpen) {
        const modalBox = document.getElementById('modal-produto-box');
        const reviewsSection = document.getElementById('modal-reviews-section');
        if (modalBox && reviewsSection) {
            modalBox.scrollTo({
                top: reviewsSection.offsetTop - 20,
                behavior: 'smooth'
            });
        }
    } else {
        const homeReviews = document.getElementById('homepage-testimonials');
        if (homeReviews) {
            homeReviews.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }
}

// --- SISTEMA DE CUPOM DE DESCONTO NA SACOLA ---
let cupomDescontoAtivo = "";
let descontoPercentual = 0;

async function verificarCupomUsoCliente(telefone, codigo) {
    // A validação definitiva ocorre na Edge Function do checkout, sem expor pedidos.
    return false;
}

async function aplicarCupomSacola() {
    const input = document.getElementById('cupom-input');
    const mensagem = document.getElementById('cupom-mensagem-sacola');
    if (!input || !mensagem) return;

    const totalGarrafas = quantidadeGarrafasCarrinho();
    const entrega = document.getElementById('metodo-entrega').value;

    const codigo = input.value.trim().toUpperCase();
    if (!codigo) {
        mensagem.style.color = "#ff4444";
        mensagem.innerText = "Por favor, digite um cupom.";
        mensagem.style.display = "block";
        return;
    }

    const telInput = document.getElementById('cliente-telefone');
    const telefone = telInput ? telInput.value.trim() : "";
    const cleanPhone = telefone.replace(/\D/g, "");

    if (cleanPhone.length < 10) {
        mensagem.style.color = "#ff4444";
        mensagem.innerText = "Digite seu telefone (WhatsApp) completo para validar o cupom.";
        mensagem.style.display = "block";
        return;
    }

    mensagem.style.color = "#888";
    mensagem.innerText = "Validando cupom... ⏳";
    mensagem.style.display = "block";

    try {
        // Verificar se este telefone já utilizou este cupom
        const jaUsou = await verificarCupomUsoCliente(cleanPhone, codigo);
        if (jaUsou) {
            mensagem.style.color = "#ff4444";
            mensagem.innerText = "Este cupom já foi utilizado por este número de WhatsApp.";
            return;
        }

        let cupomValido = false;
        let pctDesconto = 0;
        let encontradoNoBanco = false;

        if (db) {
            const { data, error } = await db.from('cupons')
                .select('*')
                .eq('codigo', codigo)
                .limit(1);

            if (!error && data && data.length > 0) {
                encontradoNoBanco = true;
                if (data[0].ativo) {
                    cupomValido = true;
                    pctDesconto = parseFloat(data[0].desconto_percentual) / 100;
                } else {
                    cupomValido = false;
                }
            }
        }

        // Fallback local
        if (!encontradoNoBanco && codigo === "AVALIEI20") {
            cupomValido = true;
            pctDesconto = 0.20;
        }

        if (cupomValido) {
            cupomDescontoAtivo = codigo;
            descontoPercentual = pctDesconto;
            mensagem.style.color = "#25d366";
            mensagem.innerText = `Cupom ${codigo} aplicado! (${pctDesconto * 100}% de desconto)`;
            input.disabled = true;
        } else {
            mensagem.style.color = "#ff4444";
            mensagem.innerText = "Cupom inválido ou expirado.";
            cupomDescontoAtivo = "";
            descontoPercentual = 0;
            input.disabled = false;
        }
    } catch (e) {
        console.error("Erro ao validar cupom:", e);
        if (codigo === "AVALIEI20") {
            cupomDescontoAtivo = "AVALIEI20";
            descontoPercentual = 0.20;
            mensagem.style.color = "#25d366";
            mensagem.innerText = "Cupom AVALIEI20 aplicado! (20% de desconto)";
            input.disabled = true;
        } else {
            mensagem.style.color = "#ff4444";
            mensagem.innerText = "Erro ao validar cupom.";
        }
    }
    updateCart();
}

function updateCart() {
    sessionStorage.setItem('tioNanCart', JSON.stringify(cart));
    const itemsCont = document.getElementById('cart-items');
    const totalGarrafas = quantidadeGarrafasCarrinho();
    const barra = document.getElementById('barra-frete');
    const textoFrete = document.getElementById('texto-frete');
    const entrega = document.getElementById('metodo-entrega').value;

    const progresso = Math.min((totalGarrafas / 3) * 100, 100);
    if (barra) barra.style.width = progresso + "%";

    if (textoFrete) {
        if (entrega === 'retirada') {
            textoFrete.innerText = "Busque seu pedido na loja sem taxas! 📍";
            if (barra) barra.style.width = "100%";
        } else {
            const isVip = urlParams.get('v') === '1';
            if (isVip) {
                textoFrete.innerText = "OFERTA EXCLUSIVA - FRETE FIXO";
                if (barra) barra.parentElement.style.display = 'none';
            } else {
                textoFrete.innerText = "FRETE FIXO DE R$ 15,00 PARA CIDADES ATENDIDAS";
                if (barra) {
                    barra.style.width = "100%";
                    barra.parentElement.style.display = 'block';
                }
            }
        }
    }

    if (cart.length === 0) {
        mostrarEtapaCheckout('carrinho');
        const containerFrete = document.getElementById('container-frete');
        if (containerFrete) containerFrete.style.display = 'none';

        if (itemsCont) {
            itemsCont.innerHTML = `
                <div style="padding:80px 20px; text-align:center; animation: fadeIn 0.5s ease-out;">
                    <svg viewBox="0 0 24 24" aria-hidden="true" style="width:82px; height:82px; margin-bottom:25px; fill:none; stroke:var(--blue-navy); stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round;"><path d="M3 4h2l2.2 11.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>
                    <p style="opacity:0.7; font-size:1.3rem; font-weight:700; margin-bottom:40px; color:var(--blue-navy); letter-spacing:1px;">Seu carrinho está vazio.</p>
                    <button class="btn-continuar" onclick="toggleCart()" style="display:inline-block; width:auto; padding:20px 50px; background:var(--blue-navy); border:none; color:#fff; border-radius:50px; font-weight:800; text-transform:uppercase; letter-spacing:2px; font-size:0.85rem; box-shadow:0 15px 30px rgba(27,54,93,0.3); cursor:pointer; transition:all 0.3s;">Voltar para a loja</button>
                </div>`;
        }
        const checkoutForm = document.getElementById('checkout-form');
        if (checkoutForm) checkoutForm.style.display = 'none';
        const btnEsvaziar = document.getElementById('container-btn-esvaziar');
        if (btnEsvaziar) btnEsvaziar.style.display = 'none';
        const btnIrEntrega = document.getElementById('btn-ir-entrega');
        if (btnIrEntrega) btnIrEntrega.style.display = 'none';
        const cartContactFields = document.getElementById('cart-contact-fields');
        if (cartContactFields) cartContactFields.style.display = 'none';
        sincronizarBadge();
        return;
    }

    const containerFrete = document.getElementById('container-frete');
    if (containerFrete) containerFrete.style.display = 'block';

    const btnEsvaziar = document.getElementById('container-btn-esvaziar');
    if (btnEsvaziar) btnEsvaziar.style.display = 'block';

    const btnIrEntrega = document.getElementById('btn-ir-entrega');
    if (btnIrEntrega) btnIrEntrega.style.display = 'flex';
    const cartContactFields = document.getElementById('cart-contact-fields');
    if (cartContactFields) cartContactFields.style.display = 'block';

    const checkoutForm = document.getElementById('checkout-form');
    if (checkoutForm) checkoutForm.style.display = checkoutEtapaAtual === 'carrinho' ? 'none' : 'block';

    const blocoEndereco = document.getElementById('bloco-endereco');
    const infoEntrega = document.getElementById('info-entrega-imediata');
    const blocoRetirada = document.getElementById('bloco-retirada');

    if (entrega === 'tele' || entregaPorTransportadora(entrega)) {
        if (blocoEndereco) blocoEndereco.style.display = 'block';
        if (infoEntrega) infoEntrega.style.display = 'flex';
        // Atualizar itens, preços ou estoque não deve consultar novamente o cliente.
        // Essa consulta pertence apenas à etapa de identificação; executá-la aqui
        // sem CPF/e-mail podia sobrescrever ou invalidar o endereço já preenchido.
    } else {
        if (blocoEndereco) blocoEndereco.style.display = 'none';
        if (infoEntrega) infoEntrega.style.display = 'none';
    }
    if (blocoRetirada) blocoRetirada.style.display = (entrega === 'retirada') ? 'block' : 'none';

    if (entrega === 'retirada') liberarBotao();
    else if ((entrega === 'tele' || entregaPorTransportadora(entrega)) && document.getElementById('cidade').value) validarCidade(document.getElementById('cidade').value);

    if (itemsCont) {
        itemsCont.innerHTML = cart.map(i => {
            const imgHtml = i.foto ? `<img src="${i.foto}" style="width:55px; height:55px; object-fit:contain; border-radius:10px; background:rgba(255,255,255,0.03); margin-right:15px; border:1px solid rgba(197,160,89,0.1);">` : '';
            return `
            <div class="cart-item-row">
                <div style="display:flex; align-items:center;">
                    ${imgHtml}
                    <div>
                        <div style="font-weight:800; font-size:1rem; color:var(--blue-navy); margin-bottom:4px;">${i.name}</div>
                        <div style="color:var(--gold-soft); font-size:0.9rem; font-weight:600;">R$ ${(i.price * i.qtd).toFixed(2).replace('.', ',')}</div>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <button class="qty-btn" onclick="changeQty('${i.id}', -1)">-</button>
                    <span style="font-weight:900; font-size:1.1rem; min-width:20px; text-align:center;">${i.qtd}</span>
                    <button class="qty-btn" onclick="changeQty('${i.id}', 1)">+</button>
                </div>
            </div>`;
        }).join('');
    }

    let subtotal = cart.reduce((acc, i) => acc + (i.price * i.qtd), 0);
    let valorDesconto = subtotal * descontoPercentual;
    let total = subtotal - valorDesconto;
    
    let freteInclusoText = "";
    const isVip = urlParams.get('v') === '1';
    if (entrega === 'tele' || entregaPorTransportadora(entrega)) {
        total += valorFreteAtual();
        freteInclusoText = " (frete incluso)";
    }
    
    const totalDisplay = document.getElementById('cart-total-display');
    if (totalDisplay) {
        if (descontoPercentual > 0) {
            totalDisplay.innerHTML = `
                <div style="font-size: 0.9rem; font-weight: normal; color: #888; text-decoration: line-through; margin-bottom: 2px;">Subtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}</div>
                <div style="font-size: 0.95rem; font-weight: bold; color: #25d366; margin-bottom: 5px;">Desconto: -R$ ${valorDesconto.toFixed(2).replace('.', ',')} (${descontoPercentual * 100}%)</div>
                <div>Total: R$ ${total.toFixed(2).replace('.', ',')}${freteInclusoText}</div>
            `;
        } else {
            totalDisplay.innerText = `Total: R$ ${total.toFixed(2).replace('.', ',')}${freteInclusoText}`;
        }
    }
}

let carregandoMercadoPagoAutomaticamente = false;

async function handlePagamentoChange() {
    atualizarPagamentoPorEntrega();
    const pag = document.getElementById('metodo-pagamento').value;
    const blocoTroco = document.getElementById('bloco-troco');
    const btnFinalizar = document.getElementById('btn-finalizar');
    const btnTexto = document.getElementById('btn-finalizar-texto');
    if (blocoTroco) blocoTroco.style.display = (pag === 'Dinheiro') ? 'block' : 'none';
    if (btnFinalizar) btnFinalizar.style.display = 'flex';
    if (btnTexto) btnTexto.textContent = pag === 'Dinheiro' ? 'Finalizar pedido' : pag === 'Teste' ? 'Criar pedido de teste' : 'Ir para pagamento seguro';
    if (pag === 'Dinheiro' || pag === 'Teste') {
        const paymentBrick = document.getElementById('paymentBrick_container');
        const statusBrick = document.getElementById('statusScreenBrick_container');
        const avisoSandbox = document.getElementById('mp-sandbox-aviso');
        if (paymentBrick) paymentBrick.style.display = 'none';
        if (statusBrick) statusBrick.style.display = 'none';
        if (avisoSandbox) avisoSandbox.style.display = 'none';
        return;
    }

    if (pag === 'Mercado Pago' && checkoutEtapaAtual === 'pagamento' && !carregandoMercadoPagoAutomaticamente) {
        carregandoMercadoPagoAutomaticamente = true;
        if (btnFinalizar) btnFinalizar.disabled = true;
        if (btnTexto) btnTexto.textContent = 'Carregando Mercado Pago…';
        try {
            await checkout();
        } finally {
            carregandoMercadoPagoAutomaticamente = false;
            if (btnFinalizar) btnFinalizar.disabled = false;
            if (btnTexto) btnTexto.textContent = 'Ir para pagamento seguro';
        }
    }
}

function handleTrocoChange() {
    const precisaTroco = document.getElementById('precisa-troco').checked;
    const campoTroco = document.getElementById('campo-troco-valor');
    if (campoTroco) campoTroco.style.display = precisaTroco ? 'block' : 'none';
    if (!precisaTroco) document.getElementById('troco').value = '';
}

function changeQty(id, delta) {
    const item = cart.find(i => i.id === id);
    if (item) {
        item.qtd += delta;
        if (item.qtd <= 0) cart = cart.filter(i => i.id !== id);
        updateCart();
        sincronizarBadge();
        agendarAtualizacaoAutomaticaFrete();
    }
}


function esvaziarSacola(event) {
    if (event) event.stopPropagation();
    if (cart.length === 0) return;
    if (!confirm("Deseja realmente esvaziar todo o seu carrinho? 🛒")) return;
    cart = [];
    updateCart();
    sincronizarBadge();
}


function sincronizarBadge() {
    const badge = document.getElementById('badge');
    if (badge) badge.innerText = quantidadeItensCarrinho();
}

function identificarClienteSalvo(nome, telefone) {
    const nomeLimpo = (nome || '').trim();
    const telefoneLimpo = (telefone || '').trim();
    return nomeLimpo && telefoneLimpo ? ` (cliente salvo: ${nomeLimpo} • ${telefoneLimpo})` : "";
}

let timeoutSalvarRascunho;
function salvarRascunhoCliente() {
    clearTimeout(timeoutSalvarRascunho);
    timeoutSalvarRascunho = setTimeout(async () => {
        const telInput = document.getElementById('cliente-telefone');
        const nomeInput = document.getElementById('cliente-nome');
        const emailInput = document.getElementById('cliente-email');
        const cpfInput = document.getElementById('cliente-cpf');
        if (!telInput || !nomeInput || !emailInput || !cpfInput) return;

        const telRaw = telInput.value;
        const nome = nomeInput.value;
        const email = emailInput.value.trim().toLowerCase();
        const cpf = cpfInput.value.replace(/\D/g, '');
        const tel = telRaw.replace(/\D/g, "");

        if (tel.length >= 10 && nome.length >= 3) {
            localStorage.setItem('visitorName', nome);
            updateWelcome();
        }
    }, 1000);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isCartOpen) {
        const cpf = document.getElementById('cliente-cpf').value;
        const email = document.getElementById('cliente-email').value;
        const nome = document.getElementById('cliente-nome').value;
        const telefone = document.getElementById('cliente-telefone').value;
        const entrega = document.getElementById('metodo-entrega').value;
        const pag = document.getElementById('metodo-pagamento').value;
        const rua = document.getElementById('rua').value;

        let faltou = [];
        if (!cpf) faltou.push("CPF");
        if (!email) faltou.push("E-mail");
        if (!telefone) faltou.push("Telefone");
        if (!nome) faltou.push("Nome");
        if (entrega === "none" || !entrega) faltou.push("Entrega");
        if (entrega === "tele" && !rua) faltou.push("Endereço");
        if (pag === "none" || !pag) faltou.push("Pagamento");

        if (faltou.length > 0) {
            let sufixo = (nome && telefone.length >= 10) ? identificarClienteSalvo(nome, telefone) : "";
            rastrearAcao(faltou.join(", ") + sufixo, "⚠️ Saiu sem");
        }
    } else if (document.visibilityState === 'visible' && isCartOpen) {
        rastrearAcao("Sacola", "✨ Voltou");
    }
});

async function renderizarStatusMercadoPago(paymentId) {
    const paymentContainer = document.getElementById('paymentBrick_container');
    const statusContainer = document.getElementById('statusScreenBrick_container');
    if (paymentBrickController) {
        await paymentBrickController.unmount();
        paymentBrickController = null;
    }
    paymentContainer.style.display = 'none';
    statusContainer.style.display = 'block';
    statusScreenBrickController = await mercadoPagoBricksBuilder.create('statusScreen', 'statusScreenBrick_container', {
        initialization: { paymentId },
        callbacks: {
            onReady: () => statusContainer.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            onError: (error) => console.error('Erro na tela de status Mercado Pago:', error)
        }
    });
}

async function renderizarPaymentBrick(orderPayload, amount) {
    if (!window.MercadoPago) throw new Error('O componente seguro do Mercado Pago não carregou.');
    const button = document.getElementById('btn-finalizar');
    const notice = document.getElementById('mp-sandbox-aviso');
    const container = document.getElementById('paymentBrick_container');
    if (button) button.style.display = 'none';
    notice.style.display = 'block';
    container.style.display = 'block';

    if (paymentBrickController) await paymentBrickController.unmount();
    if (statusScreenBrickController) {
        await statusScreenBrickController.unmount();
        statusScreenBrickController = null;
    }
    const mercadoPago = new window.MercadoPago(MERCADO_PAGO_TEST_PUBLIC_KEY, { locale: 'pt-BR' });
    mercadoPagoBricksBuilder = mercadoPago.bricks();
    paymentBrickController = await mercadoPagoBricksBuilder.create('payment', 'paymentBrick_container', {
        initialization: {
            amount: Number(amount.toFixed(2)),
            payer: {
                email: orderPayload.email,
                identification: { type: 'CPF', number: orderPayload.cpf }
            }
        },
        customization: {
            visual: { style: { theme: 'default', customVariables: { baseColor: '#1b365d' } } },
            paymentMethods: {
                bankTransfer: 'pix',
                creditCard: 'all',
                debitCard: 'all',
                prepaidCard: 'all'
            }
        },
        callbacks: {
            onReady: () => container.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            onError: (error) => console.error('Erro no Payment Brick:', error),
            onSubmit: async ({ formData }) => {
                try {
                    const { data, error } = await db.functions.invoke('mercado-pago-checkout', {
                        body: { ...orderPayload, sandbox: true, payment: formData }
                    });
                    if (error) {
                        let message = error.message || 'Falha ao processar o pagamento de teste.';
                        try {
                            const body = await error.context?.json?.();
                            message = [body?.error, body?.detail].filter(Boolean).join(' — ') || message;
                        } catch (_) {}
                        throw new Error(message);
                    }
                    if (!data?.payment_id) throw new Error(data?.error || 'O Mercado Pago não retornou o pagamento.');
                    salvarClienteRecenteCheckout(orderPayload.cpf, orderPayload.email, orderPayload.nome, orderPayload.telefone, orderPayload.endereco || {});
                    sessionStorage.setItem('tioNanPedidoPendente', data.pedido || '');
                    await renderizarStatusMercadoPago(data.payment_id);
                } catch (error) {
                    console.error('Erro no pagamento incorporado:', error);
                    alert(`Não foi possível processar o teste.\n\n${error?.message || 'Tente novamente.'}`);
                    throw error;
                }
            }
        }
    });
}

async function checkout() {
    try {
        const cpf = document.getElementById('cliente-cpf').value.replace(/\D/g, '');
        const email = document.getElementById('cliente-email').value.trim().toLowerCase();
        const nome = document.getElementById('cliente-nome').value;
        const entrega = document.getElementById('metodo-entrega').value;
        const pag = document.getElementById('metodo-pagamento').value;
        const marketingConsentimento = Boolean(document.getElementById('marketing-consentimento')?.checked);
        const totalGarrafas = quantidadeGarrafasCarrinho();

        document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));

        function showError(elementId) {
            const el = document.getElementById(elementId);
            if (el) {
                el.classList.add('input-error');
                el.focus();
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });

                let campoNome = el.placeholder || elementId;
                if (elementId === "metodo-entrega") campoNome = "Forma de Entrega";
                if (elementId === "metodo-pagamento") campoNome = "Forma de Pagamento";

                rastrearAcao(campoNome, "❌ Faltou");
            }
        }

        const telefone = document.getElementById('cliente-telefone').value;
        if (!cpfValido(cpf)) return showError('cliente-cpf');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('cliente-email');
        if (!telefone || telefone.length < 14) return showError('cliente-telefone');
        if (!nome) return showError('cliente-nome');
        if (!entrega || entrega === "none") return showError('metodo-entrega');
        if (entrega === 'tele' || entregaPorTransportadora(entrega)) {
            const valor = id => document.getElementById(id)?.value?.trim() || '';
            if (valor('cep').replace(/\D/g, '').length !== 8) return showError('cep');
            if (!valor('rua')) return showError('rua');
            if (!valor('numero')) return showError('numero');
            if (!valor('bairro')) return showError('bairro');
            if (!valor('cidade')) return showError('cidade');
            if (!valor('estado')) return showError('estado');
            if (entrega === 'tele' && !CIDADES_PERMITIDAS.some(c => c.localeCompare(valor('cidade'), 'pt-BR', { sensitivity: 'base' }) === 0)) return showError('cidade');
        }
        if (!pag || pag === "none") return showError('metodo-pagamento');
        if (pag === 'Dinheiro' && document.getElementById('precisa-troco').checked && !document.getElementById('troco').value.trim()) {
            return showError('troco');
        }

        // Validar se o telefone já utilizou este cupom antes de finalizar
        if (cupomDescontoAtivo) {
            const cleanPhone = telefone.replace(/\D/g, "");
            const jaUsou = await verificarCupomUsoCliente(cleanPhone, cupomDescontoAtivo);
            if (jaUsou) {
                alert(`O cupom ${cupomDescontoAtivo} já foi utilizado pelo seu número de WhatsApp. Por favor, utilize outro cupom.`);
                // Resetar cupom
                cupomDescontoAtivo = "";
                descontoPercentual = 0;
                const input = document.getElementById('cupom-input');
                if (input) {
                    input.value = "";
                    input.disabled = false;
                }
                const mensagemSacola = document.getElementById('cupom-mensagem-sacola');
                if (mensagemSacola) {
                    mensagemSacola.style.color = "#ff4444";
                    mensagemSacola.innerText = "Este cupom já foi utilizado por este número de WhatsApp.";
                    mensagemSacola.style.display = "block";
                }
                updateCart();
                return;
            }
        }

        localStorage.setItem('visitorName', nome);
        updateWelcome();
        atualizarPresenca();

        let endereco = (entrega === 'tele' || entregaPorTransportadora(entrega)) ? `${document.getElementById('rua').value}, ${document.getElementById('numero').value} - ${document.getElementById('bairro').value}, ${document.getElementById('cidade').value}` : "Retirada na Loja (Av. Bento Gonçalves, 4321) - Dia e horário a combinar";
        const custoTotalPedido = cart.reduce((acc, i) => acc + (i.cost * i.qtd), 0);

        let valorFrete = 0;
        valorFrete = valorFreteAtual();

        let subtotal = cart.reduce((acc, i) => acc + (i.price * i.qtd), 0);
        let valorDesconto = subtotal * descontoPercentual;
        let valorTotalComFrete = subtotal - valorDesconto + valorFrete;

        const itensMsg = cart.map(i => `${i.name} (x${i.qtd})`).join(', ');
        const totalMsg = `R$ ${valorTotalComFrete.toFixed(2).replace('.', ',')}${valorFrete > 0 ? ' (frete incluso)' : ''}`;

        let beneficioMsg = "";
        
        let cupomMsg = "";
        if (cupomDescontoAtivo) {
            cupomMsg = `\n🏷️ Cupom: *${cupomDescontoAtivo}* (Desconto: -R$ ${valorDesconto.toFixed(2).replace('.', ',')})`;
        }

        if (pag === "Mercado Pago" && MERCADO_PAGO_BRICK_TEST) {
            const enderecoPayload = (entrega === 'tele' || entregaPorTransportadora(entrega)) ? {
                cep: document.getElementById('cep').value,
                rua: document.getElementById('rua').value,
                numero: document.getElementById('numero').value,
                apto: document.getElementById('apto').value,
                bairro: document.getElementById('bairro').value,
                cidade: document.getElementById('cidade').value,
                estado: document.getElementById('estado').value
            } : {};
            try {
                await renderizarPaymentBrick({
                    cpf,
                    email,
                    nome,
                    telefone,
                    marketing_consentimento: marketingConsentimento,
                    entrega,
                    frete: freteMelhorEnvioSelecionado,
                    endereco: enderecoPayload,
                    cupom: cupomDescontoAtivo,
                    itens: cart.map(item => ({ id: item.id, nome: item.name, quantidade: item.qtd }))
                }, valorTotalComFrete);
            } catch (error) {
                console.error('Erro ao abrir pagamento incorporado:', error);
                alert(`Não foi possível carregar o pagamento.\n\n${error?.message || 'Tente novamente.'}`);
                const btn = document.getElementById('btn-finalizar');
                if (btn) btn.style.display = 'flex';
            }
            return;
        }

        if (pag === "Mercado Pago") {
            const btn = document.getElementById('btn-finalizar');
            if (btn) { btn.disabled = true; btn.style.opacity = "0.65"; btn.textContent = "Abrindo pagamento seguro…"; }
            const enderecoPayload = (entrega === 'tele' || entregaPorTransportadora(entrega)) ? {
                cep: document.getElementById('cep').value,
                rua: document.getElementById('rua').value,
                numero: document.getElementById('numero').value,
                apto: document.getElementById('apto').value,
                bairro: document.getElementById('bairro').value,
                cidade: document.getElementById('cidade').value,
                estado: document.getElementById('estado').value
            } : {};
            try {
                const { data, error } = await db.functions.invoke('mercado-pago-checkout', { body: {
                    cpf,
                    email,
                    nome,
                    telefone,
                    entrega,
                    frete: freteMelhorEnvioSelecionado,
                    endereco: enderecoPayload,
                    cupom: cupomDescontoAtivo,
                    itens: cart.map(item => ({ id: item.id, nome: item.name, quantidade: item.qtd }))
                }});
                if (error) {
                    let functionMessage = error.message || "Falha ao abrir o checkout.";
                    try {
                        if (error.context && typeof error.context.json === 'function') {
                            const functionBody = await error.context.json();
                            functionMessage = [functionBody?.error, functionBody?.detail]
                                .filter(Boolean)
                                .join(' — ') || functionMessage;
                        }
                    } catch (contextError) {
                        console.warn("Não foi possível ler os detalhes do checkout:", contextError);
                    }
                    throw new Error(functionMessage);
                }
                if (!data?.checkout_url) throw new Error(data?.error || "O checkout não retornou um endereço de pagamento.");
                salvarClienteRecenteCheckout(cpf, email, nome, telefone, enderecoPayload);
                sessionStorage.setItem('tioNanPedidoPendente', data.pedido || '');
                window.location.assign(data.checkout_url);
                return;
            } catch (paymentError) {
                console.error("Erro no checkout Mercado Pago:", paymentError);
                alert(`Não foi possível abrir o pagamento.\n\n${paymentError?.message || "Tente novamente em instantes."}`);
                if (btn) { btn.disabled = false; btn.style.opacity = "1"; btn.innerHTML = 'Ir para pagamento seguro'; }
                return;
            }
        }

        const enderecoPayload = (entrega === 'tele' || entregaPorTransportadora(entrega)) ? {
            cep: document.getElementById('cep').value,
            rua: document.getElementById('rua').value,
            numero: document.getElementById('numero').value,
            apto: document.getElementById('apto').value,
            bairro: document.getElementById('bairro').value,
            cidade: document.getElementById('cidade').value,
            estado: document.getElementById('estado').value
        } : {};
        const btn = document.getElementById('btn-finalizar');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.65'; }
        const { data, error } = await db.functions.invoke('mercado-pago-checkout', { body: {
            pagamento: pag,
            teste: pag === 'Teste',
            troco: pag === 'Dinheiro' && document.getElementById('precisa-troco').checked ? document.getElementById('troco').value : '',
            cpf, email, nome, telefone, marketing_consentimento: marketingConsentimento, entrega, endereco: enderecoPayload, frete: freteMelhorEnvioSelecionado,
            cupom: cupomDescontoAtivo,
            itens: cart.map(item => ({ id: item.id, nome: item.name, quantidade: item.qtd }))
        }});
        if (error) {
            let mensagem = error.message || 'Não foi possível criar o pedido.';
            try {
                if (error.context && typeof error.context.json === 'function') {
                    const resposta = await error.context.json();
                    mensagem = [resposta?.error, resposta?.detail].filter(Boolean).join(' — ') || mensagem;
                }
            } catch (contextError) {
                console.warn('Não foi possível ler os detalhes do pedido em dinheiro:', contextError);
            }
            throw new Error(mensagem);
        }
        if (!data?.tracking_token) throw new Error(data?.error || 'O pedido foi criado sem código de acompanhamento.');
        salvarClienteRecenteCheckout(cpf, email, nome, telefone, enderecoPayload);
        localStorage.setItem('tioNanUltimoPedido', data.tracking_token);
        cart = [];
        sessionStorage.removeItem('tioNanCart');
        window.location.assign(`pedido.html?novo=1&token=${encodeURIComponent(data.tracking_token)}`);
    } catch (e) {
        console.error(e);
        const mensagem = e instanceof Error && e.message ? e.message : 'Não foi possível finalizar o pedido.';
        alert(`Não foi possível finalizar o pedido.\n\n${mensagem}`);
        const btn = document.getElementById('btn-finalizar');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}

const paymentReturn = new URLSearchParams(window.location.search).get('pagamento');
if (paymentReturn === 'sucesso') {
    cart = [];
    sessionStorage.removeItem('tioNanCart');
    sessionStorage.removeItem('tioNanPedidoPendente');
    setTimeout(() => alert('Pagamento aprovado! Seu pedido Tio Nan foi recebido.'), 250);
} else if (paymentReturn === 'pendente') {
    setTimeout(() => alert('Pagamento em processamento. Avisaremos assim que houver confirmação.'), 250);
} else if (paymentReturn === 'falha') {
    setTimeout(() => alert('O pagamento não foi concluído. Seu carrinho continua salvo para tentar novamente.'), 250);
}

loadProducts(); updateCart(); sincronizarBadge(); updateWelcome(); carregarTestimonialsHome();

let isCartOpen = false;

function toggleCart() {
    const overlay = document.getElementById('cart-overlay');
    const isActive = overlay && overlay.classList.contains('active');
    if (isActive) {
        closeCart(false);
    } else {
        openCart();
    }
}

function openCart() {
    isCartOpen = true;
    const overlay = document.getElementById('cart-overlay');
    const backdrop = document.getElementById('backdrop');
    const preview = document.getElementById('desktop-cart-preview');
    if (preview) preview.classList.remove('active');
    if (overlay) overlay.classList.add('active');
    document.body.classList.add('stop-scroll');
    if (backdrop) backdrop.style.display = 'block';
    history.pushState({ sacolaAberta: true }, "", "#sacola");
    rastrearAcao("Carrinho", "💳 Abriu Checkout");
}
function closeCart(veioDoBotaoVoltar = false) {
    try {
        const nome = document.getElementById('cliente-nome').value;
        const telefone = document.getElementById('cliente-telefone').value;
        const entrega = document.getElementById('metodo-entrega').value;
        const pag = document.getElementById('metodo-pagamento').value;
        const rua = document.getElementById('rua').value;

        if (cart.length > 0) {
            let faltou = [];
            if (!telefone) faltou.push("Telefone");
            if (!nome) faltou.push("Nome");
            if (entrega === "none" || !entrega) faltou.push("Entrega");
            if (entrega === "tele" && !rua) faltou.push("Endereço");
            if (pag === "none" || !pag) faltou.push("Pagamento");

            if (faltou.length > 0) {
                let sufixo = (nome && telefone.length >= 10) ? identificarClienteSalvo(nome, telefone) : "";
                rastrearAcao(faltou.join(", ") + sufixo, "⚠️ Abandonou sem");
            } else {
                rastrearAcao(`Pronto p/ WhatsApp${identificarClienteSalvo(nome, telefone)}`, "⚠️ Abandonou (Preencheu Tudo)");
            }
        }
    } catch (e) { }

    isCartOpen = false;
    const overlay = document.getElementById('cart-overlay');
    const backdrop = document.getElementById('backdrop');
    if (overlay) overlay.classList.remove('active');
    document.body.classList.remove('stop-scroll');
    if (backdrop) backdrop.style.display = 'none';
    if (!veioDoBotaoVoltar) { history.back(); }
}
window.addEventListener("popstate", (event) => { if (isCartOpen) { closeCart(true); } });

if (urlParams.get('carrinho') === '1') setTimeout(async () => {
    openCart();
    const cepTransferido = String(sessionStorage.getItem('tioNanCheckoutCep') || '').replace(/\D/g, '');
    if (cepTransferido.length !== 8) return;
    const campoCep = document.getElementById('cep');
    if (campoCep) campoCep.value = cepTransferido.replace(/^(\d{5})(\d{3})$/, '$1-$2');
    await buscaCEP();
    try {
        const entregaTransferida = JSON.parse(sessionStorage.getItem('tioNanCheckoutEntrega') || 'null');
        const opcao = entregaTransferida?.value
            ? document.querySelector(`input[name="entrega-cep"][value="${CSS.escape(entregaTransferida.value)}"]`)
            : null;
        if (opcao) { opcao.checked = true; opcao.dispatchEvent(new Event('change', { bubbles:true })); }
    } catch (error) { console.warn('Não foi possível restaurar a opção de entrega:', error); }
    sessionStorage.removeItem('tioNanCheckoutCep');
    sessionStorage.removeItem('tioNanCheckoutEntrega');
}, 150);

document.addEventListener('input', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('input-error')) {
        e.target.classList.remove('input-error');
    }
});
document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('input-error')) {
        e.target.classList.remove('input-error');
    }
});

async function carregarTestimonialsHome() {
    const container = document.getElementById('testimonials-swiper-wrapper');
    const section = document.getElementById('homepage-testimonials');
    if (!container || !section) return;

    try {
        if (!db) return;
        
        // Busca as avaliações que contêm comentários e os produtos em paralelo
        const [reviewsRes, prodsRes] = await Promise.all([
            db.from('avaliacoes')
                .select('*')
                .gte('estrelas', 4)
                .not('comentario', 'is', null)
                .neq('comentario', '')
                .order('created_at', { ascending: false })
                .limit(40), // Buscamos mais para garantir avaliadores únicos após deduplicação
            db.from('produtos').select('*').eq('excluido', false)
        ]);

        if (reviewsRes.error) throw reviewsRes.error;
        
        // Filtra para garantir apenas depoimentos com comentários válidos e sem nomes repetidos
        const nomesVistos = new Set();
        const data = [];
        const rawReviews = (reviewsRes.data || []).filter(avaliacao => avaliacaoDeSaborAtivo(avaliacao.produto_nome));
        
        for (const a of rawReviews) {
            if (!a.comentario || a.comentario.trim() === '') continue;
            
            // Pega o nome completo em maiúsculo para comparar/exibir
            const nomeExibicao = a.cliente_nome ? a.cliente_nome.trim().toUpperCase() : 'ANÔNIMO';
            
            // Se já vimos esse primeiro nome de exibição, pula
            if (nomeExibicao !== 'ANÔNIMO' && nomesVistos.has(nomeExibicao)) {
                continue;
            }
            
            if (nomeExibicao !== 'ANÔNIMO') {
                nomesVistos.add(nomeExibicao);
            }
            
            data.push(a);
            if (data.length >= 9) break; // Exibe no máximo 9 depoimentos únicos na home
        }
        
        if (data.length === 0) {
            section.classList.add('hidden');
            return;
        }

        // Mapeia as fotos e o link da página de cada produto.
        const produtosMap = {};
        if (prodsRes.data) {
            prodsRes.data.forEach(p => {
                const id = p.id;
                const nome = p.nome;

                const foto1Raw = (p.foto_1 && p.foto_1.trim().length > 5) ? p.foto_1.trim() : "https://via.placeholder.com/300x300?text=Sem+Foto";
                let foto1 = fixDrive(foto1Raw);
                foto1 = getLocalPhoto(nome, foto1, false);

                const nomeNormalizado = nome.trim().toLowerCase();

                produtosMap[nomeNormalizado] = {
                    fotoUrl: foto1,
                    produtoUrl: urlProduto({ id, nome })
                };
            });
        }

        container.innerHTML = data.map(a => {
            const estrelas = "★".repeat(a.estrelas) + "☆".repeat(5 - a.estrelas);
            const nomeExibicao = a.cliente_nome ? a.cliente_nome.trim().toUpperCase() : 'ANÔNIMO';
            const comentario = a.comentario.trim();
            const dataF = a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
            
            const prodNomeKey = a.produto_nome ? a.produto_nome.trim().toLowerCase() : '';
            const prodInfo = produtosMap[prodNomeKey];
            const fotoUrl = prodInfo ? prodInfo.fotoUrl : '';
            const produtoUrl = prodInfo ? prodInfo.produtoUrl : '';
            const clickAttr = produtoUrl ? `onclick="window.location.href='${produtoUrl}'"` : '';
            
            return `
                <div class="swiper-slide" style="height: auto;">
                    <div class="testimonial-card" ${clickAttr}>
                        <!-- Lado do Produto -->
                        <div class="testimonial-product-side">
                            ${fotoUrl ? `<img src="${fotoUrl}" class="testimonial-card-bottle" alt="${a.produto_nome}">` : ''}
                            <span class="testimonial-product-tag">${a.produto_nome}</span>
                        </div>
                        
                        <!-- Lado da Avaliação -->
                        <div class="testimonial-review-side">
                            <div class="testimonial-stars">${estrelas}</div>
                            <p class="testimonial-comment">"${comentario}"</p>
                    ${a.foto_cliente_url ? `
                        <div style="margin-bottom: 12px; margin-top: -5px; z-index: 5; position: relative; display: flex; gap: 6px; flex-wrap: wrap;">
                            ${a.foto_cliente_url.split(',').map(url => `
                                <img src="${url.trim()}" alt="Foto da garrafa enviada pelo cliente" style="width: 45px; height: 45px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(197, 160, 89, 0.2); cursor: pointer; display: block;" onclick="abrirLightbox('${url.trim()}', event, '${a.foto_cliente_url.replace(/'/g, "\\'")}')">
                            `).join('')}
                        </div>
                    ` : ''}
                            <div class="testimonial-footer">
                                <span class="testimonial-author">${nomeExibicao}</span>
                                ${dataF ? `<span class="testimonial-date">${dataF}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        section.classList.remove('hidden');

        // Inicializa o Swiper para depoimentos com atraso de renderização
        setTimeout(() => {
            new Swiper('.swiper-testimonials', {
                slidesPerView: 1,
                spaceBetween: 20,
                loop: data.length > 3,
                pagination: {
                    el: '.testimonials-pagination',
                    clickable: true,
                },
                breakpoints: {
                    640: { slidesPerView: 2, spaceBetween: 20 },
                    1024: { slidesPerView: 3, spaceBetween: 30 }
                },
                autoplay: {
                    delay: 4500,
                    disableOnInteraction: false,
                }
            });
            // Inicia as notificações flutuantes (Live Social Proof)
            iniciarToastProvaSocial(data);
        }, 150);
    } catch (e) {
        console.error("Erro ao carregar depoimentos na home:", e);
        section.classList.add('hidden');
    }
}

// --- FUNÇÕES DE PROVA SOCIAL E TRUST BADGE ---

function atualizarSeloConfianca(avaliacoes) {
    const qtyEl = document.getElementById('total-reviews-qty');
    const starsEl = document.getElementById('header-average-stars');
    const containerEl = document.getElementById('header-social-proof-container');
    if (!containerEl || !qtyEl || !starsEl || !avaliacoes || avaliacoes.length === 0) return;

    const totalCount = avaliacoes.length;
    const totalStars = avaliacoes.reduce((acc, a) => acc + a.estrelas, 0);
    const media = (totalStars / totalCount).toFixed(1);

    qtyEl.innerText = totalCount;
    starsEl.innerText = media;
    containerEl.style.display = 'flex';
}

function iniciarToastProvaSocial(avaliacoes) {
    // Se o usuário já fechou na sessão atual, não exibe
    if (sessionStorage.getItem('social-proof-dismissed') === 'true') return;

    const toast = document.getElementById('social-proof-toast');
    if (!toast || !avaliacoes || avaliacoes.length === 0) return;

    let index = 0;
    let timeoutId = null;

    function mostrarProximaNotificacao() {
        // Se o usuário fechou entre os intervalos, encerra
        if (sessionStorage.getItem('social-proof-dismissed') === 'true') return;

        const a = avaliacoes[index];
        const nome = a.cliente_nome ? a.cliente_nome.trim() : 'Cliente Satisfeito';
        
        // Formata primeiro nome + sobrenome abreviado
        const partesNome = nome.split(' ');
        const nomeFormatado = partesNome[0] + (partesNome.length > 1 ? ' ' + partesNome[partesNome.length - 1][0] + '.' : '');
        
        const estrelas = '★'.repeat(a.estrelas);
        const produto = a.produto_nome || 'uma garrafa';
        const comentarioCurto = a.comentario.length > 70 ? a.comentario.substring(0, 67) + '...' : a.comentario;

        // Monta o conteúdo do toast flutuante
        toast.innerHTML = `
            <button class="social-proof-close" onclick="fecharToastProvaSocial(event)">&times;</button>
            <div class="social-proof-icon">⭐</div>
            <div class="social-proof-content">
                <p class="social-proof-title"><strong>${nomeFormatado}</strong> avaliou com ${estrelas}</p>
                <p class="social-proof-desc">"${comentarioCurto}"</p>
                <p class="social-proof-product">${produto}</p>
            </div>
        `;

        // Ativa o toast flutuante (fade-in)
        toast.classList.add('active');

        // Oculta após 6 segundos (fade-out)
        timeoutId = setTimeout(() => {
            toast.classList.remove('active');
            index = (index + 1) % avaliacoes.length;
            
            // Próximo toast aparece após 8 segundos
            timeoutId = setTimeout(mostrarProximaNotificacao, 8000);
        }, 6000);
    }

    // Primeiro toast aparece após 3 segundos da inicialização
    setTimeout(mostrarProximaNotificacao, 3000);
}

function fecharToastProvaSocial(event) {
    if (event) event.stopPropagation();
    const toast = document.getElementById('social-proof-toast');
    if (toast) {
        toast.classList.remove('active');
    }
    sessionStorage.setItem('social-proof-dismissed', 'true');
}
