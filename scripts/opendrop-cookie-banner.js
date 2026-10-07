/* NFDGames / OpenDrop cookie consent banner.
 *
 * The site loads three Google products that drop persistent storage:
 *   - Google Analytics 4 (measurementId G-ENWJJ78E3Q, via Firebase)
 *   - Google Ads conversion-measurement tag (AW-17319823241)
 *   - Firebase Analytics
 *
 * Under EU ePrivacy + GDPR these may not fire until consent. Under
 * CCPA/CPRA / CO / CT the user has a right to opt out and the
 * Global Privacy Control browser signal is a valid opt-out.
 *
 * This script:
 *   1. Boots Google Consent Mode v2 in default-deny state before
 *      anything else runs (the gtag scripts themselves still load,
 *      but they queue events until consent is granted).
 *   2. If `navigator.globalPrivacyControl === true`, persists a
 *      "reject" choice automatically and does not show the banner.
 *   3. Otherwise on first visit shows a consent strip; persists the
 *      user's choice in localStorage so it doesn't return on every
 *      page load.
 *   4. Exposes `window.OpenDropConsent` so the Privacy Policy page
 *      can offer a "Manage Cookie Preferences" button that reopens
 *      the banner.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'opendrop_cookie_consent_v1';

  function readChoice() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var json = JSON.parse(raw);
      if (json && json.choice) return json;
    } catch (_) { /* malformed entry — treat as no choice */ }
    return null;
  }

  function persistChoice(choice, source) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ choice: choice, source: source || 'banner', ts: Date.now() })
      );
    } catch (_) { /* localStorage disabled — silent fail */ }
  }

  function clearChoice() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  function ensureGtagShim() {
    var w = window;
    if (typeof w.gtag !== 'function') {
      w.dataLayer = w.dataLayer || [];
      w.gtag = function gtagShim() { w.dataLayer.push(arguments); };
    }
    return w.gtag;
  }

  /**
   * Push a Google Consent Mode v2 state update.
   * Called once at boot with the stored choice (defaulting to
   * deny-everything if no stored choice yet) and again every time
   * the user accepts or rejects from the banner.
   */
  function applyConsent(accepted, isUpdate) {
    var gtag = ensureGtagShim();
    var state = accepted ? 'granted' : 'denied';
    gtag('consent', isUpdate ? 'update' : 'default', {
      ad_storage: state,
      ad_user_data: state,
      ad_personalization: state,
      analytics_storage: state,
      functionality_storage: state,
      personalization_storage: state,
      security_storage: 'granted'
    });
  }

  function detectGpc() {
    try {
      return navigator && navigator.globalPrivacyControl === true;
    } catch (_) { return false; }
  }

  function buildBanner() {
    var root = document.createElement('div');
    root.className = 'cookie-banner';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Cookie consent');
    var policyHref = (location.pathname.indexOf('/OpenDrop/') === 0)
      ? 'PrivacyPolicy.html'
      : '/OpenDrop/PrivacyPolicy.html';
    root.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<p class="cookie-banner-text">' +
          'We use Google Analytics and a Google Ads conversion-measurement tag to ' +
          'understand which features matter. They drop persistent cookies. ' +
          '<a href="' + policyHref + '">Read our Privacy Policy</a>. ' +
          'You can change your mind any time on that page.' +
        '</p>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="btn btn-outline cookie-reject">Reject</button>' +
          '<button type="button" class="btn btn-primary cookie-accept">Accept</button>' +
        '</div>' +
      '</div>';
    return root;
  }

  var activeBanner = null;
  /** Queued callbacks waiting for a positive consent grant. Drained
   * the moment we record an "accept" choice (whether at preboot from
   * storage or via the banner). Callbacks added after consent is
   * already granted fire immediately. */
  var consentCallbacks = [];
  function notifyConsentGranted() {
    var queued = consentCallbacks;
    consentCallbacks = [];
    for (var i = 0; i < queued.length; i++) {
      try { queued[i](); } catch (e) { /* swallow — one bad cb shouldn't block others */ }
    }
  }

  function show() {
    if (activeBanner) return;
    var banner = buildBanner();
    activeBanner = banner;
    document.body.appendChild(banner);
    /* setTimeout instead of rAF — rAF is throttled when the tab is
     * backgrounded, which would leave the banner stuck off-screen
     * if the user opened the page in a background tab. 16ms is one
     * frame at 60Hz, enough for the transition to animate from the
     * initial off-screen transform. */
    setTimeout(function () {
      banner.classList.add('cookie-banner-visible');
    }, 16);
    function close(accepted, source) {
      persistChoice(accepted ? 'accept' : 'reject', source);
      applyConsent(accepted, true);
      if (accepted) notifyConsentGranted();
      banner.classList.remove('cookie-banner-visible');
      setTimeout(function () {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
        if (activeBanner === banner) activeBanner = null;
      }, 400);
    }
    banner.querySelector('.cookie-accept').addEventListener('click', function () { close(true, 'banner'); });
    banner.querySelector('.cookie-reject').addEventListener('click', function () { close(false, 'banner'); });
  }

  function init() {
    applyConsent(false, false);

    if (detectGpc()) {
      persistChoice('reject', 'gpc');
      applyConsent(false, true);
      return;
    }

    var stored = readChoice();
    if (stored) {
      applyConsent(stored.choice === 'accept', true);
      return;
    }
    show();
  }

  window.OpenDropConsent = {
    /** Re-open the banner so the user can change their decision. */
    open: function () {
      clearChoice();
      applyConsent(false, true);
      var run = function () { show(); };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
    },
    /** Programmatic opt-out. Useful for the "Do Not Sell / Share" link. */
    optOut: function () {
      persistChoice('reject', 'user-action');
      applyConsent(false, true);
      if (activeBanner) {
        activeBanner.classList.remove('cookie-banner-visible');
      }
    },
    /** Programmatic opt-in. */
    optIn: function () {
      persistChoice('accept', 'user-action');
      applyConsent(true, true);
      notifyConsentGranted();
      if (activeBanner) {
        activeBanner.classList.remove('cookie-banner-visible');
      }
    },
    /** Inspect the current choice. Returns 'accept' | 'reject' | null. */
    current: function () {
      var stored = readChoice();
      return stored ? stored.choice : null;
    },
    /** Run a callback once the user has granted consent (now or later).
     * Used by Firebase Analytics, Google Ads conversion tags, and any
     * other third-party SDK that would otherwise initialize on page
     * load. If consent has already been granted, fires synchronously
     * on the next microtask. */
    onConsent: function (cb) {
      if (typeof cb !== 'function') return;
      var stored = readChoice();
      if (stored && stored.choice === 'accept') {
        Promise.resolve().then(cb);
        return;
      }
      consentCallbacks.push(cb);
    }
  };

  /* Default-deny + GPC handling and stored-choice replay must run
   * synchronously at script load so any Google tag that fires after
   * this script (Google tags are typically async-loaded right after
   * this in <head>) sees the consent default already in place.
   * Banner UI work is deferred to DOMContentLoaded since it needs
   * <body> to attach to. */
  (function preboot() {
    applyConsent(false, false);
    if (detectGpc()) {
      persistChoice('reject', 'gpc');
      applyConsent(false, true);
      return;
    }
    var stored = readChoice();
    if (stored) {
      applyConsent(stored.choice === 'accept', true);
    }
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
