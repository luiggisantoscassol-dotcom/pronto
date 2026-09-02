const trackingForm = document.getElementById('tracking-form');
const trackingInput = document.getElementById('tracking-code-input');
const trackingError = document.getElementById('tracking-error');
const menuButton = document.getElementById('menu-toggle');
const siteMenu = document.getElementById('site-menu');

menuButton.addEventListener('click', () => {
  const open = siteMenu.classList.toggle('active');
  menuButton.classList.toggle('active', open);
  menuButton.setAttribute('aria-expanded', String(open));
});

trackingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = trackingInput.value.trim();
  let code = value;

  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      code = url.searchParams.get('token') || url.searchParams.get('codigo') || '';
    }
  } catch (_) {
    code = '';
  }

  const isShortCode = /^[0-9a-f]{8}$/i.test(code);
  const isSecureToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(code);
  if (!isShortCode && !isSecureToken) {
    trackingError.textContent = 'Digite os 8 caracteres do código do pedido.';
    trackingInput.focus();
    return;
  }

  trackingError.textContent = '';
  const parameter = isShortCode ? 'codigo' : 'token';
  window.location.assign(`pedido.html?${parameter}=${encodeURIComponent(code)}`);
});
