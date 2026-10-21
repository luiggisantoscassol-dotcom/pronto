(() => {
  const STORAGE_KEY = 'tioNanStoryDismissed';
  const VIDEO_URL = '/fotos/tio-nan-story.mp4?v=1';
  const COVER_URL = '/fotos/tio-nan-story-cover.webp?v=1';
  const cartOpen = () => document.getElementById('cart-overlay')?.classList.contains('active');
  const productModalOpen = () => document.getElementById('modal-produto-overlay')?.classList.contains('active');
  const pageBlocked = () => cartOpen() || productModalOpen() || ['age-modal-open','newsletter-open','first-order-open'].some(name => document.body.classList.contains(name));
  const track = (event, label, metadata = {}) => {
    window.TioNanAnalytics?.track(event, { label, metadata });
    window.gtag?.('event', event, { story_title:label });
  };

  function initStory() {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') return;
    document.body.classList.toggle('story-has-buybar', Boolean(document.querySelector('.mobile-buy-bar')));
    const launcher = document.createElement('button');
    launcher.className = 'brand-story-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Conheça a história da Tio Nan');
    launcher.innerHTML = `<span class="brand-story-launcher__cover"><img src="${COVER_URL}" alt="Conheça a Tio Nan" loading="lazy"><span class="brand-story-launcher__play" aria-hidden="true"></span><span class="brand-story-launcher__title">Conheça a Tio Nan</span></span><span class="brand-story-launcher__close" role="button" aria-label="Ocultar vídeo">×</span>`;

    const modal = document.createElement('div');
    modal.className = 'brand-story-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'A história da Tio Nan');
    modal.innerHTML = `<div class="brand-story-card"><video class="brand-story-video" poster="${COVER_URL}" preload="none" controls playsinline></video><button class="brand-story-modal__close" type="button" aria-label="Fechar vídeo">×</button><div class="brand-story-end"><strong>Agora escolha o seu brinde.</strong><p>Conheça nossas cachaças, bebidas mistas e kits.</p><a href="${location.pathname.includes('/produtos/') || location.pathname.endsWith('produto.html') ? '/index.html#vitrine' : '#vitrine'}">Ver nossos produtos</a></div></div>`;
    document.body.append(launcher, modal);

    const video = modal.querySelector('video');
    const end = modal.querySelector('.brand-story-end');
    const modalClose = modal.querySelector('.brand-story-modal__close');
    const launcherClose = launcher.querySelector('.brand-story-launcher__close');
    let openedOnce = false;
    let revealAllowed = false;
    let lastReportedSeconds = -1;

    const reportWatchTime = (force = false, completed = false) => {
      const seconds = Math.max(0, Math.floor(Number(video.currentTime) || 0));
      if (!force && seconds < lastReportedSeconds + 5) return;
      if (seconds <= lastReportedSeconds && !completed) return;
      lastReportedSeconds = Math.max(lastReportedSeconds, seconds);
      const duration = Math.max(0, Math.round(Number(video.duration) || 0));
      track('brand_story_watch', 'Assistiu ao story institucional', {
        segundos: seconds,
        duracao_total: duration,
        percentual: duration ? Math.min(100, Math.round((seconds / duration) * 100)) : null,
        completo: completed
      });
    };

    const closeModal = () => {
      reportWatchTime(true);
      video.pause();
      modal.hidden = true;
      document.body.classList.remove('brand-story-open');
      launcher.classList.toggle('is-visible', revealAllowed && !pageBlocked());
      track('brand_story_close', 'Story institucional');
    };
    const openModal = async () => {
      if (pageBlocked()) return;
      launcher.classList.remove('is-visible');
      modal.hidden = false;
      document.body.classList.add('brand-story-open');
      end.classList.remove('is-visible');
      if (!video.src) {
        video.src = VIDEO_URL;
        video.load();
      }
      track(openedOnce ? 'brand_story_resume' : 'brand_story_open', openedOnce ? 'Retomou o story institucional' : 'Abriu o story institucional');
      openedOnce = true;
      try { await video.play(); } catch {}
    };
    const dismiss = event => {
      event.stopPropagation();
      sessionStorage.setItem(STORAGE_KEY, '1');
      launcher.remove();
      if (!modal.hidden) closeModal();
      track('brand_story_dismiss', 'Story institucional');
    };
    const syncVisibility = () => {
      const blocked = pageBlocked();
      if (blocked && !modal.hidden) closeModal();
      launcher.classList.toggle('is-visible', revealAllowed && !blocked && sessionStorage.getItem(STORAGE_KEY) !== '1' && modal.hidden);
    };

    launcher.addEventListener('click', openModal);
    launcherClose.addEventListener('click', dismiss);
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeModal(); });
    video.addEventListener('pause', () => reportWatchTime(true));
    video.addEventListener('ended', () => { reportWatchTime(true, true); end.classList.add('is-visible'); track('brand_story_complete', 'Story institucional'); });
    video.addEventListener('timeupdate', () => {
      reportWatchTime();
      if (video.duration && video.currentTime / video.duration >= .5 && !video.dataset.halfTracked) {
        video.dataset.halfTracked = '1';
        track('brand_story_half', 'Story institucional');
      }
    });
    window.addEventListener('pagehide', () => { if (!modal.hidden) reportWatchTime(true); });
    end.querySelector('a').addEventListener('click', () => {
      track('brand_story_cta', 'Ver nossos produtos');
      closeModal();
    });
    new MutationObserver(syncVisibility).observe(document.body, { attributes:true, subtree:true, attributeFilter:['class'] });
    window.setTimeout(() => {
      revealAllowed = true;
      syncVisibility();
      if (!pageBlocked()) track('brand_story_impression', 'Story institucional');
    }, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStory, { once:true });
  else initStory();
})();
