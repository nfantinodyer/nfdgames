/* Live App Store data: rating, review count, and customer reviews.
 *
 * Fetches the public iTunes Search API (for rating + count) and the
 * customerreviews RSS endpoint (for actual review bodies and stars)
 * and updates the trust bar plus the social-proof testimonial
 * section in place.
 *
 * Both endpoints are CORS-friendly so this runs entirely in the
 * browser on each page load — no manifest, no GitHub Action, and
 * the numbers are always whatever Apple is currently reporting.
 *
 * Hard-coded fallbacks already exist in the static HTML; if either
 * endpoint fails, the page just keeps the static numbers it shipped
 * with so we never display "0 ratings" or an empty quote block.
 */
(function () {
  'use strict';

  const APPLE_APP_ID = '6757438202';

  /**
   * Update the "5.0 / App Store Rating" pair in the trust bar to
   * the live values, and the rating-count noun if the count is
   * exactly 1 (so we don't say "1 ratings").
   */
  async function refreshTrustBarRating() {
    try {
      const r = await fetch(
        `https://itunes.apple.com/lookup?id=${APPLE_APP_ID}&country=us&_=${Date.now()}`,
      );
      if (!r.ok) return;
      const json = await r.json();
      const app = (json.results || [])[0];
      if (!app) return;

      // averageUserRatingForCurrentVersion is per-version; we want
      // the all-time average so social proof grows over time.
      const rating =
        app.averageUserRating != null ? app.averageUserRating : null;
      const count =
        app.userRatingCount != null ? app.userRatingCount : null;
      if (rating == null && count == null) return;

      // Trust bar: first .trust-item holds the rating.
      const items = document.querySelectorAll('.trust-bar .trust-item');
      if (!items.length) return;
      const ratingItem = items[0];
      const valueEl = ratingItem.querySelector('.trust-value');
      const labelEl = ratingItem.querySelector('.trust-label');
      if (rating != null && valueEl) {
        // One decimal place ("5.0") to match the static text.
        valueEl.textContent = rating.toFixed(1);
      }
      if (count != null && labelEl && count > 0) {
        const countLabel =
          count === 1 ? '1 rating · App Store' : `${count} ratings · App Store`;
        labelEl.textContent = countLabel;
      }
    } catch (_) {
      // Network failure / CORS hiccup — leave the static numbers.
    }
  }

  /**
   * Fetch up to N most-recent App Store reviews and replace the
   * static testimonial(s) with them.
   *
   * The customerreviews RSS is the same endpoint Apple uses to
   * power the App Store's own review tab; it always returns the
   * latest reviews even if the iTunes Search API hasn't synced.
   */
  async function refreshTestimonials() {
    try {
      const r = await fetch(
        `https://itunes.apple.com/us/rss/customerreviews/page=1/id=${APPLE_APP_ID}/sortby=mostrecent/json?_=${Date.now()}`,
      );
      if (!r.ok) return;
      const json = await r.json();
      const entries = (json.feed && json.feed.entry) || [];
      // The first entry of the customerreviews feed is the app
      // metadata, not a review. Drop it.
      const reviews = entries
        .filter((e) => e.author && e['im:rating'])
        .slice(0, 6);
      if (!reviews.length) return;

      const list = document.querySelector('.testimonials');
      if (!list) return;

      const html = reviews
        .map((rev) => {
          const author = (rev.author && rev.author.name && rev.author.name.label) || 'App Store user';
          const stars = Number((rev['im:rating'] || {}).label || 5);
          const title = (rev.title && rev.title.label) || '';
          const body = (rev.content && rev.content.label) || '';
          // Cap body length so an unusually long review doesn't
          // blow out the layout. Cut on a word boundary for
          // readability and append an ellipsis.
          const trimmed =
            body.length > 320
              ? body.slice(0, 320).replace(/\s+\S*$/, '') + '…'
              : body;
          const safe = (s) =>
            String(s)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          const fullStar = '★';
          const emptyStar = '☆';
          const starStr =
            fullStar.repeat(Math.max(0, Math.min(5, stars))) +
            emptyStar.repeat(Math.max(0, 5 - Math.min(5, stars)));
          return `
            <blockquote class="testimonial">
              ${title ? `<p class="testimonial-title">${safe(title)}</p>` : ''}
              <p>${safe(trimmed)}</p>
              <cite>
                <span class="testimonial-stars">${starStr}</span>
                <span class="testimonial-source">${safe(author)} · App Store</span>
              </cite>
            </blockquote>
          `;
        })
        .join('');

      list.innerHTML = html;
    } catch (_) {
      // Leave the hard-coded testimonial in place.
    }
  }

  function init() {
    refreshTrustBarRating();
    refreshTestimonials();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
