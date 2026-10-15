(() => {
    document.documentElement.style.touchAction = 'pan-x pan-y';

    const bloquearGesto = event => event.preventDefault();
    document.addEventListener('gesturestart', bloquearGesto, { passive: false });
    document.addEventListener('gesturechange', bloquearGesto, { passive: false });
    document.addEventListener('gestureend', bloquearGesto, { passive: false });
    document.addEventListener('touchmove', event => {
        if (event.touches.length > 1) event.preventDefault();
    }, { passive: false });

    let ultimoToque = 0;
    document.addEventListener('touchend', event => {
        const agora = Date.now();
        if (agora - ultimoToque < 300) event.preventDefault();
        ultimoToque = agora;
    }, { passive: false });
})();
