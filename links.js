
const supabaseUrl = 'https://eegqobqhrfdkmjyjnqvp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys';
let db;
try {
    db = window.supabase.createClient(supabaseUrl, supabaseKey);
} catch (e) {
    console.error("Erro Supabase:", e);
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
    return "Mobile/Desktop";
}

async function rastrearAcao(label, acao = "") {
    try {
        const visitorName = localStorage.getItem('visitorName') || 'Anônimo';
        const infoAparelho = `BIO_${getDeviceInfo()}`;
        
        if (db) {
            await db.from('rastreio_carrinho').insert([{
                device_id: deviceId,
                produto_nome: acao ? `${acao}: ${label}` : label,
                cliente_nome: `[BIO] ${visitorName}`,
                ip: infoAparelho,
                local: "Instagram Bio Page"
            }]);
        }
    } catch (e) { }
}

// Rastrear entrada na página
rastrearAcao("Entrou na Bio", "PÁGINA");

// Adicionar rastreio nos links
document.querySelectorAll('.link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        rastrearAcao(btn.innerText.trim(), "CLIQUE");
    });
});

function toggleFaq(el) {
    const item = el.parentElement;
    const isActive = item.classList.contains('active');
    
    // Fecha todos
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
    
    // Abre se não estava ativo
    if (!isActive) {
        item.classList.add('active');
    }
}
