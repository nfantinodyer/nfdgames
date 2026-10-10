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
        playStore: 'https://play.google.com/store/apps/details?id=com.nfdgames.opendrop',
        appStore: 'https://apps.apple.com/us/app/opendrop/id6757438202',
        microsoftStore: 'https://apps.microsoft.com/store/detail/XP99SJJTQXZ9WT',
    };

    // DOM element IDs
    const ELEMENTS = {
        badgeText: 'releaseBadgeText',
        badgeLink: 'releaseBadgeLink',
        versionText: 'windowsVersionText',
        linuxVersionText: 'linuxVersionText',
        heroDownload: 'heroDownloadBtn',
        heroDownloadText: 'heroDownloadText',
        windowsDownload: 'windowsDownloadBtn',
        linuxDownload: 'linuxDownloadBtn',
        linuxArmDownload: 'linuxArmDownloadBtn',
        downloadModal: 'downloadModal',
        closeModal: 'closeModal',
        modalMicrosoftStore: 'modalMicrosoftStore',
        modalWebDownload: 'modalWebDownload',
        // Linux modal elements
        linuxDownloadModal: 'linuxDownloadModal',
        closeLinuxModal: 'closeLinuxModal',
        linuxModalOk: 'linuxModalOk',
        linuxCommand: 'linuxCommand',
        copyCommand: 'copyCommand',
    };

    // Platform detection
    const PLATFORMS = {
        WINDOWS: 'windows',
        MACOS: 'macos',
        LINUX: 'linux',
        IOS: 'ios',
        ANDROID: 'android',
        UNKNOWN: 'unknown',
    };

    // Store the current release for modal use
    let currentRelease = null;
    const DEFAULT_LINUX_ASSETS = {
        x86_64: 'OpenDrop-1.0.0-x86_64.AppImage',
        aarch64: 'OpenDrop-1.0.0-aarch64.AppImage',
    };
    let currentLinuxAssetName = DEFAULT_LINUX_ASSETS.x86_64;

    /**
     * Detect the user's operating system
     * @returns {string} Platform identifier
     */
    function detectOS() {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        const platform = navigator.platform || '';
        
        // Check for iOS first (before Mac check since iPad can report as Mac)
        if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
            return PLATFORMS.IOS;
        }

        // iPadOS asks for the desktop site and reports a Macintosh UA,
        // but unlike a Mac it has a multi-touch screen.
        if (/Macintosh/i.test(userAgent) && (navigator.maxTouchPoints || 0) > 1) {
            return PLATFORMS.IOS;
        }
        
        // Check for Android
        if (/android/i.test(userAgent)) {
            return PLATFORMS.ANDROID;
        }
        
        // Check for Windows
        if (/Win/i.test(platform) || /Windows/i.test(userAgent)) {
            return PLATFORMS.WINDOWS;
        }
        
        // Check for macOS (after iOS check)
        if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) {
            return PLATFORMS.MACOS;
        }
        
        // ChromeOS reports Linux in its UA; it gets the platform list
        if (/CrOS/.test(userAgent)) {
            return PLATFORMS.UNKNOWN;
        }

        // Check for Linux
        if (/Linux/i.test(platform) || /Linux/i.test(userAgent)) {
            return PLATFORMS.LINUX;
        }
        
        return PLATFORMS.UNKNOWN;
    }

    /**
     * Get platform display info
     * @param {string} platform - Platform identifier
     * @returns {Object} Platform info with name and availability
     */
    function getPlatformInfo(platform) {
        const info = {
            [PLATFORMS.WINDOWS]: { 
                name: 'Windows', 
                available: true, 
                extension: '.exe',
                action: 'Download for Windows'
            },
            [PLATFORMS.LINUX]: { 
                name: 'Linux', 
                available: true, 
                extension: '.AppImage',
                action: 'Download for Linux'
            },
            [PLATFORMS.MACOS]: { 
                name: 'macOS', 
                available: false, 
                extension: null,
                action: 'See all platforms'
            },
            [PLATFORMS.IOS]: { 
                name: 'iPhone', 
                available: true, 
                extension: null,
                action: 'Get it on the App Store'
            },
            [PLATFORMS.ANDROID]: { 
                name: 'Android', 
                available: true, 
                extension: null,
                action: 'Get it on Google Play'
            },
            [PLATFORMS.UNKNOWN]: { 
                name: 'Desktop', 
                available: true, 
                extension: null,
                action: 'Choose your platform'
            },
        };
        return info[platform] || info[PLATFORMS.UNKNOWN];
    }

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
     * Detect the CPU architecture to offer Linux users
     * @returns {string} 'aarch64' or 'x86_64'
     */
    function detectLinuxArch() {
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        return /aarch64|arm64|armv8/i.test(ua + ' ' + platform) ? 'aarch64' : 'x86_64';
    }

    /**
     * Find the Linux AppImage asset for an architecture.
     * Matches OpenDrop-<version>-x86_64.AppImage or
     * OpenDrop-<version>-aarch64.AppImage first, then any AppImage
     * naming the architecture. A missing ARM64 build falls back to x86_64.
     * @param {Array} assets - Release assets
     * @param {string} arch - 'x86_64' (default) or 'aarch64'
     * @returns {Object|null} Linux asset or null
     */
    function pickLinuxAsset(assets, arch) {
        if (!Array.isArray(assets) || assets.length === 0) {
            return null;
        }
        const wanted = arch === 'aarch64' ? 'aarch64' : 'x86_64';
        const appImages = assets.filter(a =>
            a && typeof a.name === 'string' && /\.appimage$/i.test(a.name)
        );
        if (appImages.length === 0) return null;

        const exact = new RegExp('^OpenDrop-[0-9][0-9A-Za-z.+-]*-' + wanted + '\\.AppImage$');
        const exactMatch = appImages.find(a => exact.test(a.name));
        if (exactMatch) return exactMatch;

        const archPattern = wanted === 'aarch64' ? /aarch64|arm64/i : /x86_64|amd64/i;
        const looseMatch = appImages.find(a => archPattern.test(a.name));
        if (looseMatch) return looseMatch;

        if (wanted === 'aarch64') {
            return pickLinuxAsset(assets, 'x86_64');
        }

        // Older releases used a name with no architecture in it
        return appImages.find(a => !/aarch64|arm64/i.test(a.name)) || null;
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

    let lastFocus = null;
    let trapHandler = null;

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    /**
     * Build a keydown handler that keeps Tab and Shift+Tab inside the
     * open dialog, so focus never lands on the dimmed page behind it
     * @param {HTMLElement} modal - Overlay element
     * @returns {function(KeyboardEvent): void}
     */
    function makeFocusTrap(modal) {
        const dialog = modal.querySelector('.download-modal-content') || modal;
        return (e) => {
            if (e.key !== 'Tab') return;
            const items = Array.from(dialog.querySelectorAll(FOCUSABLE))
                .filter((el) => el.getClientRects().length > 0);
            if (!items.length) {
                e.preventDefault();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            const outside = !dialog.contains(active);
            if (e.shiftKey && (active === first || outside)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || outside)) {
                e.preventDefault();
                first.focus();
            }
        };
    }

    /**
     * Open a modal overlay, move focus into it and keep it there
     * @param {HTMLElement} modal - Overlay element
     * @param {string} focusId - Id of the element to focus
     */
    function openModal(modal, focusId) {
        if (!modal) return;
        lastFocus = document.activeElement;
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        if (trapHandler) document.removeEventListener('keydown', trapHandler);
        trapHandler = makeFocusTrap(modal);
        document.addEventListener('keydown', trapHandler);
        const focusEl = document.getElementById(focusId);
        if (focusEl) focusEl.focus();
    }

    /**
     * Close a modal overlay and return focus to where it was
     * @param {HTMLElement} modal - Overlay element
     */
    function closeModal(modal) {
        if (!modal || modal.style.display === 'none') return;
        modal.style.display = 'none';
        document.body.style.overflow = '';
        if (trapHandler) {
            document.removeEventListener('keydown', trapHandler);
            trapHandler = null;
        }
        if (lastFocus && typeof lastFocus.focus === 'function') {
            lastFocus.focus();
        }
        lastFocus = null;
    }

    /**
     * Show the download choice modal for Windows users
     */
    function showDownloadModal() {
        openModal(document.getElementById(ELEMENTS.downloadModal), ELEMENTS.closeModal);
    }

    /**
     * Hide the download choice modal
     */
    function hideDownloadModal() {
        closeModal(document.getElementById(ELEMENTS.downloadModal));
    }

    /**
     * Show the Linux download modal with instructions
     */
    function showLinuxDownloadModal() {
        // Update the command with the actual filename
        const commandEl = document.getElementById(ELEMENTS.linuxCommand);
        if (commandEl) {
            commandEl.textContent = `chmod +x ${currentLinuxAssetName}`;
        }
        openModal(document.getElementById(ELEMENTS.linuxDownloadModal), ELEMENTS.linuxModalOk);
    }

    /**
     * Hide the Linux download modal
     */
    function hideLinuxDownloadModal() {
        closeModal(document.getElementById(ELEMENTS.linuxDownloadModal));
    }

    /**
     * Copy command to clipboard
     */
    async function copyCommandToClipboard() {
        const commandEl = document.getElementById(ELEMENTS.linuxCommand);
        const copyBtn = document.getElementById(ELEMENTS.copyCommand);
        
        if (!commandEl || !copyBtn) return;
        
        try {
            await navigator.clipboard.writeText(commandEl.textContent);
            
            // Visual feedback
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
            `;
            
            // Reset after 2 seconds
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                `;
            }, 2000);
        } catch (err) {
            console.warn('Failed to copy to clipboard:', err);
        }
    }

    /**
     * Initialize modal event listeners
     */
    function initModal() {
        const modal = document.getElementById(ELEMENTS.downloadModal);
        const closeBtn = document.getElementById(ELEMENTS.closeModal);
        const microsoftBtn = document.getElementById(ELEMENTS.modalMicrosoftStore);
        const webBtn = document.getElementById(ELEMENTS.modalWebDownload);

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', hideDownloadModal);
        }

        // Click outside to close
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    hideDownloadModal();
                }
            });
        }

        // Escape key to close (for both modals)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideDownloadModal();
                hideLinuxDownloadModal();
            }
        });

        // Microsoft Store button
        if (microsoftBtn) {
            microsoftBtn.href = URLS.microsoftStore;
            microsoftBtn.addEventListener('click', () => {
                hideDownloadModal();
            });
        }

        // Web download button - update with release URL when available
        if (webBtn && currentRelease) {
            const windowsAsset = pickWindowsAsset(currentRelease.assets);
            const downloadUrl = windowsAsset?.browser_download_url || 
                               currentRelease.html_url || 
                               URLS.latestRelease;
            webBtn.href = downloadUrl;
        }

        // Close modal when either option is clicked
        [microsoftBtn, webBtn].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    hideDownloadModal();
                });
            }
        });
    }

    /**
     * Initialize Linux modal event listeners
     */
    function initLinuxModal() {
        const modal = document.getElementById(ELEMENTS.linuxDownloadModal);
        const closeBtn = document.getElementById(ELEMENTS.closeLinuxModal);
        const okBtn = document.getElementById(ELEMENTS.linuxModalOk);
        const copyBtn = document.getElementById(ELEMENTS.copyCommand);

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', hideLinuxDownloadModal);
        }

        // OK button
        if (okBtn) {
            okBtn.addEventListener('click', hideLinuxDownloadModal);
        }

        // Copy button
        if (copyBtn) {
            copyBtn.addEventListener('click', copyCommandToClipboard);
        }

        // Click outside to close
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    hideLinuxDownloadModal();
                }
            });
        }
    }

    /**
     * Show the chmod instructions for one Linux AppImage after its
     * download has started
     * @param {string} assetName - File name shown in the chmod command
     */
    function handleLinuxDownload(assetName) {
        currentLinuxAssetName = assetName || DEFAULT_LINUX_ASSETS.x86_64;
        // Let the download start before the modal opens
        setTimeout(() => {
            showLinuxDownloadModal();
        }, 100);
    }

    /**
     * Bind the two Linux download links once. Each reads its own asset
     * name at click time, so the modal always names the file that was
     * actually downloaded.
     */
    function initLinuxButtons() {
        [
            [ELEMENTS.linuxDownload, DEFAULT_LINUX_ASSETS.x86_64],
            [ELEMENTS.linuxArmDownload, DEFAULT_LINUX_ASSETS.aarch64],
        ].forEach(([id, fallbackName]) => {
            const btn = document.getElementById(id);
            if (!btn || btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => {
                handleLinuxDownload(btn.dataset.assetName || fallbackName);
            });
        });
    }

    /**
     * Click handler for the hero button. Reads the state at click time
     * because the button is updated again after the release loads.
     * @param {Event} e - Click event
     */
    function onHeroClick(e) {
        const os = document.documentElement.dataset.os || detectOS();
        const heroBtn = e.currentTarget;
        if (os === PLATFORMS.WINDOWS) {
            e.preventDefault();
            showDownloadModal();
        } else if (os === PLATFORMS.LINUX && heroBtn.dataset.assetName) {
            handleLinuxDownload(heroBtn.dataset.assetName);
        }
    }

    /**
     * Update hero button based on detected OS.
     * Called before and after the release fetch.
     * @param {Object} release - GitHub release object (optional)
     */
    function updateHeroForOS(release) {
        const detectedOS = detectOS();
        const platformInfo = getPlatformInfo(detectedOS);

        const heroBtn = document.getElementById(ELEMENTS.heroDownload);
        const heroText = document.getElementById(ELEMENTS.heroDownloadText);

        if (!heroBtn || !heroText) return;

        setTextSafe(heroText, platformInfo.action);

        if (!heroBtn.dataset.bound) {
            heroBtn.dataset.bound = '1';
            heroBtn.addEventListener('click', onHeroClick);
        }

        switch (detectedOS) {
            case PLATFORMS.WINDOWS:
                // Click opens the Microsoft Store or .exe choice
                heroBtn.href = '#';
                break;
            case PLATFORMS.ANDROID:
                heroBtn.href = URLS.playStore;
                heroBtn.target = '_blank';
                heroBtn.rel = 'noopener';
                break;
            case PLATFORMS.IOS:
                heroBtn.href = URLS.appStore;
                heroBtn.target = '_blank';
                heroBtn.rel = 'noopener';
                break;
            case PLATFORMS.LINUX: {
                const asset = release ? pickLinuxAsset(release.assets, detectLinuxArch()) : null;
                if (asset && asset.browser_download_url) {
                    heroBtn.href = asset.browser_download_url;
                    heroBtn.dataset.assetName = asset.name;
                } else {
                    heroBtn.href = '#download';
                    delete heroBtn.dataset.assetName;
                }
                break;
            }
            default:
                // macOS (no release yet) and anything unrecognised: a
                // working primary button that scrolls to the platform list.
                // No conversion event, since nothing is downloaded.
                heroBtn.href = '#download';
                heroBtn.removeAttribute('target');
                heroBtn.onclick = null;
                heroBtn.removeAttribute('onclick');
                break;
        }
    }

    /**
     * Update UI with release information
     * @param {Object} release - GitHub release object
     */
    function updateReleaseUI(release) {
        if (!release) return;

        // Store release for modal use
        currentRelease = release;

        const tag = release.tag_name || '';
        const cleaned = String(tag).trim().replace(/^v/i, '');

        // Update badge
        const badgeText = document.getElementById(ELEMENTS.badgeText);
        const badgeLink = document.getElementById(ELEMENTS.badgeLink);
        const versionLabel = cleaned ? `Version ${cleaned} \u2022 Now available` : 'Now available';

        setTextSafe(badgeText, versionLabel);
        if (badgeLink) {
            badgeLink.href = release.html_url || URLS.latestRelease;
        }

        // Update Windows version text
        const versionText = document.getElementById(ELEMENTS.versionText);
        if (versionText) {
            const display = cleaned ? `v${cleaned} \u2022 64-bit` : '64-bit';
            setTextSafe(versionText, display);
        }

        // Update Linux version text
        const linuxVersionText = document.getElementById(ELEMENTS.linuxVersionText);
        if (linuxVersionText) {
            const display = cleaned ? `v${cleaned} \u2022 x86_64 and ARM64` : 'x86_64 and ARM64';
            setTextSafe(linuxVersionText, display);
        }

        // Keep the SoftwareApplication node's softwareVersion current
        const schemaTag = document.getElementById('opendrop-schema');
        if (schemaTag && cleaned) {
            try {
                const schema = JSON.parse(schemaTag.textContent);
                const graph = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
                const app = graph.find(node => node && node['@type'] === 'SoftwareApplication');
                if (app) {
                    app.softwareVersion = cleaned;
                    schemaTag.textContent = JSON.stringify(schema, null, 2);
                }
            } catch (e) {
                console.warn('Failed to update SEO schema:', e);
            }
        }

        // Update Windows download button
        const windowsAsset = pickWindowsAsset(release.assets);
        const windowsDownloadUrl = windowsAsset?.browser_download_url ||
                                   release.html_url ||
                                   URLS.latestRelease;
        setHrefSafe(document.getElementById(ELEMENTS.windowsDownload), windowsDownloadUrl);

        // Update the two Linux download links (x86_64 and ARM64)
        [
            [ELEMENTS.linuxDownload, 'x86_64'],
            [ELEMENTS.linuxArmDownload, 'aarch64'],
        ].forEach(([id, arch]) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            const asset = pickLinuxAsset(release.assets, arch);
            setHrefSafe(btn, asset?.browser_download_url || release.html_url || URLS.latestRelease);
            if (asset) {
                btn.dataset.assetName = asset.name;
            }
        });

        // Update modal web download button
        const webBtn = document.getElementById(ELEMENTS.modalWebDownload);
        if (webBtn) {
            webBtn.href = windowsDownloadUrl;
        }

        // Update hero button based on OS
        updateHeroForOS(release);
    }

    /**
     * Fetch and display the latest release
     */
    async function fetchLatestRelease() {
        // Update hero button immediately based on OS (before fetch completes)
        updateHeroForOS(null);

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
        initModal();
        initLinuxModal();
        initLinuxButtons();
    }

    // Expose the detected platform to CSS and opendrop-page.js right away
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.os = detectOS();
    }

    // Public API
    return {
        init,
        fetchLatestRelease,
        detectOS,
        getPlatformInfo,
        showDownloadModal,
        hideDownloadModal,
        showLinuxDownloadModal,
        hideLinuxDownloadModal,
        // Expose for testing
        _parseSemver: parseSemver,
        _pickBestRelease: pickBestRelease,
        _pickWindowsAsset: pickWindowsAsset,
        _pickLinuxAsset: pickLinuxAsset,
        _detectLinuxArch: detectLinuxArch,
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
