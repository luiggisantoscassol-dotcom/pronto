
document.addEventListener('touchstart', function (event) { if (event.touches.length > 1) { event.preventDefault(); } }, { passive: false });
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

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
        const nameInput = document.getElementById('visitor-name');
        const name = nameInput ? nameInput.value.trim() : '';
        if (name.length < 2) return;

        localStorage.setItem('visitorName', name);
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
    const isVerified = localStorage.getItem('ageVerified');
    const overlay = document.getElementById('age-verification-overlay');
    const visitorName = localStorage.getItem('visitorName');

    if (isVerified === 'true' && visitorName) {
        if (overlay) overlay.style.display = 'none';
        // Se já verificou, o loader pode sumir direto pelo loadProducts()
    } else {
        if (overlay) overlay.style.display = 'flex';
    }
});

function updateWelcome() {
    const visitorName = localStorage.getItem('visitorName') || '';
    const titleEl = document.getElementById('hero-title');
    if (titleEl) {
        if (visitorName) {
            titleEl.innerHTML = `<span style="display:block; font-size:0.7em; opacity:1; color:#000; margin-bottom:12px; letter-spacing:3px;">Olá, ${visitorName}!</span>Seja bem vindo à Tio Nan`;
        } else {
            titleEl.innerText = "Seja bem vindo à Tio Nan";
        }
    }

    const cartTitle = document.getElementById('cart-title');
    if (cartTitle && visitorName) cartTitle.innerText = `Sacola de ${visitorName}`;

    const welcomeHeader = document.getElementById('header-user-welcome');
    if (welcomeHeader && visitorName) welcomeHeader.innerText = `Olá, ${visitorName}`;

    const inputNome = document.getElementById('cliente-nome');
    if (inputNome && !inputNome.value) inputNome.value = visitorName;
}

const supabaseUrl = 'https://eegqobqhrfdkmjyjnqvp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys';
let db;
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
    const hasName = localStorage.getItem('visitorName') && localStorage.getItem('visitorName').trim() !== '';

    if (canalPresenca && hasName) {
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

const CIDADES_PERMITIDAS = ["Porto Alegre", "Montenegro", "Viamão", "Canoas"];

new Swiper('.swiper-hero', {
    loop: true,
    pagination: { el: '.hero-pagination', clickable: true },
    navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
    autoplay: { delay: 5000, disableOnInteraction: false }
});

let cart = [];

function mascaraCEP(t) {
    let v = t.value.replace(/\D/g, "");
    if (v.length > 5) v = v.substring(0, 5) + "-" + v.substring(5, 8);
    t.value = v;
}

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

async function buscarCliente() {
    const telInput = document.getElementById('cliente-telefone');
    if (!telInput) return;
    const tel = telInput.value.replace(/\D/g, "");
    if (tel.length >= 10) {
        try {
            const { data, error } = await db.from('clientes').select('*').eq('telefone', tel).limit(1);
            if (data && data.length > 0 && !error) {
                const cli = data[0];
                if (cli.nome) {
                    document.getElementById('cliente-nome').value = cli.nome;
                    localStorage.setItem('visitorName', cli.nome);
                    updateWelcome();
                    atualizarPresenca();
                }
                if (cli.cep) {
                    document.getElementById('cep').value = cli.cep;
                    document.getElementById('rua').value = cli.rua || "";
                    document.getElementById('numero').value = cli.numero || "";
                    document.getElementById('bairro').value = cli.bairro || "";
                    document.getElementById('cidade').value = cli.cidade || "";
                    document.getElementById('estado').value = cli.estado || "";
                    document.getElementById('apto').value = cli.apto || "";
                    validarCidade(cli.cidade);
                }
            }
        } catch (e) { console.log("Erro ao buscar cliente."); }
    }
}

async function buscaCEP() {
    let cep = document.getElementById('cep').value.replace(/\D/g, '');
    if (cep.length === 8) {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const d = await res.json();
        if (!d.erro) {
            document.getElementById('rua').value = d.logradouro;
            document.getElementById('bairro').value = d.bairro;
            document.getElementById('cidade').value = d.localidade;
            document.getElementById('estado').value = d.uf;
            validarCidade(d.localidade);
        }
    }
}

function validarCidade(cidade) {
    const btn = document.getElementById('btn-finalizar');
    const aviso = document.getElementById('aviso-regiao');
    const entrega = document.getElementById('metodo-entrega').value;
    if (entrega === 'tele') {
        const permitida = CIDADES_PERMITIDAS.some(c => c.toLowerCase() === cidade.toLowerCase());
        if (!permitida) {
            btn.disabled = true; btn.style.background = "#333"; btn.style.opacity = "0.5"; aviso.style.display = "block";
        } else { liberarBotao(); }
    } else { liberarBotao(); }
}

function liberarBotao() {
    const btn = document.getElementById('btn-finalizar');
    const aviso = document.getElementById('aviso-regiao');
    btn.disabled = false; btn.style.background = "#25D366"; btn.style.opacity = "1"; aviso.style.display = "none";
}

const DESCRICOES_PREMIUM = {
    "Gengibre, Guaco e Mel": "Uma alquimia perfeita para quem aprecia intensidade e conforto. O calor picante do gengibre fresco desperta o paladar, enquanto o guaco traz notas herbais profundas que remetem à tradição do campo. A finalização fica por conta da doçura aveludada do mel, que suaviza a potência da cachaça e deixa um retrogosto acolhedor. Ideal para dias frios ou para momentos de puro relaxamento.",
    "Café": "O encontro perfeito entre o corpo robusto da cachaça artesanal e o aroma intenso do café torrado. Apresenta notas de chocolate amargo e um final persistente, ideal para paladares que buscam sofisticação em cada dose.",
    "Butiá": "Uma explosão de tropicalidade gaúcha. O sabor exótico e levemente ácido do butiá harmoniza perfeitamente com a doçura da cana, revelando aromas silvestres e uma refrescância incomparável.",
    "Morango com Pimenta": "A sedutora dança entre a doçura vibrante e o fogo sutil. O frescor suculento do morango maduro envolve a boca de imediato, preparando o terreno para a picância instigante da pimenta dedo-de-moça. É uma bebida de contrastes marcantes: começa doce e encerra com um toque levemente ardente que convida ao próximo gole.",
    "Jabuticaba": "O \"ouro negro\" brasileiro em forma de elixir. A jabuticaba traz uma adstringência elegante e uma doçura natural que dança com a suavidade da destilação artesanal, evocando tradição e frescor.",
    "Morango": "Frescor frutado e doçura equilibrada. O sabor puro do morango silvestre se funde à cachaça artesanal, resultando em uma bebida leve, aromática e extremamente agradável para qualquer ocasião."
};



function getLocalPhoto(nome, currentUrl, isFoto2 = false) {
    // 1. Se o link salvo no Admin já começa com fotos/, usa ele direto
    if (currentUrl && currentUrl.startsWith('fotos/')) return currentUrl;

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

    const nomeNorm = nome.trim().toLowerCase();
    if (LOCAL_PHOTOS[nomeNorm]) {
        return isFoto2 ? LOCAL_PHOTOS[nomeNorm].f2 : LOCAL_PHOTOS[nomeNorm].f1;
    }

    // 3. Tenta encontrar por padrão de nome (slug) - Ex: Cachaça de Limão -> fotos/limao.webp
    // Nota: Como não podemos checar se o arquivo existe via JS sem request, 
    // mantemos o mapeamento ou o link original do Drive como prioridade segura.

    return currentUrl;
}


async function loadProducts() {
    try {
        if (!db) {
            console.warn("Supabase não inicializado.");
            return;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const productId = urlParams.get('id') || urlParams.get('p');

        let query = db.from('produtos').select('*').eq('excluido', false);
        
        const isUUID = productId && productId.length > 20;
        
        if (isUUID) {
            query = query.eq('id', productId);
        } else if (!productId) {
            query = query.or('visivel.eq.true,visivel.is.null');
        }

        const { data: produtos, error } = await query;
        if (error) throw error;

        let htmlDisp = ''; let htmlEsg = '';
        let autoOpenData = null;

        produtos.forEach(p => {
            const id = p.id;
            const nome = p.nome;

            const fixDrive = (url) => {
                if (!url || typeof url !== 'string' || !url.includes('drive.google')) return url.trim();
                const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
                if (idMatch && idMatch[1]) {
                    return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w600`;
                }
                return url.trim();
            };

            const foto1Raw = (p.foto_1 && p.foto_1.trim().length > 5) ? p.foto_1.trim() : "https://via.placeholder.com/300x300?text=Sem+Foto";
            let foto1 = fixDrive(foto1Raw); foto1 = getLocalPhoto(nome, foto1, false);

            const temFoto2 = (p.foto_2 && p.foto_2.trim().length > 5);
            let foto2 = temFoto2 ? fixDrive(p.foto_2.trim()) : foto1; foto2 = getLocalPhoto(nome, foto2, true);

            const precoNum = parseFloat(p.preco);
            const estoque = parseInt(p.estoque) || 0;
            const temEstoque = estoque > 0;
            const custoNum = parseFloat(p.custo || 0);

            let descricao = p.descricao || '';
            const nomeNormalizado = nome.trim().toLowerCase();
            const chavePremium = Object.keys(DESCRICOES_PREMIUM).find(k => k.toLowerCase() === nomeNormalizado);
            const saboresForcados = ["gengibre, guaco e mel", "morango com pimenta"];
            if (saboresForcados.includes(nomeNormalizado) || !descricao || descricao.includes("feita com muito carinho") || descricao.length < 10) {
                if (chavePremium) descricao = DESCRICOES_PREMIUM[chavePremium];
            }

            const teor = p.teor_alcoolico || '';
            const harmonizacao = p.harmonizacao || '';

            const dadosModal = encodeURIComponent(JSON.stringify({ id, nome, foto1, precoNum, custoNum, descricao, teor, harmonizacao, temEstoque, estoque }));
            
            const slug = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
            if (productId && (id == productId || productId == slug)) autoOpenData = dadosModal;

            const tagEstoque = (temEstoque && estoque <= 5) ? `<span class="tag-estoque-discreta">🔥 Apenas ${estoque} unidades</span>` : '';

            const card = `
                <div class="card-produto ${temEstoque ? '' : 'esgotado-card'}" id="card-${id}">
                    <div class="img-wrapper" onclick="abrirModalProduto('${dadosModal}')" style="cursor:pointer;">
                        ${temEstoque ? '' : '<div class="faixa-esgotado-clean">Volta Logo!</div>'}
                        <div class="desktop-only-images">
                            <img src="${foto1}" class="foto-1 prod-img">
                            <img src="${foto2}" class="foto-2" loading="lazy">
                        </div>
                        <div class="swiper swiper-produto">
                            <div class="swiper-wrapper">
                                <div class="swiper-slide"><img src="${foto1}" class="prod-img" loading="lazy"></div>
                                ${temFoto2 ? `<div class="swiper-slide"><img src="${foto2}" class="prod-img" loading="lazy"></div>` : ''}
                            </div>
                            <div class="swiper-pagination"></div>
                        </div>
                        <div class="hint-detalhes">
                            <svg viewBox="0 0 24 24" style="width:14px; fill:currentColor;"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                            Ver Detalhes
                        </div>
                    </div>
                    <div onclick="abrirModalProduto('${dadosModal}')" style="cursor:pointer;">
                        ${tagEstoque}
                        <h3 class="prod-nome">${nome}</h3>
                        <span class="preco">R$ ${precoNum.toFixed(2).replace('.', ',')}</span>
                    </div>
                    ${temEstoque ? `<button class="btn-adicionar" onclick="add('${id}','${nome}',${precoNum}, ${custoNum}, event)">Adicionar à sacola</button>` : `<button class="btn-adicionar" disabled>Esgotado</button>`}
                </div>`;

            if (temEstoque) htmlDisp += card; else htmlEsg += card;
        });
        document.getElementById('vitrine').innerHTML = htmlDisp + htmlEsg;

        if (autoOpenData) {
            setTimeout(() => {
                abrirModalProduto(autoOpenData);
            }, 1000);
        }

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

        document.querySelectorAll('.swiper-produto').forEach(el => swiperObserver.observe(el));


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

function add(id, name, price, cost, event) {
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
        if (fotoUrl) item.foto = fotoUrl;
    } else {
        cart.push({ id, name, price, cost: cost, qtd: 1, foto: fotoUrl });
    }
    updateCart();

    if (card) {
        const btnAdicionar = card.querySelector('.btn-adicionar');
        if (btnAdicionar) {
            btnAdicionar.classList.remove('animating');
            void btnAdicionar.offsetWidth;
            btnAdicionar.classList.add('animating');
            btnAdicionar.textContent = "Adicionado! ✓";
            clearTimeout(btnAdicionar.resetTimeout);
            btnAdicionar.resetTimeout = setTimeout(() => {
                btnAdicionar.textContent = "Adicionar à sacola";
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
            const totalGarrafas = cart.reduce((acc, i) => acc + i.qtd, 0);
            const nudge = document.getElementById("nudge-frete");
            if (nudge) {
                if (totalGarrafas === 2) {
                    nudge.classList.add("active");
                    clearTimeout(window.nudgeTimeout);
                    window.nudgeTimeout = setTimeout(() => {
                        nudge.classList.remove("active");
                    }, 5000);
                } else {
                    nudge.classList.remove("active");
                }
            }
        };
    }
    rastrearAcao(name, "🛒 Adicionou");
}

function abrirModalProduto(dadosEncoded) {
    const p = JSON.parse(decodeURIComponent(dadosEncoded));

    rastrearAcao(p.nome, "👀 Viu");

    document.getElementById('modal-foto').src = p.foto1;
    document.getElementById('modal-nome').innerText = p.nome;
    document.getElementById('modal-preco').innerText = `R$ ${parseFloat(p.precoNum).toFixed(2).replace('.', ',')}`;

    let tagsHtml = '';
    if (p.teor) tagsHtml += `<span class="modal-tag">🌡️ ${p.teor}</span>`;
    if (p.temEstoque && p.estoque <= 5) tagsHtml += `<span class="modal-tag" style="background:#ff6b6b22; color:#ff6b6b; border-color:#ff6b6b;">🔥 Apenas ${p.estoque} un.</span>`;
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

    document.getElementById('modal-produto-overlay').classList.add('active');
    const modalBox = document.getElementById('modal-produto-box');
    if (modalBox) {
        modalBox.style.scrollBehavior = 'auto';
        modalBox.scrollTop = 0;
    }
    document.body.classList.add('stop-scroll');
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

function updateCart() {
    const itemsCont = document.getElementById('cart-items');
    const totalGarrafas = cart.reduce((acc, i) => acc + i.qtd, 0);
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
            if (totalGarrafas === 0) textoFrete.innerText = "Adicione 3 garrafas para FRETE GRÁTIS";
            else if (totalGarrafas < 3) textoFrete.innerText = `Faltam ${3 - totalGarrafas} garrafas para FRETE GRÁTIS!`;
            else textoFrete.innerText = "PARABÉNS! VOCÊ GANHOU FRETE GRÁTIS! 🚚";
        }
    }

    if (cart.length === 0) {
        const containerFrete = document.getElementById('container-frete');
        if (containerFrete) containerFrete.style.display = 'none';

        if (itemsCont) {
            itemsCont.innerHTML = `
                <div style="padding:80px 20px; text-align:center; animation: fadeIn 0.5s ease-out;">
                    <img src="fotos/icon-sacola.webp" style="width:180px; height:180px; margin-bottom:25px; opacity:0.9; object-fit:contain;">
                    <p style="opacity:0.7; font-size:1.3rem; font-weight:700; margin-bottom:40px; color:var(--blue-navy); letter-spacing:1px;">Sua sacola está vazia.</p>
                    <button class="btn-continuar" onclick="toggleCart()" style="display:inline-block; width:auto; padding:20px 50px; background:var(--blue-navy); border:none; color:#fff; border-radius:50px; font-weight:800; text-transform:uppercase; letter-spacing:2px; font-size:0.85rem; box-shadow:0 15px 30px rgba(27,54,93,0.3); cursor:pointer; transition:all 0.3s;">Voltar para a loja</button>
                </div>`;
        }
        const checkoutForm = document.getElementById('checkout-form');
        if (checkoutForm) checkoutForm.style.display = 'none';
        const btnEsvaziar = document.getElementById('container-btn-esvaziar');
        if (btnEsvaziar) btnEsvaziar.style.display = 'none';
        sincronizarBadge();
        return;
    }

    const containerFrete = document.getElementById('container-frete');
    if (containerFrete) containerFrete.style.display = 'block';

    const btnEsvaziar = document.getElementById('container-btn-esvaziar');
    if (btnEsvaziar) btnEsvaziar.style.display = 'block';

    const checkoutForm = document.getElementById('checkout-form');
    if (checkoutForm) checkoutForm.style.display = 'block';

    const blocoEndereco = document.getElementById('bloco-endereco');
    const infoEntrega = document.getElementById('info-entrega-imediata');
    const blocoRetirada = document.getElementById('bloco-retirada');

    if (entrega === 'tele') {
        if (blocoEndereco) blocoEndereco.style.display = 'block';
        if (infoEntrega) infoEntrega.style.display = 'flex';
        buscarCliente();
    } else {
        if (blocoEndereco) blocoEndereco.style.display = 'none';
        if (infoEntrega) infoEntrega.style.display = 'none';
    }
    if (blocoRetirada) blocoRetirada.style.display = (entrega === 'retirada') ? 'block' : 'none';

    if (entrega === 'retirada') liberarBotao();
    else if (entrega === 'tele' && document.getElementById('cidade').value) validarCidade(document.getElementById('cidade').value);

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

    let total = cart.reduce((acc, i) => acc + (i.price * i.qtd), 0);
    let freteInclusoText = "";
    if (entrega === 'tele' && totalGarrafas < 3) {
        total += 15;
        freteInclusoText = " (frete incluso)";
    }
    const totalDisplay = document.getElementById('cart-total-display');
    if (totalDisplay) totalDisplay.innerText = `Total: R$ ${total.toFixed(2).replace('.', ',')}${freteInclusoText}`;
}

function handlePagamentoChange() {
    const pag = document.getElementById('metodo-pagamento').value;
    const blocoTroco = document.getElementById('bloco-troco');
    if (blocoTroco) blocoTroco.style.display = (pag === 'Dinheiro') ? 'block' : 'none';
}

function changeQty(id, delta) {
    const item = cart.find(i => i.id === id);
    if (item) {
        item.qtd += delta;
        if (item.qtd <= 0) cart = cart.filter(i => i.id !== id);
        updateCart();
        sincronizarBadge();
    }
}


function esvaziarSacola(event) {
    if (event) event.stopPropagation();
    if (cart.length === 0) return;
    if (!confirm("Deseja realmente esvaziar toda a sua sacola? 🛍️")) return;
    cart = [];
    updateCart();
    sincronizarBadge();
}


function sincronizarBadge() {
    const totalGarrafas = cart.reduce((acc, i) => acc + i.qtd, 0);
    const badge = document.getElementById('badge');
    if (badge) badge.innerText = totalGarrafas;
}

let timeoutSalvarRascunho;
function salvarRascunhoCliente() {
    clearTimeout(timeoutSalvarRascunho);
    timeoutSalvarRascunho = setTimeout(async () => {
        const telInput = document.getElementById('cliente-telefone');
        const nomeInput = document.getElementById('cliente-nome');
        if (!telInput || !nomeInput) return;

        const telRaw = telInput.value;
        const nome = nomeInput.value;
        const tel = telRaw.replace(/\D/g, "");

        if (tel.length >= 10 && nome.length >= 3) {
            const dados = { telefone: tel, nome: nome };

            const fields = ['cep', 'rua', 'numero', 'bairro', 'cidade', 'estado', 'apto'];
            fields.forEach(f => {
                const el = document.getElementById(f);
                if (el && el.value) dados[f] = el.value;
            });

            try {
                await db.from('clientes').upsert([dados], { onConflict: 'telefone' });
                localStorage.setItem('visitorName', nome);
                updateWelcome();
                rastrearAcao("Identificação", "✅ Preencheu");
            } catch (e) {
                console.warn("Erro ao salvar rascunho:", e.message);
            }
        }
    }, 1000);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isCartOpen) {
        const nome = document.getElementById('cliente-nome').value;
        const telefone = document.getElementById('cliente-telefone').value;
        const entrega = document.getElementById('metodo-entrega').value;
        const pag = document.getElementById('metodo-pagamento').value;
        const rua = document.getElementById('rua').value;

        let faltou = [];
        if (!telefone) faltou.push("Telefone");
        if (!nome) faltou.push("Nome");
        if (entrega === "none" || !entrega) faltou.push("Entrega");
        if (entrega === "tele" && !rua) faltou.push("Endereço");
        if (pag === "none" || !pag) faltou.push("Pagamento");

        if (faltou.length > 0) {
            let sufixo = (nome && telefone.length >= 10) ? " (cliente salvo)" : "";
            rastrearAcao(faltou.join(", ") + sufixo, "⚠️ Saiu sem");
        }
    } else if (document.visibilityState === 'visible' && isCartOpen) {
        rastrearAcao("Sacola", "✨ Voltou");
    }
});

async function checkout() {
    try {
        const nome = document.getElementById('cliente-nome').value;
        const entrega = document.getElementById('metodo-entrega').value;
        const pag = document.getElementById('metodo-pagamento').value;
        const totalGarrafas = cart.reduce((acc, i) => acc + i.qtd, 0);

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
        if (!telefone || telefone.length < 14) return showError('cliente-telefone');
        if (!nome) return showError('cliente-nome');
        if (!entrega || entrega === "none") return showError('metodo-entrega');
        if (entrega === 'tele') {
            if (!document.getElementById('rua').value) return showError('rua');
            if (!document.getElementById('numero').value) return showError('numero');
            if (!document.getElementById('bairro').value) return showError('bairro');
            if (!document.getElementById('cidade').value) return showError('cidade');
        }
        if (!pag || pag === "none") return showError('metodo-pagamento');

        localStorage.setItem('visitorName', nome);
        updateWelcome();
        atualizarPresenca();

        let endereco = (entrega === 'tele') ? `${document.getElementById('rua').value}, ${document.getElementById('numero').value} - ${document.getElementById('bairro').value}, ${document.getElementById('cidade').value}` : "Retirada na Loja (Av. Bento Gonçalves, 4321)";
        const custoTotalPedido = cart.reduce((acc, i) => acc + (i.cost * i.qtd), 0);

        let valorFrete = 0;
        if (entrega === 'tele' && totalGarrafas < 3) {
            valorFrete = 15.00;
        }

        let valorTotalComFrete = cart.reduce((acc, i) => acc + (i.price * i.qtd), 0) + valorFrete;

        const itensMsg = cart.map(i => `${i.name} (x${i.qtd})`).join(', ');
        const totalMsg = `R$ ${valorTotalComFrete.toFixed(2).replace('.', ',')}${valorFrete > 0 ? ' (frete incluso)' : ''}`;

        let beneficioMsg = "";
        if (entrega === 'tele' && totalGarrafas >= 3) beneficioMsg = "\n🚚 FRETE GRÁTIS ATIVADO!";

        const dbDados = {
            cliente: `${nome} (${telefone})`,
            itens: itensMsg,
            total: parseFloat(valorTotalComFrete.toFixed(2)),
            custo: parseFloat(custoTotalPedido.toFixed(2)),
            pagamento: pag,
            endereco: endereco,
            frete: parseFloat(valorFrete)
        };
        db.from('pedidos').insert([dbDados]).then(() => console.log("Salvo")).catch(e => console.error(e));

        const dadosCliente = {
            telefone: telefone.replace(/\D/g, ""),
            nome: nome
        };

        if (entrega === 'tele') {
            const fields = ['cep', 'rua', 'numero', 'bairro', 'cidade', 'estado', 'apto'];
            fields.forEach(f => {
                const el = document.getElementById(f);
                if (el && el.value) dadosCliente[f] = el.value;
            });
        }

        db.from('clientes').upsert([dadosCliente], { onConflict: 'telefone' }).then(() => console.log("Cliente atualizado")).catch(e => console.log(e));

        let trocoMsg = "";
        if (pag === "Dinheiro") {
            const trocoVal = document.getElementById('troco').value;
            if (trocoVal) trocoMsg = `\n💵 Troco para: R$ ${trocoVal}`;
        }

        try {
            const baseUrl = window.location.protocol + "//" + window.location.host + window.location.pathname.replace('index.html', '');
            const adminUrl = baseUrl + (baseUrl.endsWith('/') ? '' : '/') + 'admin.html';
            const barkTitle = encodeURIComponent(`🥃 NOVO PEDIDO: ${nome.toUpperCase()}`);
            const barkBody = encodeURIComponent(`Valor: ${totalMsg}\nItens: ${itensMsg}`);
            const barkUrl = `https://api.day.app/Jk7w8aEYetUowZ9xUJGEiQ/${barkTitle}/${barkBody}?url=${encodeURIComponent(adminUrl)}&icon=https://eegqobqhrfdkmjyjnqvp.supabase.co/storage/v1/object/public/fotos/favicon.png&sound=telegraph`;

            fetch(barkUrl).catch(e => console.log("Bark offline"));
        } catch (e) { }

        rastrearAcao(itensMsg, "🚀 Clicou WhatsApp");

        const waUrl = `https://wa.me/5551989067003?text=${encodeURIComponent("*PEDIDO TIO NAN*\n👤 " + nome + "\n📱 " + telefone + "\n📦 " + itensMsg + "\n📍 " + endereco + "\n💳 Pagamento: " + pag + trocoMsg + "\n💰 " + totalMsg + beneficioMsg)}`;
        window.location.href = waUrl;
    } catch (e) {
        console.error(e);
        alert("Ops! Verifique se todos os campos estão preenchidos corretamente.");
    }
}

loadProducts(); updateCart(); sincronizarBadge(); updateWelcome();

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
    if (overlay) overlay.classList.add('active');
    document.body.classList.add('stop-scroll');
    if (backdrop) backdrop.style.display = 'block';
    history.pushState({ sacolaAberta: true }, "", "#sacola");
    rastrearAcao("Sacola", "💳 Abriu Checkout");
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
                let sufixo = (nome && telefone.length >= 10) ? " (cliente salvo)" : "";
                rastrearAcao(faltou.join(", ") + sufixo, "⚠️ Abandonou sem");
            } else {
                rastrearAcao("Pronto p/ WhatsApp (cliente salvo)", "⚠️ Abandonou (Preencheu Tudo)");
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


