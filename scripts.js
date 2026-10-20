
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
        if (overlay) {
            overlay.classList.remove('is-visible');
            overlay.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('age-modal-open');

        updateWelcome();
        rastrearAcao("Idade Verificada", "🔞");
        // Newsletter permanece disponível por ação do visitante, sem interromper a chegada.

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
        if (overlay) {
            overlay.classList.remove('is-visible');
            overlay.setAttribute('aria-hidden', 'true');
        }
        // Não abre newsletter automaticamente para quem acabou de chegar.
    } else {
        const exibirConfirmacaoIdade = async () => {
            await Promise.race([
                window.tioNanBannersReady || Promise.resolve(),
                new Promise(resolve => window.setTimeout(resolve, 5000))
            ]);
            window.setTimeout(() => {
                if (!overlay || localStorage.getItem('ageVerified') === 'true') return;
                overlay.classList.add('is-visible');
                overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('age-modal-open');
                window.setTimeout(() => overlay.querySelector('.btn-yes')?.focus(), 120);
            }, 1000);
        };
        if (document.readyState === 'complete') exibirConfirmacaoIdade();
        else window.addEventListener('load', exibirConfirmacaoIdade, { once: true });
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

let newsletterTimer = null;
function newsletterPodeAbrir() {
    const ageOverlay = document.getElementById('age-verification-overlay');
    const cartOverlay = document.getElementById('cart-overlay');
    const productModal = document.getElementById('modal-produto-overlay');
    const reviewLightbox = document.getElementById('review-lightbox');

    if (ageOverlay && getComputedStyle(ageOverlay).display !== 'none') return false;
    if (cartOverlay?.classList.contains('active')) return false;
    if (productModal?.classList.contains('active')) return false;
    if (reviewLightbox && getComputedStyle(reviewLightbox).display !== 'none') return false;
    if (document.body.classList.contains('stop-scroll')) return false;
    return true;
}

function agendarNewsletterModal(delay = 15000) {
    if (newsletterTimer || localStorage.getItem('newsletterCadastro') === 'true' || sessionStorage.getItem('newsletterDispensado') === 'true') return;
    newsletterTimer = window.setTimeout(() => {
        newsletterTimer = null;
        const modal = document.getElementById('newsletter-modal');
        if (!modal) return;
        if (!newsletterPodeAbrir()) return agendarNewsletterModal(4000);
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('newsletter-open');
        window.setTimeout(() => document.getElementById('newsletter-email')?.focus(), 300);
    }, delay);
}

function fecharNewsletterModal() {
    const modal = document.getElementById('newsletter-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('newsletter-open');
    sessionStorage.setItem('newsletterDispensado', 'true');
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-newsletter-close]').forEach((el) => el.addEventListener('click', fecharNewsletterModal));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') fecharNewsletterModal(); });
    document.getElementById('newsletter-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const email = document.getElementById('newsletter-email')?.value.trim() || '';
        const feedback = document.getElementById('newsletter-feedback');
        const button = form.querySelector('button[type="submit"]');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { feedback.textContent = 'Digite um e-mail válido.'; return; }
        button.disabled = true; button.textContent = 'Cadastrando…'; feedback.textContent = '';
        try {
            const response = await fetch(`${supabaseUrl}/functions/v1/newsletter-inscricao`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
                body: JSON.stringify({ email, consentimento: true, origem: 'modal-home-15s' })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir o cadastro.');
            if (!data?.ok) throw new Error(data?.error || 'Não foi possível concluir o cadastro.');
            localStorage.setItem('newsletterCadastro', 'true');
            feedback.textContent = 'Pronto! Seu lugar no Clube Tio Nan está garantido. 🥃';
            form.reset();
            window.setTimeout(fecharNewsletterModal, 1800);
        } catch (error) {
            feedback.textContent = error?.message || 'Não foi possível cadastrar agora. Tente novamente.';
            button.disabled = false; button.innerHTML = 'Quero participar <span aria-hidden="true">→</span>';
        }
    });
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

function formatarNomeAvaliacao(nome, fallback = 'Cliente Tio Nan') {
    const partes = String(nome || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!partes.length) return fallback;
    const primeiro = partes[0].charAt(0).toUpperCase() + partes[0].slice(1).toLowerCase();
    if (partes.length === 1) return primeiro;
    return `${primeiro} ${partes[1].charAt(0).toUpperCase()}.`;
}

const supabaseUrl = 'https://eegqobqhrfdkmjyjnqvp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys';
const MERCADO_PAGO_BRICK_ENABLED = true;
const MERCADO_PAGO_PUBLIC_KEY = 'APP_USR-5994a629-0c21-4af7-8cac-b23a67bcdc37';
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
const acessoInternoTioNan = window.TioNanInternalAccess === true || localStorage.getItem('tioNanInternalAccess') === '1';
if (!acessoInternoTioNan) fetchIP();

// --- SISTEMA DE PRESENÇA EM TEMPO REAL ---
let canalPresenca;
if (db && !acessoInternoTioNan) {
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
    if (acessoInternoTioNan) return;
    try {
        const visitorName = localStorage.getItem('visitorName') || 'Anônimo';
        const geo = await getGeoLocation();
        const localBase = geo.cidade + (geo.estado ? ", " + geo.estado : "");
        const infoAparelho = `DISP_${getDeviceInfo()}`;
        const localStr = `${infoAparelho} ${localBase}`;
        const origem = getReferrer();
        const prefixoOrigem = (origem && origem !== "DIRETO") ? `[${origem}] ` : "";

        const evento = acao.includes('Buscou') ? 'search'
            : acao.includes('Adicionou') ? 'add_to_cart'
            : acao.includes('Viu') ? 'product_view'
            : acao.includes('Abriu Checkout') ? 'checkout_start'
            : acao.includes('Abandonou') || acao.includes('Saiu sem') ? 'cart_abandon'
            : acao.includes('Voltou') ? 'cart_return'
            : acao.includes('Pulso') ? 'heartbeat'
            : acao.includes('🔞') ? 'age_confirmed'
            : 'interaction';

        if (window.TioNanAnalytics) {
            await window.TioNanAnalytics.track(evento, {
                label,
                acao,
                cliente_nome: prefixoOrigem + (visitorName === 'Anônimo' ? `${infoAparelho} Anônimo` : visitorName),
                ip: `${infoAparelho} ${userIP}`,
                local: localStr
            });
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
let sacolasLoja = [];
let planoSacolasAtual = [];

function entregaPermiteSacolas() {
    const entrega = document.getElementById('metodo-entrega')?.value || '';
    const cidade = String(document.getElementById('cidade')?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return entrega === 'retirada' || (entrega === 'tele' && cidade === 'porto alegre');
}

function calcularPlanoSacolas(totalGarrafas = quantidadeGarrafasCarrinho()) {
    const simples = sacolasLoja.find(item => Number(item.capacidade_garrafas) === 1);
    const dupla = sacolasLoja.find(item => Number(item.capacidade_garrafas) === 2);
    const qtdDuplas = Math.floor(totalGarrafas / 2);
    const qtdSimples = totalGarrafas % 2;
    if (!totalGarrafas || (qtdDuplas && (!dupla || Number(dupla.estoque || 0) < qtdDuplas)) || (qtdSimples && (!simples || Number(simples.estoque || 0) < qtdSimples))) return [];
    return [
        ...(qtdDuplas ? [{ ...dupla, quantidade:qtdDuplas }] : []),
        ...(qtdSimples ? [{ ...simples, quantidade:qtdSimples }] : [])
    ];
}

function descreverPlanoSacolas(plano = planoSacolasAtual) {
    return plano.map(item => `${item.quantidade} ${Number(item.capacidade_garrafas) === 2 ? (item.quantidade === 1 ? 'sacola dupla' : 'sacolas duplas') : (item.quantidade === 1 ? 'sacola simples' : 'sacolas simples')}`).join(' + ');
}

function atualizarFotoOpcaoSacolas() {
    const visual = document.getElementById('opcao-sacolas-visual');
    if (!visual) return;
    const itens = planoSacolasAtual.flatMap(sacola => {
        const capacidade = Number(sacola.capacidade_garrafas) === 2 ? 2 : 1;
        return Array.from({ length:Number(sacola.quantidade || 0) }, () => capacidade);
    });
    visual.innerHTML = itens.map(capacidade => `
        <span class="opcao-sacolas__item is-photo">
            <img src="${capacidade === 1 ? 'fotos/sacola-simples.jpg?v=1' : 'fotos/sacola-dupla.jpg?v=1'}" alt="">
            <b>${capacidade} ${capacidade === 1 ? 'garrafa' : 'garrafas'}</b>
        </span>
    `).join('');
    visual.classList.toggle('is-combination', itens.length > 1);
}

function atualizarOpcaoSacolas() {
    const bloco = document.getElementById('opcao-sacolas');
    const check = document.getElementById('quero-sacolas');
    const resumo = document.getElementById('opcao-sacolas-resumo');
    const aviso = document.getElementById('opcao-sacolas-aviso');
    if (!bloco || !check || !resumo || !aviso) return;
    const elegivel = entregaPermiteSacolas() && quantidadeGarrafasCarrinho() > 0;
    if (!elegivel) { bloco.hidden = true; check.checked = false; planoSacolasAtual = []; return; }
    planoSacolasAtual = calcularPlanoSacolas();
    const disponivel = planoSacolasAtual.length > 0;
    bloco.hidden = !disponivel;
    check.disabled = !disponivel;
    if (!disponivel) check.checked = false;
    resumo.textContent = disponivel ? `Para este pedido: ${descreverPlanoSacolas()}.` : 'As sacolas adequadas para este pedido estão sem estoque no momento.';
    aviso.textContent = disponivel ? 'Disponível somente para retirada ou entrega própria em Porto Alegre.' : 'Você ainda pode concluir o pedido normalmente, sem sacola.';
    atualizarFotoOpcaoSacolas();
}

function alternarSacolasCliente(ativo) {
    if (ativo && !planoSacolasAtual.length) document.getElementById('quero-sacolas').checked = false;
    atualizarFotoOpcaoSacolas();
}

function sacolasSelecionadasPayload() {
    if (!document.getElementById('quero-sacolas')?.checked || !entregaPermiteSacolas()) return [];
    return planoSacolasAtual.map(item => ({ id:item.id, nome:item.nome, capacidade_garrafas:Number(item.capacidade_garrafas), quantidade:Number(item.quantidade) }));
}

async function carregarSacolasLoja() {
    if (!db) return;
    const { data, error } = await db.from('embalagens').select('id,nome,estoque,capacidade_garrafas,especie').eq('ativo', true).gt('estoque', 0).order('capacidade_garrafas');
    if (!error) sacolasLoja = (data || []).filter(item => String(item.especie || '').toUpperCase() === 'SACOLA');
    atualizarOpcaoSacolas();
}
document.addEventListener('DOMContentLoaded', carregarSacolasLoja);

function entregaPorTransportadora(valor = document.getElementById('metodo-entrega')?.value || '') {
    return String(valor).startsWith('melhor-envio:') || String(valor).startsWith('frenet:');
}

function atualizarPagamentoPorEntrega() {
    const pagamento = document.getElementById('metodo-pagamento');
    if (!pagamento) return;
    const opcaoDinheiro = [...pagamento.options].find(option => option.value === 'Dinheiro');
    const cidade = document.getElementById('cidade')?.value || '';
    const entrega = document.getElementById('metodo-entrega')?.value || '';
    const cidadeNormalizada = cidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
    const dinheiroPermitido = entrega === 'retirada' || cidadeNormalizada === 'porto alegre';
    if (opcaoDinheiro) {
        opcaoDinheiro.hidden = !dinheiroPermitido;
        opcaoDinheiro.disabled = !dinheiroPermitido;
    }
    if (!dinheiroPermitido && pagamento.value === 'Dinheiro') pagamento.value = 'Mercado Pago';
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
    const dominioOficial = /(^|\.)tionan\.com\.br$/i.test(window.location.hostname);
    return dominioOficial
        ? `/produtos/${slugProduto(produto.nome)}`
        : `produto.html?id=${encodeURIComponent(produto.id)}`;
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

function escaparBanner(texto=''){return String(texto).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function linkSeguroBanner(link=''){const valor=String(link).trim();return /^https?:\/\//i.test(valor)||(/^[a-z0-9][a-z0-9._~!$&'()*+,;=@%/?#-]*$/i.test(valor)&&!valor.includes(':'))?valor:'todos-produtos.html'}
function linkVisivelDoBanner(slide) {
    return [...(slide?.querySelectorAll('.hero-link') || [])].find(link => getComputedStyle(link).display !== 'none') || null;
}
function dadosRastreioBanner(link) {
    return {
        id: link?.dataset.bannerId || 'banner-sem-id',
        titulo: link?.dataset.bannerTitle || link?.getAttribute('aria-label') || 'Banner do site',
        destino: link?.getAttribute('href') || '',
        formato: window.matchMedia('(max-width: 639px)').matches ? 'mobile' : 'desktop'
    };
}
function registrarVisualizacaoBanner(slide) {
    const link = linkVisivelDoBanner(slide);
    if (!link || !window.TioNanAnalytics) return;
    const banner = dadosRastreioBanner(link);
    const chave = `tioNanBannerView:${window.TioNanAnalytics.sessionId?.() || 'sessao'}:${banner.id}:${banner.formato}`;
    try { if (sessionStorage.getItem(chave)) return; sessionStorage.setItem(chave, '1'); } catch (_) {}
    window.TioNanAnalytics.track('banner_view', {
        label: `Viu banner: ${banner.titulo}`,
        metadata: { banner_id: banner.id, banner_titulo: banner.titulo, destino: banner.destino, formato: banner.formato }
    });
}
function prepararCliquesBanners(heroSlider) {
    if (heroSlider.dataset.trackingBanner === '1') return;
    heroSlider.dataset.trackingBanner = '1';
    heroSlider.addEventListener('click', async event => {
        const link = event.target.closest('a.hero-link');
        if (!link || event.defaultPrevented || (event.button != null && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const destino = link.href;
        if (!destino || !window.TioNanAnalytics) return;
        event.preventDefault();
        const banner = dadosRastreioBanner(link);
        await Promise.race([
            window.TioNanAnalytics.track('banner_click', {
                label: `Clicou no banner: ${banner.titulo}`,
                metadata: { banner_id: banner.id, banner_titulo: banner.titulo, destino: banner.destino, formato: banner.formato }
            }),
            new Promise(resolve => setTimeout(resolve, 700))
        ]);
        window.location.assign(destino);
    });
}
function iniciarCarrosselBanners() {
    const heroSlider = document.querySelector('.swiper-hero');
    if (!heroSlider) return;
    prepararCliquesBanners(heroSlider);
    const varios = heroSlider.querySelectorAll('.swiper-slide').length > 1;
    heroSlider.querySelectorAll('.swiper-button-next,.swiper-button-prev').forEach(button => button.hidden = !varios);
    if (varios) {
        const heroAnterior = heroSlider.querySelector('.swiper-button-prev');
        const heroProximo = heroSlider.querySelector('.swiper-button-next');
        const swiper = new Swiper(heroSlider, {
            loop: true,
            pagination: { el: heroSlider.querySelector('.hero-pagination'), clickable: true },
            navigation: { prevEl: heroAnterior, nextEl: heroProximo },
            autoplay: { delay: 5000, disableOnInteraction: false },
            on: {
                init(instance) { registrarVisualizacaoBanner(instance.slides[instance.activeIndex]); },
                slideChangeTransitionEnd(instance) { registrarVisualizacaoBanner(instance.slides[instance.activeIndex]); }
            }
        });
        window.heroBannerSwiper = swiper;
    } else {
        registrarVisualizacaoBanner(heroSlider.querySelector('.swiper-slide'));
    }
}

function iniciarCarrosselBeneficios() {
    const element = document.querySelector('.swiper-benefits');
    if (!element || typeof Swiper === 'undefined') return;
    const atualizarDegrades = instance => {
        element.classList.toggle('is-at-start', instance.isBeginning);
        element.classList.toggle('is-at-end', instance.isEnd);
    };
    const carrossel = new Swiper(element, {
        slidesPerView: 1.16,
        spaceBetween: 0,
        loop: false,
        rewind: true,
        speed: 520,
        autoplay: {
            delay: 5000,
            disableOnInteraction: false,
            pauseOnMouseEnter: true
        },
        grabCursor: true,
        watchOverflow: true,
        breakpoints: {
            640: { slidesPerView: 2.16 },
            1000: { slidesPerView: 4, allowTouchMove: false }
        },
        on: {
            init: atualizarDegrades,
            slideChange: atualizarDegrades,
            resize: atualizarDegrades
        }
    });
    window.benefitsSwiper = carrossel;

    element.querySelector('[data-benefit-action="grupo-ofertas"]')?.addEventListener('click', () => {
        if (typeof rastrearAcao === 'function') rastrearAcao('Clique grupo de ofertas', '💬');
    });
    const regras = document.getElementById('regras-primeira-compra');
    let scrollAntesDasRegras = 0;
    const abrirRegrasPrimeiraCompra = () => {
        if (!regras || regras.open) return;
        scrollAntesDasRegras = window.scrollY;
        document.body.style.top = `-${scrollAntesDasRegras}px`;
        document.body.classList.add('first-order-open');
        regras.showModal();
    };
    const fecharRegrasPrimeiraCompra = () => {
        if (!regras?.open) return;
        regras.close();
    };
    const restaurarRolagemAposRegras = () => {
        document.body.classList.remove('first-order-open');
        document.body.style.top = '';
        window.scrollTo(0, scrollAntesDasRegras);
    };
    element.querySelector('[data-benefit-action="primeira-compra"]')?.addEventListener('click', event => {
        event.preventDefault();
        abrirRegrasPrimeiraCompra();
        if (typeof rastrearAcao === 'function') rastrearAcao('Abriu regras da primeira compra', '🏷️');
    });
    regras?.querySelector('[data-first-order-close]')?.addEventListener('click', fecharRegrasPrimeiraCompra);
    regras?.addEventListener('click', event => { if (event.target === regras) fecharRegrasPrimeiraCompra(); });
    regras?.addEventListener('close', restaurarRolagemAposRegras);
    regras?.querySelector('[data-first-order-shop]')?.addEventListener('click', () => {
        fecharRegrasPrimeiraCompra();
        requestAnimationFrame(() => document.getElementById('vitrine')?.scrollIntoView({ behavior:'smooth', block:'start' }));
    });
}
async function carregarBannersSite() {
    const lista = document.getElementById('hero-banners');
    const hero = document.querySelector('.swiper-hero');
    if (!lista) {
        iniciarCarrosselBanners();
        hero?.classList.remove('is-loading');
        return;
    }
    try {
        const { data, error } = await db.from('banners_site')
            .select('id,titulo,imagem_desktop_url,imagem_mobile_url,link_url,texto_alternativo,ordem')
            .eq('ativo', true)
            .order('ordem', { ascending: true })
            .order('criado_em', { ascending: true });
        if (error) throw error;
        const celular = window.matchMedia('(max-width: 639px)').matches;
        const banners = (data || []).filter(banner => celular ? banner.imagem_mobile_url : banner.imagem_desktop_url);
        if (banners.length) {
            lista.innerHTML = banners.map((banner, index) => {
                const imagem = celular ? banner.imagem_mobile_url : banner.imagem_desktop_url;
                return `<div class="swiper-slide"><a class="hero-link" href="${escaparBanner(linkSeguroBanner(banner.link_url))}" aria-label="${escaparBanner(banner.titulo)}" data-banner-id="${escaparBanner(banner.id)}" data-banner-title="${escaparBanner(banner.titulo)}"><img src="${escaparBanner(imagem)}" alt="${escaparBanner(banner.texto_alternativo || banner.titulo)}" loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${index === 0 ? 'high' : 'low'}"></a></div>`;
            }).join('');
        }
        const primeiraImagem = lista.querySelector('img');
        if (primeiraImagem && !primeiraImagem.complete) {
            await Promise.race([
                new Promise(resolve => {
                    primeiraImagem.addEventListener('load', resolve, { once: true });
                    primeiraImagem.addEventListener('error', resolve, { once: true });
                }),
                new Promise(resolve => window.setTimeout(resolve, 4000))
            ]);
        }
    } catch (error) {
        console.warn('Banners dinâmicos indisponíveis; mantendo banner padrão.', error?.message || error);
    }
    iniciarCarrosselBanners();
    hero?.classList.remove('is-loading');
}
window.tioNanBannersReady = carregarBannersSite();
iniciarCarrosselBeneficios();

let cart = JSON.parse(sessionStorage.getItem('tioNanCart') || '[]');

const CARRINHO_RECUPERACAO_STORAGE = 'tioNanCarrinhoRecuperacaoToken';
let carrinhoRecuperacaoTimer = null;

function tokenRecuperacaoCarrinho(criar = true) {
    let token = localStorage.getItem(CARRINHO_RECUPERACAO_STORAGE) || '';
    if (!token && criar && window.crypto?.randomUUID) {
        token = window.crypto.randomUUID();
        localStorage.setItem(CARRINHO_RECUPERACAO_STORAGE, token);
    }
    return token;
}

async function salvarCarrinhoParaRecuperacao() {
    if (acessoInternoTioNan) return;
    const email = document.getElementById('cliente-email')?.value?.trim().toLowerCase() || '';
    const nome = document.getElementById('cliente-nome')?.value?.trim() || '';
    const consentimento = Boolean(document.getElementById('marketing-consentimento')?.checked);
    if (!db || !cart.length || !consentimento || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const token = tokenRecuperacaoCarrinho();
    if (!token) return;
    const { error } = await db.functions.invoke('carrinho-abandonado', {
        body: {
            action: 'salvar', token, email, nome, consentimento: true,
            itens: cart.map(item => ({ id: item.id, quantidade: item.qtd }))
        }
    });
    if (error) console.warn('Não foi possível guardar a sacola para recuperação:', error.message);
}

function agendarSalvamentoCarrinho() {
    clearTimeout(carrinhoRecuperacaoTimer);
    if (acessoInternoTioNan) return;
    if (!cart.length) {
        cancelarRecuperacaoCarrinho();
        return;
    }
    carrinhoRecuperacaoTimer = window.setTimeout(salvarCarrinhoParaRecuperacao, 900);
}

async function cancelarRecuperacaoCarrinho(removerToken = true) {
    clearTimeout(carrinhoRecuperacaoTimer);
    const token = tokenRecuperacaoCarrinho(false);
    if (removerToken) localStorage.removeItem(CARRINHO_RECUPERACAO_STORAGE);
    if (acessoInternoTioNan) return;
    if (!db || !token) return;
    try { await db.functions.invoke('carrinho-abandonado', { body: { action: 'cancelar', token } }); } catch (_) {}
}

async function recuperarCarrinhoDoEmail() {
    const token = urlParams.get('recuperar_carrinho');
    if (!db || !token) return;
    const { data, error } = await db.functions.invoke('carrinho-abandonado', { body: { action: 'recuperar', token } });
    if (error || !data?.itens?.length) {
        console.warn('Não foi possível recuperar a sacola:', error?.message || data?.error);
        return;
    }
    cart = data.itens;
    localStorage.setItem(CARRINHO_RECUPERACAO_STORAGE, token);
    sessionStorage.setItem('tioNanCart', JSON.stringify(cart));
    const emailInput = document.getElementById('cliente-email');
    const nomeInput = document.getElementById('cliente-nome');
    const consentInput = document.getElementById('marketing-consentimento');
    if (emailInput) emailInput.value = data.email || '';
    if (nomeInput && data.nome) nomeInput.value = data.nome;
    if (consentInput) consentInput.checked = true;
    updateCart();
    sincronizarBadge();
    openCart();
    history.replaceState(history.state, '', `${location.pathname}?carrinho=1#sacola`);
}

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
    if (!sessionStorage.getItem('tioNanCheckoutStartTracked')) {
        sessionStorage.setItem('tioNanCheckoutStartTracked', '1');
        const items = cart.map(item => ({
            id: String(item.id),
            item_id: String(item.id),
            name: item.displayName || item.name,
            item_name: item.displayName || item.name,
            price: Number(item.price || 0),
            quantity: Number(item.qtd || 1)
        }));
        const value = cart.reduce((total, item) => total + Number(item.price || 0) * Number(item.qtd || 1), 0);
        rastrearAcao('Checkout', '💳 Abriu Checkout');
        window.TioNanPixel?.initiateCheckout({ items, value });
        window.gtag?.('event', 'begin_checkout', { currency:'BRL', value, items });
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

    const metaCheckout = dadosCarrinhoMeta();
    window.TioNanPixel?.initiateCheckout(metaCheckout);
    mostrarEtapaCheckout('pagamento');
    atualizarPagamentoPorEntrega();
    handlePagamentoChange();
}

function dadosCarrinhoMeta() {
    const subtotal = cart.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.qtd || 0)), 0);
    const entrega = document.getElementById('metodo-entrega')?.value;
    const frete = entrega === 'tele' || entregaPorTransportadora(entrega) ? valorFreteAtual() : 0;
    return {
        items: cart.map(item => ({ id:item.id, quantity:item.qtd, item_price:item.price })),
        value: Math.max(0, subtotal - valorDescontoCarrinho(subtotal) + frete)
    };
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
    await verificarBeneficioPrimeiraCompra(cpf);
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
                const cotacoes = (Array.isArray(cotacao?.cotacoes) ? cotacao.cotacoes : [])
                    .filter(frete => normalizarNomeSabor(frete?.transportadora).includes('jadlog'));
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
    "Café": "O encontro perfeito entre o corpo robusto da cachaça Tio Nan e o aroma intenso do café torrado. Apresenta notas de chocolate amargo e um final persistente, ideal para paladares que buscam sofisticação em cada dose.",
    "Butiá": "Uma explosão de tropicalidade gaúcha. O sabor exótico e levemente ácido do butiá harmoniza perfeitamente com a doçura da cana, revelando aromas silvestres e uma refrescância incomparável.",
    "Morango com Pimenta": "A sedutora dança entre a doçura vibrante e o fogo sutil. O frescor suculento do morango maduro envolve a boca de imediato, preparando o terreno para a picância instigante da pimenta dedo-de-moça. É uma bebida de contrastes marcantes: começa doce e encerra com um toque levemente ardente que convida ao próximo gole.",
    "Jabuticaba": "O \"ouro negro\" brasileiro em forma de elixir. A jabuticaba traz uma adstringência elegante e uma doçura natural que encontra a suavidade da cachaça, evocando tradição e frescor.",
    "Morango": "Frescor frutado e doçura equilibrada. O sabor puro do morango silvestre se funde à cachaça Tio Nan, resultando em uma bebida leve, aromática e extremamente agradável para qualquer ocasião."
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
        "butiá": { f1: "fotos/butia.webp", f2: "fotos/butia-2.webp" },
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
    if (blingId === '16712113631' || blingId === '16712114193') return 'fotos/produto-em-breve.svg';
    if (blingId === '16699719562') return isFoto2 ? 'fotos/gengibre-2.webp' : 'fotos/gengibre-guaco-mel.webp?v=5';
    if (blingId === '16699660347') return 'fotos/cachaca-ouro.webp?v=2';
    if (blingId === '16687078597') return 'fotos/produto-em-breve.svg';
    return getLocalPhoto(produto?.nome || '', fixDrive(isFoto2 ? produto?.foto_2 : produto?.foto_1), isFoto2);
}

// O cadastro administrativo/Bling é a fonte oficial para a apresentação dos
// produtos. As variações de embalagem possuem IDs próprios para que pedido,
// estoque e documento fiscal permaneçam vinculados ao item correto.
function nomeProdutoOficial(produto) {
    return String(produto?.nome || '');
}

function apresentacaoCardProduto(produto) {
    const blingId = String(produto?.bling_id || '');
    const nome = nomeProdutoOficial(produto);
    if (blingId === '16699719562') return { titulo: 'Gengibre, Guaco e Mel', subtitulo: 'Bebida alcoólica mista · 700 ml' };
    if (blingId === '16699660347') return { titulo: 'Cachaça Ouro', subtitulo: 'Envelhecida em carvalho por 2 anos · Premium · 700 ml' };
    if (blingId === '16687078597') return { titulo: 'Cachaça Prata', subtitulo: 'Tradicional · 700 ml' };
    if (blingId === '16712113631') return { titulo: 'Cachaça Ouro', subtitulo: 'Garrafa quadrada · 750 ml · Premium' };
    if (blingId === '16712114193') return { titulo: 'Cachaça Prata', subtitulo: 'Garrafa quadrada · 750 ml · Tradicional' };
    if (produto?.tipo_produto === 'kit') {
        const titulo = nome.replace(/\s+TIO\s+NAN\s*$/i, '').replace(/\s+700\s*ML\s*/ig, ' ').replace(/\s{2,}/g, ' ').trim();
        const unidades = Math.max(1, Number(produto?.unidades_por_kit || 1));
        return { titulo, subtitulo: `${unidades} ${unidades === 1 ? 'garrafa' : 'garrafas'} de 700 ml` };
    }
    return { titulo: nome, subtitulo: '' };
}

function nomeProdutoExibicaoCarrinho(nome = '') {
    const original = String(nome || '').trim();
    const normalizado = normalizarNomeSabor(original);
    if (normalizado.includes('gengibre') && normalizado.includes('guaco') && normalizado.includes('mel')) return 'Gengibre, Guaco e Mel';
    if (normalizado.includes('kit') && normalizado.includes('prata') && normalizado.includes('6')) return 'Kit Cachaça Prata - 6 garrafas';
    if (normalizado.includes('ouro')) return 'Cachaça Ouro';
    if (normalizado.includes('prata')) return 'Cachaça Prata';
    return original;
}

function subtituloProdutoExibicaoCarrinho(nome = '', unidadesPorKit = 1) {
    const normalizado = normalizarNomeSabor(nome);
    const unidades = Math.max(1, Number(unidadesPorKit || 1));
    if (normalizado.includes('kit')) return `${unidades} ${unidades === 1 ? 'garrafa' : 'garrafas'} de 700 ml`;
    if (normalizado.includes('gengibre') && normalizado.includes('guaco') && normalizado.includes('mel')) return 'Bebida alcoólica mista · 700 ml';
    const volume = normalizado.includes('750') ? '750 ml' : '700 ml';
    if (normalizado.includes('ouro')) return `Premium · ${volume}`;
    if (normalizado.includes('prata')) return `Tradicional · ${volume}`;
    return volume;
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
        const ordemProdutosBling = ['16699719562', '16699660347', '16712113631', '16687078597', '16712114193'];
        const prioridadeProduto = new Map(ordemProdutosBling.map((id, indice) => [id, indice]));
        const produtosExibidos = (produtos || [])
            .filter(produto => ordemProdutosBling.includes(String(produto.bling_id || '')) || (produto.tipo_produto === 'kit' && produto.visivel === true))
            .sort((a, b) => {
                const prioridadeA = prioridadeProduto.get(String(a.bling_id || '')) ?? ordemProdutosBling.length;
                const prioridadeB = prioridadeProduto.get(String(b.bling_id || '')) ?? ordemProdutosBling.length;
                return prioridadeA - prioridadeB || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
            });

        let htmlDisp = ''; let htmlEsg = '';

        produtosExibidos.forEach((p, productIndex) => {
            const id = p.id;
            const nome = nomeProdutoOficial(p);
            const apresentacao = apresentacaoCardProduto(p);

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
                : (p.lancado === false ? 'fotos/produto-em-breve.svg' : '');
            let foto1 = fotoProdutoOficial({ ...p, foto_1: foto1Raw }, false);

            const temFoto2 = (p.foto_2 && p.foto_2.trim().length > 5);
            let foto2 = temFoto2 ? fixDrive(p.foto_2.trim()) : foto1;
            const usaPlaceholder = foto1.includes('produto-em-breve.svg');
            const carregamentoPrincipal = productIndex < 2 ? 'eager' : 'lazy';
            const prioridadePrincipal = productIndex < 2 ? 'high' : 'low';

            const precoNum = parseFloat(p.preco);
            const precoOriginalNum = parseFloat(p.preco_original || 0);
            const temDesconto = precoOriginalNum > precoNum;
            const estoque = parseInt(p.estoque) || 0;
            const temEstoque = estoque > 0;
            const emBreve = p.lancado === false;
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

            const acaoDetalhes = (p.localOnly && normalizarNomeProduto(nome) !== 'ouro') ? '' : `onclick="window.location.href='${produtoUrl}'" style="cursor:pointer;"`;
            const percentualDesconto = temDesconto ? Math.round((1 - precoNum / precoOriginalNum) * 100) : 0;
            const precoExibido = emBreve ? 'Em breve' : temDesconto
                ? `<small class="preco-original">Preço normal: R$ ${precoOriginalNum.toFixed(2).replace('.', ',')}</small><span class="preco-promocional">R$ ${precoNum.toFixed(2).replace('.', ',')}</span><em class="desconto-produto">Economize ${percentualDesconto}%</em>`
                : `R$ ${precoNum.toFixed(2).replace('.', ',')}`;

            const card = `
                <div class="card-produto ${temEstoque ? '' : 'esgotado-card'} ${emBreve ? 'em-breve-card' : ''} ${usaPlaceholder ? 'produto-placeholder' : ''} ${temDesconto && !emBreve ? 'oferta-card' : ''}" id="card-${id}">
                    ${emBreve ? '<div class="faixa-esgotado-clean">Em breve</div>' : (temEstoque ? '' : '<div class="faixa-esgotado-clean">Volta Logo!</div>')}
                    ${temDesconto && !emBreve ? `<div class="faixa-oferta-clean">Oferta · ${percentualDesconto}% OFF</div>` : ''}
                    <div class="img-wrapper" ${acaoDetalhes}>
                        <div class="desktop-only-images">
                            <img src="${foto1}" class="foto-1 prod-img" loading="${carregamentoPrincipal}" decoding="async" fetchpriority="${prioridadePrincipal}">
                            <img src="${foto2}" class="foto-2" loading="lazy" decoding="async" fetchpriority="low">
                        </div>
                        ${temFoto2 ? `<div class="swiper swiper-produto">
                            <div class="swiper-wrapper">
                                <div class="swiper-slide"><img src="${foto1}" class="prod-img" loading="${carregamentoPrincipal}" decoding="async" fetchpriority="${prioridadePrincipal}" onerror="this.onerror=null;this.src='fotos/produto-em-breve.svg'"></div>
                                <div class="swiper-slide"><img src="${foto2}" class="prod-img" loading="lazy" decoding="async" fetchpriority="low" onerror="this.onerror=null;this.src='${foto1}'"></div>
                            </div>
                            <div class="swiper-pagination"></div>
                        </div>` : `<div class="swiper-produto swiper-produto-estatico"><img src="${foto1}" class="prod-img" loading="${carregamentoPrincipal}" decoding="async" fetchpriority="${prioridadePrincipal}" onerror="this.onerror=null;this.src='fotos/produto-em-breve.svg'"></div>`}
                    </div>
                    <div ${acaoDetalhes}>
                        <h3 class="prod-nome">${apresentacao.titulo}</h3>
                        ${apresentacao.subtitulo ? `<p class="prod-subtitulo">${apresentacao.subtitulo}</p>` : ''}
                        ${estrelasVitrineHtml}
                        <span class="preco">${precoExibido}</span>
                    </div>
                    ${emBreve ? '<button class="btn-adicionar" disabled>Em breve</button>' : (temEstoque ? `<button class="btn-adicionar" onclick="add('${id}','${nome}',${precoNum}, ${custoNum}, event, ${Number(p.unidades_por_kit || 1)})">Comprar</button>` : `<button class="btn-adicionar" disabled>Volta logo!</button>`)}
                </div>`;

            const slide = `<div class="swiper-slide">${card}</div>`;
            if (temEstoque) htmlDisp += slide; else htmlEsg += slide;
        });
        document.getElementById('vitrine').innerHTML = htmlDisp + htmlEsg;

        if (window.productsSwiper) window.productsSwiper.destroy(true, true);
        const productsElement = document.querySelector('.swiper-products');
        const productsAnterior = productsElement.querySelector('.products-prev');
        const productsProximo = productsElement.querySelector('.products-next');
        window.productsSwiper = new Swiper(productsElement, {
            slidesPerView: 1.42,
            spaceBetween: 8,
            centeredSlides: false,
            pagination: { el: productsElement.querySelector('.products-pagination'), clickable: true },
            navigation: { prevEl: productsAnterior, nextEl: productsProximo },
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


        if (window.matchMedia('(min-width: 640px)').matches) {
            const highlightObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                        document.querySelectorAll('.card-produto.active-scroll').forEach(el => {
                            if (el !== entry.target) el.classList.remove('active-scroll');
                        });
                        entry.target.classList.add('active-scroll');
                    } else if (!entry.isIntersecting || entry.intersectionRatio < 0.2) {
                        entry.target.classList.remove('active-scroll');
                    }
                });
            }, {
                threshold: [0.2, 0.5, 0.8],
                rootMargin: '-25% 0px -25% 0px'
            });

            document.querySelectorAll('.card-produto').forEach(card => highlightObserver.observe(card));
        }

    } catch (error) {
        console.error("Erro ao carregar produtos:", error);
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

function add(id, name, price, cost, event, unidadesPorKit = 1, displayName = '') {
    try { fecharToastProvaSocial(); } catch (e) {}
    if (event) { createParticles(event.clientX, event.clientY); event.stopPropagation(); }
    const card = document.getElementById(`card-${id}`);
    const nomeVisual = displayName || card?.querySelector('.prod-nome')?.textContent?.trim() || nomeProdutoExibicaoCarrinho(name);
    const subtituloVisual = card?.querySelector('.prod-subtitulo')?.textContent?.trim() || subtituloProdutoExibicaoCarrinho(name, unidadesPorKit);
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
        item.displayName = nomeVisual;
        item.displaySubtitle = subtituloVisual;
        item.unidadesPorKit = Math.max(1, Number(unidadesPorKit || item.unidadesPorKit || 1));
        if (fotoUrl) item.foto = fotoUrl;
    } else {
        cart.push({ id, name, displayName:nomeVisual, displaySubtitle:subtituloVisual, price, cost: cost, qtd: 1, foto: fotoUrl, unidadesPorKit: Math.max(1, Number(unidadesPorKit || 1)) });
    }
    updateCart();
    agendarVerificacaoPrimeiraCompra();
    if (typeof isCartOpen !== 'undefined' && isCartOpen) agendarAtualizacaoAutomaticaFrete();
    const abrirCarrinhoAposAdicionar = () => {
        if (window.matchMedia('(min-width: 900px)').matches) {
            mostrarPreviewCarrinho(nomeVisual, fotoUrl);
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
    window.TioNanPixel?.addToCart({ id, name, value:price }, 1);
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
    window.TioNanPixel?.viewContent({ id:p.id, name:p.nome, value:Number(p.precoNum || p.preco || 0), category:p.categoria });

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

    document.getElementById('modal-desc').innerText = p.descricao || 'Uma cachaça Tio Nan feita para transformar bons encontros em brindes especiais.';

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
            const nomeExibicao = formatarNomeAvaliacao(a.cliente_nome, 'Anônimo');
            
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
let primeiraCompraElegivel = false;
let descontoPrimeiraCompra = 0;
let verificacaoPrimeiraCompraTimer = null;

function valorDescontoCarrinho(subtotal) {
    if (cupomDescontoAtivo && descontoPercentual > 0) return subtotal * descontoPercentual;
    return Math.min(subtotal, Math.max(0, Number(descontoPrimeiraCompra || 0)));
}

function mostrarStatusPrimeiraCompra(tipo, mensagem) {
    const status = document.getElementById('primeira-compra-status');
    if (!status) return;
    status.className = `first-order-status${tipo ? ` is-${tipo}` : ''}`;
    status.textContent = mensagem || '';
}

async function verificarBeneficioPrimeiraCompra(cpfInformado, silencioso = false) {
    const cpf = String(cpfInformado || document.getElementById('cliente-cpf')?.value || '').replace(/\D/g, '');
    if (!cpfValido(cpf) || !cart.length) {
        primeiraCompraElegivel = false;
        descontoPrimeiraCompra = 0;
        if (!silencioso && cpf.length === 11) mostrarStatusPrimeiraCompra('returning', 'Não foi possível validar o benefício com este CPF.');
        return false;
    }
    if (!silencioso) mostrarStatusPrimeiraCompra('loading', 'Verificando seu benefício de primeira compra…');
    try {
        const { data, error } = await db.functions.invoke('verificar-primeira-compra', {
            body: { cpf, email:document.getElementById('cliente-email')?.value?.trim().toLowerCase() || '', itens: cart.map(item => ({ id:item.id, nome:item.name, quantidade:item.qtd })) }
        });
        if (error) throw error;
        primeiraCompraElegivel = data?.elegivel === true;
        descontoPrimeiraCompra = primeiraCompraElegivel ? Number(data?.desconto || 0) : 0;
        if (primeiraCompraElegivel && descontoPrimeiraCompra > 0) {
            const texto = descontoPrimeiraCompra.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
            mostrarStatusPrimeiraCompra('eligible', cupomDescontoAtivo
                ? `Você tem ${texto} de benefício, mas o cupom aplicado será usado no lugar dele.`
                : `✓ Benefício de primeira compra aplicado: −${texto}`);
        } else if (primeiraCompraElegivel) {
            mostrarStatusPrimeiraCompra('empty', 'Seu benefício está disponível, mas este carrinho possui apenas kits ou produtos que já estão em oferta.');
        } else {
            mostrarStatusPrimeiraCompra('returning', 'Este CPF já possui uma compra aprovada.');
        }
        updateCart();
        return primeiraCompraElegivel;
    } catch (error) {
        console.warn('Não foi possível verificar o benefício de primeira compra.', error);
        primeiraCompraElegivel = false;
        descontoPrimeiraCompra = 0;
        if (!silencioso) mostrarStatusPrimeiraCompra('returning', 'Não foi possível verificar o benefício agora. Tente novamente.');
        return false;
    }
}

function agendarVerificacaoPrimeiraCompra() {
    clearTimeout(verificacaoPrimeiraCompraTimer);
    const cpf = document.getElementById('cliente-cpf')?.value?.replace(/\D/g, '') || '';
    if (!cpfValido(cpf) || !document.getElementById('checkout-details')?.offsetParent) return;
    verificacaoPrimeiraCompraTimer = window.setTimeout(() => verificarBeneficioPrimeiraCompra(cpf, true), 450);
}

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
    if (primeiraCompraElegivel && descontoPrimeiraCompra > 0) {
        const texto = descontoPrimeiraCompra.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
        mostrarStatusPrimeiraCompra('eligible', cupomDescontoAtivo
            ? `Você tem ${texto} de benefício, mas o cupom aplicado será usado no lugar dele.`
            : `✓ Benefício de primeira compra aplicado: −${texto}`);
    }
    updateCart();
}

function updateCart() {
    sessionStorage.setItem('tioNanCart', JSON.stringify(cart));
    agendarSalvamentoCarrinho();
    const itemsCont = document.getElementById('cart-items');
    const totalGarrafas = quantidadeGarrafasCarrinho();
    const barra = document.getElementById('barra-frete');
    const textoFrete = document.getElementById('texto-frete');
    const entrega = document.getElementById('metodo-entrega').value;
    atualizarOpcaoSacolas();

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
                        <div style="font-weight:800; font-size:1rem; color:var(--blue-navy); margin-bottom:3px;">${i.displayName || nomeProdutoExibicaoCarrinho(i.name)}</div>
                        <div style="color:#738096; font-size:0.76rem; font-weight:600; margin-bottom:5px;">${i.displaySubtitle || subtituloProdutoExibicaoCarrinho(i.name, i.unidadesPorKit)}</div>
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
    let valorDesconto = valorDescontoCarrinho(subtotal);
    let total = subtotal - valorDesconto;
    
    let freteInclusoText = "";
    const isVip = urlParams.get('v') === '1';
    if (entrega === 'tele' || entregaPorTransportadora(entrega)) {
        total += valorFreteAtual();
        freteInclusoText = " (frete incluso)";
    }
    
    const totalDisplay = document.getElementById('cart-total-display');
    if (totalDisplay) {
        if (valorDesconto > 0) {
            const rotuloDesconto = cupomDescontoAtivo
                ? `Cupom ${cupomDescontoAtivo}`
                : 'Primeira compra';
            totalDisplay.innerHTML = `
                <div style="font-size: 0.9rem; font-weight: normal; color: #888; text-decoration: line-through; margin-bottom: 2px;">Subtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}</div>
                <div style="font-size: 0.95rem; font-weight: bold; color: #25d366; margin-bottom: 5px;">${rotuloDesconto}: -R$ ${valorDesconto.toFixed(2).replace('.', ',')}</div>
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
    if (btnTexto) btnTexto.textContent = pag === 'Dinheiro' ? 'Finalizar pedido' : 'Ir para pagamento seguro';
    if (pag && pag !== 'none') {
        const metaCheckout = dadosCarrinhoMeta();
        window.TioNanPixel?.addPaymentInfo({ ...metaCheckout, method:pag });
    }
    if (pag === 'Dinheiro') {
        const paymentBrick = document.getElementById('paymentBrick_container');
        const statusBrick = document.getElementById('statusScreenBrick_container');
        if (paymentBrick) paymentBrick.style.display = 'none';
        if (statusBrick) statusBrick.style.display = 'none';
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
        agendarVerificacaoPrimeiraCompra();
        sincronizarBadge();
        agendarAtualizacaoAutomaticaFrete();
    }
}


function esvaziarSacola(event) {
    if (event) event.stopPropagation();
    if (cart.length === 0) return;
    if (!confirm("Deseja realmente esvaziar todo o seu carrinho? 🛒")) return;
    cart = [];
    primeiraCompraElegivel = false;
    descontoPrimeiraCompra = 0;
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
    const container = document.getElementById('paymentBrick_container');
    if (button) button.style.display = 'none';
    container.style.display = 'block';

    if (paymentBrickController) await paymentBrickController.unmount();
    if (statusScreenBrickController) {
        await statusScreenBrickController.unmount();
        statusScreenBrickController = null;
    }
    const mercadoPago = new window.MercadoPago(MERCADO_PAGO_PUBLIC_KEY, { locale: 'pt-BR' });
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
                        body: { ...orderPayload, payment: formData }
                    });
                    if (error) {
                        let message = error.message || 'Falha ao processar o pagamento.';
                        try {
                            const body = await error.context?.json?.();
                            message = [body?.error, body?.detail].filter(Boolean).join(' — ') || message;
                        } catch (_) {}
                        throw new Error(message);
                    }
                    if (!data?.payment_id) throw new Error(data?.error || 'O Mercado Pago não retornou o pagamento.');
                    salvarClienteRecenteCheckout(orderPayload.cpf, orderPayload.email, orderPayload.nome, orderPayload.telefone, orderPayload.endereco || {});
                    sessionStorage.setItem('tioNanPedidoPendente', data.pedido || '');
                    const totalConfirmado = Number(data.total ?? amount);
                    sessionStorage.setItem('tioNanMetaPedidoPendente', JSON.stringify({ reference:data.pedido, trackingToken:data.tracking_token, value:totalConfirmado, items:dadosCarrinhoMeta().items }));
                    if (data.status === 'approved' && !data.sandbox) {
                        window.TioNanPixel?.purchase({ reference:data.pedido, value:totalConfirmado, items:dadosCarrinhoMeta().items });
                        window.location.assign(`pedido.html?novo=1&token=${encodeURIComponent(data.tracking_token)}`);
                        return;
                    }
                    await renderizarStatusMercadoPago(data.payment_id);
                } catch (error) {
                    console.error('Erro no pagamento incorporado:', error);
                    alert(`Não foi possível processar o pagamento.\n\n${error?.message || 'Tente novamente.'}`);
                    throw error;
                }
            }
        }
    });
}

async function checkout() {
    try {
        if (acessoInternoTioNan) {
            alert('Modo de teste ativo: o checkout pode ser conferido, mas nenhum pedido ou pagamento será criado e nenhuma ação será enviada ao painel.');
            return;
        }
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
        const cidadePagamento = (document.getElementById('cidade')?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (pag === 'Dinheiro' && entrega !== 'retirada' && cidadePagamento !== 'porto alegre') {
            atualizarPagamentoPorEntrega();
            alert('O pagamento em dinheiro está disponível somente para entregas em Porto Alegre. Escolha Pix ou cartão pelo Mercado Pago.');
            return;
        }
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
        await verificarBeneficioPrimeiraCompra(cpf, true);
        let valorDesconto = valorDescontoCarrinho(subtotal);
        let valorTotalComFrete = subtotal - valorDesconto + valorFrete;

        const itensMsg = cart.map(i => `${i.name} (x${i.qtd})`).join(', ');
        const totalMsg = `R$ ${valorTotalComFrete.toFixed(2).replace('.', ',')}${valorFrete > 0 ? ' (frete incluso)' : ''}`;

        let beneficioMsg = "";
        
        let cupomMsg = "";
        if (cupomDescontoAtivo) {
            cupomMsg = `\n🏷️ Cupom: *${cupomDescontoAtivo}* (Desconto: -R$ ${valorDesconto.toFixed(2).replace('.', ',')})`;
        }

        if (pag === "Mercado Pago" && MERCADO_PAGO_BRICK_ENABLED) {
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
                    carrinho_recuperacao_token: tokenRecuperacaoCarrinho(false) || null,
                    entrega,
                    frete: freteMelhorEnvioSelecionado,
                    endereco: enderecoPayload,
                    cupom: cupomDescontoAtivo,
                    sacolas: sacolasSelecionadasPayload(),
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
                    marketing_consentimento: marketingConsentimento,
                    carrinho_recuperacao_token: tokenRecuperacaoCarrinho(false) || null,
                    entrega,
                    frete: freteMelhorEnvioSelecionado,
                    endereco: enderecoPayload,
                    cupom: cupomDescontoAtivo,
                    sacolas: sacolasSelecionadasPayload(),
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
                const totalConfirmado = Number(data.total ?? valorTotalComFrete);
                sessionStorage.setItem('tioNanMetaPedidoPendente', JSON.stringify({ reference:data.pedido, trackingToken:data.tracking_token, value:totalConfirmado, items:dadosCarrinhoMeta().items }));
                await window.TioNanAnalytics?.track('order_created', { label:data.pedido || 'Pedido Mercado Pago', valor:totalConfirmado, metadata:{ pagamento:'Mercado Pago', primeira_compra:data.primeira_compra === true } });
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
            cpf, email, nome, telefone, marketing_consentimento: marketingConsentimento, carrinho_recuperacao_token: tokenRecuperacaoCarrinho(false) || null, entrega, endereco: enderecoPayload, frete: freteMelhorEnvioSelecionado,
            cupom: cupomDescontoAtivo,
            sacolas: sacolasSelecionadasPayload(),
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
        await window.TioNanAnalytics?.track('order_created', { label:data.pedido || 'Pedido criado', valor:Number(data.total ?? valorTotalComFrete), metadata:{ pagamento:pag, primeira_compra:data.primeira_compra === true } });
        cancelarRecuperacaoCarrinho();
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
async function registrarCompraAprovadaRetorno() {
    try {
        const metaPedido = JSON.parse(sessionStorage.getItem('tioNanMetaPedidoPendente') || 'null');
        const reference = new URLSearchParams(window.location.search).get('pedido') || metaPedido?.reference;
        if (!metaPedido?.trackingToken || reference !== metaPedido.reference) return;
        const { data, error } = await db.functions.invoke('acompanhar-pedido', { body:{ token:metaPedido.trackingToken } });
        if (!error && data?.pedido?.status_pagamento === 'pago') {
            window.TioNanPixel?.purchase({ ...metaPedido, reference });
            window.TioNanGoogleAds?.purchase({
                reference
            });
            sessionStorage.removeItem('tioNanMetaPedidoPendente');
        }
    } catch (_) {}
}
if (paymentReturn === 'sucesso') {
    registrarCompraAprovadaRetorno();
    cancelarRecuperacaoCarrinho();
    cart = [];
    sessionStorage.removeItem('tioNanCart');
    sessionStorage.removeItem('tioNanPedidoPendente');
    setTimeout(() => alert('Pagamento aprovado! Seu pedido Tio Nan foi recebido.'), 250);
} else if (paymentReturn === 'pendente') {
    setTimeout(() => alert('Pagamento em processamento. Avisaremos assim que houver confirmação.'), 250);
} else if (paymentReturn === 'falha') {
    setTimeout(() => alert('O pagamento não foi concluído. Seu carrinho continua salvo para tentar novamente.'), 250);
}

loadProducts(); updateCart(); sincronizarBadge(); updateWelcome(); carregarGoogleReviews(); carregarTestimonialsHome();

async function carregarGoogleReviews() {
    const section = document.getElementById('google-reviews');
    const list = document.getElementById('google-reviews-list');
    if (!section || !list) return;
    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/google-avaliacoes`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.configured || !Number(data.rating) || !Array.isArray(data.reviews) || !data.reviews.length) return;
        const rating = Math.max(0, Math.min(5, Number(data.rating)));
        const total = Math.max(0, Number(data.total) || 0);
        section.querySelector('[data-google-rating]').textContent = rating.toFixed(1).replace('.', ',');
        section.querySelector('[data-google-stars]').textContent = '★★★★★';
        section.querySelector('[data-google-count]').textContent = `${total} ${total === 1 ? 'avaliação' : 'avaliações'}`;
        const all = section.querySelector('[data-google-reviews-all]');
        const write = section.querySelector('[data-google-reviews-write]');
        if (all) all.href = data.googleMapsUrl;
        if (write) write.href = data.writeReviewUrl;
        list.innerHTML = data.reviews.map(review => {
            const score = Math.max(0, Math.min(5, Math.round(Number(review.rating) || 0)));
            const author = escaparBanner(review.author || 'Cliente Google');
            const text = escaparBanner(review.text || 'Avaliou a Tio Nan no Google.');
            const published = escaparBanner(review.published || '');
            const authorUrl = escaparBanner(review.authorUrl || data.googleMapsUrl);
            const reviewUrl = escaparBanner(review.reviewUrl || data.googleMapsUrl);
            const photo = review.photoUrl ? `<img src="${escaparBanner(review.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span aria-hidden="true">${author.charAt(0)}</span>`;
            return `<article class="swiper-slide google-review-card">
                <header><a class="google-review-card__author" href="${authorUrl}" target="_blank" rel="noopener">${photo}<span><strong>${author}</strong><small>${published}</small></span></a><b aria-label="Avaliação: ${score} de 5 estrelas">${'★'.repeat(score)}${'☆'.repeat(5-score)}</b></header>
                <p>${text}</p>
                <a class="google-review-card__source" href="${reviewUrl}" target="_blank" rel="noopener">Ver avaliação no Google</a>
            </article>`;
        }).join('');
        section.hidden = false;
        new Swiper('.swiper-google-reviews', {
            slidesPerView: 1.08, spaceBetween: 14,
            pagination: { el: '.google-reviews-pagination', clickable: true },
            breakpoints: { 640: { slidesPerView: 2.08, spaceBetween: 18 }, 1024: { slidesPerView: 3, spaceBetween: 20 } }
        });
    } catch (error) {
        console.warn('Avaliações do Google indisponíveis.', error);
    }
}
document.getElementById('cliente-email')?.addEventListener('input', agendarSalvamentoCarrinho);
document.getElementById('cliente-nome')?.addEventListener('input', agendarSalvamentoCarrinho);
document.getElementById('marketing-consentimento')?.addEventListener('change', () => {
    if (document.getElementById('marketing-consentimento')?.checked) agendarSalvamentoCarrinho();
    else cancelarRecuperacaoCarrinho();
});
if (urlParams.get('recuperar_carrinho')) window.setTimeout(recuperarCarrinhoDoEmail, 450);

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
            const nomeExibicao = formatarNomeAvaliacao(a.cliente_nome, 'Anônimo');
            
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

                const foto1Raw = (p.foto_1 && p.foto_1.trim().length > 5) ? p.foto_1.trim() : "fotos/produto-em-breve.svg";
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
            const nomeExibicao = formatarNomeAvaliacao(a.cliente_nome, 'Anônimo');
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
