const pedidoDb = window.supabase.createClient(
  'https://eegqobqhrfdkmjyjnqvp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZ3FvYnFocmZka21qeWpucXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MjU5NzcsImV4cCI6MjA5MzEwMTk3N30.rHSlJ1Fv0oSEsJc4r44czBs3Lb6dkfWl-WwtIHawpys'
);
const params = new URLSearchParams(location.search);
const providedToken = params.get('token') || '';
const providedShortCode = params.get('codigo') || '';
const token = providedToken || (!providedShortCode ? localStorage.getItem('tioNanUltimoPedido') || '' : '');
const shortCode = providedShortCode || (!token ? localStorage.getItem('tioNanUltimoPedidoCodigo') || '' : '');
const accessCode = token || shortCode;
const stages = [
  ['Novo Pedido','Pedido recebido','Seu pedido entrou em nossa fila.'],
  ['Confirmado','Pedido confirmado','Confirmamos os dados do pedido.'],
  ['Em Preparo','Em preparo','Estamos preparando seu pedido.'],
  ['Saiu para Entrega','Saiu para entrega','Seu pedido está a caminho.'],
  ['Concluído','Concluído','Pedido entregue ou retirado.']
];

if (accessCode) {
  if (token) localStorage.setItem('tioNanUltimoPedido', token);
  if (shortCode) localStorage.setItem('tioNanUltimoPedidoCodigo', shortCode);
}

document.getElementById('copy-code').addEventListener('click', async (event) => {
  const visibleCode = document.getElementById('tracking-code').textContent.trim();
  if (!visibleCode) return;
  await navigator.clipboard.writeText(visibleCode);
  event.currentTarget.textContent = 'Copiado';
  setTimeout(() => { event.currentTarget.textContent = 'Copiar'; }, 1600);
});

function renderTimeline(status) {
  if (status === 'Cancelado') {
    document.getElementById('timeline').innerHTML = '<p class="error">Este pedido foi cancelado. Entre em contato conosco se precisar de ajuda.</p>';
    return;
  }
  const current = Math.max(0, stages.findIndex(([key]) => key === status));
  document.getElementById('timeline').innerHTML = stages.map(([, title, text], index) => `
    <div class="step ${index < current ? 'done' : index === current ? 'active' : ''}">
      <span class="dot">${index < current ? '✓' : index + 1}</span><div><b>${title}</b><small>${text}</small></div>
    </div>`).join('');
}

async function loadOrder(show = false) {
  const tracking = document.getElementById('tracking');
  if (show) tracking.style.display = 'block';
  if (!accessCode) {
    document.getElementById('order-code').textContent = 'Código de acompanhamento não encontrado.';
    tracking.innerHTML = '<p class="error">Abra o link recebido ao finalizar o pedido.</p>';
    return;
  }
  const requestBody = token ? { token } : { codigo: shortCode };
  const { data, error } = await pedidoDb.functions.invoke('acompanhar-pedido', { body: requestBody });
  if (error || !data?.pedido) {
    tracking.style.display = 'block';
    tracking.innerHTML = '<p class="error">Não foi possível consultar o pedido agora. Tente novamente.</p>';
    return;
  }
  const order = data.pedido;
  const orderCode = String(order.referencia).slice(0, 8).toUpperCase();
  document.getElementById('order-code').textContent = `Pedido ${orderCode}`;
  document.getElementById('tracking-code').textContent = orderCode;
  document.getElementById('tracking-code-box').style.display = 'block';
  localStorage.setItem('tioNanUltimoPedidoCodigo', orderCode);
  renderTimeline(order.status || 'Novo Pedido');
}

document.getElementById('track-button').addEventListener('click', () => loadOrder(true));
loadOrder(params.get('novo') !== '1');
setInterval(() => { if (document.getElementById('tracking').style.display === 'block') loadOrder(true); }, 60000);
