/* ============================================
   NFDGames - Common JavaScript Utilities
   ============================================ */

/**
 * Initialize smooth scrolling for anchor links
 */
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            // Read the href at click time: scripts may rewrite it (for example
            // a hero button that becomes a store link).
            const targetId = this.getAttribute('href') || '';
            if (targetId.charAt(0) !== '#' || targetId.length < 2) return;

            let target = null;
            try {
                target = document.querySelector(targetId);
            } catch (err) {
                target = null;
            }
            if (!target) return;

            e.preventDefault();
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });

            // Move focus to the target as native in-page navigation would, so the
            // skip link and in-page links continue keyboard navigation from there.
            // Elements focused this way carry data-scroll-focus and draw no ring.
            if (!target.matches('a[href], button, input, select, textarea, summary, [tabindex]')) {
                target.setAttribute('tabindex', '-1');
                target.setAttribute('data-scroll-focus', '');
            }
            target.focus({ preventScroll: true });

            // Keep the address bar in step, as a native fragment link would.
            if (window.history && history.pushState && location.hash !== targetId) {
                history.pushState(null, '', targetId);
            }
        });
    });
}

/**
 * Initialize navbar scroll effect
 */
function initNavScroll() {
    const nav = document.querySelector('nav');
    if (!nav) return;

    const SCROLL_THRESHOLD = 50;

    function updateNav() {
        if (window.scrollY > SCROLL_THRESHOLD) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }
    }

    // Use passive listener for better scroll performance
    window.addEventListener('scroll', updateNav, { passive: true });
    
    // Initial check
    updateNav();
}

/**
 * Initialize mobile menu toggle
 */
function initMobileMenu() {
    const btn = document.getElementById('mobileMenuBtn');
    const nav = document.getElementById('navLinks');
    if (!btn || !nav) return;

    function setOpen(open) {
        btn.classList.toggle('active', open);
        nav.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    btn.addEventListener('click', () => {
        setOpen(!nav.classList.contains('open'));
    });

    // Close menu when a link is clicked
    nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            setOpen(false);
        });
    });

    // Close on Escape and return focus to the button
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && nav.classList.contains('open')) {
            setOpen(false);
            btn.focus();
        }
    });
}

/**
 * Initialize all common functionality
 */
function initCommon() {
    initSmoothScroll();
    initNavScroll();
    initMobileMenu();
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommon);
} else {
    initCommon();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initSmoothScroll, initNavScroll, initMobileMenu, initCommon };
}
