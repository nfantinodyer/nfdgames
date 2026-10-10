/* OpenDrop screenshot carousel.
 *
 * Drops a sliding 3-card gallery into #screenshots-stage that
 * auto-rotates through real screenshots pulled live from each
 * platform's official store.
 *
 * Why a slide and not 3D coverflow: the earlier 3D version used
 * overdetermined transforms (transform-origin AND explicit
 * translateZ) which placed cards on a doubled-radius cylinder with
 * an offset center, making cards visually grow as they swung
 * through the perspective camera. A predictable "previous / current
 * / next" slide with simple opacity + scale at the edges gives the
 * "spinning" feel without the math hazards.
 *
 * Sources:
 *   - iOS / Android tabs  -> App Store (iTunes Search API + HTML
 *                            scrape fallback, both run server-side
 *                            into screenshots-manifest.json)
 *   - Windows / Linux     -> Microsoft Store, baked at build time
 *   - macOS               -> Mac App Store live; auto-falls back to
 *                            Windows shots when Apple has no Mac
 *                            screenshots yet (Mac app not released).
 *                            Auto-flips back the day Apple starts
 *                            returning macSoftware screenshots.
 *
 * Deliberately framework-free: pure DOM + fetch + CSS.
 */
(function () {
  'use strict';

  const APPLE_APP_ID = '6757438202';

  /* Apple's lookup API returns 320x480 thumbnails. The CDN serves any
     size from the same path, so ask for a 1080px-wide WebP: the cards
     render at up to 2x DPR and the thumbnail looks soft there. Same
     rewrite as scripts/refresh-screenshots-manifest.mjs. */
  function upscaleAppleUrl(u) {
    return String(u).replace(/\/\d+x\d+[a-z]*\.(?:jpg|jpeg|png|webp)(\?.*)?$/i, '/1080x0w.webp');
  }
  const MANIFEST_URL = 'screenshots-manifest.json';
  const ROTATE_MS = 4000;

  /**
   * Live iOS fetch. The manifest is also pre-baked, but a live
   * fetch on page load means a new App Store release surfaces the
   * day it ships, not the day after the GitHub Action runs.
   */
  async function fetchIosScreenshotsLive() {
    try {
      const r = await fetch(
        `https://itunes.apple.com/lookup?id=${APPLE_APP_ID}&entity=software&country=us&_=${Date.now()}`
      );
      if (!r.ok) return [];
      const json = await r.json();
      const app = (json.results || [])[0];
      if (!app) return [];
      // Use ONLY iPhone screenshots. `ipadScreenshotUrls` would
      // mix in shots at a different aspect ratio that look wrong
      // alongside the iPhone ones in the carousel.
      const urls = app.screenshotUrls || [];
      return urls.map((u, i) => ({
        url: upscaleAppleUrl(u),
        alt: `OpenDrop iOS screenshot ${i + 1}`,
      }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Live Mac fetch. Returns [] until Apple has a real macSoftware
   * listing; the empty array is the signal to fall back to the
   * Windows gallery in the carousel below.
   */
  async function fetchMacScreenshotsLive() {
    try {
      const r = await fetch(
        `https://itunes.apple.com/lookup?id=${APPLE_APP_ID}&entity=macSoftware&country=us&_=${Date.now()}`
      );
      if (!r.ok) return [];
      const json = await r.json();
      const app = (json.results || [])[0];
      if (!app) return [];
      const urls = app.screenshotUrls || [];
      return urls.map((u, i) => ({
        url: upscaleAppleUrl(u),
        alt: `OpenDrop macOS screenshot ${i + 1}`,
      }));
    } catch (_) {
      return [];
    }
  }

  async function fetchManifest() {
    try {
      const r = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }

  async function loadAllPlatforms() {
    const [liveIos, liveMac, manifest] = await Promise.all([
      fetchIosScreenshotsLive(),
      fetchMacScreenshotsLive(),
      fetchManifest(),
    ]);

    // Manifest is the source of truth for Windows. iOS uses the
    // live fetch when available so a fresh release is surfaced
    // the moment it ships.
    const windows =
      (manifest && Array.isArray(manifest.windows) ? manifest.windows : []) || [];
    const macFromManifest =
      (manifest && Array.isArray(manifest.mac) ? manifest.mac : []) || [];
    const iosFromManifest =
      (manifest && Array.isArray(manifest.ios) ? manifest.ios : []) || [];

    const ios = liveIos.length ? liveIos : iosFromManifest;
    // Mac fallback chain: live API → manifest → Windows shots.
    // The boolean tells the UI whether we're showing real Mac
    // screenshots or the Windows fallback so we can surface a note.
    let mac;
    let macIsFallback;
    if (liveMac.length) {
      mac = liveMac;
      macIsFallback = false;
    } else if (macFromManifest.length) {
      mac = macFromManifest;
      macIsFallback = false;
    } else {
      mac = windows;
      macIsFallback = true;
    }

    return { ios, windows, mac, macIsFallback };
  }

  // ============================================================
  // Slide carousel
  //
  // Three cards visible: previous (offset left, dim, slightly
  // scaled down), current (centered, full opacity, full size),
  // next (offset right, dim, slightly scaled down). On rotate,
  // each card animates one slot left.
  // ============================================================

  function clearStage(stage) {
    while (stage.firstChild) stage.removeChild(stage.firstChild);
  }

  /**
   * Map a per-card offset (relative to currentIndex, in
   * `(-n/2, n/2]`) to its slot class. Cards beyond ±1 are
   * off-screen but still in the DOM so they can transition into
   * place when they slide into the visible window.
   */
  function slotForOffset(offset) {
    if (offset === 0) return 'current';
    if (offset === 1) return 'next';
    if (offset === -1) return 'prev';
    if (offset > 0) return 'off-right';
    return 'off-left';
  }

  function init() {
    const root = document.getElementById('screenshots-section');
    if (!root) return;
    const stage = root.querySelector('#screenshots-stage');
    const tabs = root.querySelectorAll('.ss-tab');
    const note = root.querySelector('#screenshots-note');
    const prevBtn = root.querySelector('#ssPrev');
    const nextBtn = root.querySelector('#ssNext');
    const stageWrap = root.querySelector('.ss-stage-wrap');
    const dotsEl = root.querySelector('#screenshots-dots');
    if (!stage) return;

    let platforms = null;
    let currentTab = 'ios';
    let currentShots = [];
    let currentIndex = 0;
    /**
     * One DOM element per shot, parallel to currentShots. Built
     * once per platform activation; thereafter, rotation just
     * updates each card's slot class so CSS transitions handle
     * the actual sliding animation.
     */
    let cardEls = [];
    let timer = null;
    let paused = false;
    // Set true when the carousel has scrolled out of view; the
    // auto-rotate tick is a no-op while this is true. Distinct
    // from `paused` (hover/focus/reduced-motion) so the two can
    // coexist: a user hovering the carousel after scrolling it
    // back into view stays paused via `paused`.
    let offscreen = false;

    function shotsForTab(name) {
      if (!platforms) return [];
      switch (name) {
        case 'ios':
        case 'android':
          return platforms.ios || [];
        case 'windows':
        case 'linux':
          return platforms.windows || [];
        case 'mac':
          return platforms.mac || [];
        default:
          return [];
      }
    }

    function setNote(name) {
      if (!note) return;
      let msg = '';
      if (name === 'mac' && platforms && platforms.macIsFallback) {
        msg =
          'The macOS app is not released yet, so this preview shows the Windows app. ' +
          'It switches over once the Mac App Store has screenshots.';
      } else if (name === 'android') {
        msg =
          'The Android tab shows iPhone screenshots. The two apps look nearly the same.';
      } else if (name === 'linux') {
        msg =
          'The Linux tab shows Windows screenshots. The desktop app looks the same on both.';
      }
      note.textContent = msg;
      note.style.display = msg ? '' : 'none';
    }

    /**
     * Build one DOM element per shot and stash references in
     * `cardEls`. Called once per platform activation. After this,
     * rotations are class-swap operations on existing nodes so
     * CSS transitions drive the slide animation (no DOM
     * teardown, no flicker, no hard cut).
     */
    function buildCards() {
      clearStage(stage);
      cardEls = [];
      if (!currentShots.length) {
        stage.classList.add('ss-empty');
        renderDots();
        return;
      }
      stage.classList.remove('ss-empty');

      currentShots.forEach((s, i) => {
        const fig = document.createElement('figure');
        fig.className = 'ss-card';
        fig.dataset.idx = String(i);
        // Eager-load every shot in the active platform so swipes
        // and auto-rotations never reveal a half-painted card.
        // `loading="lazy"` is wrong here: the prev/next cards are
        // off-screen at load time and would only fetch on the
        // first rotation, by which point the slide animation has
        // already started.
        fig.innerHTML = `<img src="${s.url}" alt="${s.alt || 'OpenDrop screenshot'}" loading="eager" decoding="async">`;
        // Side-card click navigates that direction. The handler
        // computes direction from the card's CURRENT slot class
        // at click time, since the slot moves around as the user
        // rotates.
        fig.addEventListener('click', () => {
          if (fig.classList.contains('ss-card-prev')) rotateBy(-1, true);
          else if (fig.classList.contains('ss-card-next')) rotateBy(1, true);
        });
        stage.appendChild(fig);
        cardEls.push(fig);
      });
      relayout();
      renderDots();
    }

    /**
     * Position-indicator dots beneath the carousel. One per shot
     * in the active platform; the active dot is highlighted. Each
     * dot is also clickable as a direct-jump shortcut.
     */
    function renderDots() {
      if (!dotsEl) return;
      dotsEl.innerHTML = '';
      if (currentShots.length <= 1) return;
      currentShots.forEach((_, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ss-dot' + (i === currentIndex ? ' active' : '');
        b.setAttribute(
          'aria-label',
          `Go to screenshot ${i + 1} of ${currentShots.length}`,
        );
        b.addEventListener('click', () => {
          if (i === currentIndex) return;
          // Take the shortest path so dots don't induce a long
          // loop when the user clicks one near the start while
          // the carousel is near the end.
          const n = currentShots.length;
          let delta = i - currentIndex;
          if (delta > n / 2) delta -= n;
          if (delta < -n / 2) delta += n;
          rotateBy(delta, true);
        });
        dotsEl.appendChild(b);
      });
    }

    function syncDotState() {
      if (!dotsEl) return;
      const dots = dotsEl.querySelectorAll('.ss-dot');
      dots.forEach((d, i) => {
        d.classList.toggle('active', i === currentIndex);
      });
    }

    /**
     * Update each card's slot class based on its index relative
     * to currentIndex. The relative offset is normalized into
     * `(-n/2, n/2]` so cards always take the shortest path
     * around the rotation. A card sitting one slot to the right
     * never slides the long way around when it should slide one
     * slot left.
     */
    function relayout() {
      const n = currentShots.length;
      if (!n) return;
      const half = n / 2;
      cardEls.forEach((el, i) => {
        let offset = ((i - currentIndex) % n + n) % n; // 0..n-1
        if (offset > half) offset -= n;                // (-n/2, n/2]
        const slot = slotForOffset(offset);
        // Only touch className if it actually changed; this
        // avoids redundant transitions when relayout is called
        // back-to-back (e.g. via resize).
        const target = `ss-card ss-card-${slot}`;
        if (el.className !== target) el.className = target;
      });
    }

    /**
     * Rotate the carousel by `delta` cards (typically ±1). When
     * `userInitiated` is true the auto-rotate timer is restarted
     * from zero so a button press doesn't get steamrolled by an
     * auto-tick a hundred milliseconds later.
     */
    function rotateBy(delta, userInitiated) {
      if (!currentShots.length) return;
      const n = currentShots.length;
      currentIndex = (currentIndex + delta + n) % n;
      relayout();
      syncDotState();
      if (userInitiated) restartTimer();
    }

    /**
     * Probe the first image to learn the platform's native aspect
     * ratio. iPhone shots are tall and narrow, Windows shots are
     * wide. Without this, a single fixed 280x540 card would crop
     * Windows screenshots horizontally and waste vertical space on
     * phone shots. We size the card to the largest screenshot in
     * the set (they're consistent within a platform) and write the
     * dimensions to CSS custom properties on the stage so the slot
     * offsets stay proportional.
     */
    async function adaptCardSizeForCurrent() {
      if (!currentShots.length) return;
      // Find the natural dimensions of the largest screenshot in
      // the set. Apple and Microsoft both ship a consistent shape
      // per platform, so checking the first image is usually
      // enough; checking ALL of them is cheap and means the layout
      // is correct even if one shot is an outlier portrait.
      const probes = await Promise.all(
        currentShots.map((s) => loadImageDims(s.url).catch(() => null))
      );
      const dims = probes.filter(Boolean);
      if (!dims.length) return;
      let maxW = 0;
      let maxH = 0;
      for (const d of dims) {
        if (d.width > maxW) maxW = d.width;
        if (d.height > maxH) maxH = d.height;
      }
      if (!maxW || !maxH) return;

      const aspect = maxW / maxH;

      // Fit into the visible stage. The wrap is ~580px tall on
      // desktop, ~480px on mobile (CSS media query). We cap card
      // height to ~92% of that to leave breathing room. Width then
      // follows the aspect ratio, capped by half the wrap width
      // so the side cards still have somewhere to peek from.
      const wrapWidth = Math.min(stageWrap.clientWidth, 1100);
      const wrapHeight = stageWrap.clientHeight || 580;
      const cardHeightCap = Math.round(wrapHeight * 0.92);
      // Side cards live at 0.82 scale and need to remain visible,
      // so limit the centre card to a fraction of the wrap width
      // to keep them from being pushed off-screen.
      const cardWidthCap = Math.max(220, Math.round(wrapWidth * 0.55));

      let cardH = cardHeightCap;
      let cardW = Math.round(cardH * aspect);
      if (cardW > cardWidthCap) {
        cardW = cardWidthCap;
        cardH = Math.round(cardW / aspect);
      }

      // Side-card horizontal offset: keep half the centre card
      // visible past the side card's centre. Slot points sit at
      // ~0.78 * cardW from the middle so the prev/next cards peek
      // about 22% past the centre card's edge.
      const slotOffset = Math.round(cardW * 0.78);

      stage.style.setProperty('--ss-card-w', cardW + 'px');
      stage.style.setProperty('--ss-card-h', cardH + 'px');
      stage.style.setProperty('--ss-slot-offset', slotOffset + 'px');
    }

    /** Promise wrapper around HTMLImageElement onload. */
    function loadImageDims(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () =>
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = reject;
        img.src = url;
      });
    }

    function activate(name) {
      currentTab = name;
      tabs.forEach((t) => {
        const selected = t.dataset.tab === name;
        t.classList.toggle('active', selected);
        t.setAttribute('aria-selected', selected ? 'true' : 'false');
        t.setAttribute('tabindex', selected ? '0' : '-1');
      });
      currentShots = shotsForTab(name);
      currentIndex = 0;
      buildCards();
      setNote(name);
      restartTimer();
      // Adapt card size after the initial build so the dim probes
      // run in parallel with the user already seeing the gallery.
      adaptCardSizeForCurrent();
    }

    function restartTimer() {
      if (timer) clearInterval(timer);
      if (currentShots.length <= 1) return;
      timer = setInterval(() => {
        if (paused || offscreen) return;
        rotateBy(1);
      }, ROTATE_MS);
    }

    tabs.forEach((t) => {
      t.addEventListener('click', () => activate(t.dataset.tab));
    });
    // Pass userInitiated=true so the auto-rotate timer resets;
    // otherwise an auto-tick scheduled for ~100ms after the click
    // would yank the carousel to the next slide before the user
    // has a chance to look.
    if (prevBtn) prevBtn.addEventListener('click', () => rotateBy(-1, true));
    if (nextBtn) nextBtn.addEventListener('click', () => rotateBy(1, true));

    if (stageWrap) {
      stageWrap.addEventListener('mouseenter', () => (paused = true));
      stageWrap.addEventListener('mouseleave', () => (paused = false));
      stageWrap.addEventListener('focusin', () => (paused = true));
      stageWrap.addEventListener('focusout', () => (paused = false));

      // Keyboard nav: ←/→ rotate, Home/End jump to ends. The wrap
      // already has tabindex="0" so it can receive keyboard focus.
      stageWrap.addEventListener('keydown', (e) => {
        if (!currentShots.length) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          rotateBy(-1, true);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          rotateBy(1, true);
        } else if (e.key === 'Home') {
          e.preventDefault();
          rotateBy(-currentIndex, true);
        } else if (e.key === 'End') {
          e.preventDefault();
          rotateBy(currentShots.length - 1 - currentIndex, true);
        }
      });

      // Touch swipe: pointer events handle mouse + touch + pen
      // through the same code path, so we don't need a separate
      // touchstart/touchend pair. The drag has to exceed
      // SWIPE_THRESHOLD horizontally AND beat the vertical drift
      // (so a vertical scroll inside the section doesn't flip
      // cards on the way past).
      const SWIPE_THRESHOLD = 40;
      let downX = null;
      let downY = null;
      let downTime = 0;
      stageWrap.addEventListener('pointerdown', (e) => {
        // Skip clicks on the inline arrows / dots. They have
        // their own handlers and we don't want to double-fire.
        if (e.target.closest('.ss-arrow') || e.target.closest('.ss-dot')) {
          return;
        }
        downX = e.clientX;
        downY = e.clientY;
        downTime = Date.now();
      });
      stageWrap.addEventListener('pointerup', (e) => {
        if (downX == null) return;
        const dx = e.clientX - downX;
        const dy = e.clientY - downY;
        const dt = Date.now() - downTime;
        downX = downY = null;
        // Tap, not a swipe: let the click handlers run.
        if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) {
          return;
        }
        // Quick flicks (under ~250 ms) get half the threshold so
        // a deliberate but short swipe still counts.
        if (Math.abs(dx) < SWIPE_THRESHOLD / 2 && dt > 250) return;
        rotateBy(dx < 0 ? 1 : -1, true);
      });
      stageWrap.addEventListener('pointercancel', () => {
        downX = downY = null;
      });
    }

    // Pause the auto-rotation while the carousel is off-screen.
    // Without this it spins in the background, churning paint
    // work and racing the IntersectionObserver-style "seen on
    // screen" analytics events on the page below.
    if ('IntersectionObserver' in window && stageWrap) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === stageWrap) {
              offscreen = !entry.isIntersecting;
            }
          }
        },
        { threshold: 0.1 },
      );
      io.observe(stageWrap);
    }

    // Keep the card size adapted to the wrap width on resize.
    // Mobile and desktop cap differently, and the slot offset
    // depends on wrap width too.
    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => adaptCardSizeForCurrent());
    });

    document.addEventListener('visibilitychange', () => {
      paused = document.visibilityState !== 'visible';
    });

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) paused = true;
    if (reduced.addEventListener) {
      reduced.addEventListener('change', (e) => {
        paused = e.matches;
      });
    }

    loadAllPlatforms().then((data) => {
      platforms = data;
      activate(currentTab);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
