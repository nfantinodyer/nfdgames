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
    let currentLinuxAssetName = 'OpenDrop-x86_64.AppImage';

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
                action: 'macOS Coming Soon'
            },
            [PLATFORMS.IOS]: { 
                name: 'iPhone', 
                available: true, 
                extension: null,
                action: 'Get on App Store'
            },
            [PLATFORMS.ANDROID]: { 
                name: 'Android', 
                available: true, 
                extension: null,
                action: 'Get on Play Store'
            },
            [PLATFORMS.UNKNOWN]: { 
                name: 'Desktop', 
                available: true, 
                extension: null,
                action: 'Download'
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
     * Find the Linux AppImage asset from release assets
     * Specifically looks for OpenDrop-x86_64.AppImage
     * @param {Array} assets - Release assets
     * @returns {Object|null} Linux asset or null
     */
    function pickLinuxAsset(assets) {
        if (!Array.isArray(assets) || assets.length === 0) {
            return null;
        }

        // Look specifically for OpenDrop-x86_64.AppImage first
        const exactMatch = assets.find(a => 
            a && typeof a.name === 'string' && 
            a.name === 'OpenDrop-x86_64.AppImage'
        );
        if (exactMatch) return exactMatch;

        // Fallback: any AppImage with OpenDrop and x86_64 in the name
        const preferred = assets.find(a => 
            a && typeof a.name === 'string' && 
            a.name.toLowerCase().endsWith('.appimage') &&
            /opendrop/i.test(a.name) && 
            /x86_64/i.test(a.name)
        );
        if (preferred) return preferred;

        // Fallback: any OpenDrop AppImage
        const opendropAny = assets.find(a => 
            a && typeof a.name === 'string' && 
            a.name.toLowerCase().endsWith('.appimage') &&
            /opendrop/i.test(a.name)
        );
        if (opendropAny) return opendropAny;

        // Last fallback: first AppImage
        const anyAppImage = assets.find(a => 
            a && typeof a.name === 'string' && 
            a.name.toLowerCase().endsWith('.appimage')
        );
        return anyAppImage || null;
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
     * Show the download choice modal for Windows users
     */
    function showDownloadModal() {
        const modal = document.getElementById(ELEMENTS.downloadModal);
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Hide the download choice modal
     */
    function hideDownloadModal() {
        const modal = document.getElementById(ELEMENTS.downloadModal);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    /**
     * Show the Linux download modal with instructions
     */
    function showLinuxDownloadModal() {
        const modal = document.getElementById(ELEMENTS.linuxDownloadModal);
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            
            // Update the command with the actual filename
            const commandEl = document.getElementById(ELEMENTS.linuxCommand);
            if (commandEl) {
                commandEl.textContent = `chmod +x ${currentLinuxAssetName}`;
            }
        }
    }

    /**
     * Hide the Linux download modal
     */
    function hideLinuxDownloadModal() {
        const modal = document.getElementById(ELEMENTS.linuxDownloadModal);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
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
     * Handle Linux download button click
     * @param {Event} e - Click event
     * @param {string} downloadUrl - URL to download
     */
    function handleLinuxDownload(e, downloadUrl) {
        // Allow the download to proceed (don't prevent default)
        // Show the modal after a brief delay to let download start
        setTimeout(() => {
            showLinuxDownloadModal();
        }, 100);
    }

    /**
     * Update hero button based on detected OS
     * @param {Object} release - GitHub release object (optional)
     */
    function updateHeroForOS(release) {
        const detectedOS = detectOS();
        const platformInfo = getPlatformInfo(detectedOS);
        
        const heroBtn = document.getElementById(ELEMENTS.heroDownload);
        const heroText = document.getElementById(ELEMENTS.heroDownloadText);
        
        if (!heroBtn || !heroText) return;

        // Update button text
        setTextSafe(heroText, platformInfo.action);

        // For Windows, intercept click to show modal
        if (detectedOS === PLATFORMS.WINDOWS) {
            heroBtn.href = '#';
            heroBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showDownloadModal();
            });
            return;
        }

        // Update button href based on platform
        if (detectedOS === PLATFORMS.ANDROID) {
            heroBtn.href = URLS.playStore;
            heroBtn.target = '_blank';
        } else if (detectedOS === PLATFORMS.IOS) {
            heroBtn.href = URLS.appStore;
            heroBtn.target = '_blank';
        } else if (detectedOS === PLATFORMS.MACOS) {
            // For unavailable platforms, link to download section
            heroBtn.href = '#download';
            heroBtn.classList.remove('btn-primary');
            heroBtn.classList.add('btn-secondary');
        } else if (detectedOS === PLATFORMS.LINUX && release) {
            // For Linux, set appropriate download link and show modal on click
            const asset = pickLinuxAsset(release.assets);
            const downloadUrl = asset?.browser_download_url || 
                               release.html_url || 
                               URLS.latestRelease;
            heroBtn.href = downloadUrl;
            
            if (asset) {
                currentLinuxAssetName = asset.name;
            }
            
            heroBtn.addEventListener('click', (e) => {
                handleLinuxDownload(e, downloadUrl);
            });
        } else if (release) {
            // For unknown OS with release
            heroBtn.href = release.html_url || URLS.latestRelease;
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
        const versionLabel = cleaned ? `Version ${cleaned} • Now Available` : 'Now Available';
        
        setTextSafe(badgeText, versionLabel);
        if (badgeLink) {
            badgeLink.href = release.html_url || URLS.latestRelease;
        }

        // Update Windows version text
        const versionText = document.getElementById(ELEMENTS.versionText);
        if (versionText) {
            const display = cleaned ? `v${cleaned} • 64-bit` : '64-bit';
            setTextSafe(versionText, display);
        }

        // Update Linux version text
        const linuxVersionText = document.getElementById(ELEMENTS.linuxVersionText);
        if (linuxVersionText) {
            const display = cleaned ? `v${cleaned} • x86_64` : 'x86_64';
            setTextSafe(linuxVersionText, display);
        }

        // Update Windows download button
        const windowsAsset = pickWindowsAsset(release.assets);
        const windowsDownloadUrl = windowsAsset?.browser_download_url || 
                                   release.html_url || 
                                   URLS.latestRelease;
        setHrefSafe(document.getElementById(ELEMENTS.windowsDownload), windowsDownloadUrl);

        // Update Linux download button
        const linuxAsset = pickLinuxAsset(release.assets);
        const linuxDownloadUrl = linuxAsset?.browser_download_url || 
                                 release.html_url || 
                                 URLS.latestRelease;
        
        const linuxBtn = document.getElementById(ELEMENTS.linuxDownload);
        if (linuxBtn) {
            setHrefSafe(linuxBtn, linuxDownloadUrl);
            
            // Store the asset name for the modal
            if (linuxAsset) {
                currentLinuxAssetName = linuxAsset.name;
            }
            
            // Add click handler to show Linux modal
            linuxBtn.addEventListener('click', (e) => {
                handleLinuxDownload(e, linuxDownloadUrl);
            });
        }

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
