/* ============================================
   OpenDrop - GitHub Release Integration
   ============================================ */

const OpenDropRelease = (function() {
    // Configuration
    const CONFIG = {
        owner: 'nfantinodyer',
        repo: 'nfdgames',
        cacheKey: 'opendrop_latest_release_v1',
        cacheTTL: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
    };

    // Derived URLs
    const URLS = {
        releasesPage: `https://github.com/${CONFIG.owner}/${CONFIG.repo}/releases`,
        latestRelease: `https://github.com/${CONFIG.owner}/${CONFIG.repo}/releases/latest`,
        api: `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/releases?per_page=100`,
    };

    // DOM element IDs
    const ELEMENTS = {
        badgeText: 'releaseBadgeText',
        badgeLink: 'releaseBadgeLink',
        versionText: 'windowsVersionText',
        heroDownload: 'heroDownloadBtn',
        windowsDownload: 'windowsDownloadBtn',
    };

    /**
     * Parse semantic version from a tag string
     * @param {string} tag - Version tag (e.g., "v1.2.3", "release-1.2.3")
     * @returns {Object|null} Parsed version object or null
     */
    function parseSemver(tag) {
        if (!tag) return null;
        
        const cleaned = String(tag).trim().replace(/^v/i, '');
        const match = cleaned.match(/(\d+)\.(\d+)\.(\d+)/);
        
        if (!match) return null;
        
        return {
            major: Number(match[1]),
            minor: Number(match[2]),
            patch: Number(match[3]),
        };
    }

    /**
     * Compare two semantic versions
     * @param {Object} a - First version
     * @param {Object} b - Second version
     * @returns {number} Comparison result (-1, 0, or 1)
     */
    function compareSemver(a, b) {
        if (a.major !== b.major) return a.major - b.major;
        if (a.minor !== b.minor) return a.minor - b.minor;
        return a.patch - b.patch;
    }

    /**
     * Find the best release from a list of releases
     * Prefers stable releases with highest semantic version
     * @param {Array} releases - List of GitHub releases
     * @returns {Object|null} Best release or null
     */
    function pickBestRelease(releases) {
        if (!Array.isArray(releases) || releases.length === 0) {
            return null;
        }

        // Filter out drafts
        const nonDrafts = releases.filter(r => r && !r.draft);
        
        // Prefer stable (non-prerelease) releases
        const stable = nonDrafts.filter(r => !r.prerelease);
        const candidates = stable.length > 0 ? stable : nonDrafts;

        let best = null;

        for (const release of candidates) {
            const semver = parseSemver(release.tag_name);
            if (!semver) continue;

            if (!best) {
                best = { release, semver };
                continue;
            }

            const cmp = compareSemver(semver, best.semver);
            
            if (cmp > 0) {
                best = { release, semver };
            } else if (cmp === 0) {
                // Tie-breaker: prefer most recently published
                const aTime = new Date(release.published_at || 0).getTime();
                const bTime = new Date(best.release.published_at || 0).getTime();
                if (aTime > bTime) {
                    best = { release, semver };
                }
            }
        }

        // Fallback to first candidate if no parseable versions found
        if (!best && candidates.length > 0) {
            return candidates[0];
        }

        return best ? best.release : null;
    }

    /**
     * Find the Windows executable asset from release assets
     * @param {Array} assets - Release assets
     * @returns {Object|null} Windows asset or null
     */
    function pickWindowsAsset(assets) {
        if (!Array.isArray(assets) || assets.length === 0) {
            return null;
        }

        const isExe = (a) => a && typeof a.name === 'string' && 
                            a.name.toLowerCase().endsWith('.exe');
        const exes = assets.filter(isExe);

        if (exes.length === 0) return null;

        // Prefer an exe that looks like the OpenDrop server
        const preferred = exes.find(a => 
            /opendrop/i.test(a.name) && 
            /server|setup|installer|windows/i.test(a.name)
        );
        if (preferred) return preferred;

        // Try any OpenDrop exe
        const opendropAny = exes.find(a => /opendrop/i.test(a.name));
        if (opendropAny) return opendropAny;

        // Fallback to first exe
        return exes[0];
    }

    /**
     * Safely set href on an element
     * @param {HTMLElement} el - Target element
     * @param {string} href - URL to set
     */
    function setHrefSafe(el, href) {
        if (!el) return;
        el.href = href || el.dataset.fallbackHref || URLS.latestRelease;
    }

    /**
     * Safely set text content on an element
     * @param {HTMLElement} el - Target element
     * @param {string} text - Text to set
     */
    function setTextSafe(el, text) {
        if (!el) return;
        el.textContent = text;
    }

    /**
     * Get cached release data if still valid
     * @returns {Object|null} Cached release or null
     */
    function getCachedRelease() {
        try {
            const cachedRaw = localStorage.getItem(CONFIG.cacheKey);
            if (!cachedRaw) return null;

            const cached = JSON.parse(cachedRaw);
            const isValid = cached?.ts && 
                           (Date.now() - cached.ts) < CONFIG.cacheTTL && 
                           cached?.release;

            return isValid ? cached.release : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Cache release data
     * @param {Object} release - Release to cache
     */
    function cacheRelease(release) {
        try {
            localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
                ts: Date.now(),
                release: release,
            }));
        } catch (e) {
            // Ignore cache errors
        }
    }

    /**
     * Update UI with release information
     * @param {Object} release - GitHub release object
     */
    function updateReleaseUI(release) {
        if (!release) return;

        const tag = release.tag_name || '';
        const cleaned = String(tag).trim().replace(/^v/i, '');
        
        // Update badge
        const badgeText = document.getElementById(ELEMENTS.badgeText);
        const badgeLink = document.getElementById(ELEMENTS.badgeLink);
        const versionLabel = cleaned ? `Version ${cleaned} • Now Available` : 'Now Available';
        
        setTextSafe(badgeText, versionLabel);
        if (badgeLink) {
            badgeLink.href = release.html_url || URLS.latestRelease;
        }

        // Update version text
        const versionText = document.getElementById(ELEMENTS.versionText);
        if (versionText) {
            const display = cleaned ? `v${cleaned} • 64-bit` : '64-bit';
            setTextSafe(versionText, display);
        }

        // Update download buttons
        const asset = pickWindowsAsset(release.assets);
        const downloadUrl = asset?.browser_download_url || 
                           release.html_url || 
                           URLS.latestRelease;

        setHrefSafe(document.getElementById(ELEMENTS.heroDownload), downloadUrl);
        setHrefSafe(document.getElementById(ELEMENTS.windowsDownload), downloadUrl);
    }

    /**
     * Fetch and display the latest release
     */
    async function fetchLatestRelease() {
        // Try cache first
        const cached = getCachedRelease();
        if (cached) {
            updateReleaseUI(cached);
            return;
        }

        // Fetch from API
        try {
            const response = await fetch(URLS.api, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                },
            });

            if (!response.ok) {
                console.warn('GitHub API request failed:', response.status);
                return;
            }

            const releases = await response.json();
            const best = pickBestRelease(releases);
            
            if (!best) {
                console.warn('No suitable release found');
                return;
            }

            updateReleaseUI(best);
            cacheRelease(best);
        } catch (error) {
            console.warn('Failed to fetch releases:', error);
            // Keep defaults on error
        }
    }

    /**
     * Initialize the release integration
     */
    function init() {
        fetchLatestRelease();
    }

    // Public API
    return {
        init,
        fetchLatestRelease,
        // Expose for testing
        _parseSemver: parseSemver,
        _pickBestRelease: pickBestRelease,
        _pickWindowsAsset: pickWindowsAsset,
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', OpenDropRelease.init);
} else {
    OpenDropRelease.init();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpenDropRelease;
}
