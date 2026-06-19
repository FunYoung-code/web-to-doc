(function () {
    const TOGGLE_KEYS = [
        'autoStoreEnabled',
        'showStoreButton',
        'showCopyButton',
        'showExportButton'
    ];

    const DEFAULTS = {
        autoStoreEnabled: false,
        showStoreButton: true,
        showCopyButton: true,
        showExportButton: true
    };

    const STORAGE_KEY_BLACKLIST = 'siteBlacklist';

    const i18n = window.DocExportI18n;
    const t = i18n.t.bind(i18n);

    let currentTabId = null;
    let currentDomain = '';
    let siteBlacklist = [];
    let isRestrictedPage = false;
    let toastTimer = null;
    let storageCount = 0;

    function showToast(message) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.classList.remove('show');
        }, 1800);
    }

    function refreshPageI18n() {
        i18n.applyPageI18n(document);
        i18n.updateLangToggleButton(document.getElementById('langToggle'));
        document.title = t('popupTitle');
        updateStorageBadge(storageCount);
        updateSiteBarUI();
    }

    function storageGet(keys) {
        return new Promise(function (resolve) {
            chrome.storage.local.get(keys, resolve);
        });
    }

    function storageSet(data) {
        return new Promise(function (resolve) {
            chrome.storage.local.set(data, resolve);
        });
    }

    function getActiveTab() {
        return new Promise(function (resolve) {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                resolve(tabs && tabs[0] ? tabs[0] : null);
            });
        });
    }

    function normalizeDomain(domain) {
        if (!domain) return '';
        let d = String(domain).trim().toLowerCase();
        if (d.startsWith('www.')) d = d.slice(4);
        return d;
    }

    function isRestrictedUrl(url) {
        if (!url) return true;
        const restricted = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'moz-extension:', 'devtools:'];
        for (let i = 0; i < restricted.length; i++) {
            if (url.startsWith(restricted[i])) return true;
        }
        if (url.startsWith('https://chrome.google.com/webstore') ||
            url.startsWith('https://chromewebstore.google.com') ||
            url.startsWith('https://microsoftedge.microsoft.com/addons')) {
            return true;
        }
        return false;
    }

    function isDomainBlacklisted(domain) {
        const d = normalizeDomain(domain);
        if (!d) return false;
        return siteBlacklist.some(function (item) {
            return normalizeDomain(item) === d;
        });
    }

    function updateStorageBadge(count) {
        const badge = document.getElementById('storageBadge');
        const clearBtn = document.getElementById('clearStorageBtn');
        storageCount = count || 0;
        if (badge) badge.textContent = t('storageBadge', { count: storageCount });
        if (clearBtn) clearBtn.disabled = storageCount === 0;
    }

    async function refreshStorageCount() {
        const result = await storageGet(['temporaryStorage']);
        const list = result.temporaryStorage || [];
        updateStorageBadge(list.length);
    }

    async function loadBlacklist() {
        const result = await storageGet([STORAGE_KEY_BLACKLIST]);
        siteBlacklist = Array.isArray(result[STORAGE_KEY_BLACKLIST]) ? result[STORAGE_KEY_BLACKLIST] : [];
    }

    function updateSiteBarUI() {
        const domainEl = document.getElementById('currentDomain');
        const toggle = document.getElementById('siteEnabledToggle');
        const toggleWrap = document.getElementById('siteEnabledToggleWrap');

        if (isRestrictedPage) {
            if (domainEl) {
                domainEl.textContent = t('pageUnavailable');
                domainEl.classList.add('muted');
            }
            if (toggle) {
                toggle.disabled = true;
                toggle.checked = false;
            }
            if (toggleWrap) toggleWrap.style.display = 'none';
            return;
        }

        if (toggleWrap) toggleWrap.style.display = '';
        const blacklisted = isDomainBlacklisted(currentDomain);
        if (domainEl) {
            domainEl.textContent = currentDomain || t('currentPage');
            domainEl.classList.toggle('blacklisted', blacklisted);
            domainEl.classList.remove('muted');
        }
        if (toggle) {
            toggle.disabled = !currentDomain;
            toggle.checked = !!currentDomain && !blacklisted;
        }
    }

    async function loadCurrentSite() {
        isRestrictedPage = false;
        currentDomain = '';
        const tab = await getActiveTab();
        const domainEl = document.getElementById('currentDomain');

        if (!tab) {
            if (domainEl) {
                domainEl.textContent = t('cannotGetPage');
                domainEl.classList.add('muted');
            }
            return;
        }

        currentTabId = tab.id;

        if (!tab.url || isRestrictedUrl(tab.url)) {
            isRestrictedPage = true;
            updateSiteBarUI();
            return;
        }

        try {
            const url = new URL(tab.url);
            currentDomain = normalizeDomain(url.hostname);
        } catch (e) {
            currentDomain = '';
        }

        updateSiteBarUI();
    }

    async function toggleSiteBlacklist(enabled) {
        if (!currentDomain || isRestrictedPage) return;

        const domain = normalizeDomain(currentDomain);
        let list = siteBlacklist.map(normalizeDomain).filter(Boolean);

        if (enabled) {
            list = list.filter(function (d) { return d !== domain; });
        } else if (!list.includes(domain)) {
            list.push(domain);
        }

        siteBlacklist = list;
        await storageSet({ [STORAGE_KEY_BLACKLIST]: list });
        updateSiteBarUI();
        showToast(enabled ? t('enabledOnSite') : t('addedToBlacklist'));
    }

    async function loadToggleSettings() {
        const result = await storageGet(TOGGLE_KEYS);
        TOGGLE_KEYS.forEach(function (key) {
            const el = document.getElementById(key);
            if (!el) return;
            const val = result[key];
            el.checked = val !== undefined ? !!val : !!DEFAULTS[key];
        });
    }

    function bindToggle(key) {
        const el = document.getElementById(key);
        if (!el) return;
        el.addEventListener('change', async function () {
            await storageSet({ [key]: el.checked });
        });
    }

    async function clearStorage() {
        const data = await storageGet(['temporaryStorage']);
        if (!(data.temporaryStorage || []).length) {
            showToast(t('storageEmpty'));
            return;
        }
        if (!confirm(t('confirmClearStorage'))) return;
        await storageSet({ temporaryStorage: [] });
        updateStorageBadge(0);
        showToast(t('storageCleared'));

        if (currentTabId) {
            chrome.tabs.sendMessage(currentTabId, { action: 'refreshStoredContentPanel' }).catch(function () {});
        }
    }

    document.addEventListener('DOMContentLoaded', async function () {
        await new Promise(function (resolve) {
            i18n.loadLang(resolve);
        });
        refreshPageI18n();
        i18n.initLangToggle(document.getElementById('langToggle'), refreshPageI18n);

        const manifest = chrome.runtime.getManifest();
        const versionBadge = document.getElementById('versionBadge');
        if (versionBadge && manifest.version) {
            versionBadge.textContent = 'v' + manifest.version;
        }

        await loadBlacklist();
        await loadCurrentSite();
        await loadToggleSettings();
        await refreshStorageCount();

        TOGGLE_KEYS.forEach(bindToggle);

        document.getElementById('openFullSettings').addEventListener('click', function () {
            chrome.runtime.openOptionsPage();
        });
        document.getElementById('clearStorageBtn').addEventListener('click', clearStorage);

        const siteToggle = document.getElementById('siteEnabledToggle');
        if (siteToggle) {
            siteToggle.addEventListener('change', function () {
                toggleSiteBlacklist(siteToggle.checked);
            });
        }

        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local') {
                if (changes.uiLanguage) {
                    refreshPageI18n();
                }
                if (changes.temporaryStorage) {
                    const list = changes.temporaryStorage.newValue || [];
                    updateStorageBadge(list.length);
                }
                if (changes[STORAGE_KEY_BLACKLIST]) {
                    siteBlacklist = changes[STORAGE_KEY_BLACKLIST].newValue || [];
                    updateSiteBarUI();
                }
            }
        });
    });
})();
