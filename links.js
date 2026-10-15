
async function rastrearAcao(label, acao = "") {
    await window.TioNanAnalytics?.track('link_click', {
        label,
        acao,
        metadata: { pagina: 'links' }
    });
}

// Adicionar rastreio nos links
document.querySelectorAll('.link-btn').forEach(btn => {
    btn.addEventListener('click', async (event) => {
        const destino = btn.href;
        if (destino) event.preventDefault();
        try { await rastrearAcao(btn.innerText.trim(), "CLIQUE"); }
        finally { if (destino) window.location.assign(destino); }
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
