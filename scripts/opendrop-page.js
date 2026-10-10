/* OpenDrop product page behaviour (refresh 2026-10).
 *
 * - Segmented controls: set aria-pressed and write data-state on the
 *   element named by data-target (route ladder, competitor picker).
 * - Reveal toggles: hide the [data-scope="all"] rows of a table until
 *   the visitor asks for them (on phones, [data-scope="wide"] rows
 *   too), with the row count in the label.
 * - Sticky sub-nav: scrollspy (aria-current) and a progress line.
 * - Download list: mark the row for the visitor's platform.
 * - Carousel: arrow-key support for the platform tabs.
 *
 * Reads html[data-os], which opendrop-release.js sets as soon as it
 * runs. Without JavaScript every row, route and option stays visible.
 */
(function () {
  'use strict';

  var os = document.documentElement.dataset.os || 'unknown';
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Competitor picker default (before segmented init) ---------- */
  function initAltPicker() {
    var picker = document.querySelector('.alt-picker');
    if (!picker) return;
    var defaults = {
      windows: 'quickshare',
      android: 'quickshare',
      ios: 'airdrop',
      macos: 'airdrop',
    };
    var choice = defaults[os] || 'localsend';
    picker.querySelectorAll('.segmented__btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.value === choice ? 'true' : 'false');
    });
    picker.hidden = false;
  }

  /* ---------- Segmented controls ---------- */
  function initSegmented() {
    document.querySelectorAll('[data-segmented]').forEach(function (group) {
      var target = document.getElementById(group.dataset.target);
      var buttons = Array.prototype.slice.call(group.querySelectorAll('.segmented__btn'));
      if (!buttons.length) return;

      function select(value) {
        buttons.forEach(function (btn) {
          btn.setAttribute('aria-pressed', btn.dataset.value === value ? 'true' : 'false');
        });
        if (target) target.dataset.state = value;
      }

      var pressed = buttons.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })[0];
      select((pressed || buttons[0]).dataset.value);

      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () { select(btn.dataset.value); });
      });
    });
  }

  /* ---------- Reveal toggles ---------- */
  // [data-scope="all"] rows stay hidden until the visitor asks for
  // them. [data-scope="wide"] rows are default rows on wider screens;
  // on phones CSS also folds them while the table carries
  // data-collapsed, so the "Show {n} more" label counts them there.
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 700px)') : null;

  function onNarrowChange(fn) {
    if (!narrow) return;
    if (typeof narrow.addEventListener === 'function') narrow.addEventListener('change', fn);
    else if (typeof narrow.addListener === 'function') narrow.addListener(fn);
  }

  function initRevealToggles() {
    document.querySelectorAll('[data-reveal]').forEach(function (btn) {
      var target = document.getElementById(btn.getAttribute('aria-controls'));
      if (!target) return;
      var rows = target.querySelectorAll('[data-scope="all"]');
      if (!rows.length) return;
      var countAll = target.querySelectorAll('[data-scope="all"]:not(.group-row)').length;
      var countWide = target.querySelectorAll('[data-scope="wide"]').length;
      var label = btn.querySelector('.reveal-toggle__label') || btn;

      function moreLabel() {
        var n = countAll + (narrow && narrow.matches ? countWide : 0);
        return (btn.dataset.labelMore || '').replace('{n}', n);
      }

      function setExpanded(expanded) {
        rows.forEach(function (row) { row.hidden = !expanded; });
        if (expanded) target.removeAttribute('data-collapsed');
        else target.setAttribute('data-collapsed', '');
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        label.textContent = expanded ? btn.dataset.labelLess : moreLabel();
      }

      setExpanded(false);
      btn.hidden = false;

      onNarrowChange(function () {
        if (btn.getAttribute('aria-expanded') !== 'true') label.textContent = moreLabel();
      });

      btn.addEventListener('click', function () {
        var expand = btn.getAttribute('aria-expanded') !== 'true';
        setExpanded(expand);
        if (!expand && btn.getBoundingClientRect().top < 0) {
          btn.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
        }
      });
    });
  }

  /* ---------- Sticky sub-nav: scrollspy and progress ---------- */
  function initSubnav() {
    var subnav = document.querySelector('nav.subnav');
    if (!subnav) return;
    var list = subnav.querySelector('.subnav__list');
    var links = Array.prototype.slice.call(subnav.querySelectorAll('.subnav__link'));
    var sections = [];
    links.forEach(function (link) {
      var id = (link.getAttribute('href') || '').slice(1);
      var el = id && document.getElementById(id);
      if (el) sections.push({ el: el, link: link, visible: false });
    });

    // The Download section has no rail link; the sub-nav button marks it.
    var marked = links.slice();
    var cta = subnav.querySelector('.subnav__cta');
    var ctaHref = cta ? cta.getAttribute('href') || '' : '';
    var ctaTarget = ctaHref.charAt(0) === '#' && document.getElementById(ctaHref.slice(1));
    if (ctaTarget) {
      sections.push({ el: ctaTarget, link: cta, visible: false });
      marked.push(cta);
    }

    var current = null;
    function setCurrent(link) {
      if (link === current) return;
      current = link;
      marked.forEach(function (l) {
        if (l === link) l.setAttribute('aria-current', 'true');
        else l.removeAttribute('aria-current');
      });
      // Keep the active link in view inside the rail without moving the page
      if (link && link !== cta && list && list.scrollWidth > list.clientWidth) {
        var left = link.offsetLeft - list.offsetLeft;
        var right = left + link.offsetWidth;
        if (left < list.scrollLeft || right > list.scrollLeft + list.clientWidth) {
          var next = Math.max(0, left - 16);
          if (typeof list.scrollTo === 'function') {
            list.scrollTo({ left: next, behavior: reducedMotion ? 'auto' : 'smooth' });
          } else {
            list.scrollLeft = next;
          }
        }
      }
    }

    if ('IntersectionObserver' in window && sections.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          sections.forEach(function (s) {
            if (s.el === entry.target) s.visible = entry.isIntersecting;
          });
        });
        var active = sections.filter(function (s) { return s.visible; })[0];
        setCurrent(active ? active.link : null);
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach(function (s) { io.observe(s.el); });
    }

    var main = document.getElementById('main');
    var ticking = false;
    function updateProgress() {
      ticking = false;
      if (!main) return;
      var rect = main.getBoundingClientRect();
      var total = rect.height - window.innerHeight;
      var p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      subnav.style.setProperty('--progress', p.toFixed(4));
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(updateProgress);
      }
    }, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }

  /* ---------- Download list: the visitor's platform ---------- */
  function initRecommendedRow() {
    var ids = { windows: 'dl-windows', linux: 'dl-linux', ios: 'dl-ios', android: 'dl-android' };
    var row = ids[os] && document.getElementById(ids[os]);
    if (!row) return;
    row.classList.add('is-recommended');
    var line = row.querySelector('.row__title-line');
    if (line && !line.querySelector('.chip--free')) {
      var chip = document.createElement('span');
      chip.className = 'chip chip--free';
      chip.textContent = 'Your device';
      line.appendChild(chip);
    }
  }

  /* ---------- Carousel: default tab and keyboard support ---------- */
  function initCarouselTabs() {
    var tablist = document.querySelector('#screenshots-section .ss-tabs');
    if (!tablist) return;
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('.ss-tab'));

    // Every visitor starts on the iPhone tab. The Windows and Linux
    // galleries open on the desktop dashboard, which shows a pairing
    // QR code, a secret and a relay host; keep them out of the first
    // view until the store screenshots are replaced.

    // Tabs pattern: arrow keys move between platforms (the carousel
    // script makes only the selected tab focusable with Tab).
    tablist.addEventListener('keydown', function (e) {
      var index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      var next = null;
      if (e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      next.click();
      next.focus();
    });
  }

  function init() {
    initAltPicker();
    initSegmented();
    initRevealToggles();
    initSubnav();
    initRecommendedRow();
    initCarouselTabs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
