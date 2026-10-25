(() => {
  const PHONE = '5551989067003';

  function initWhatsAppHelp() {
    if (document.querySelector('[data-whatsapp-help]')) return;
    document.body.classList.toggle('whatsapp-has-buybar', Boolean(document.querySelector('.mobile-buy-bar')));

    const link = document.createElement('a');
    link.className = 'whatsapp-help';
    link.dataset.whatsappHelp = '';
    link.href = `https://wa.me/${PHONE}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', 'Fale com a Tio Nan pelo WhatsApp');
    link.innerHTML = '<span class="whatsapp-help__label">Dúvidas? Fale conosco!</span><span class="whatsapp-help__icon"><img src="/fotos/whatsapp-contato.webp" alt="" width="58" height="58"></span>';

    link.addEventListener('click', () => {
      const productName = document.querySelector('.product-info h1')?.textContent?.trim();
      const message = productName
        ? `Olá! Estou vendo ${productName} no site da Tio Nan e gostaria de tirar uma dúvida.`
        : 'Olá! Estou no site da Tio Nan e gostaria de tirar uma dúvida.';
      link.href = `https://wa.me/${PHONE}?text=${encodeURIComponent(message)}`;
      window.TioNanAnalytics?.track('whatsapp_help_click', {
        label: productName ? `Dúvida sobre ${productName}` : 'Dúvida pelo site'
      });
      window.gtag?.('event', 'contact', {
        method: 'WhatsApp',
        item_name: productName || 'Site Tio Nan'
      });
    });

    document.body.appendChild(link);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhatsAppHelp, { once: true });
  } else {
    initWhatsAppHelp();
  }
})();
