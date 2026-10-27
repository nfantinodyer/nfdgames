/* ============================================
   NFDGames - Case-insensitive URLs
   ============================================ */

/**
 * GitHub Pages matches paths case-sensitively, so /opendrop/ or
 * /OpenDrop/privacypolicy.html land on 404.html even though the page exists.
 * The 404 page loads this script in <head>: it looks the path up in the sitemap
 * ignoring case and replaces the URL with the real one. Pages missing from the
 * sitemap still get their folder name fixed (/opendrop/auth/action.html).
 */
(function () {
    // Top-level folders whose real names contain capitals.
    const FOLDERS = ['OpenDrop', 'Gunslinger'];

    const path = location.pathname;
    const segment = path.split('/')[1] || '';
    const folder = FOLDERS.find(name => name.toLowerCase() === segment.toLowerCase());
    if (!folder) return;

    // Hide the 404 content while the lookup runs so a fixable URL doesn't flash it.
    const root = document.documentElement;
    root.style.visibility = 'hidden';
    const reveal = () => { root.style.visibility = ''; };
    const fallbackTimer = setTimeout(reveal, 2000);

    // Never redirect to the same path: a real 404 under a correctly cased folder
    // would otherwise reload forever.
    const go = target => {
        if (target && target !== path) {
            location.replace(target + location.search + location.hash);
            return;
        }
        clearTimeout(fallbackTimer);
        reveal();
    };

    const folderFixed = '/' + folder + path.slice(1 + segment.length);

    // "/opendrop" and "/opendrop/index.html" both mean the folder's index page.
    let wanted = path.toLowerCase().replace(/\/index\.html$/, '/');
    const lastPart = wanted.slice(wanted.lastIndexOf('/') + 1);
    if (lastPart && !lastPart.includes('.')) wanted += '/';

    fetch('/sitemap.xml')
        .then(response => (response.ok ? response.text() : ''))
        .then(xml => {
            const locPaths = /<loc>https?:\/\/[^/<]+(\/[^<#]*)/g;
            let match;
            while ((match = locPaths.exec(xml))) {
                if (match[1].toLowerCase() === wanted) return go(match[1]);
            }
            go(folderFixed);
        })
        .catch(() => go(folderFixed));
})();
