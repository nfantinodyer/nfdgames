/* ============================================
   NFDGames - Common JavaScript Utilities
   ============================================ */

/**
 * Initialize smooth scrolling for anchor links
 */
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const target = document.querySelector(targetId);
            
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
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
 * Initialize all common functionality
 */
function initCommon() {
    initSmoothScroll();
    initNavScroll();
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommon);
} else {
    initCommon();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initSmoothScroll, initNavScroll, initCommon };
}
