(function () {
  'use strict';

  var INTERNAL_ACCESS_KEY = 'tioNanInternalAccess';
  var GOOGLE_ADS_ID = 'AW-18524058545';
  var GOOGLE_ANALYTICS_ID = 'G-FT6M0L0E6S';
  var GOOGLE_ADS_PURCHASE_DESTINATION = 'AW-18524058545/4GrZCNL-xqIdELHn-oBF';

  try {
    if (window.localStorage.getItem(INTERNAL_ACCESS_KEY) === '1') return;
  } catch (_) {
    // Se o armazenamento estiver indisponível, mantém a medição normal do site.
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ANALYTICS_ID);
  window.gtag('config', GOOGLE_ADS_ID);

  window.TioNanGoogleAds = window.TioNanGoogleAds || {};
  window.TioNanGoogleAds.purchase = function (purchase) {
    var localReference = String(purchase && purchase.reference || '').trim();
    if (!localReference) return false;

    var storageKey = 'tioNanGoogleAdsPurchase:' + localReference;
    try {
      if (window.localStorage.getItem(storageKey) === '1') return false;
    } catch (_) {}

    window.gtag('event', 'conversion', {
      send_to: GOOGLE_ADS_PURCHASE_DESTINATION,
      value: 1.0,
      currency: 'BRL',
      transaction_id: ''
    });

    try {
      window.localStorage.setItem(storageKey, '1');
    } catch (_) {}
    return true;
  };

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GOOGLE_ANALYTICS_ID);
  document.head.appendChild(script);
})();
