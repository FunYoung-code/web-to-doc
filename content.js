// content.js
/** 浮窗面板与控制栏之间的垂直间距 */
const PANEL_DOCK_GAP = 2;

let isButtonVisible = false; // 标志位，记录按钮是否可见
let suppressSelectionToolbarMouseup = false; // 点击外部关闭选区工具栏后，忽略同一次点击的 mouseup
// content.js - Web to Doc extension content script

const i18n = window.DocExportI18n;
function t(key, params) { return i18n.t(key, params); }

let isViewingStoredContent = false; // 标志位，记录是否正在查看暂存内容
let isButtonClickInProgress = false; // 标志位，记录是否有按钮点击正在进行
let suppressOutsideClickClose = false; // 阻止 popup 操作后穿透点击误关面板
let isRefreshingStoredPanel = false; // 防止重复刷新暂存列表面板
let articles = []; // 用于存储各篇文章的段落数组
let currentArticle = []; // 当前文章的段落数组

// 插件设置
let pluginSettings = {
    autoStoreEnabled: false,
    showStoreButton: true,
    showCopyButton: true,
    showExportButton: true,
    /** 相对鼠标方位：topLeft | topRight | bottomLeft | bottomRight */
    selectionButtonPosition: 'bottomRight',
    storeHotkey: "Ctrl+Shift+S",
    undoStoreHotkey: "Ctrl+Shift+Z",
    exportHotkey: "Ctrl+Shift+X",
    autoStoreDelay: 500,
    autoExportEnabled: false
};

// 自动暂存相关变量
let autoStoreTimeout = null;
let lastStoredText = null;
let storeOperationInProgress = false;
let storedItemsHistory = [];
let baselineStorageLength = 0; // 基线暂存内容长度

// 加载插件设置
async function loadPluginSettings() {
    try {
        const settings = await new Promise((resolve) => {
            chrome.storage.local.get(Object.keys(pluginSettings), (result) => {
                resolve(result);
            });
        });
        
        // 更新设置
        Object.assign(pluginSettings, settings);
        
        // 加载暂存历史
        const history = await new Promise((resolve) => {
            chrome.storage.local.get(['storedItemsHistory'], (result) => {
                resolve(result.storedItemsHistory || []);
            });
        });
        storedItemsHistory = history;
        
        // 初始化基线暂存内容长度
        const storageResult = await new Promise((resolve) => {
            chrome.storage.local.get(['temporaryStorage'], (result) => {
                resolve(result.temporaryStorage || []);
            });
        });
        baselineStorageLength = storageResult.length;

        
        console.log('插件设置已加载:', pluginSettings);
    } catch (error) {
        console.error('加载插件设置失败:', error);
    }
}

// 初始化时加载设置
loadPluginSettings();

function refreshToolbarI18n() {
    if (typeof optionsButtonContainer !== 'undefined') {
        optionsButtonContainer.title = t('formatSettings');
        if (optionsButton) optionsButton.alt = t('formatSettings');
    }
    if (typeof toggleButtonContainer !== 'undefined') {
        toggleButtonContainer.title = t('contentManagement');
        if (toggleButton) toggleButton.alt = t('contentManagement');
    }
    if (typeof outputButtonContainer !== 'undefined') {
        outputButtonContainer.title = t('exportDocument');
        if (outputButton) outputButton.alt = t('exportDocument');
    }
    if (typeof dockToggleContainer !== 'undefined') {
        dockToggleContainer.title = isToolbarExpanded ? t('collapsePanel') : t('expandPanel');
    }
    const exportMenu = docExportUIShadow && docExportUIShadow.querySelector('.doc-export-action-menu');
    if (exportMenu) {
        const titleEl = exportMenu.querySelector('.doc-export-action-menu-title');
        const mergedBtn = exportMenu.querySelector('[data-export-action="merged"]');
        const perArticleBtn = exportMenu.querySelector('[data-export-action="perArticle"]');
        if (titleEl) titleEl.textContent = t('exportModeTitle');
        if (mergedBtn) mergedBtn.textContent = t('exportMerged');
        if (perArticleBtn) perArticleBtn.textContent = t('exportPerArticle');
    }
    const dockMenu = docExportUIShadow && docExportUIShadow.querySelector('.doc-export-dock-context-menu');
    if (dockMenu) {
        const clearBtn = dockMenu.querySelector('[data-dock-action="clear"]');
        const exportBtn = dockMenu.querySelector('[data-dock-action="export"]');
        if (clearBtn) clearBtn.textContent = t('clearStorage');
        if (exportBtn) exportBtn.textContent = t('exportDocument');
    }
    if (typeof isOptionsPanelVisible !== 'undefined' && isOptionsPanelVisible && typeof loadOptionsPanel === 'function') {
        loadOptionsPanel();
    }
    if (typeof isPanelVisible !== 'undefined' && isPanelVisible && isViewingStoredContent) {
        refreshStoredContentPanel();
    }
}

i18n.loadLang(function () {
    refreshToolbarI18n();
});

function convertFormatSettingsOnLangChange(oldLang, newLang, callback) {
    if (!isExtensionContextValid()) {
        if (callback) callback();
        return;
    }
    const keys = i18n.getFormatSettingKeys();
    safeStorageGet(keys, function (result) {
        const converted = i18n.convertFormatSettingsForLang(result, oldLang, newLang);
        const patch = {};
        keys.forEach(function (key) {
            if (converted[key] !== undefined && converted[key] !== result[key]) {
                patch[key] = converted[key];
            }
        });
        if (Object.keys(patch).length) {
            safeStorageSet(patch, function () {
                if (callback) callback();
            });
        } else if (callback) {
            callback();
        }
    });
}

// 监听设置变化
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.uiLanguage) {
            const oldLang = changes.uiLanguage.oldValue;
            const newLang = changes.uiLanguage.newValue;
            if (oldLang && newLang && oldLang !== newLang) {
                convertFormatSettingsOnLangChange(oldLang, newLang, refreshToolbarI18n);
            } else {
                refreshToolbarI18n();
            }
        }
        Object.keys(changes).forEach(key => {
            if (pluginSettings.hasOwnProperty(key)) {
                pluginSettings[key] = changes[key].newValue;
                console.log(`设置已更新: ${key} = ${changes[key].newValue}`);
                
            }
            
            // 监听temporaryStorage变化，更新基线长度（仅在非检测期间更新）
            if (key === 'temporaryStorage') {
                const newLength = changes[key].newValue ? changes[key].newValue.length : 0;
                const oldLength = changes[key].oldValue ? changes[key].oldValue.length : 0;
                console.log(`暂存内容变化: ${oldLength} -> ${newLength}`);
                
                // 只有在非检测期间才更新基线长度
                if (!window.isAutoExportDetecting) {
                    baselineStorageLength = newLength;
                }

                // 暂存列表已打开时，保持面板并刷新内容（如 popup 清空暂存）
                if (isPanelVisible && isViewingStoredContent) {
                    refreshStoredContentPanel();
                }

                if (typeof updateDockTrayIcon === 'function') {
                    updateDockTrayIcon(newLength);
                }
            }
        });
    }
});

// 工具类
class Utility {
    // 防抖函数：避免短时间内多次触发
    static debounce(func, wait, immediate = false) {
        let timeout;
        return function() {
            const context = this;
            const args = arguments;
            const later = function() {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    }

    // 节流函数：限制一段时间内只执行一次
    static throttle(func, wait) {
        let lastCall = 0;
        return function() {
            const now = new Date().getTime();
            if (now - lastCall < wait) return;
            lastCall = now;
            return func.apply(this, arguments);
        };
    }

    // 深度克隆对象
    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        const clone = Array.isArray(obj) ? [] : {};
        
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                clone[key] = this.deepClone(obj[key]);
            }
        }
        
        return clone;
    }

    // 验证数字是否在指定范围内
    static isNumberInRange(value, min, max) {
        const num = parseFloat(value);
        return !isNaN(num) && num >= min && num <= max;
    }

    // 验证字符串是否为空
    static isStringEmpty(str) {
        return !str || str.trim() === '';
    }

    // 格式化当前日期为YYYYMMDD格式
    static formatDate() {
        const date = new Date();
        return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    }

    // 格式化当前时间为HHMM格式
    static formatTime() {
        const date = new Date();
        return `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
    }

    // 生成唯一ID
    static generateUniqueId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // 图片处理相关工具函数
    static resolveImageUrl(imageUrl) {
        let resolved;
        try {
            resolved = new URL(imageUrl, document.baseURI || window.location.href).href;
        } catch (e) {
            resolved = String(imageUrl).trim();
        }
        if (typeof location !== 'undefined' && location.protocol === 'https:' && resolved.startsWith('http://')) {
            resolved = 'https://' + resolved.slice(7);
        }
        return resolved;
    }

    static _canvasFromImage(img, quality, maxWidth, maxHeight, format) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
        }
        if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
        const base64 = canvas.toDataURL(mimeType, quality);

        return {
            data: base64,
            width: width,
            height: height,
            format: format
        };
    }

    static _renderImageToBase64(imageUrl, quality, maxWidth, maxHeight, format, options) {
        options = options || {};
        return new Promise(function (resolve, reject) {
            const img = new Image();
            if (options.crossOrigin) {
                img.crossOrigin = options.crossOrigin;
            }
            img.referrerPolicy = 'strict-origin-when-cross-origin';

            img.onload = function () {
                try {
                    resolve(Utility._canvasFromImage(img, quality, maxWidth, maxHeight, format));
                } catch (err) {
                    reject(err);
                }
            };

            img.onerror = function () {
                reject(new Error('Failed to load image'));
            };

            img.src = imageUrl;
        });
    }

    static _fetchImageViaBackground(imageUrl, referer) {
        return new Promise(function (resolve, reject) {
            chrome.runtime.sendMessage({
                action: 'fetchImage',
                url: imageUrl,
                referer: referer || ''
            }, function (response) {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response || !response.success) {
                    reject(new Error((response && response.error) || 'Failed to fetch image'));
                    return;
                }
                resolve(response);
            });
        });
    }

    static async _fetchAndRenderImage(imageUrl, quality, maxWidth, maxHeight, format, referer) {
        const response = await Utility._fetchImageViaBackground(imageUrl, referer);
        const binary = atob(response.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: response.mimeType || 'image/jpeg' });
        const blobUrl = URL.createObjectURL(blob);
        try {
            return await Utility._renderImageToBase64(blobUrl, quality, maxWidth, maxHeight, format, {});
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }

    // 将图片转换为base64格式
    static async imageToBase64(imageUrl, quality = 0.8, maxWidth = 600, maxHeight = 800, format = 'jpeg', options = {}) {
        const resolvedUrl = Utility.resolveImageUrl(imageUrl);
        const referer = options.referer || (typeof document !== 'undefined' ? document.location.href : '');
        const strategies = [
            function () {
                return Utility._renderImageToBase64(resolvedUrl, quality, maxWidth, maxHeight, format, { crossOrigin: 'anonymous' });
            },
            function () {
                return Utility._fetchAndRenderImage(resolvedUrl, quality, maxWidth, maxHeight, format, referer);
            },
            function () {
                return Utility._renderImageToBase64(resolvedUrl, quality, maxWidth, maxHeight, format, {});
            }
        ];

        let lastError = null;
        for (let i = 0; i < strategies.length; i++) {
            try {
                return await strategies[i]();
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('Failed to load image');
    }

    // 从base64提取二进制数据
    static base64ToArrayBuffer(base64) {
        const binaryString = atob(base64.split(',')[1]);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // 获取图片的MIME类型
    static getImageMimeType(format) {
        switch (format.toLowerCase()) {
            case 'png': return 'image/png';
            case 'jpeg':
            case 'jpg': return 'image/jpeg';
            case 'webp': return 'image/webp';
            default: return 'image/jpeg';
        }
    }

    // 检查元素是否为图片
    static isImageElement(element) {
        return element.tagName === 'IMG' || 
               element.tagName === 'IMAGE' || 
               (element.style && element.style.backgroundImage && element.style.backgroundImage !== 'none');
    }

    // 获取元素的图片URL
    static getImageUrl(element) {
        if (element.tagName === 'IMG') {
            return element.src;
        } else if (element.style && element.style.backgroundImage && element.style.backgroundImage !== 'none') {
            const match = element.style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/);
            return match ? match[1] : null;
        }
        return null;
    }
}

// 设置管理器类
class SettingsManager {
    constructor() {
        this.staticDefaults = {
            titleFontSize: 18,
            bodyFontSize: 16,
            paragraphSpacingBefore: 0,
            paragraphSpacingAfter: 0,
            pageMargins: {
                top: 2.8,
                right: 2.8,
                bottom: 2.8,
                left: 2.8
            },
            lineSpacing: "single",
            fixedLineSpacing: 20,
            multipleLineSpacing: 3,
            firstLineIndent: 2,
            addPageNumbers: "yes",
            pageNumberPosition: "footerCenter",
            pageNumberStyle: "1,2,3",
            pageNumberFontSize: 12,
            userTags: [],
            articleSeparator: "newline",
            customSeparator: "",
            saveTables: "yes",
            tableCellAlignment: "center",
            saveImages: "yes",
            imageQuality: "medium",
            imageMaxWidth: 600,
            imageMaxHeight: 800,
            imageFormat: "jpeg",
            preserveHyperlinks: "no",
            generateTableOfContents: "no",
            tocTitleFontSize: 16,
            tocEntryFontSize: 12,
            heading1RecognizeType: "chinese_comma",
            heading2RecognizeType: "chinese_paren",
            heading3RecognizeType: "number_dot",
            heading1FontSize: 16,
            heading2FontSize: 16,
            heading3FontSize: 16,
            exportFormat: "docx",
            exportTextExcludeEnabled: "yes",
            exportTextExcludeCustom: "",
        };
        this.fontSizeMap = {
            42: "初号", 36: "小初", 26: "一号", 24: "小一",
            22: "二号", 18: "小二", 16: "三号", 15: "小三",
            14: "四号", 12: "小四", 10.5: "五号", 9: "小五",
            7.5: "六号", 6.5: "小六", 5.5: "七号", 5: "八号"
        };
    }

    getDefaultValues() {
        return Object.assign({}, this.staticDefaults, i18n.getFormatDefaults());
    }

    // 加载设置
    loadSettings() {
        return new Promise((resolve) => {
            try {
                if (!isExtensionContextValid()) {
                    notifyExtensionContextInvalidatedOnce();
                    resolve(this.getDefaultValues());
                    return;
                }
                const defaults = this.getDefaultValues();
                safeStorageGet(Object.keys(defaults), (result) => {
                    resolve({ ...defaults, ...result });
                });
            } catch (error) {
                console.warn('Error loading settings:', error);
                resolve(this.getDefaultValues());
            }
        });
    }

    // 保存设置
    saveSettings(settings) {
        return new Promise((resolve) => {
            try {
                if (!isExtensionContextValid()) {
                    notifyExtensionContextInvalidatedOnce();
                    resolve();
                    return;
                }
                safeStorageSet(settings, () => {
                    resolve();
                });
            } catch (error) {
                console.warn('Error saving settings:', error);
                resolve(); // 仍然resolve但可能会失败
            }
        });
    }

    // 更新字体大小显示
    updateFontSizeDisplay(type) {
        const elementId = type === "title" ? "titleFontSize" : "bodyFontSize";
        const displayId = type === "title" ? "titleFontSizeDisplay" : "bodyFontSizeDisplay";

        const fontSizeValue = parseFloat(getOptionsEl(elementId).value);
        const pixelValue = Math.round((fontSizeValue / 72) * 96);

        getOptionsEl(displayId).textContent =
            t('fontSizeDisplay', { name: i18n.getFontSizeName(fontSizeValue), px: pixelValue });
    }

    // 更新标题层级字号显示
    updateHeadingFontSizeDisplay(level) {
        const elementId = `heading${level}FontSize`;
        const displayId = `heading${level}FontSizeDisplay`;
        const fontSizeEl = getOptionsEl(elementId);
        const displayEl = getOptionsEl(displayId);
        if (!fontSizeEl || !displayEl) return;

        const fontSizeValue = parseFloat(fontSizeEl.value);
        const pixelValue = Math.round((fontSizeValue / 72) * 96);
        displayEl.textContent =
            t('fontSizeDisplay', { name: i18n.getFontSizeName(fontSizeValue), px: pixelValue });
    }

    // 更新页码设置的可见性
    togglePageNumberSettingsVisibility() {
        const addPageNumbersCheckbox = getOptionsEl("addPageNumbers");
        const pageNumberSettings = queryOptionsAll(".page-number-setting");
        if (addPageNumbersCheckbox) {
            pageNumberSettings.forEach(setting => {
                setting.style.display = addPageNumbersCheckbox.checked ? "flex" : "none";
            });
        }
    }

    // 更新行间距的可见性
    updateLineSpacingDisplay() {
        const lineSpacing = getOptionsEl('lineSpacing').value;
        getOptionsEl('fixedLineSpacingContainer').style.display = lineSpacing === 'fixed' ? 'block' : 'none';
        getOptionsEl('multipleLineSpacingContainer').style.display = lineSpacing === 'multiple' ? 'block' : 'none';
    }

    // 获取当前设置
    getCurrentSettings() {
        // 获取字体值的辅助函数
        const getFontValue = (selectId, customId) => {
            const selectElement = getOptionsEl(selectId);
            const customElement = getOptionsEl(customId);
            if (selectElement && selectElement.value === 'custom' && customElement) {
                return customElement.value.trim() || selectElement.value;
            }
            return selectElement ? selectElement.value : '';
        };

        return {
            titleFontStyle: getFontValue("titleFontStyle", "titleFontCustom"),
            bodyFontStyle: getFontValue("bodyFontStyle", "bodyFontCustom"),
            titleFontSize: parseInt(getOptionsEl("titleFontSize").value, 10),
            bodyFontSize: parseInt(getOptionsEl("bodyFontSize").value, 10),
            paragraphSpacingBefore: parseInt(getOptionsEl("paragraphSpacingBefore").value, 10),
            paragraphSpacingAfter: parseInt(getOptionsEl("paragraphSpacingAfter").value, 10),
            pageMargins: {
                top: parseFloat(getOptionsEl('pageMarginTop').value),
                right: parseFloat(getOptionsEl('pageMarginRight').value),
                bottom: parseFloat(getOptionsEl('pageMarginBottom').value),
                left: parseFloat(getOptionsEl('pageMarginLeft').value),
            },
            lineSpacing: getOptionsEl("lineSpacing").value,
            fixedLineSpacing: getOptionsEl("lineSpacing").value === "fixed" ? 
                parseInt(getOptionsEl("fixedLineSpacing").value, 10) : null,
            multipleLineSpacing: getOptionsEl("lineSpacing").value === "multiple" ? 
                parseFloat(getOptionsEl("multipleLineSpacing").value) : null,
            firstLineIndent: parseInt(getOptionsEl("firstLineIndent").value, 10),
            addPageNumbers: getOptionsEl("addPageNumbers") ? (getOptionsEl("addPageNumbers").checked ? "yes" : "no") : "yes",
            pageNumberPosition: getOptionsEl("pageNumberPosition").value,
            pageNumberFontStyle: getFontValue("pageNumberFontStyle", "pageNumberFontCustom"),
            pageNumberFontSize: parseInt(getOptionsEl("pageNumberFontSize").value, 10),
            pageNumberStyle: getOptionsEl("pageNumberStyle").value,
            filenameFormat: getOptionsEl("filenameFormat").value,
            exportFormat: getOptionsEl("exportFormat") ? getOptionsEl("exportFormat").value : "docx",
            exportTextExcludeEnabled: getOptionsEl("exportTextExcludeEnabled")
                ? (getOptionsEl("exportTextExcludeEnabled").checked ? "yes" : "no")
                : "yes",
            exportTextExcludeCustom: getOptionsEl("exportTextExcludeCustom")
                ? getOptionsEl("exportTextExcludeCustom").value
                : "",
            userTags: [], // 暂时为空，后续可以添加标签管理功能
            articleSeparator: getOptionsEl("articleSeparator").value,
            customSeparator: getOptionsEl("customSeparator").value,
            saveTables: getOptionsEl("saveTables") ? (getOptionsEl("saveTables").checked ? "yes" : "no") : "yes",
            tableCellAlignment: getOptionsEl("tableCellAlignment") ? getOptionsEl("tableCellAlignment").value : "center",
            // 新增图片设置项
            saveImages: getOptionsEl("saveImages") ? (getOptionsEl("saveImages").checked ? "yes" : "no") : "yes",
            imageQuality: getOptionsEl("imageQuality") ? getOptionsEl("imageQuality").value : "medium",
            imageMaxWidth: getOptionsEl("imageMaxWidth") ? parseInt(getOptionsEl("imageMaxWidth").value, 10) : 600,
            imageMaxHeight: getOptionsEl("imageMaxHeight") ? parseInt(getOptionsEl("imageMaxHeight").value, 10) : 800,
            imageFormat: getOptionsEl("imageFormat") ? getOptionsEl("imageFormat").value : "jpeg",
            preserveHyperlinks: getOptionsEl("preserveHyperlinks") ? (getOptionsEl("preserveHyperlinks").checked ? "yes" : "no") : "no",
            // 新增目录设置项
            generateTableOfContents: getOptionsEl("generateTableOfContents") ? (getOptionsEl("generateTableOfContents").checked ? "yes" : "no") : "no",
            tocTitle: getOptionsEl("tocTitle") ? getOptionsEl("tocTitle").value : i18n.getFormatDefaults().tocTitle,
            tocTitleFontStyle: getFontValue("tocTitleFontStyle", "tocTitleFontCustom"),
            tocTitleFontSize: getOptionsEl("tocTitleFontSize") ? parseInt(getOptionsEl("tocTitleFontSize").value, 10) : 16,
            tocEntryFontStyle: getFontValue("tocEntryFontStyle", "tocEntryFontCustom"),
            tocEntryFontSize: getOptionsEl("tocEntryFontSize") ? parseInt(getOptionsEl("tocEntryFontSize").value, 10) : 12,
            heading1RecognizeType: getOptionsEl("heading1RecognizeType") ? getOptionsEl("heading1RecognizeType").value : "chinese_comma",
            heading2RecognizeType: getOptionsEl("heading2RecognizeType") ? getOptionsEl("heading2RecognizeType").value : "chinese_paren",
            heading3RecognizeType: getOptionsEl("heading3RecognizeType") ? getOptionsEl("heading3RecognizeType").value : "number_dot",
            heading1FontStyle: getFontValue("heading1FontStyle", "heading1FontCustom"),
            heading2FontStyle: getFontValue("heading2FontStyle", "heading2FontCustom"),
            heading3FontStyle: getFontValue("heading3FontStyle", "heading3FontCustom"),
            heading1FontSize: getOptionsEl("heading1FontSize") ? parseInt(getOptionsEl("heading1FontSize").value, 10) : 16,
            heading2FontSize: getOptionsEl("heading2FontSize") ? parseInt(getOptionsEl("heading2FontSize").value, 10) : 16,
            heading3FontSize: getOptionsEl("heading3FontSize") ? parseInt(getOptionsEl("heading3FontSize").value, 10) : 16,
        };
    }

    // 应用设置到页面
    applySettingsToPage(result) {
        // 应用字体设置的辅助函数
        const applyFontSetting = (selectId, customId, value, defaultValues) => {
            const selectElement = getOptionsEl(selectId);
            const customElement = getOptionsEl(customId);
            const customContainer = getOptionsEl(customId + 'Container');
            
            if (selectElement && customElement && customContainer) {
                // 检查是否为自定义字体
                const predefinedFonts = {
                    'titleFontStyle': i18n.getTitleFonts(),
                    'bodyFontStyle': i18n.getCommonFonts(),
                    'pageNumberFontStyle': i18n.getCommonFonts(),
                    'tocTitleFontStyle': i18n.getCommonFonts(),
                    'tocEntryFontStyle': i18n.getCommonFonts(),
                    'heading1FontStyle': i18n.getCommonFonts(),
                    'heading2FontStyle': i18n.getCommonFonts(),
                    'heading3FontStyle': i18n.getCommonFonts()
                };
                
                const fonts = predefinedFonts[selectId] || [];
                if (value && !fonts.includes(value)) {
                    // 自定义字体
                    selectElement.value = 'custom';
                    customElement.value = value;
                    customContainer.style.display = 'block';
                } else {
                    // 预定义字体
                    selectElement.value = value || defaultValues;
                    customElement.value = '';
                    customContainer.style.display = 'none';
                }
            }
        };

        // 加载设置到页面元素
        const defaults = this.getDefaultValues();
        applyFontSetting('titleFontStyle', 'titleFontCustom', result.titleFontStyle, defaults.titleFontStyle);
        applyFontSetting('bodyFontStyle', 'bodyFontCustom', result.bodyFontStyle, defaults.bodyFontStyle);
        getOptionsEl('titleFontSize').value = result.titleFontSize || defaults.titleFontSize;
        getOptionsEl('bodyFontSize').value = result.bodyFontSize || defaults.bodyFontSize;

        getOptionsEl('paragraphSpacingBefore').value = result.paragraphSpacingBefore || defaults.paragraphSpacingBefore;
        getOptionsEl('paragraphSpacingAfter').value = result.paragraphSpacingAfter || defaults.paragraphSpacingAfter;

        const margins = result.pageMargins || defaults.pageMargins;
        getOptionsEl('pageMarginTop').value = margins.top;
        getOptionsEl('pageMarginRight').value = margins.right;
        getOptionsEl('pageMarginBottom').value = margins.bottom;
        getOptionsEl('pageMarginLeft').value = margins.left;

        getOptionsEl('lineSpacing').value = result.lineSpacing || defaults.lineSpacing;
        getOptionsEl('fixedLineSpacing').value = result.fixedLineSpacing || defaults.fixedLineSpacing;
        getOptionsEl('multipleLineSpacing').value = result.multipleLineSpacing || defaults.multipleLineSpacing;

        getOptionsEl('firstLineIndent').value = result.firstLineIndent || defaults.firstLineIndent;

        // 页码设置
        if (getOptionsEl('addPageNumbers')) {
            const addPageNumbersCheckbox = getOptionsEl('addPageNumbers');
            const addPageNumbersLabel = addPageNumbersCheckbox.nextElementSibling;
            const addPageNumbersCircle = addPageNumbersLabel.querySelector('span');
            
            addPageNumbersCheckbox.checked = (result.addPageNumbers || defaults.addPageNumbers) === 'yes';
            
            // 更新开关样式
            if (addPageNumbersCheckbox.checked) {
                addPageNumbersLabel.style.backgroundColor = '#34C759';
                addPageNumbersCircle.style.left = '22px';
            } else {
                addPageNumbersLabel.style.backgroundColor = '#E5E5EA';
                addPageNumbersCircle.style.left = '2px';
            }
        }
        getOptionsEl('pageNumberPosition').value = result.pageNumberPosition || defaults.pageNumberPosition;
        getOptionsEl('pageNumberStyle').value = result.pageNumberStyle || defaults.pageNumberStyle;
        applyFontSetting('pageNumberFontStyle', 'pageNumberFontCustom', result.pageNumberFontStyle, defaults.pageNumberFontStyle);
        getOptionsEl('pageNumberFontSize').value = result.pageNumberFontSize || defaults.pageNumberFontSize;

        // 文件名格式
        getOptionsEl('filenameFormat').value = i18n.localizeFilenameFormat(result.filenameFormat || defaults.filenameFormat);

        if (getOptionsEl('exportFormat')) {
            getOptionsEl('exportFormat').value = result.exportFormat === 'pdf' ? 'pdf' : 'docx';
        }

        if (getOptionsEl('exportTextExcludeEnabled')) {
            const exportTextExcludeCheckbox = getOptionsEl('exportTextExcludeEnabled');
            const exportTextExcludeLabel = exportTextExcludeCheckbox.nextElementSibling;
            const exportTextExcludeCircle = exportTextExcludeLabel.querySelector('span');
            const excludeOn = (result.exportTextExcludeEnabled || defaults.exportTextExcludeEnabled) === 'yes';
            exportTextExcludeCheckbox.checked = excludeOn;
            if (excludeOn) {
                exportTextExcludeLabel.style.backgroundColor = '#34C759';
                exportTextExcludeCircle.style.left = '22px';
            } else {
                exportTextExcludeLabel.style.backgroundColor = '#E5E5EA';
                exportTextExcludeCircle.style.left = '2px';
            }
        }
        if (getOptionsEl('exportTextExcludeCustom')) {
            getOptionsEl('exportTextExcludeCustom').value = result.exportTextExcludeCustom || defaults.exportTextExcludeCustom || '';
        }

        // 文章分隔符设置（存储值若不在下拉选项内，浏览器会显示空白，必须归一化）
        const VALID_ARTICLE_SEPARATORS = ['newline', 'pagebreak', 'custom'];
        const sepNorm = VALID_ARTICLE_SEPARATORS.includes(result.articleSeparator)
            ? result.articleSeparator
            : defaults.articleSeparator;
        getOptionsEl('articleSeparator').value = sepNorm;
        getOptionsEl('customSeparator').value = result.customSeparator || defaults.customSeparator;

        // 表格保存设置
        if (getOptionsEl('saveTables')) {
            const saveTablesCheckbox = getOptionsEl('saveTables');
            const saveTablesLabel = saveTablesCheckbox.nextElementSibling;
            const saveTablesCircle = saveTablesLabel.querySelector('span');
            saveTablesCheckbox.checked = (result.saveTables || defaults.saveTables) === 'yes';
            if (saveTablesCheckbox.checked) {
                saveTablesLabel.style.backgroundColor = '#34C759';
                saveTablesCircle.style.left = '22px';
            } else {
                saveTablesLabel.style.backgroundColor = '#E5E5EA';
                saveTablesCircle.style.left = '2px';
            }
        }
        if (getOptionsEl('tableCellAlignment')) {
            getOptionsEl('tableCellAlignment').value = result.tableCellAlignment || defaults.tableCellAlignment;
        }

        // 图片保存设置
        if (getOptionsEl('saveImages')) {
            const saveImagesCheckbox = getOptionsEl('saveImages');
            const saveImagesLabel = saveImagesCheckbox.nextElementSibling;
            const saveImagesCircle = saveImagesLabel.querySelector('span');
            
            saveImagesCheckbox.checked = result.saveImages === 'yes';
            
            // 更新开关样式
            if (saveImagesCheckbox.checked) {
                saveImagesLabel.style.backgroundColor = '#34C759';
                saveImagesCircle.style.left = '22px';
            } else {
                saveImagesLabel.style.backgroundColor = '#E5E5EA';
                saveImagesCircle.style.left = '2px';
            }
        }
        if (getOptionsEl('imageQuality')) {
            getOptionsEl('imageQuality').value = result.imageQuality || defaults.imageQuality;
        }
        if (getOptionsEl('imageMaxWidth')) {
            getOptionsEl('imageMaxWidth').value = result.imageMaxWidth || defaults.imageMaxWidth;
        }
        if (getOptionsEl('imageMaxHeight')) {
            getOptionsEl('imageMaxHeight').value = result.imageMaxHeight || defaults.imageMaxHeight;
        }
        if (getOptionsEl('imageFormat')) {
            getOptionsEl('imageFormat').value = result.imageFormat || defaults.imageFormat;
        }

        if (getOptionsEl('preserveHyperlinks')) {
            const preserveHyperlinksCheckbox = getOptionsEl('preserveHyperlinks');
            const preserveHyperlinksLabel = preserveHyperlinksCheckbox.nextElementSibling;
            const preserveHyperlinksCircle = preserveHyperlinksLabel.querySelector('span');
            preserveHyperlinksCheckbox.checked = result.preserveHyperlinks === 'yes';
            if (preserveHyperlinksCheckbox.checked) {
                preserveHyperlinksLabel.style.backgroundColor = '#34C759';
                preserveHyperlinksCircle.style.left = '22px';
            } else {
                preserveHyperlinksLabel.style.backgroundColor = '#E5E5EA';
                preserveHyperlinksCircle.style.left = '2px';
            }
        }

        // 目录设置
        if (getOptionsEl('generateTableOfContents')) {
            const generateTocCheckbox = getOptionsEl('generateTableOfContents');
            const generateTocLabel = generateTocCheckbox.nextElementSibling;
            const generateTocCircle = generateTocLabel.querySelector('span');
            
            generateTocCheckbox.checked = result.generateTableOfContents === 'yes';
            
            // 更新开关样式
            if (generateTocCheckbox.checked) {
                generateTocLabel.style.backgroundColor = '#34C759';
                generateTocCircle.style.left = '22px';
            } else {
                generateTocLabel.style.backgroundColor = '#E5E5EA';
                generateTocCircle.style.left = '2px';
            }
        }
        if (getOptionsEl('tocTitle')) {
            getOptionsEl('tocTitle').value = result.tocTitle || defaults.tocTitle;
        }
        applyFontSetting('tocTitleFontStyle', 'tocTitleFontCustom', result.tocTitleFontStyle, defaults.tocTitleFontStyle);
        if (getOptionsEl('tocTitleFontSize')) {
            getOptionsEl('tocTitleFontSize').value = result.tocTitleFontSize || defaults.tocTitleFontSize;
        }
        applyFontSetting('tocEntryFontStyle', 'tocEntryFontCustom', result.tocEntryFontStyle, defaults.tocEntryFontStyle);
        if (getOptionsEl('tocEntryFontSize')) {
            getOptionsEl('tocEntryFontSize').value = result.tocEntryFontSize || defaults.tocEntryFontSize;
        }

        // 标题层级设置
        [1, 2, 3].forEach((level) => {
            const recognizeKey = `heading${level}RecognizeType`;
            const fontKey = `heading${level}FontStyle`;
            const sizeKey = `heading${level}FontSize`;
            if (getOptionsEl(recognizeKey)) {
                getOptionsEl(recognizeKey).value = result[recognizeKey] || defaults[recognizeKey];
            }
            applyFontSetting(fontKey, `heading${level}FontCustom`, result[fontKey], defaults[fontKey]);
            if (getOptionsEl(sizeKey)) {
                getOptionsEl(sizeKey).value = result[sizeKey] || defaults[sizeKey];
            }
            this.updateHeadingFontSizeDisplay(level);
        });

        // 初始化可见性
        this.togglePageNumberSettingsVisibility();
        this.updateLineSpacingDisplay();
        this.updateFontSizeDisplay('title');
        this.updateFontSizeDisplay('body');
        
        // 初始化图片设置选项的可见性
        const imageSettingsContainer = getOptionsEl('imageSettingsContainer');
        const saveImagesCheckbox = getOptionsEl('saveImages');
        if (imageSettingsContainer && saveImagesCheckbox) {
            imageSettingsContainer.style.display = saveImagesCheckbox.checked ? 'flex' : 'none';
        }
        
        // 初始化目录设置选项的可见性
        const tocSettingsContainer = getOptionsEl('tocSettingsContainer');
        const generateTocCheckbox = getOptionsEl('generateTableOfContents');
        if (tocSettingsContainer && generateTocCheckbox) {
            tocSettingsContainer.style.display = generateTocCheckbox.checked ? 'flex' : 'none';
        }
    }
}

// 创建设置管理器实例
const settingsManager = new SettingsManager();

// ========== 扩展 UI 样式隔离（Shadow DOM，一次性阻断宿主页面 CSS 污染）==========
const docExportUIHost = document.createElement('div');
docExportUIHost.id = 'doc-export-ui-host';
const docExportUIShadow = docExportUIHost.attachShadow({ mode: 'open' });

const docExportUIBaseStyle = document.createElement('style');
docExportUIBaseStyle.textContent = `
    :host {
        all: initial;
        position: fixed;
        inset: 0;
        width: 0;
        height: 0;
        overflow: visible;
        z-index: 2147483645;
        pointer-events: none;
    }
    *, *::before, *::after {
        box-sizing: border-box;
    }
    :host, :host * {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: normal;
        letter-spacing: normal;
        text-transform: none;
        -webkit-font-smoothing: antialiased;
    }
    img {
        border: none;
        max-width: none;
        vertical-align: middle;
    }
    button, input, select, textarea {
        font: inherit;
        margin: 0;
    }
    .doc-export-toolbar-btn,
    .doc-export-toolbar-toggle {
        outline: none;
        -webkit-tap-highlight-color: transparent;
    }
    .content-panel::-webkit-scrollbar,
    .options-panel::-webkit-scrollbar {
        width: 8px;
    }
    .content-panel::-webkit-scrollbar-track,
    .options-panel::-webkit-scrollbar-track {
        background: transparent;
    }
    .content-panel::-webkit-scrollbar-thumb,
    .options-panel::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
    }
    .content-panel::-webkit-scrollbar-thumb:hover,
    .options-panel::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.3);
    }
    .content-panel,
    .options-panel,
    .doc-export-action-menu,
    .doc-export-edit-overlay,
    .doc-export-edit-modal {
        pointer-events: auto;
    }
    .doc-export-edit-overlay {
        position: fixed;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.6);
        z-index: 10050;
        cursor: pointer;
    }
    .doc-export-edit-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        width: min(800px, 90vw);
        max-height: 85vh;
        min-height: 0;
        overflow: hidden;
        z-index: 10051;
    }
    .doc-export-edit-modal-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .doc-export-edit-modal-footer {
        flex-shrink: 0;
    }
`;
docExportUIShadow.appendChild(docExportUIBaseStyle);

function appendDocExportUIStyles(cssText) {
    const el = document.createElement('style');
    el.textContent = cssText;
    docExportUIShadow.appendChild(el);
    return el;
}

function mountDocExportUIHost() {
    if (!document.body.contains(docExportUIHost)) {
        document.body.appendChild(docExportUIHost);
    }
}

function isNodeInDocExportUI(node) {
    if (!node) return false;
    const root = node.getRootNode();
    return root === docExportUIShadow || docExportUIShadow.contains(node);
}

/** Shadow DOM 内点击在 document 上会 retarget 到 host，需用 composedPath 判断真实目标 */
function isEventInNode(event, node) {
    if (!event || !node) return false;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    if (path && path.indexOf(node) !== -1) return true;
    return node === event.target || node.contains(event.target);
}

mountDocExportUIHost();

// 控制面板：同一锚点容器，整体移动
const dockRoot = document.createElement('div');
dockRoot.id = 'doc-export-dock-root';
dockRoot.style.position = 'fixed';
dockRoot.style.bottom = '5px';
dockRoot.style.right = '20px';
dockRoot.style.zIndex = '1000';
dockRoot.style.pointerEvents = 'none';
dockRoot.style.overflow = 'visible';
dockRoot.style.display = 'none';
docExportUIShadow.appendChild(dockRoot);

// 创建按钮容器
const buttonsContainer = document.createElement('div');
buttonsContainer.style.position = 'absolute';
buttonsContainer.style.bottom = '0';
buttonsContainer.style.right = '0';
buttonsContainer.style.zIndex = '1000';
buttonsContainer.style.display = 'flex';
buttonsContainer.style.alignItems = 'center';
buttonsContainer.classList.add('doc-export-toolbar-wrap');
buttonsContainer.style.pointerEvents = 'auto';
dockRoot.appendChild(buttonsContainer);

// 折叠/展开触发图标（右侧固定锚点）
const dockToggleContainer = document.createElement('div');
dockToggleContainer.classList.add('doc-export-toolbar-toggle');
buttonsContainer.appendChild(dockToggleContainer);

function dockAssetUrl(path) {
    try {
        return chrome.runtime.getURL(path);
    } catch (e) {
        return '';
    }
}

const dockTrayIcon = document.createElement('div');
dockTrayIcon.classList.add('doc-export-tray-icon');
dockTrayIcon.setAttribute('data-count', '0');
dockTrayIcon.setAttribute('aria-hidden', 'true');
dockTrayIcon.innerHTML = [
    '<img class="doc-export-tray-folder doc-export-tray-folder-empty" src="' + dockAssetUrl('images/file_empty.svg') + '" alt="" draggable="false">',
    '<img class="doc-export-tray-folder doc-export-tray-folder-full" src="' + dockAssetUrl('images/file_full.svg') + '" alt="" draggable="false">',
    '<span class="doc-export-tray-badge"></span>'
].join('');
dockToggleContainer.appendChild(dockTrayIcon);
const dockTrayBadge = dockTrayIcon.querySelector('.doc-export-tray-badge');
dockToggleContainer.title = '展开面板';
let dockTrayCount = 0;

function playDockFileFlyAnimation(fromClientX, fromClientY) {
    if (!dockTrayIcon || typeof fromClientX !== 'number' || typeof fromClientY !== 'number') return;

    const trayRect = dockTrayIcon.getBoundingClientRect();
    const targetX = trayRect.left + trayRect.width / 2;
    const targetY = trayRect.top + trayRect.height * 0.42;

    const flyer = document.createElement('div');
    flyer.className = 'doc-export-file-flyer';
    flyer.innerHTML = [
        '<div class="doc-export-file-flyer-sheet">',
        '<span></span><span></span><span></span>',
        '</div>'
    ].join('');
    flyer.style.left = fromClientX + 'px';
    flyer.style.top = fromClientY + 'px';
    docExportUIShadow.appendChild(flyer);

    const animation = flyer.animate([
        {
            left: fromClientX + 'px',
            top: fromClientY + 'px',
            transform: 'translate(-50%, -50%) scale(1) rotate(0deg)',
            opacity: 1
        },
        {
            left: targetX + 'px',
            top: targetY + 'px',
            transform: 'translate(-50%, -50%) scale(0.42) rotate(-6deg)',
            opacity: 0.92
        }
    ], {
        duration: 520,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'forwards'
    });

    animation.onfinish = function () {
        flyer.remove();
        dockTrayIcon.classList.add('dock-tray-landed');
        setTimeout(function () { dockTrayIcon.classList.remove('dock-tray-landed'); }, 320);
    };
    animation.oncancel = function () { flyer.remove(); };
}

function updateDockTrayIcon(count, opts) {
    if (!dockTrayIcon) return;
    const n = Math.max(0, count | 0);
    const prevN = dockTrayCount;
    dockTrayCount = n;

    dockTrayIcon.setAttribute('data-count', String(n));
    dockTrayIcon.classList.toggle('has-files', n > 0);

    if (n === 0) {
        dockTrayBadge.textContent = '';
        dockTrayBadge.classList.remove('visible');
    } else {
        dockTrayBadge.textContent = String(n);
        dockTrayBadge.classList.add('visible');
        if (n > prevN && !(opts && opts.skipAnimation)) {
            dockTrayBadge.classList.add('bump');
            setTimeout(function () { dockTrayBadge.classList.remove('bump'); }, 450);
        }
    }
}

chrome.storage.local.get(['temporaryStorage'], function (result) {
    updateDockTrayIcon((result.temporaryStorage || []).length, { skipAnimation: true });
});

// 功能按钮抽屉区（从图标左侧滑出，图标位置不变）
const dockDrawer = document.createElement('div');
dockDrawer.classList.add('doc-export-toolbar-drawer');
buttonsContainer.insertBefore(dockDrawer, dockToggleContainer);

let isToolbarExpanded = false;
let dockSuppressToggleClick = false;

function collapseToolbarPanels() {
    if (isPanelVisible) {
        contentPanel.style.display = 'none';
        toggleButton.src = safeGetURL('images/list.png');
        isPanelVisible = false;
        isViewingStoredContent = false;
    }
    if (isOptionsPanelVisible) {
        optionsPanel.style.display = 'none';
        optionsButton.src = safeGetURL('images/options.png');
        isOptionsPanelVisible = false;
    }
    if (typeof exportActionMenuVisible !== 'undefined' && exportActionMenuVisible) {
        hideExportActionMenu();
    }
    if (typeof dockContextMenuVisible !== 'undefined' && dockContextMenuVisible) {
        hideDockContextMenu();
    }
}

function refreshToolbarButtonIcons() {
    if (typeof toggleButton === 'undefined' || !toggleButton) return;
    toggleButton.src = safeGetURL(isPanelVisible ? 'images/list_active.png' : 'images/list.png');
    optionsButton.src = safeGetURL(isOptionsPanelVisible ? 'images/options_active.png' : 'images/options.png');
    if (typeof exportActionMenuVisible !== 'undefined' && exportActionMenuVisible) {
        outputButton.src = safeGetURL('images/output_active.png');
    } else if (pluginSettings.autoExportEnabled) {
        outputButton.src = safeGetURL('images/output_active.png');
    } else {
        outputButton.src = safeGetURL('images/output.png');
    }
}

function setToolbarExpanded(expanded) {
    if (isToolbarExpanded === expanded) return;
    isToolbarExpanded = expanded;
    buttonsContainer.classList.toggle('doc-export-toolbar-expanded', expanded);
    dockToggleContainer.title = expanded ? t('collapsePanel') : t('expandPanel');
    if (!expanded) {
        collapseToolbarPanels();
    } else {
        refreshToolbarButtonIcons();
        requestAnimationFrame(refreshToolbarButtonIcons);
    }
    updateFloatingPanelsPosition();
}

function toggleToolbarExpanded(ev) {
    if (ev) {
        ev.stopPropagation();
        ev.preventDefault();
    }
    setToolbarExpanded(!isToolbarExpanded);
}

dockToggleContainer.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    startDockDrag(e);
});

dockToggleContainer.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    if (dockSuppressToggleClick) {
        dockSuppressToggleClick = false;
        return;
    }
    toggleToolbarExpanded(e);
});

dockToggleContainer.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof exportActionMenuVisible !== 'undefined' && exportActionMenuVisible) {
        hideExportActionMenu();
    }
    toggleDockContextMenu(e);
});

// 创建 options 按钮容器
const optionsButtonContainer = document.createElement('div');
optionsButtonContainer.style.position = 'relative';
optionsButtonContainer.style.width = '30px';
optionsButtonContainer.style.height = '30px';
optionsButtonContainer.style.borderRadius = '50%';
optionsButtonContainer.style.backgroundColor = '#ffffff';
optionsButtonContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.1)';
optionsButtonContainer.style.display = 'flex';
optionsButtonContainer.style.alignItems = 'center';
optionsButtonContainer.style.justifyContent = 'center';
optionsButtonContainer.classList.add('doc-export-toolbar-btn');
optionsButtonContainer.title = t('formatSettings');
dockDrawer.appendChild(optionsButtonContainer);

// 创建 options 按钮
const optionsButton = document.createElement('img');
optionsButton.src = safeGetURL('images/options.png');
optionsButton.alt = t('formatSettings');
optionsButton.draggable = false;
optionsButton.style.width = '20px';
optionsButton.style.height = '20px';
optionsButtonContainer.appendChild(optionsButton);

// 创建 list 按钮容器
const toggleButtonContainer = document.createElement('div');
toggleButtonContainer.style.position = 'relative';
toggleButtonContainer.style.width = '30px';
toggleButtonContainer.style.height = '30px';
toggleButtonContainer.style.borderRadius = '50%';
toggleButtonContainer.style.backgroundColor = '#ffffff';
toggleButtonContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.1)';
toggleButtonContainer.style.display = 'flex';
toggleButtonContainer.style.alignItems = 'center';
toggleButtonContainer.style.justifyContent = 'center';
toggleButtonContainer.classList.add('doc-export-toolbar-btn');
toggleButtonContainer.title = t('contentManagement');
dockDrawer.appendChild(toggleButtonContainer);

// 创建 list 按钮
const toggleButton = document.createElement('img');
toggleButton.src = safeGetURL('images/list.png');
toggleButton.alt = t('contentManagement');
toggleButton.draggable = false;
toggleButton.style.width = '20px';
toggleButton.style.height = '20px';
toggleButtonContainer.appendChild(toggleButton);

// 创建 output 按钮容器
const outputButtonContainer = document.createElement('div');
outputButtonContainer.style.position = 'relative';
outputButtonContainer.style.width = '30px';
outputButtonContainer.style.height = '30px';
outputButtonContainer.style.borderRadius = '50%';
outputButtonContainer.style.backgroundColor = '#ffffff';
outputButtonContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.1)';
outputButtonContainer.style.display = 'flex';
outputButtonContainer.style.alignItems = 'center';
outputButtonContainer.style.justifyContent = 'center';
outputButtonContainer.classList.add('doc-export-toolbar-btn');
outputButtonContainer.title = t('exportDocument');
dockDrawer.appendChild(outputButtonContainer);

// 创建 output 按钮
const outputButton = document.createElement('img');
outputButton.alt = t('exportDocument');
outputButton.draggable = false;
outputButton.style.width = '20px';
outputButton.style.height = '20px';
outputButtonContainer.appendChild(outputButton);

// 检查自动导出功能状态并设置按钮样式
async function updateOutputButtonStyle() {
    try {
        const settings = await new Promise((resolve) => {
            safeStorageGet(['autoExportEnabled'], resolve);
        });
        
        if (settings.autoExportEnabled) {
            outputButton.src = safeGetURL('images/output.png');        
        } else {
            // 自动导出功能关闭时，使用普通图标
            outputButton.src = safeGetURL('images/output.png');
            outputButtonContainer.style.animation = 'none';
        }
    } catch (error) {
        console.warn('Failed to load auto export settings:', error);
        // 默认使用普通图标
        outputButton.src = safeGetURL('images/output.png');
        outputButtonContainer.style.animation = 'none';
    }
}

// 初始化按钮样式
updateOutputButtonStyle();

// 监听设置变化，更新按钮样式
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local' && changes.autoExportEnabled) {
        updateOutputButtonStyle();
    }
});



// 添加悬停效果
optionsButtonContainer.addEventListener('mouseenter', async function () {
    if (!isToolbarExpanded) return;
    optionsButton.src = safeGetURL('images/options_hover.png');
});
optionsButtonContainer.addEventListener('mouseleave', function () {
    if (isOptionsPanelVisible) {
        optionsButton.src = safeGetURL('images/options_active.png');
    } else {
        optionsButton.src = safeGetURL('images/options.png');
    }
});

outputButtonContainer.addEventListener('mouseenter', async function () {
    if (!isToolbarExpanded) return;
    outputButton.src = safeGetURL('images/output_hover.png');
});
outputButtonContainer.addEventListener('mouseleave', async function () {
    // 根据自动导出功能状态决定悬停离开时的图标
    try {
        const settings = await new Promise((resolve) => {
            safeStorageGet(['autoExportEnabled'], resolve);
        });
        
        if (settings.autoExportEnabled) {
            outputButton.src = safeGetURL('images/output_active.png');
        } else {
            outputButton.src = safeGetURL('images/output.png');
        }
    } catch (error) {
        outputButton.src = safeGetURL('images/output.png');
    }
});

// 移除操作栏中的connect按钮悬停效果

// 添加点击事件
optionsButtonContainer.addEventListener('click', function(event) {
    event.stopPropagation();
    try {
        // 设置按钮点击标志位，防止显示暂存、复制按钮
        isButtonClickInProgress = true;
        
        if (!isExtensionContextValid()) {
            notifyExtensionContextInvalidatedOnce();
            isButtonClickInProgress = false;
            return;
        }
        
        if (isOptionsPanelVisible) {
            // 关闭设置面板
            optionsPanel.style.display = 'none';
            optionsButton.src = safeGetURL('images/options.png');
            isOptionsPanelVisible = false;
            // 关闭面板时，延迟重置标志位
            setTimeout(() => {
                isButtonClickInProgress = false;
            }, 100);
        } else {
            // 如果list面板是打开的，先关闭它
            if (isPanelVisible) {
                contentPanel.style.display = 'none';
                toggleButton.src = safeGetURL('images/list.png');
                isPanelVisible = false;
                isViewingStoredContent = false;
            }
            
            // 加载设置面板内容
            loadOptionsPanel();
            optionsPanel.style.display = 'block';
            optionsPanel.style.pointerEvents = 'auto';
            optionsButton.src = safeGetURL('images/options_active.png');
            isOptionsPanelVisible = true;
            updateFloatingPanelsPosition();
            
            // 打开面板时，延迟更长时间重置标志位，确保loadOptionsPanel完成
            setTimeout(() => {
                isButtonClickInProgress = false;
            }, 300);
        }
    } catch (error) {
        console.warn('Error in options button click handler:', error);
        isButtonClickInProgress = false;
    }
});

// 移除操作栏中的connect按钮点击事件

// 导出按钮点击事件：弹出操作菜单（合并导出 / 逐篇导出）
outputButtonContainer.addEventListener('click', function(ev) {
    try {
        ev.stopPropagation();
        isButtonClickInProgress = true;

        if (!isExtensionContextValid()) {
            notifyExtensionContextInvalidatedOnce();
            isButtonClickInProgress = false;
            return;
        }

        document.querySelectorAll('.temporary-save-button, .selection-export-button, .copy-button').forEach(function (el) {
            if (el.parentElement) el.parentElement.remove();
        });
        isButtonVisible = false;

        if (isPanelVisible) {
            contentPanel.style.display = 'none';
            toggleButton.src = safeGetURL('images/list.png');
            isPanelVisible = false;
            isViewingStoredContent = false;
        }

        if (isOptionsPanelVisible) {
            optionsPanel.style.display = 'none';
            optionsButton.src = safeGetURL('images/options.png');
            isOptionsPanelVisible = false;
        }

        safeStorageGet(['temporaryStorage'], function(result) {
            if (!result.temporaryStorage || result.temporaryStorage.length === 0) {
                showNotification(t('noStoredContent'));
                setTimeout(function() { isButtonClickInProgress = false; }, 100);
                return;
            }
            toggleExportActionMenu(ev);
            setTimeout(function() { isButtonClickInProgress = false; }, 100);
        });
    } catch (error) {
        console.warn('Error in output button click handler:', error);
        showNotification(t('exportFailed'));
        setTimeout(function() { isButtonClickInProgress = false; }, 100);
    }
});

// 从popup.js复制的辅助函数
function isValidNumber(value) {
    const number = parseFloat(value);
    return !isNaN(number) && isFinite(number);
}

function parseMargin(value, defaultValue) {
    const margin = parseFloat(value);
    // 厘米到TWIP的精确换算：1厘米 = 566.9291338582677 TWIP
    // 1厘米 = 10毫米，1英寸 = 25.4毫米，1英寸 = 1440 TWIP
    // 所以 1厘米 = (1440 / 25.4) * 10 = 566.9291338582677 TWIP
    return isValidNumber(margin) ? Math.round(margin * 566.93) : Math.round(defaultValue * 566.93);
}

function getFontSizeInHalfPoints(size, defaultSize, mapping) {
    const parsedSize = parseFloat(size);
    if (!isValidNumber(parsedSize)) {
        return defaultSize * 2; // 返回默认大小（半磅单位）
    }
    
    // 检查是否有映射对应的值（中文字号）
    if (mapping && mapping[parsedSize]) {
        return mapping[parsedSize] * 2; // 使用映射表的值（半磅单位）
    }
    
    // 直接使用输入值（磅）转为半磅单位
    return parsedSize * 2;
}

function getLineSpacingValue(lineSpacing, fixedLineSpacing, multipleLineSpacing) {
    if (lineSpacing === 'fixed') {
        return { line: fixedLineSpacing * 20, lineRule: 'exact' };
    } else if (lineSpacing === '1.5') {
        return { line: 1.5 * 240, lineRule: 'auto' };
    } else if (lineSpacing === '2') {
        return { line: 2 * 240, lineRule: 'auto' };
    } else if (lineSpacing === 'multiple') {
        return { line: multipleLineSpacing * 240, lineRule: 'auto' };
    } else {
        return { line: 240, lineRule: 'auto' };
    }
}

const EXPORT_STORAGE_SETTING_KEYS = [
    'titleFontStyle', 'bodyFontStyle', 'titleFontSize', 'bodyFontSize',
    'paragraphSpacingBefore', 'paragraphSpacingAfter', 'pageMargins', 'lineSpacing',
    'fixedLineSpacing', 'multipleLineSpacing', 'firstLineIndent',
    'addPageNumbers', 'pageNumberPosition', 'pageNumberFontStyle',
    'pageNumberFontSize', 'pageNumberStyle', 'filenameFormat', 'exportFormat',
    'exportTextExcludeEnabled', 'exportTextExcludeCustom', 'userTags',
    'articleSeparator', 'customSeparator', 'saveTables', 'tableCellAlignment', 'saveImages', 'imageQuality',
    'imageMaxWidth', 'imageMaxHeight', 'imageFormat', 'preserveHyperlinks', 'generateTableOfContents',
    'tocTitle', 'tocTitleFontStyle', 'tocTitleFontSize', 'tocEntryFontStyle', 'tocEntryFontSize',
    'heading1RecognizeType', 'heading2RecognizeType', 'heading3RecognizeType',
    'heading1FontStyle', 'heading2FontStyle', 'heading3FontStyle',
    'heading1FontSize', 'heading2FontSize', 'heading3FontSize',
];

function getDefaultFilenameFormat() {
    return i18n.localizeFilenameFormat(i18n.getFormatDefaults().filenameFormat);
}

function buildProcessedExportSettings(settings) {
    const formatDefaults = i18n.getFormatDefaults();
    const chineseFontSizeMapping = {
        42: 42, 36: 36, 26: 26, 24: 24, 22: 22, 18: 18, 16: 16, 15: 15, 14: 14, 12: 12,
        10.5: 10.5, 9: 9, 7.5: 7.5, 6.5: 6.5, 5.5: 5.5, 5: 5
    };
    const pageMargins = settings.pageMargins || {
        top: 2.8, right: 2.8, bottom: 2.8, left: 2.8
    };
    return {
        titleFontStyle: settings.titleFontStyle || formatDefaults.titleFontStyle,
        bodyFontStyle: settings.bodyFontStyle || formatDefaults.bodyFontStyle,
        titleFontSize: getFontSizeInHalfPoints(settings.titleFontSize, 18, chineseFontSizeMapping),
        bodyFontSize: getFontSizeInHalfPoints(settings.bodyFontSize, 16, chineseFontSizeMapping),
        paragraphSpacingBefore: isValidNumber(settings.paragraphSpacingBefore) ? parseInt(settings.paragraphSpacingBefore, 10) : 0,
        paragraphSpacingAfter: isValidNumber(settings.paragraphSpacingAfter) ? parseInt(settings.paragraphSpacingAfter, 10) : 0,
        pageMargins: {
            top: parseMargin(pageMargins.top, 2.8),
            right: parseMargin(pageMargins.right, 2.8),
            bottom: parseMargin(pageMargins.bottom, 2.8),
            left: parseMargin(pageMargins.left, 2.8)
        },
        lineSpacing: settings.lineSpacing || 'single',
        fixedLineSpacing: settings.fixedLineSpacing || 20,
        multipleLineSpacing: settings.multipleLineSpacing || 3,
        firstLineIndent: isValidNumber(settings.firstLineIndent) ? parseInt(settings.firstLineIndent, 10) : 2,
        addPageNumbers: settings.addPageNumbers || 'yes',
        pageNumberPosition: settings.pageNumberPosition || 'footerCenter',
        pageNumberStyle: settings.pageNumberStyle || '1,2,3',
        pageNumberFontStyle: settings.pageNumberFontStyle || formatDefaults.pageNumberFontStyle,
        pageNumberFontSize: getFontSizeInHalfPoints(settings.pageNumberFontSize, 12, chineseFontSizeMapping),
        articleSeparator: settings.articleSeparator || 'newline',
        customSeparator: settings.customSeparator || '',
        saveTables: settings.saveTables || 'yes',
        tableCellAlignment: settings.tableCellAlignment || 'center',
        saveImages: settings.saveImages || 'yes',
        imageQuality: settings.imageQuality || 'medium',
        imageMaxWidth: settings.imageMaxWidth || 600,
        imageMaxHeight: settings.imageMaxHeight || 800,
        imageFormat: settings.imageFormat || 'jpeg',
        preserveHyperlinks: settings.preserveHyperlinks || 'no',
        generateTableOfContents: settings.generateTableOfContents || 'no',
        tocTitle: settings.tocTitle || formatDefaults.tocTitle,
        tocTitleFontStyle: settings.tocTitleFontStyle || formatDefaults.tocTitleFontStyle,
        tocTitleFontSize: settings.tocTitleFontSize || 16,
        tocEntryFontStyle: settings.tocEntryFontStyle || formatDefaults.tocEntryFontStyle,
        tocEntryFontSize: settings.tocEntryFontSize || 12,
        heading1RecognizeType: settings.heading1RecognizeType || 'chinese_comma',
        heading2RecognizeType: settings.heading2RecognizeType || 'chinese_paren',
        heading3RecognizeType: settings.heading3RecognizeType || 'number_dot',
        heading1FontStyle: settings.heading1FontStyle || formatDefaults.heading1FontStyle,
        heading2FontStyle: settings.heading2FontStyle || formatDefaults.heading2FontStyle,
        heading3FontStyle: settings.heading3FontStyle || formatDefaults.heading3FontStyle,
        heading1FontSize: getFontSizeInHalfPoints(settings.heading1FontSize, 16, chineseFontSizeMapping),
        heading2FontSize: getFontSizeInHalfPoints(settings.heading2FontSize, 16, chineseFontSizeMapping),
        heading3FontSize: getFontSizeInHalfPoints(settings.heading3FontSize, 16, chineseFontSizeMapping),
        exportFormat: settings.exportFormat === 'pdf' ? 'pdf' : 'docx',
        exportTextExcludeEnabled: settings.exportTextExcludeEnabled !== 'no' ? 'yes' : 'no',
        exportTextExcludeCustom: settings.exportTextExcludeCustom || '',
        pageMarginsCm: {
            top: parseFloat(pageMargins.top) || 2.8,
            right: parseFloat(pageMargins.right) || 2.8,
            bottom: parseFloat(pageMargins.bottom) || 2.8,
            left: parseFloat(pageMargins.left) || 2.8
        },
    };
}

/**
 * 创建导出 iframe。PDF 依赖 html2canvas 截图，不能用 display:none（会导致空白页）。
 */
function attachExportIframe() {
    const exportFrame = document.createElement('iframe');
    exportFrame.src = safeGetURL('export.html') + '?fromMessage=true';
    exportFrame.setAttribute('aria-hidden', 'true');
    exportFrame.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        'width:850px',
        'height:1200px',
        'opacity:0',
        'pointer-events:none',
        'border:none',
        'z-index:-1'
    ].join(';');
    document.body.appendChild(exportFrame);
    return exportFrame;
}

/** 合并多篇为一個 Word（与原导出按钮一致） */
function runMergedWordExport(temporaryStorage) {
    if (!temporaryStorage || temporaryStorage.length === 0) {
        showNotification(t('noContentToExport'));
        return;
    }
    showNotification(t('exporting'));
    safeStorageGet(EXPORT_STORAGE_SETTING_KEYS, function(settings) {
        const processedSettings = buildProcessedExportSettings(settings);
        try {
            const exportFrame = attachExportIframe();

            setTimeout(function() {
                exportFrame.contentWindow.postMessage({
                    type: 'EXPORT_DOCUMENT',
                    temporaryStorage: temporaryStorage,
                    settings: processedSettings,
                    filenameFormat: settings.filenameFormat || getDefaultFilenameFormat()
                }, '*');
            }, 1000);

            window.addEventListener('message', function mergedExportCompleteHandler(event) {
                if (event.data && event.data.type === 'EXPORT_COMPLETE') {
                    var articleCount = temporaryStorage.length;
                    showNotification(t('exportSuccess', { count: articleCount }));
                    window.removeEventListener('message', mergedExportCompleteHandler);
                    setTimeout(function() {
                        if (exportFrame && exportFrame.parentNode) {
                            exportFrame.parentNode.removeChild(exportFrame);
                        }
                    }, 1000);
                } else if (event.data && event.data.type === 'EXPORT_ERROR') {
                    showNotification(t('exportDocFailed', { error: event.data.error }));
                    window.removeEventListener('message', mergedExportCompleteHandler);
                    setTimeout(function() {
                        if (exportFrame && exportFrame.parentNode) {
                            exportFrame.parentNode.removeChild(exportFrame);
                        }
                    }, 1000);
                }
            });
        } catch (error) {
            console.warn('Error creating export frame:', error);
            showNotification(t('createExportPageFailed'));
        }
    });
}

/** 逐篇生成多篇 DOCX，打包为一个 ZIP 下载（popup 内 JSZip；浏览器端难以生成 RAR） */
function runPerArticleWordExport(temporaryStorage) {
    if (!temporaryStorage || temporaryStorage.length === 0) {
        showNotification(t('noContentToExport'));
        return;
    }
    showNotification(t('generatingZip'));
    safeStorageGet(EXPORT_STORAGE_SETTING_KEYS, function(settings) {
        const processedSettings = buildProcessedExportSettings(settings);
        const filenameFormat = settings.filenameFormat || getDefaultFilenameFormat();
        let exportFrame = null;

        function removeFrame() {
            if (exportFrame && exportFrame.parentNode) {
                exportFrame.parentNode.removeChild(exportFrame);
            }
            exportFrame = null;
        }

        try {
            exportFrame = attachExportIframe();

            function zipExportHandler(event) {
                if (!event.data || event.source !== exportFrame.contentWindow) return;
                if (event.data.type === 'EXPORT_COMPLETE') {
                    window.removeEventListener('message', zipExportHandler);
                    var n = temporaryStorage.length;
                    showNotification(t('zipDownloaded', { count: n }));
                    setTimeout(removeFrame, 800);
                } else if (event.data.type === 'EXPORT_ERROR') {
                    window.removeEventListener('message', zipExportHandler);
                    showNotification(t('zipFailed', { error: event.data.error }));
                    removeFrame();
                }
            }
            window.addEventListener('message', zipExportHandler);

            setTimeout(function() {
                if (!exportFrame || !exportFrame.contentWindow) return;
                exportFrame.contentWindow.postMessage({
                    type: 'EXPORT_ARTICLES_ZIP',
                    temporaryStorage: temporaryStorage,
                    settings: processedSettings,
                    filenameFormat: filenameFormat
                }, '*');
            }, 1200);
        } catch (error) {
            console.warn('runPerArticleWordExport:', error);
            showNotification(t('cannotStartExport'));
            removeFrame();
        }
    });
}

let exportActionMenuEl = null;
let exportActionMenuVisible = false;

function ensureExportActionMenu() {
    if (exportActionMenuEl) return exportActionMenuEl;

    const st = document.createElement('style');
    st.textContent = [
        '.doc-export-action-menu{position:fixed;display:none;z-index:10002;box-sizing:border-box;width:380px;',
        'background:#F2F2F7;border:none;border-radius:16px;padding:10px;',
        'box-shadow:0 8px 32px rgba(0,0,0,0.12);overflow:visible;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
        '.doc-export-action-menu-inner{background:#fff;border-radius:12px;overflow:hidden;}',
        '.doc-export-action-menu-inner button{display:block;width:100%;padding:14px 16px;margin:0;border:none;',
        'background:#fff;text-align:left;font-size:15px;font-weight:500;color:#1C1C1E;cursor:pointer;',
        '-webkit-font-smoothing:antialiased;}',
        '.doc-export-action-menu-inner button:hover{background:#F9F9F9;}',
        '.doc-export-action-menu-inner button:active{background:#F2F2F7;}',
        '.doc-export-action-menu-inner button+button{border-top:1px solid #E5E5EA;}',
        '.doc-export-action-menu-title{text-align:center;margin:0;padding:6px 8px 10px;font-size:18px;font-weight:600;color:#333;}'
    ].join('');
    appendDocExportUIStyles(st.textContent);

    const menu = document.createElement('div');
    menu.className = 'doc-export-action-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
        '<div class="doc-export-action-menu-title">' + t('exportModeTitle') + '</div>' +
        '<div class="doc-export-action-menu-inner" role="presentation">' +
        '<button type="button" data-export-action="merged" role="menuitem">' + t('exportMerged') + '</button>' +
        '<button type="button" data-export-action="perArticle" role="menuitem">' + t('exportPerArticle') + '</button>' +
        '</div>';
    docExportUIShadow.appendChild(menu);

    menu.querySelectorAll('[data-export-action]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var action = btn.getAttribute('data-export-action');
            hideExportActionMenu();
            safeStorageGet(['temporaryStorage'], function(result) {
                var list = result.temporaryStorage || [];
                if (!list.length) {
                    showNotification(t('noStoredContent'));
                    return;
                }
                if (action === 'merged') {
                    runMergedWordExport(list);
                } else if (action === 'perArticle') {
                    runPerArticleWordExport(list);
                }
            });
        });
    });

    exportActionMenuEl = menu;
    return menu;
}

function positionExportActionMenu() {
    const menu = ensureExportActionMenu();
    const vh = window.innerHeight;
    const r = dockPos.right;
    const b = dockPos.bottom;
    const toolbarH = buttonsContainer.offsetHeight || 40;
    const gapAboveToolbar = toolbarH + PANEL_DOCK_GAP;
    const gapBelowToolbar = PANEL_DOCK_GAP;
    const toolbarBottomFromTop = vh - b;
    const panelsOpenBelow = isDockInUpperScreenHalf();

    menu.style.position = 'fixed';
    menu.style.right = r + 'px';
    menu.style.left = 'auto';
    menu.style.width = '380px';
    menu.style.zIndex = '1002';

    if (panelsOpenBelow) {
        const topPx = Math.max(8, toolbarBottomFromTop + gapBelowToolbar);
        menu.style.top = topPx + 'px';
        menu.style.bottom = 'auto';
    } else {
        menu.style.bottom = (b + gapAboveToolbar) + 'px';
        menu.style.top = 'auto';
    }
}

function hideExportActionMenu() {
    if (!exportActionMenuEl) return;
    exportActionMenuEl.style.display = 'none';
    exportActionMenuVisible = false;
    document.removeEventListener('click', exportActionMenuOutsideClose, true);
    refreshToolbarButtonIcons();
}

function exportActionMenuOutsideClose(e) {
    if (!exportActionMenuEl || !exportActionMenuVisible) return;
    if (isEventInNode(e, exportActionMenuEl)) return;
    if (isEventInNode(e, outputButtonContainer)) return;
    hideExportActionMenu();
}

function toggleExportActionMenu(ev) {
    const menu = ensureExportActionMenu();
    if (exportActionMenuVisible) {
        hideExportActionMenu();
        return;
    }
    if (typeof dockContextMenuVisible !== 'undefined' && dockContextMenuVisible) {
        hideDockContextMenu();
    }
    positionExportActionMenu();
    menu.style.display = 'block';
    menu.style.pointerEvents = 'auto';
    exportActionMenuVisible = true;
    refreshToolbarButtonIcons();
    setTimeout(function() {
        document.addEventListener('click', exportActionMenuOutsideClose, true);
    }, 0);
}

let dockContextMenuEl = null;
let dockContextMenuVisible = false;

function ensureDockContextMenu() {
    if (dockContextMenuEl) return dockContextMenuEl;

    const st = document.createElement('style');
    st.textContent = [
        '.doc-export-dock-context-menu{position:fixed;display:none;z-index:10003;box-sizing:border-box;min-width:132px;',
        'background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:10px;padding:4px;',
        'box-shadow:0 4px 20px rgba(0,0,0,0.12);overflow:hidden;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
        '.doc-export-dock-context-menu button{display:block;width:100%;padding:9px 14px;margin:0;border:none;',
        'background:transparent;text-align:left;font-size:13px;font-weight:500;color:#1C1C1E;cursor:pointer;',
        'border-radius:6px;white-space:nowrap;-webkit-font-smoothing:antialiased;}',
        '.doc-export-dock-context-menu button:hover{background:#F2F2F7;}',
        '.doc-export-dock-context-menu button:active{background:#E8E8ED;}'
    ].join('');
    appendDocExportUIStyles(st.textContent);

    const menu = document.createElement('div');
    menu.className = 'doc-export-dock-context-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
        '<button type="button" data-dock-action="clear" role="menuitem">' + t('clearStorage') + '</button>' +
        '<button type="button" data-dock-action="export" role="menuitem">' + t('exportDocument') + '</button>';
    docExportUIShadow.appendChild(menu);

    menu.querySelector('[data-dock-action="clear"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideDockContextMenu();
        clearAllTemporaryStorage();
    });
    menu.querySelector('[data-dock-action="export"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideDockContextMenu();
        exportAllStoredContent();
    });

    dockContextMenuEl = menu;
    return menu;
}

function positionDockContextMenu() {
    const menu = ensureDockContextMenu();
    const rect = dockToggleContainer.getBoundingClientRect();
    const menuW = menu.offsetWidth || 148;
    const menuH = menu.offsetHeight || 80;
    const gap = 8;
    const pad = 8;
    const vw = window.innerWidth;

    let left = rect.left + (rect.width - menuW) / 2;
    left = Math.min(Math.max(pad, left), vw - menuW - pad);

    let top = rect.top - menuH - gap;
    top = Math.max(pad, top);

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
}

function hideDockContextMenu() {
    if (!dockContextMenuEl) return;
    dockContextMenuEl.style.display = 'none';
    dockContextMenuVisible = false;
    document.removeEventListener('click', dockContextMenuOutsideClose, true);
}

function dockContextMenuOutsideClose(e) {
    if (!dockContextMenuEl || !dockContextMenuVisible) return;
    if (isEventInNode(e, dockContextMenuEl)) return;
    if (isEventInNode(e, dockToggleContainer)) return;
    hideDockContextMenu();
}

function toggleDockContextMenu(ev) {
    const menu = ensureDockContextMenu();
    if (dockContextMenuVisible) {
        hideDockContextMenu();
        return;
    }
    positionDockContextMenu();
    menu.style.display = 'block';
    menu.style.pointerEvents = 'auto';
    dockContextMenuVisible = true;
    setTimeout(function () {
        document.addEventListener('click', dockContextMenuOutsideClose, true);
    }, 0);
}

function clearAllTemporaryStorage() {
    try {
        safeStorageGet(['temporaryStorage'], function (result) {
            if (!(result.temporaryStorage || []).length) {
                showNotification(t('storageEmpty'));
                return;
            }
            if (!confirm(t('confirmClearStorage'))) return;
            safeStorageSet({ temporaryStorage: [] }, function () {
                showNotification(t('storageCleared'));
                articles.length = 0;
                if (typeof updateDockTrayIcon === 'function') {
                    updateDockTrayIcon(0);
                }
                if (isPanelVisible && isViewingStoredContent) {
                    refreshStoredContentPanel();
                }
                try {
                    chrome.runtime.sendMessage({ action: 'updateArticleList', data: { cleared: true } });
                } catch (err) {
                    console.warn('通知其他标签页失败:', err);
                }
            });
        });
    } catch (error) {
        console.warn('Error in clearAllTemporaryStorage:', error);
        showNotification(t('exportFailed'));
    }
}

function calculateFirstLineIndent(fontSize, firstLineIndent) {
    const fontSizeInPoints = fontSize / 2;
    return Math.round(fontSizeInPoints * firstLineIndent * 20);
}

function createFooterWithPageNumber(settings) {
    const footer = new docx.Footer({
        children: [
            new docx.Paragraph({
                alignment:
                    settings.pageNumberPosition === "footerLeft" ? docx.AlignmentType.LEFT :
                    settings.pageNumberPosition === "footerCenter" ? docx.AlignmentType.CENTER :
                    docx.AlignmentType.RIGHT,
                children: [
                    new docx.TextRun({
                        children: [docx.PageNumber.CURRENT],
                        font: settings.pageNumberFontStyle,
                        size: settings.pageNumberFontSize,
                    }),
                ],
            }),
        ],
    });
    return footer;
}

// 生成目录函数
function generateTableOfContents(formattedTexts, tocSettings) {
    const tocParagraphs = [];
    
    // 添加目录标题
    tocParagraphs.push(new docx.Paragraph({
        children: [
            new docx.TextRun({
                text: tocSettings.tocTitle || '目录',
                font: tocSettings.tocTitleFontStyle || '黑体',
                size: tocSettings.tocTitleFontSize || 32, // 已经是半磅单位
                bold: true
            })
        ],
        alignment: docx.AlignmentType.CENTER,
        spacing: {
            before: 400,
            after: 600
        }
    }));
    
    // 为每篇文章生成目录条目
    formattedTexts.forEach((item, index) => {
        const textParts = item.text.split('\n\n\n');
        
        if (textParts.length > 0) {
            const firstTextPart = textParts[0];
            const textSections = firstTextPart
                .trim()
                .split('\n')
                .map(section => section.trim())
                .filter(section => section.length > 0);
            
            if (textSections.length > 0) {
                let titleText = textSections[0];
                // 移除图片占位符
                titleText = titleText.replace(/\[image\d{2}\]/g, '');
                // 去除首尾空格
                titleText = titleText.trim();
                
                if (titleText) {
                    // 生成书签ID
                    const bookmarkId = `bookmark_${index}`;
                    
                    // 创建目录条目段落，使用InternalHyperlink
                    const tocEntry = new docx.Paragraph({
                        children: [
                            // 序号
                            new docx.TextRun({
                                text: `${index + 1}. `,
                                font: tocSettings.tocEntryFontStyle || '宋体',
                                size: tocSettings.tocEntryFontSize, // 使用传入的字号设置
                                color: '000000' // 黑色
                            }),
                            // 超链接标题
                            new docx.InternalHyperlink({
                                children: [
                                    new docx.TextRun({
                                        text: titleText,
                                        font: tocSettings.tocEntryFontStyle || '宋体',
                                        size: tocSettings.tocEntryFontSize, // 使用传入的字号设置
                                        color: '000000', // 黑色
                                        underline: {
                                            type: docx.UnderlineType.SINGLE,
                                            color: '000000'
                                        }
                                    })
                                ],
                                anchor: bookmarkId
                            })
                        ],
                        spacing: {
                            before: 120,
                            after: 120
                        },
                        indent: {
                            left: 0,
                            right: 0,
                            firstLine: 0
                        }
                    });
                    
                    tocParagraphs.push(tocEntry);
                }
            }
        }
    });
    
    // 添加分页符，分隔目录和正文
    tocParagraphs.push(new docx.Paragraph({
        children: [],
        pageBreakBefore: true,
        spacing: {
            before: 400,
            after: 400
        }
    }));
    
    return tocParagraphs;
}


// list 按钮的悬停效果
toggleButtonContainer.addEventListener('mouseenter', async function () {
    if (!isToolbarExpanded || isPanelVisible) return;
    toggleButton.src = safeGetURL('images/list_hover.png');
});
toggleButtonContainer.addEventListener('mouseleave', async function () {
    if (!isPanelVisible) {
        toggleButton.src = safeGetURL('images/list.png');
    }
});

// 创建内容显示区域
const contentPanel = document.createElement('div');
contentPanel.style.position = 'fixed';
contentPanel.style.bottom = '55px';
contentPanel.style.right = '20px';
contentPanel.style.zIndex = 1000;
contentPanel.style.backgroundColor = '#fff';
contentPanel.style.border = '1px solid #ddd';
contentPanel.style.borderRadius = '16px';
contentPanel.style.padding = '10px';
contentPanel.style.width = '320px';
contentPanel.style.maxHeight = '650px'; // 统一面板最大高度
contentPanel.style.overflowY = 'auto';
contentPanel.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.1)';
contentPanel.style.display = 'none'; // 默认隐藏
contentPanel.className = 'content-panel';
docExportUIShadow.appendChild(contentPanel);

// 设置面板是否可见
let isOptionsPanelVisible = false;
// 内容面板是否可见
let isPanelVisible = false;

// list 按钮的点击效果
toggleButtonContainer.addEventListener('click', function (event) {
    // 阻止事件冒泡，防止点击按钮时触发document的点击事件
    event.stopPropagation();
    
    // 设置按钮点击标志位，防止显示暂存、复制按钮
    isButtonClickInProgress = true;
    
    if (isPanelVisible) {
        // 关闭文章列表面板
        contentPanel.style.display = 'none';
        toggleButton.src = safeGetURL('images/list.png');
        isPanelVisible = false;
        isViewingStoredContent = false; // 重置查看暂存内容标志
        
        // 延迟重置标志位
        setTimeout(() => {
            isButtonClickInProgress = false;
        }, 100);
    } else {
        // 如果设置面板是打开的，先关闭它
        if (isOptionsPanelVisible) {
            optionsPanel.style.display = 'none';
            optionsButton.src = safeGetURL('images/options.png');
            isOptionsPanelVisible = false;
        }
        
        // 从 chrome.storage 中读取暂存内容
        safeStorageGet(['temporaryStorage'], function (data) {
            let savedTexts = data.temporaryStorage || [];
            contentPanel.innerHTML = ''; // 清空面板内容
            
            // 设置面板基础样式
            contentPanel.style.backgroundColor = '#F2F2F7';
            contentPanel.style.border = 'none';
            contentPanel.style.borderRadius = '16px';
            contentPanel.style.padding = '10px';
            contentPanel.style.width = '380px';
            contentPanel.style.maxHeight = '650px';
            contentPanel.style.overflowY = 'auto';
            contentPanel.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
            
            // 创建标题栏（添加class以应用紧凑样式）
            const titleBar = document.createElement('div');
            titleBar.className = 'title-bar';
            titleBar.style.display = 'flex';
            titleBar.style.justifyContent = 'center';
            titleBar.style.alignItems = 'center';
            titleBar.style.padding = '15px';
            titleBar.style.marginBottom = '5px';
            contentPanel.appendChild(titleBar);
            
            const title = document.createElement('h3');
            title.textContent = t('storedContentTitle');
            title.style.margin = '0';
            title.style.fontSize = '18px';
            title.style.color = '#333';
            title.style.fontWeight = '600';
            titleBar.appendChild(title);
            
            // 创建顶部操作栏（添加class以应用紧凑样式）
            const topBar = document.createElement('div');
            topBar.className = 'top-bar';
            topBar.style.display = 'flex';
            topBar.style.alignItems = 'center';
            topBar.style.marginBottom = '10px';
            topBar.style.padding = '0 5px';
            contentPanel.appendChild(topBar);
            
            // 添加全选复选框
            const selectAllCheckbox = document.createElement('input');
            selectAllCheckbox.type = 'checkbox';
            selectAllCheckbox.style.marginRight = '10px';
            selectAllCheckbox.style.cursor = 'pointer';
            selectAllCheckbox.style.width = '16px';
            selectAllCheckbox.style.height = '16px';
            selectAllCheckbox.style.accentColor = '#007AFF';
            selectAllCheckbox.style.position = 'relative';
            selectAllCheckbox.style.zIndex = '10';
            selectAllCheckbox.style.opacity = '1';
            selectAllCheckbox.style.visibility = 'visible';
            selectAllCheckbox.style.marginTop = '3px'; // 与下面的多选框对齐
            selectAllCheckbox.style.marginLeft = '12px'; // 向右移动，与下面的多选框居中对齐
            selectAllCheckbox.style.padding = '0 0 0 10px';
            selectAllCheckbox.addEventListener('change', function () {
                const checkboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                const isChecked = this.checked;
                checkboxes.forEach(cb => {
                    cb.checked = isChecked;
                });
                // 更新按钮显示状态
                updateBatchButtonsVisibility();
            });
            selectAllCheckbox.id = 'selectAllCheckbox';
            topBar.appendChild(selectAllCheckbox);
            
            

            // 添加搜索框
            const searchBox = document.createElement('input');
            searchBox.type = 'text';
            searchBox.placeholder = t('searchPlaceholder');
            searchBox.className = 'search-box';
            searchBox.style.width = '100%';
            searchBox.style.padding = '8px 12px';
            searchBox.style.border = '1px solid #D1D1D6';
            searchBox.style.borderRadius = '8px';
            searchBox.style.fontSize = '14px';
            searchBox.style.boxSizing = 'border-box';
            searchBox.style.backgroundColor = '#F9F9F9';
            searchBox.style.color = '#1C1C1E';
            searchBox.style.marginBottom = '10px';
            topBar.appendChild(searchBox);

            
            // 添加批量导出按钮
            const batchExportButton = document.createElement('img');
            batchExportButton.src = safeGetURL('images/batch_output.png');
            batchExportButton.style.width = '24px';
            batchExportButton.style.height = '24px';
            batchExportButton.style.cursor = 'pointer';
            batchExportButton.style.transition = 'transform 0.2s ease';
            batchExportButton.style.marginLeft = '8px';
            batchExportButton.style.display = 'none'; // 初始隐藏
            batchExportButton.title = t('batchExport');
            batchExportButton.addEventListener('mouseenter', () => batchExportButton.style.transform = 'scale(1.1)');
            batchExportButton.addEventListener('mouseleave', () => batchExportButton.style.transform = 'scale(1)');
            batchExportButton.addEventListener('click', function () {
                const checkboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                const selectedIndexes = [];
                checkboxes.forEach((checkbox, index) => {
                    if (checkbox.checked) {
                        selectedIndexes.push(index);
                    }
                });
                if (selectedIndexes.length > 0) {
                    // 获取选中的文章
                    const selectedArticles = selectedIndexes.map(index => savedTexts[index]);
                    
                    // 显示导出提示
                    showNotification(t('exportingSelected'));
                    
                    // 获取用户设置
                    safeStorageGet(EXPORT_STORAGE_SETTING_KEYS, function(settings) {
                        const processedSettings = buildProcessedExportSettings(settings);

                        try {
                            // 创建导出页面的iframe
                            const exportFrame = attachExportIframe();

                            // 给脚本足够时间加载
                            setTimeout(() => {
                                exportFrame.contentWindow.postMessage({
                                    type: 'EXPORT_DOCUMENT',
                                    temporaryStorage: selectedArticles,
                                    settings: processedSettings,
                                    filenameFormat: settings.filenameFormat || getDefaultFilenameFormat()
                                }, '*');
                            }, 1000);

                            // 监听导出完成事件
                            window.addEventListener('message', function exportCompleteHandler(event) {
                                if (event.data && event.data.type === 'EXPORT_COMPLETE') {
                                    const selectedCount = selectedArticles.length;
                                    showNotification(t('batchExportSuccess', { count: selectedCount }));
                                    
                                    window.removeEventListener('message', exportCompleteHandler);
                                    // 移除iframe
                                    setTimeout(() => {
                                        if (exportFrame && exportFrame.parentNode) {
                                            exportFrame.parentNode.removeChild(exportFrame);
                                        }
                                    }, 1000);
                                } else if (event.data && event.data.type === 'EXPORT_ERROR') {
                                    showNotification(t('batchExportFailed', { error: event.data.error }));
                                    window.removeEventListener('message', exportCompleteHandler);
                                    // 移除iframe
                                    setTimeout(() => {
                                        if (exportFrame && exportFrame.parentNode) {
                                            exportFrame.parentNode.removeChild(exportFrame);
                                        }
                                    }, 1000);
                                }
                            });
                        } catch (error) {
                            console.warn('Error creating export frame:', error);
                            showNotification(t('createExportPageFailed'));
                        }
                    });
                } else {
                    alert(t('selectContentToExport'));
                }
            });
            topBar.appendChild(batchExportButton);

            // 添加批量删除按钮
            const batchDeleteButton = document.createElement('img');
            batchDeleteButton.src = safeGetURL('images/delete.png');
            batchDeleteButton.style.width = '24px';
            batchDeleteButton.style.height = '24px';
            batchDeleteButton.style.cursor = 'pointer';
            batchDeleteButton.style.transition = 'transform 0.2s ease';
            batchDeleteButton.style.marginLeft = '8px';
            batchDeleteButton.style.display = 'none'; // 初始隐藏
            batchDeleteButton.title = t('batchDelete');
            batchDeleteButton.addEventListener('mouseenter', () => batchDeleteButton.style.transform = 'scale(1.1)');
            batchDeleteButton.addEventListener('mouseleave', () => batchDeleteButton.style.transform = 'scale(1)');
            batchDeleteButton.addEventListener('click', function () {
                const checkboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                const selectedIndexes = [];
                checkboxes.forEach((checkbox, index) => {
                    if (checkbox.checked) {
                        selectedIndexes.push(index);
                    }
                });
                if (selectedIndexes.length > 0) {
                    if (confirm(t('confirmDeleteSelected'))) {
                        safeStorageGet(['temporaryStorage'], function (data) {
                            let savedTexts = data.temporaryStorage || [];
                            savedTexts = savedTexts.filter((_, index) => !selectedIndexes.includes(index));
                            safeStorageSet({ temporaryStorage: savedTexts }, function () {
                                toggleButton.click(); // 关闭面板
                                toggleButton.click(); // 重新打开面板
                            });
                        });
                    }
                } else {
                    alert(t('selectContentToDelete'));
                }
            });
            topBar.appendChild(batchDeleteButton);

            // 更新批量按钮显示状态的函数
            function updateBatchButtonsVisibility() {
                const checkboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                const hasSelected = Array.from(checkboxes).some(cb => cb.checked);
                
                batchDeleteButton.style.display = hasSelected ? 'block' : 'none';
                batchExportButton.style.display = hasSelected ? 'block' : 'none';
            }
            
            // 如果内容为空，显示提示信息
            if (savedTexts.length === 0) {
                const emptyContainer = document.createElement('div');
                emptyContainer.className = 'empty-container';
                emptyContainer.style.background = 'white';
                emptyContainer.style.borderRadius = '12px';
                emptyContainer.style.padding = '30px 20px';
                emptyContainer.style.textAlign = 'center';
                emptyContainer.style.color = '#8E8E93';
                contentPanel.appendChild(emptyContainer);
                
                const icon = document.createElement('div');
                icon.textContent = '📄';
                icon.style.fontSize = '40px';
                icon.style.marginBottom = '15px';
                emptyContainer.appendChild(icon);
                
                const text = document.createElement('div');
                text.textContent = t('noStoredContent');
                text.style.fontSize = '14px';
                text.style.fontWeight = '500';
                emptyContainer.appendChild(text);
            } else {
                // 如果有内容，显示文章列表
                savedTexts.forEach((text, index) => {
                    // 获取第一行作为标题
                    const lines = text.text.split('\n');
                    const title = lines[0] || t('untitled');
                    
                    // 创建每篇文章的容器
                    const articleContainer = document.createElement('div');
                    articleContainer.style.position = 'relative';
                    articleContainer.style.marginBottom = '10px';
                    articleContainer.style.backgroundColor = 'white';
                    articleContainer.style.borderRadius = '12px';
                    articleContainer.style.padding = '8px 16px 16px 8px'; // 左侧8px
                    articleContainer.style.transition = 'all 0.2s ease';
                    articleContainer.style.boxSizing = 'border-box';
                    articleContainer.style.border = '1px solid transparent';
                    articleContainer.style.cursor = 'default';
                    articleContainer.setAttribute('data-index', index);
                    articleContainer.style.minHeight = '120px';
                    
                    // 创建左侧侧边栏区域（纵向排列多选框和序号）
                    const sideBar = document.createElement('div');
                    sideBar.style.display = 'flex';
                    sideBar.style.flexDirection = 'column';
                    sideBar.style.alignItems = 'center';
                    sideBar.style.justifyContent = 'space-between';
                    sideBar.style.width = '28px';
                    sideBar.style.height = '100%';
                    sideBar.style.marginRight = '2px';
                    sideBar.style.padding = '0';
                    sideBar.style.marginTop = '0';

                    // 多选框显示控制函数
                    function updateCheckboxVisibility() {
                        // 获取所有checkboxWrapper和checkbox
                        const allCheckboxWrappers = contentPanel.querySelectorAll('.article-checkbox-wrapper');
                        const allCheckboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                        const anyChecked = Array.from(allCheckboxes).some(cb => cb.checked);
                        const selectAll = selectAllCheckbox && selectAllCheckbox.checked;
                        allCheckboxWrappers.forEach(wrapper => {
                            if (anyChecked || selectAll) {
                                wrapper.style.opacity = '1';
                                wrapper.style.pointerEvents = 'auto';
                            } else {
                                wrapper.style.opacity = '0';
                                wrapper.style.pointerEvents = 'none';
                            }
                        });
                    }

                    // 全选复选框change时也要刷新多选框显示
                    selectAllCheckbox.addEventListener('change', function() {
                        updateCheckboxVisibility();
                    });

                    // 占位flex空间让序号纵向居中，间隔更大
                    const flexSpacer = document.createElement('div');
                    flexSpacer.style.flex = '2';
                    sideBar.appendChild(flexSpacer);

                    // 序号背景容器
                    const indexWrapper = document.createElement('div');
                    indexWrapper.style.display = 'flex';
                    indexWrapper.style.alignItems = 'center';
                    indexWrapper.style.justifyContent = 'center';
                    indexWrapper.style.width = '28px';
                    indexWrapper.style.height = '28px';
                    indexWrapper.style.background = '#EAF4FF';
                    indexWrapper.style.borderRadius = '8px';
                    indexWrapper.style.boxShadow = '0 1px 2px rgba(0,122,255,0.04)';
                    indexWrapper.style.flexShrink = '0';
                    indexWrapper.style.marginBottom = '8px';
                    indexWrapper.style.marginTop = '0';
                    indexWrapper.style.padding = '0';

                    // 序号文本
                    const indexText = document.createElement('span');
                    indexText.textContent = (index + 1).toString();
                    indexText.style.fontSize = '15px';
                    indexText.style.fontWeight = '600';
                    indexText.style.color = '#007AFF';
                    indexWrapper.appendChild(indexText);
                    sideBar.appendChild(indexWrapper);

                    // 多选框背景容器
                    const checkboxWrapper = document.createElement('div');
                    checkboxWrapper.className = 'article-checkbox-wrapper';
                    checkboxWrapper.style.display = 'flex';
                    checkboxWrapper.style.alignItems = 'center';
                    checkboxWrapper.style.justifyContent = 'center';
                    checkboxWrapper.style.width = '28px';
                    checkboxWrapper.style.height = '28px';
                    checkboxWrapper.style.background = '#F2F2F7';
                    checkboxWrapper.style.borderRadius = '8px';
                    checkboxWrapper.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                    checkboxWrapper.style.flexShrink = '0';
                    checkboxWrapper.style.marginTop = '0';
                    checkboxWrapper.style.marginBottom = '0';
                    checkboxWrapper.style.padding = '0';
                    checkboxWrapper.style.opacity = '0';
                    checkboxWrapper.style.pointerEvents = 'none';                    
                    
                    // 创建序号复选框
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.style.cursor = 'pointer';
                    checkbox.style.width = '16px';
                    checkbox.style.height = '16px';
                    checkbox.style.accentColor = '#007AFF';
                    checkbox.style.position = 'relative';
                    checkbox.style.zIndex = '10';
                    checkbox.style.opacity = '1';
                    checkbox.style.visibility = 'visible';
                    checkbox.addEventListener('change', function() {
                        const allCheckboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                        const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
                        selectAllCheckbox.checked = allChecked;
                        // 更新批量按钮显示状态
                        updateBatchButtonsVisibility();
                        updateCheckboxVisibility();
                    });
                    checkboxWrapper.appendChild(checkbox);
                    sideBar.appendChild(checkboxWrapper);                    

                    // 创建左侧内容区域
                    const leftSection = document.createElement('div');
                    leftSection.style.display = 'flex';
                    leftSection.style.alignItems = 'center';
                    leftSection.style.flex = '1';
                    leftSection.style.minWidth = '0';
                    leftSection.style.gap = '2px';
                    // 横向排列sideBar和内容
                    articleContainer.style.display = 'flex';
                    articleContainer.style.flexDirection = 'row';
                    articleContainer.appendChild(sideBar);
                    articleContainer.appendChild(leftSection);
                    
                    // 创建文章内容容器
                    const contentWrapper = document.createElement('div');
                    contentWrapper.style.flex = '1';
                    contentWrapper.style.minWidth = '0';
                    contentWrapper.style.overflow = 'hidden';
                    contentWrapper.style.display = 'flex';
                    contentWrapper.style.flexDirection = 'column';
                    contentWrapper.style.gap = '8px';
                    leftSection.appendChild(contentWrapper);
                    
                    // 创建文章标题
                    const contentItem = document.createElement('div');
                    const truncatedTitle = title.length > 40 ? title.substring(0, 40) + '...' : title;
                    contentItem.textContent = `${truncatedTitle}`;
                    contentItem.style.fontSize = '15px';
                    contentItem.style.color = '#1C1C1E';
                    contentItem.style.fontWeight = '600';
                    contentItem.style.whiteSpace = 'normal';
                    contentItem.style.overflow = 'hidden';
                    contentItem.style.textOverflow = 'ellipsis';
                    contentItem.style.lineHeight = '1.4';
                    contentWrapper.appendChild(contentItem);
                    
                    // 添加文章内容预览
                    const contentPreview = document.createElement('div');
                    const contentText = lines.slice(1).join('\n').trim();
                    const truncatedContent = contentText.length > 100 ? contentText.substring(0, 100) + '...' : contentText;
                    contentPreview.textContent = truncatedContent;
                    contentPreview.style.fontSize = '13px';
                    contentPreview.style.color = '#8E8E93';
                    contentPreview.style.whiteSpace = 'normal';
                    contentPreview.style.overflow = 'hidden';
                    contentPreview.style.textOverflow = 'ellipsis';
                    contentPreview.style.lineHeight = '1.4';
                    contentPreview.style.display = '-webkit-box';
                    contentPreview.style.webkitLineClamp = '2';
                    contentPreview.style.webkitBoxOrient = 'vertical';
                    contentWrapper.appendChild(contentPreview);
                    
                    // 添加图片信息显示
                    if (text.images && text.images.length > 0) {
                        const imageInfo = document.createElement('div');
                        imageInfo.style.display = 'flex';
                        imageInfo.style.alignItems = 'center';
                        imageInfo.style.marginTop = '1px';
                        imageInfo.style.fontSize = '10px';
                        imageInfo.style.color = '#B0B0B0';
                        imageInfo.style.fontWeight = '400';
                        imageInfo.style.lineHeight = '1';
                        
                        const imageIcon = document.createElement('span');
                        imageIcon.textContent = '🖼️';
                        imageIcon.style.marginRight = '5px';
                        imageInfo.appendChild(imageIcon);
                        
                        const imageText = document.createElement('span');
                        imageText.textContent = t('includesImages', { count: text.images.length });
                        imageInfo.appendChild(imageText);
                        
                        contentWrapper.appendChild(imageInfo);
                    }
                    
                    // 创建按钮容器
                    const buttonContainer = document.createElement('div');
                    buttonContainer.style.position = 'absolute';
                    buttonContainer.style.right = '12px';
                    buttonContainer.style.top = '50%';
                    buttonContainer.style.transform = 'translateY(-50%)';
                    buttonContainer.style.display = 'flex';
                    buttonContainer.style.alignItems = 'center';
                    buttonContainer.style.gap = '6px';
                    buttonContainer.style.zIndex = '4';
                    buttonContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                    buttonContainer.style.padding = '4px 6px';
                    buttonContainer.style.borderRadius = '8px';
                    buttonContainer.style.opacity = '0';
                    buttonContainer.style.transition = 'opacity 0.2s ease';
                    buttonContainer.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                    
                    // 创建编辑按钮
                    const editButton = document.createElement('img');
                    editButton.src = safeGetURL('images/edit.png');
                    editButton.style.width = '15px';
                    editButton.style.height = '15px';
                    editButton.style.cursor = 'pointer';
                    editButton.title = t('edit');
                    editButton.style.transition = 'transform 0.2s ease';
                    editButton.addEventListener('mouseenter', () => editButton.style.transform = 'scale(1.1)');
                    editButton.addEventListener('mouseleave', () => editButton.style.transform = 'scale(1)');
                    editButton.addEventListener('click', function (e) {
                        e.stopPropagation();
                        showEditModal(text, index);
                    });
                    buttonContainer.appendChild(editButton);
                    
                    // 创建拖拽手柄
                    const dragHandle = document.createElement('img');
                    dragHandle.src = safeGetURL('images/drag.png');
                    dragHandle.className = 'drag-handle';
                    dragHandle.style.width = '15px';
                    dragHandle.style.height = '15px';
                    dragHandle.style.cursor = 'grab';
                    dragHandle.style.transition = 'transform 0.2s ease';
                    dragHandle.style.opacity = '1';
                    dragHandle.title = t('dragSort');
                    
                    // 拖拽手柄悬停效果
                    dragHandle.addEventListener('mouseenter', () => {
                        dragHandle.style.transform = 'scale(1.1)';
                    });
                    
                    dragHandle.addEventListener('mouseleave', () => {
                        dragHandle.style.transform = 'scale(1)';
                    });
                    
                    buttonContainer.appendChild(dragHandle);
                    
                    // 创建导出按钮
                    const exportButton = document.createElement('img');
                    exportButton.src = safeGetURL('images/single_output.png');
                    exportButton.style.width = '15px';
                    exportButton.style.height = '15px';
                    exportButton.style.cursor = 'pointer';
                    exportButton.title = t('exportThisArticle');
                    exportButton.style.transition = 'transform 0.2s ease';
                    exportButton.addEventListener('mouseenter', () => exportButton.style.transform = 'scale(1.1)');
                    exportButton.addEventListener('mouseleave', () => exportButton.style.transform = 'scale(1)');
                    exportButton.addEventListener('click', function () {
                        exportSingleArticle(text, index);
                    });
                    buttonContainer.appendChild(exportButton);
                    
                    articleContainer.appendChild(buttonContainer);
                    
                    // 创建删除按钮
                    const deleteButton = document.createElement('button');
                    deleteButton.textContent = '×';
                    deleteButton.style.position = 'absolute';
                    deleteButton.style.top = '8px';
                    deleteButton.style.right = '8px';
                    deleteButton.style.width = '24px';
                    deleteButton.style.height = '24px';
                    deleteButton.style.border = 'none';
                    deleteButton.style.borderRadius = '50%';
                    deleteButton.style.backgroundColor = '#FF3B30';
                    deleteButton.style.color = '#fff';
                    deleteButton.style.fontSize = '11px';
                    deleteButton.style.cursor = 'pointer';
                    deleteButton.style.display = 'flex';
                    deleteButton.style.alignItems = 'center';
                    deleteButton.style.justifyContent = 'center';
                    deleteButton.style.transition = 'all 0.2s ease';
                    deleteButton.style.opacity = '0';
                    deleteButton.style.zIndex = '5';
                    deleteButton.style.fontWeight = 'bold';
                    deleteButton.addEventListener('mouseenter', () => {
                        deleteButton.style.backgroundColor = '#FF2D55';
                        deleteButton.style.transform = 'scale(1.1)';
                    });
                    deleteButton.addEventListener('mouseleave', () => {
                        deleteButton.style.backgroundColor = '#FF3B30';
                        deleteButton.style.transform = 'scale(1)';
                    });
                    deleteButton.addEventListener('click', function () {
                        if (confirm(t('confirmDeleteArticle'))) {
                        savedTexts.splice(index, 1);
                        safeStorageSet({ temporaryStorage: savedTexts }, function () {
                            toggleButton.click();
                            toggleButton.click();
                        });
                        }
                    });
                    articleContainer.appendChild(deleteButton);
                    
                    // 添加鼠标悬停效果
                    articleContainer.addEventListener('mouseenter', () => {
                        
                        articleContainer.style.borderColor = '#007AFF';                   
                        buttonContainer.style.opacity = '1';
                        deleteButton.style.opacity = '1';
                    });
                    articleContainer.addEventListener('mouseleave', () => {
                        
                        articleContainer.style.borderColor = 'transparent';
                        articleContainer.style.transform = 'translateY(0)';
                        buttonContainer.style.opacity = '0';
                        deleteButton.style.opacity = '0';
                    });
                    
                    // 拖拽事件处理 - 移除 HTML5 拖拽，使用新的鼠标事件拖拽
                    // 拖拽手柄事件处理
                    dragHandle.addEventListener('mousedown', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        // 拖拽功能由 initializeDragAndDrop() 处理
                    });
                    
                    // 将文章容器添加到面板中
                    contentPanel.appendChild(articleContainer);

                    // 鼠标悬停时显示多选框（如果没有选中项）
                    articleContainer.addEventListener('mouseenter', () => {
                        const allCheckboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                        const anyChecked = Array.from(allCheckboxes).some(cb => cb.checked);
                        if (!anyChecked) {
                            checkboxWrapper.style.opacity = '1';
                            checkboxWrapper.style.pointerEvents = 'auto';
                        }
                    });
                    articleContainer.addEventListener('mouseleave', () => {
                        const allCheckboxes = contentPanel.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                        const anyChecked = Array.from(allCheckboxes).some(cb => cb.checked);
                        if (!anyChecked) {
                            checkboxWrapper.style.opacity = '0';
                            checkboxWrapper.style.pointerEvents = 'none';
                        }
                    });
                });
            }
            
            // 初始化拖拽排序功能
            initializeDragAndDrop();
            
            // 搜索框逻辑
            searchBox.addEventListener('input', function () {
                const searchTerm = searchBox.value.toLowerCase().trim();
                const articleContainers = contentPanel.querySelectorAll('div[data-index]');
                articleContainers.forEach(container => {
                    const text = container.textContent.toLowerCase();
                    container.style.display = (!searchTerm || text.includes(searchTerm)) ? 'flex' : 'none';
                });
            });
            
            contentPanel.style.display = 'block';
            contentPanel.style.pointerEvents = 'auto';
            toggleButton.src = safeGetURL('images/list_active.png');
            isPanelVisible = true;
            isViewingStoredContent = true;
            updateFloatingPanelsPosition();
            
            // 延迟重置标志位
            setTimeout(() => {
                isButtonClickInProgress = false;
            }, 200);
        });
    }
    
    // 移除已存在的暂存、导出和复制按钮
    document.querySelectorAll('.temporary-save-button, .selection-export-button, .copy-button').forEach(function (el) {
        if (el.parentElement) el.parentElement.remove();
    });
    isButtonVisible = false; // 设置标志位为不可见
});

// 添加点击外部关闭列表的功能
document.addEventListener('click', function(event) {
    if (suppressOutsideClickClose) return;
    if (isButtonClickInProgress) return;

    // 编辑弹窗打开时不关闭暂存列表
    const editOverlayOpen = docExportUIShadow.querySelector('.doc-export-edit-overlay');
    if (editOverlayOpen) return;

    // 如果文章列表是可见的，并且点击的不是列表内部元素和切换按钮
    if (isPanelVisible &&
        !isEventInNode(event, contentPanel) &&
        !isEventInNode(event, toggleButtonContainer)) {
        // 关闭列表
        contentPanel.style.display = 'none';
        toggleButton.src = safeGetURL('images/list.png');
        isPanelVisible = false;
        isViewingStoredContent = false;
    }
    
    // 如果设置面板是可见的，并且点击的不是面板内部元素和设置按钮
    if (isOptionsPanelVisible &&
        !isEventInNode(event, optionsPanel) &&
        !isEventInNode(event, optionsButtonContainer)) {
        // 关闭设置面板
        optionsPanel.style.display = 'none';
        optionsButton.src = safeGetURL('images/options.png');
        isOptionsPanelVisible = false;
    }
});

// 显示编辑浮窗
function showEditModal(text, index) {
    const overlay = document.createElement('div');
    overlay.className = 'doc-export-edit-overlay';
    overlay.addEventListener('click', () => closeEditModal(modal, overlay));
    docExportUIShadow.appendChild(overlay);

    const modal = document.createElement('div');
    modal.className = 'doc-export-edit-modal';
    modal.style.backgroundColor = '#F2F2F7';
    modal.style.border = 'none';
    modal.style.borderRadius = '16px';
    modal.style.padding = '20px';
    modal.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
    modal.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    // 阻止模态框内的事件冒泡
    modal.addEventListener('click', (e) => e.stopPropagation());
    modal.addEventListener('mousedown', (e) => e.stopPropagation());
    modal.addEventListener('mouseup', (e) => e.stopPropagation());
    docExportUIShadow.appendChild(modal);

    function closeEditModal(modalEl, overlayEl) {
        modalEl.remove();
        overlayEl.remove();
    }

    // 内容容器（可滚动区域）
    const contentContainer = document.createElement('div');
    contentContainer.className = 'doc-export-edit-modal-body';
    contentContainer.style.width = '100%';
    modal.appendChild(contentContainer);

    // 分离标题和正文
    const textParts = text.text.split('\n');
    const titleText = textParts[0] || '';
    const bodyText = textParts.slice(1).join('\n');

    // 创建图片数组的副本，用于编辑操作
    let editableImages = text.images ? [...text.images] : [];

    // 标题输入区域
    const titleSection = document.createElement('div');
    titleSection.style.backgroundColor = 'white';
    titleSection.style.borderRadius = '12px';
    titleSection.style.padding = '16px';
    titleSection.style.marginBottom = '10px';
    contentContainer.appendChild(titleSection);

    const titleLabel = document.createElement('div');
    titleLabel.textContent = t('editTitle');
    titleLabel.style.fontWeight = '600';
    titleLabel.style.marginBottom = '8px';
    titleLabel.style.color = '#1C1C1E';
    titleLabel.style.fontSize = '16px';
    titleSection.appendChild(titleLabel);

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = titleText;
    titleInput.style.width = '100%';
    titleInput.style.padding = '12px 15px';
    titleInput.style.border = '1px solid #D1D1D6';
    titleInput.style.borderRadius = '8px';
    titleInput.style.fontSize = '16px';
    titleInput.style.color = '#1C1C1E';
    titleInput.style.backgroundColor = '#F9F9F9';
    titleInput.style.boxSizing = 'border-box';
    titleInput.style.outline = 'none';
    titleInput.style.transition = 'border-color 0.3s';
    titleInput.addEventListener('focus', () => titleInput.style.borderColor = '#007AFF');
    titleInput.addEventListener('blur', () => titleInput.style.borderColor = '#D1D1D6');
    // 阻止事件冒泡
    titleInput.addEventListener('click', (e) => e.stopPropagation());
    titleInput.addEventListener('mousedown', (e) => e.stopPropagation());
    titleInput.addEventListener('mouseup', (e) => e.stopPropagation());
    titleSection.appendChild(titleInput);

    // 正文输入区域
    const bodySection = document.createElement('div');
    bodySection.style.backgroundColor = 'white';
    bodySection.style.borderRadius = '12px';
    bodySection.style.padding = '16px';
    bodySection.style.marginBottom = '10px';
    contentContainer.appendChild(bodySection);

    const bodyLabel = document.createElement('div');
    bodyLabel.textContent = t('editBody');
    bodyLabel.style.fontWeight = '600';
    bodyLabel.style.marginBottom = '8px';
    bodyLabel.style.color = '#1C1C1E';
    bodyLabel.style.fontSize = '16px';
    bodySection.appendChild(bodyLabel);

    const textarea = document.createElement('textarea');
    textarea.value = bodyText;
    textarea.style.width = '100%';
    textarea.style.height = 'min(280px, 32vh)';
    textarea.style.minHeight = '120px';
    textarea.style.maxHeight = '40vh';
    textarea.style.padding = '12px 15px';
    textarea.style.border = '1px solid #D1D1D6';
    textarea.style.borderRadius = '8px';
    textarea.style.fontSize = '16px';
    textarea.style.color = '#1C1C1E';
    textarea.style.backgroundColor = '#F9F9F9';
    textarea.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    textarea.style.fontSmooth = 'always';
    textarea.style.webkitFontSmoothing = 'antialiased';
    textarea.style.lineHeight = '1.5';
    textarea.style.resize = 'vertical';
    textarea.style.boxSizing = 'border-box';
    textarea.style.outline = 'none';
    textarea.style.transition = 'border-color 0.3s';
    textarea.addEventListener('focus', () => textarea.style.borderColor = '#007AFF');
    textarea.addEventListener('blur', () => textarea.style.borderColor = '#D1D1D6');
    // 阻止事件冒泡
    textarea.addEventListener('click', (e) => e.stopPropagation());
    textarea.addEventListener('mousedown', (e) => e.stopPropagation());
    textarea.addEventListener('mouseup', (e) => e.stopPropagation());
    bodySection.appendChild(textarea);

    // 图片预览区域
    if (editableImages.length > 0) {
        const imageSection = document.createElement('div');
        imageSection.style.backgroundColor = 'white';
        imageSection.style.borderRadius = '12px';
        imageSection.style.padding = '16px';
        imageSection.style.marginBottom = '10px';
        contentContainer.appendChild(imageSection);

        const imageLabel = document.createElement('div');
        imageLabel.textContent = t('imagesCount', { count: editableImages.length });
        imageLabel.style.fontWeight = '600';
        imageLabel.style.marginBottom = '10px';
        imageLabel.style.color = '#1C1C1E';
        imageLabel.style.fontSize = '16px';
        imageSection.appendChild(imageLabel);

        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.gap = '10px';
        imageContainer.style.maxHeight = '200px';
        imageContainer.style.overflowY = 'auto';
        imageContainer.style.padding = '10px';
        imageContainer.style.border = '1px solid #D1D1D6';
        imageContainer.style.borderRadius = '8px';
        imageContainer.style.backgroundColor = '#F9F9F9';
        imageSection.appendChild(imageContainer);

        editableImages.forEach((image, imgIndex) => {
            // 为每个图片添加唯一标识符
            if (!image.uniqueId) {
                image.uniqueId = Utility.generateUniqueId();
            }
            
            const imageWrapper = document.createElement('div');
            imageWrapper.style.position = 'relative';
            imageWrapper.style.display = 'inline-block';
            imageWrapper.style.margin = '5px';
            
            const img = document.createElement('img');
            img.src = image.data;
            img.style.width = '80px';
            img.style.height = '60px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '8px';
            img.style.border = '1px solid #D1D1D6';
            img.title = image.alt || t('imageN', { n: imgIndex + 1 });
            imageWrapper.appendChild(img);

            // 删除图片按钮
            const deleteImgBtn = document.createElement('button');
            deleteImgBtn.textContent = '×';
            deleteImgBtn.style.position = 'absolute';
            deleteImgBtn.style.top = '-8px';
            deleteImgBtn.style.right = '-8px';
            deleteImgBtn.style.width = '20px';
            deleteImgBtn.style.height = '20px';
            deleteImgBtn.style.border = 'none';
            deleteImgBtn.style.borderRadius = '50%';
            deleteImgBtn.style.backgroundColor = '#FF3B30';
            deleteImgBtn.style.color = '#fff';
            deleteImgBtn.style.fontSize = '12px';
            deleteImgBtn.style.cursor = 'pointer';
            deleteImgBtn.style.display = 'flex';
            deleteImgBtn.style.alignItems = 'center';
            deleteImgBtn.style.justifyContent = 'center';
            deleteImgBtn.style.zIndex = '10';
            deleteImgBtn.style.fontWeight = 'bold';
            deleteImgBtn.style.transition = 'all 0.2s ease';
            deleteImgBtn.addEventListener('mouseenter', () => {
                deleteImgBtn.style.backgroundColor = '#FF2D55';
                deleteImgBtn.style.transform = 'scale(1.1)';
            });
            deleteImgBtn.addEventListener('mouseleave', () => {
                deleteImgBtn.style.backgroundColor = '#FF3B30';
                deleteImgBtn.style.transform = 'scale(1)';
            });
            deleteImgBtn.addEventListener('click', function() {
                if (confirm(t('confirmDeleteImage'))) {
                    // 通过唯一标识符找到在editableImages中的实际索引
                    const actualIndex = editableImages.findIndex(img => img.uniqueId === image.uniqueId);
                    
                    if (actualIndex !== -1) {
                        // 从可编辑图片数组中删除
                        editableImages.splice(actualIndex, 1);
                        
                        // 从DOM中删除图片元素
                    imageWrapper.remove();
                        
                    // 更新图片数量显示
                        imageLabel.textContent = t('imagesCount', { count: editableImages.length });
                        
                        // 如果没有图片了，移除整个图片区域
                        if (editableImages.length === 0) {
                            imageSection.remove();
                        }
                        
                        // 重新排序剩余图片的索引
                        editableImages.forEach((img, newIndex) => {
                            img.imageIndex = newIndex;
                        });
                    }
                }
            });
            imageWrapper.appendChild(deleteImgBtn);
            
            imageContainer.appendChild(imageWrapper);
        });
    }

    // 按钮容器（固定在弹窗底部，不随内容滚动）
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'doc-export-edit-modal-footer';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.gap = '15px';
    buttonContainer.style.marginTop = '20px';
    buttonContainer.style.paddingTop = '4px';
    modal.appendChild(buttonContainer);

    // 保存按钮
    const saveButton = document.createElement('button');
    saveButton.textContent = t('saveEdit');
    saveButton.style.backgroundColor = '#34C759';
    saveButton.style.color = '#fff';
    saveButton.style.border = 'none';
    saveButton.style.padding = '12px 30px';
    saveButton.style.borderRadius = '8px';
    saveButton.style.cursor = 'pointer';
    saveButton.style.fontSize = '15px';
    saveButton.style.fontWeight = '600';
    saveButton.style.transition = 'all 0.3s ease';
    saveButton.style.minWidth = '100px';
    saveButton.addEventListener('mouseenter', () => saveButton.style.backgroundColor = '#30D158');
    saveButton.addEventListener('mouseleave', () => saveButton.style.backgroundColor = '#34C759');
    saveButton.addEventListener('click', function () {
        safeStorageGet(['temporaryStorage'], function (data) {
            const savedTexts = data.temporaryStorage || [];
            
            // 获取当前可编辑的图片数组（如果存在）
            const currentImages = editableImages || text.images || [];
            
            // 重新生成文本内容，确保占位符与图片一致
            let updatedText = titleInput.value + '\n' + textarea.value;
            
            // 如果图片数量发生了变化，需要重新生成占位符
            if (currentImages.length !== text.images.length) {
                // 智能处理占位符：保持原有位置，只删除对应的占位符
                updatedText = updateImagePlaceholders(updatedText, text.images, currentImages);
            }
            
            // 更新保存的数据
            savedTexts[index].text = updatedText;
            savedTexts[index].images = currentImages;
            
            safeStorageSet({ temporaryStorage: savedTexts }, function () {
                showNotification(t('contentSaved'));
                closeEditModal(modal, overlay);
                // 刷新文章列表
                toggleButton.click();
                toggleButton.click();
            });
        });
    });
    buttonContainer.appendChild(saveButton);

    // 取消按钮
    const cancelButton = document.createElement('button');
    cancelButton.textContent = t('cancel');
    cancelButton.style.backgroundColor = '#FF3B30';
    cancelButton.style.color = '#fff';
    cancelButton.style.border = 'none';
    cancelButton.style.padding = '12px 30px';
    cancelButton.style.borderRadius = '8px';
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.fontSize = '15px';
    cancelButton.style.fontWeight = '600';
    cancelButton.style.transition = 'all 0.3s ease';
    cancelButton.style.minWidth = '100px';
    cancelButton.addEventListener('mouseenter', () => cancelButton.style.backgroundColor = '#FF2D55');
    cancelButton.addEventListener('mouseleave', () => cancelButton.style.backgroundColor = '#FF3B30');
    cancelButton.addEventListener('click', () => {
        closeEditModal(modal, overlay);
        // 不关闭文章列表面板，保持展开状态
    });
    buttonContainer.appendChild(cancelButton);

    // ESC键关闭模态窗口
    document.addEventListener('keydown', function handleEsc(e) {
        if (e.key === 'Escape') {
            closeEditModal(modal, overlay);
            document.removeEventListener('keydown', handleEsc);
        }
    });

    // 自动聚焦到标题输入框
    setTimeout(() => titleInput.focus(), 100);
}

// 拖拽重排序文章
function reorderArticles(fromIndex, toIndex) {
    console.log(`开始重排序: fromIndex=${fromIndex}, toIndex=${toIndex}`);
    
    safeStorageGet(['temporaryStorage'], function (data) {
        const savedTexts = data.temporaryStorage || [];
        console.log(`当前文章数量: ${savedTexts.length}`);
        
        // 确保索引在有效范围内
        if (fromIndex < 0 || fromIndex >= savedTexts.length || 
            toIndex < 0 || toIndex > savedTexts.length) {
            console.log(`索引超出范围: fromIndex=${fromIndex}, toIndex=${toIndex}, length=${savedTexts.length}`);
            return;
        }
        
        // 执行重排序（toIndex 为移除源项后的插入位置）
        const [movedItem] = savedTexts.splice(fromIndex, 1);
        
        // 正确处理对象结构
        if (movedItem && typeof movedItem === 'object') {
            const title = movedItem.text ? movedItem.text.split('\n')[0] || '无标题' : '无标题';
            console.log(`移动的文章: ${title.substring(0, 50)}...`);
        } else {
            console.log(`移动的文章: ${typeof movedItem} - ${movedItem}`);
        }
        
        savedTexts.splice(toIndex, 0, movedItem);
        console.log(`重排序完成，新位置: ${toIndex}`);
        
        // 保存新的顺序
        safeStorageSet({ temporaryStorage: savedTexts }, function () {
            console.log(`保存完成，新文章数量: ${savedTexts.length}`);
            // 显示成功提示
            showNotification(t('orderUpdated'));
            
            // 重新渲染文章列表
            toggleButton.click(); // 关闭面板
            toggleButton.click(); // 重新打开面板
        });
    });
}

// 更新 observer 监听，确保所有按钮在页面切换时保持
const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
        mountDocExportUIHost();
        if (!docExportUIShadow.contains(dockRoot)) {
            docExportUIShadow.appendChild(dockRoot);
        }
        if (!docExportUIShadow.contains(contentPanel)) {
            docExportUIShadow.appendChild(contentPanel);
        }
        if (!docExportUIShadow.contains(optionsPanel)) {
            docExportUIShadow.appendChild(optionsPanel);
        }
    });
});
observer.observe(document.body, { childList: true });

// 监听鼠标选中文本事件
document.addEventListener('mouseup', function (event) {
    if (!isExtensionActiveOnPage()) return;

    // 如果有按钮点击正在进行，不显示暂存、复制按钮
    if (isButtonClickInProgress) {
        return;
    }
    
    // Shadow DOM 内点击在 document 上会 retarget 到 host，需用 composedPath 判断
    const isButtonClick = isEventInNode(event, buttonsContainer) ||
                         isEventInNode(event, contentPanel) ||
                         isEventInNode(event, optionsPanel);
    
    if (isButtonClick) {
        return;
    }

    // 点击外部关闭选区工具栏时，同一次点击的 mouseup 不应再次弹出工具栏
    if (suppressSelectionToolbarMouseup) {
        suppressSelectionToolbarMouseup = false;
        return;
    }
    
    // 检查是否在编辑模态框中，如果是则不处理文本选择
    const editModal = docExportUIShadow.querySelector('.doc-export-edit-modal');
    const editOverlay = docExportUIShadow.querySelector('.doc-export-edit-overlay');
    if ((editModal && isEventInNode(event, editModal)) ||
        (editOverlay && isEventInNode(event, editOverlay))) {
        return;
    }
    
    const selection = window.getSelection();
    const selectedElement = selection.anchorNode;
    
    // 判断选中的文本是否在面板内
    if (!selectedElement) return;
    
    // 检查是否在内容面板或设置面板中选择文本，如果是则不显示按钮
    const inContentPanel = contentPanel.contains(selectedElement) || 
                          (selectedElement.parentElement && contentPanel.contains(selectedElement.parentElement));
    const inOptionsPanel = optionsPanel.contains(selectedElement) || 
                          (selectedElement.parentElement && optionsPanel.contains(selectedElement.parentElement));
    
    if (inContentPanel || inOptionsPanel) return;
    
    let selectedText = '';
    let capturedRangeAtMouseup = null;
    if (selection.rangeCount > 0) {
        try {
            const rangeAtMouseup = selection.getRangeAt(0);
            capturedRangeAtMouseup = rangeAtMouseup.cloneRange();
            selectedText = getSelectionContentFromRange(rangeAtMouseup, {
                saveImages: false,
                saveTables: false
            }).text.trim();
        } catch (e) {
            capturedRangeAtMouseup = null;
            selectedText = selection.toString().trim();
        }
    } else {
        selectedText = selection.toString().trim();
    }
    
    // 如果有面板打开，先关闭面板，然后继续处理文本选择
    if (isPanelVisible || isOptionsPanelVisible) {
        // 关闭文章列表
        if (isPanelVisible) {
            contentPanel.style.display = 'none';
            toggleButton.src = safeGetURL('images/list.png');
            isPanelVisible = false;
            isViewingStoredContent = false;
        }
        
        // 关闭设置面板
        if (isOptionsPanelVisible) {
            optionsPanel.style.display = 'none';
            optionsButton.src = safeGetURL('images/options.png');
            isOptionsPanelVisible = false;
        }
        
        // 如果没有选中文本，直接返回
        if (!selectedText) return;
        
        // 如果面板刚刚被关闭，延迟一下再处理文本选择，避免与按钮点击冲突
        setTimeout(() => {
            // 再次检查是否有按钮点击正在进行
            if (isButtonClickInProgress) {
                return;
            }
            
            // 继续处理文本选择
            processTextSelection(selectedText, event, selection, capturedRangeAtMouseup);
        }, 100);
        return;
    }
    
    // 继续处理文本选择
    processTextSelection(selectedText, event, selection, capturedRangeAtMouseup);
});

// 提取文本选择处理逻辑到单独的函数
function processTextSelection(selectedText, event, selection, capturedRangeAtMouseup) {
    if (!isExtensionActiveOnPage()) {
        if (!isExtensionContextValid()) {
            notifyExtensionContextInvalidatedOnce();
        }
        return;
    }

    // 仅规范化行尾空白，保留段落/章节间换行结构
    selectedText = selectedText.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
    
    // 检查选中的内容是否包含图片
    let selectedImages = [];
    
    // 延迟回调时选区常已失效：先尝试当前 window 选区，仍无时仅走纯文本（不抽图片）
    let activeSel = selection;
    if (!activeSel || activeSel.rangeCount === 0) {
        activeSel = window.getSelection();
    }
    if (!activeSel || activeSel.rangeCount === 0) {
        // 无可用 Range：跳过图片/背景图解析，后续仍可按纯文本显示按钮与自动暂存
    } else {
    const rangeForMedia = capturedRangeAtMouseup ||
        (activeSel.rangeCount > 0 ? activeSel.getRangeAt(0) : null);
    if (rangeForMedia) {
        selectedImages = collectImagesGeometricallyInRange(rangeForMedia, selectedText);
    }
    }

    selectedImages = deduplicateImagesBySrc(selectedImages);

    let capturedSelectionRange = capturedRangeAtMouseup || null;
    if (!capturedSelectionRange && activeSel && activeSel.rangeCount > 0) {
        try {
            capturedSelectionRange = activeSel.getRangeAt(0).cloneRange();
        } catch (e) {
            capturedSelectionRange = null;
        }
    }
    
    if (selectionHasMeaningfulText(selectedText) && !isButtonVisible) {
        // 处理自动暂存
        if (pluginSettings.autoStoreEnabled && selectedText !== lastStoredText) {
            // 清除之前的自动暂存定时器
            if (autoStoreTimeout) {
                clearTimeout(autoStoreTimeout);
            }
            
            // 设置新的自动暂存定时器
            autoStoreTimeout = setTimeout(() => {
                autoStoreText(selectedText, selectedImages, capturedSelectionRange);
            }, pluginSettings.autoStoreDelay);
        }
        
        // 显示按钮
        {
            const buttons = [];
            
            // 创建现代化的按钮组容器
            const buttonGroup = createModernButtonGroup(event.pageX, event.pageY);
            let hasSelectionButton = false;

            if (pluginSettings.showCopyButton) {
                let copyButton = createModernButton(t('copy'), 'copy', buttonGroup);
                copyButton.classList.add('copy-button');
                buttons.push(copyButton);
                hasSelectionButton = true;
            }

            if (pluginSettings.showStoreButton) {
                let saveButton = createModernButton(t('store'), 'store', buttonGroup);
                saveButton.classList.add('temporary-save-button');
                buttons.push(saveButton);
                hasSelectionButton = true;
            }

            if (pluginSettings.showExportButton) {
                let exportButton = createModernButton(t('export'), 'export', buttonGroup);
                exportButton.classList.add('selection-export-button');
                buttons.push(exportButton);
                hasSelectionButton = true;
            }
            
            if (!hasSelectionButton) {
                if (buttonGroup.parentElement) buttonGroup.remove();
            } else {
            document.body.appendChild(buttonGroup);
            applySelectionButtonGroupPosition(buttonGroup, event.pageX, event.pageY);
            isButtonVisible = true;
            
            // 为按钮添加事件监听器
            buttons.forEach((button) => {
                const actionType = button.dataset.actionType;
                if (actionType === 'store') {
                    button.addEventListener('click', (e) => handleStoreClick(
                        selectedText,
                        selectedImages,
                        [buttonGroup],
                        capturedSelectionRange,
                        { x: e.clientX, y: e.clientY }
                    ));
                } else if (actionType === 'export') {
                    button.addEventListener('click', () => handleExportClick(
                        selectedText,
                        selectedImages,
                        [buttonGroup],
                        capturedSelectionRange
                    ));
                } else if (actionType === 'copy') {
                    button.addEventListener('click', () => handleCopyClick(selectedText, [buttonGroup]));
                }
            });
            
            // 添加点击外部关闭按钮的事件
        document.addEventListener('mousedown', function removeButtons(e) {
                if (!isEventInNode(e, buttonGroup)) {
                    if (buttonGroup.parentElement) buttonGroup.remove();
                isButtonVisible = false;
                suppressSelectionToolbarMouseup = true;
                document.removeEventListener('mousedown', removeButtons);
            }
        });
            }
        }
    }
}

// 网站禁用名单（列入名单的站点不加载扩展功能）
let isSiteBlacklisted = false;
let siteBlacklistCache = [];

function normalizeSiteDomain(domain) {
    if (!domain) return '';
    let d = String(domain).trim().toLowerCase();
    if (d.startsWith('www.')) d = d.slice(4);
    return d;
}

function getCurrentPageHostname() {
    try {
        return normalizeSiteDomain(location.hostname);
    } catch (e) {
        return '';
    }
}

function checkSiteBlacklist(blacklist) {
    const host = getCurrentPageHostname();
    if (!host) return false;
    const list = Array.isArray(blacklist) ? blacklist : [];
    if (list.some(function (item) { return normalizeSiteDomain(item) === host; })) {
        return true;
    }
    try {
        const origins = location.ancestorOrigins;
        if (origins && origins.length > 0) {
            const parentHost = normalizeSiteDomain(new URL(origins[origins.length - 1]).hostname);
            return list.some(function (item) { return normalizeSiteDomain(item) === parentHost; });
        }
    } catch (e) { /* ignore */ }
    return false;
}

function isExtensionActiveOnPage() {
    return !isSiteBlacklisted && isExtensionContextValid();
}

function applySiteBlacklistState() {
    applyToolbarVisibility(isExtensionActiveOnPage());
}

// 监听来自 background / popup 的消息
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === "showNotification") {
        showNotification(message.i18nKey ? t(message.i18nKey, message.params) : message.message);
    } else if (message.action === "refreshArticleList") {
        refreshArticleList();
    } else if (message.action === "refreshStoredContentPanel") {
        refreshStoredContentPanel();
    } else if (message.action === "ping") {
        sendResponse({ pong: true, active: isExtensionActiveOnPage() });
    }
    return true;
});

function applyToolbarVisibility(visible) {
    if (typeof dockRoot !== 'undefined' && dockRoot) {
        dockRoot.style.display = visible ? '' : 'none';
    }
    if (!visible) {
        if (typeof contentPanel !== 'undefined' && contentPanel) contentPanel.style.display = 'none';
        if (typeof optionsPanel !== 'undefined' && optionsPanel) optionsPanel.style.display = 'none';
        if (typeof exportActionMenuVisible !== 'undefined' && exportActionMenuVisible && typeof hideExportActionMenu === 'function') {
            hideExportActionMenu();
        }
        isPanelVisible = false;
        isOptionsPanelVisible = false;
        isButtonVisible = false;
        if (typeof toggleButton !== 'undefined' && toggleButton) toggleButton.src = safeGetURL('images/list.png');
        if (typeof optionsButton !== 'undefined' && optionsButton) optionsButton.src = safeGetURL('images/options.png');
        document.querySelectorAll('.temporary-save-button, .selection-export-button, .copy-button').forEach(function (el) {
            if (el.parentElement) el.parentElement.remove();
        });
    }
}

function initSiteBlacklist() {
    try {
        chrome.storage.local.get(['siteBlacklist'], function (result) {
            siteBlacklistCache = result.siteBlacklist || [];
            isSiteBlacklisted = checkSiteBlacklist(siteBlacklistCache);
            applySiteBlacklistState();
        });
        chrome.storage.onChanged.addListener(function (changes, namespace) {
            if (namespace !== 'local' || !changes.siteBlacklist) return;
            const wasBlacklisted = isSiteBlacklisted;
            siteBlacklistCache = changes.siteBlacklist.newValue || [];
            isSiteBlacklisted = checkSiteBlacklist(siteBlacklistCache);
            if (wasBlacklisted !== isSiteBlacklisted) {
                applySiteBlacklistState();
            }
        });
    } catch (err) {
        console.warn('初始化网站禁用名单失败:', err);
    }
}

initSiteBlacklist();

const notificationSlots = {};

// 显示通知（始终置于扩展 UI 之上；可选用更长展示时间）
function showNotification(message, options) {
    const opts = options || {};
    const duration = typeof opts.duration === 'number' ? opts.duration : 2500;
    const zIndex = typeof opts.zIndex === 'number' ? opts.zIndex : 2147483646;
    const replaceKey = opts.replaceKey || null;

    if (replaceKey && notificationSlots[replaceKey]) {
        const slot = notificationSlots[replaceKey];
        slot.el.textContent = message;
        clearTimeout(slot.timer);
        slot.timer = setTimeout(function () {
            if (slot.el.parentElement) slot.el.remove();
            delete notificationSlots[replaceKey];
        }, duration);
        return;
    }

    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.top = '10px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.backgroundColor = '#28a745';
    notification.style.color = '#fff';
    notification.style.padding = '10px 20px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.1)';
    notification.style.zIndex = String(zIndex);
    notification.style.maxWidth = 'min(92vw, 520px)';
    notification.style.textAlign = 'center';
    notification.style.wordBreak = 'break-word';
    document.body.appendChild(notification);
    const timer = setTimeout(function () {
        if (notification.parentElement) notification.remove();
        if (replaceKey && notificationSlots[replaceKey] && notificationSlots[replaceKey].el === notification) {
            delete notificationSlots[replaceKey];
        }
    }, duration);
    if (replaceKey) {
        notificationSlots[replaceKey] = { el: notification, timer: timer };
    }
}

// 创建设置面板
const optionsPanel = document.createElement('div');
optionsPanel.style.position = 'fixed';
optionsPanel.style.bottom = '55px';
optionsPanel.style.right = '20px';
optionsPanel.style.zIndex = 1000;
optionsPanel.style.backgroundColor = '#F2F2F7';
optionsPanel.style.border = 'none';
optionsPanel.style.borderRadius = '16px';
optionsPanel.style.padding = '10px';
optionsPanel.style.width = '380px';
optionsPanel.style.maxHeight = '650px'; // 统一面板最大高度
optionsPanel.style.overflowY = 'auto';
optionsPanel.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
optionsPanel.style.display = 'none';  // 默认隐藏

// 添加iOS风格的滚动条样式 + 紧凑模式样式 + 呼吸灯动画
const optionsPanelStyle = document.createElement('style');
optionsPanelStyle.textContent = `
    .options-panel::-webkit-scrollbar { width: 8px; }
    .options-panel::-webkit-scrollbar-track { background: transparent; }
    .options-panel::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
    .options-panel::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.3); }

    /* 避免宿主页面样式把原生下拉文字/选项隐藏；保证选项可读 */
    .options-panel select {
        appearance: auto !important;
        -webkit-appearance: menulist !important;
        color: #1C1C1E !important;
        background-color: #F9F9F9 !important;
    }
    .options-panel select option {
        color: #1C1C1E !important;
        background-color: #ffffff !important;
    }

    /* 紧凑模式：压缩标题栏、分组、行间距 */
    .options-panel .title-bar { padding: 10px !important; margin-bottom: 4px !important; }
    .options-panel .top-bar { margin-bottom: 6px !important; padding: 0 4px !important; }
    .options-panel .search-box { margin-bottom: 6px !important; }
    .options-panel .group { margin-bottom: 8px !important; padding: 8px !important; }
    .options-panel .group .section { padding: 12px !important; }
    .options-panel label { margin-bottom: 4px !important; }
    .options-panel input[type="text"],
    .options-panel select { padding: 6px 10px !important; font-size: 13px !important; }

    /* 纹理向上移动动画效果 */
    @keyframes textureMove {
        0% { background-position: 0 0; }
        100% { background-position: 0 8px; } /* 向下移动一个完整周期，实现无缝循环 */
    }
`;
appendDocExportUIStyles(optionsPanelStyle.textContent);
optionsPanel.className = 'options-panel';

docExportUIShadow.appendChild(optionsPanel);

/** 在 Shadow DOM 内的设置面板中查找元素（document.getElementById 无法穿透 Shadow Root） */
function getOptionsEl(id) {
    if (!optionsPanel || !id) return null;
    return optionsPanel.querySelector('#' + CSS.escape(id));
}

function queryOptionsAll(selector) {
    if (!optionsPanel) return [];
    return optionsPanel.querySelectorAll(selector);
}

// ========== 悬浮工具栏位置：统一锚点 + 非按钮区域拖拽 ==========
const DOCK_STORAGE_KEY = 'toolbarDockPosition';
const dockDragStyleEl = document.createElement('style');
dockDragStyleEl.textContent = `
    .doc-export-toolbar-wrap {
        gap: 0;
        background-color: transparent;
        border-radius: 10px;
        padding: 0;
        box-shadow: none;
        overflow: visible;
        user-select: none;
        -webkit-user-select: none;
        transition: background-color 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                    box-shadow 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .doc-export-toolbar-wrap.doc-export-toolbar-expanded {
        background-color: #ffffff;
        border-radius: 10px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
        overflow: hidden;
    }
    .doc-export-toolbar-wrap .doc-export-toolbar-btn {
        cursor: pointer;
    }
    .doc-export-toolbar-wrap .doc-export-toolbar-btn img {
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-user-drag: none;
    }
    .doc-export-toolbar-wrap .doc-export-toolbar-toggle {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        cursor: move;
        background-color: rgba(255, 255, 255, 0.3);
        border-radius: 10px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08);
        transition: background-color 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                    box-shadow 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                    width 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                    border-radius 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .doc-export-tray-icon {
        position: relative;
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        flex-shrink: 0;
        transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .doc-export-tray-icon.dock-tray-landed {
        transform: scale(1.08);
    }
    .doc-export-tray-folder {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
        transition: opacity 0.25s ease;
        pointer-events: none;
        user-select: none;
    }
    .doc-export-tray-folder-full {
        opacity: 0;
    }
    .doc-export-tray-icon.has-files .doc-export-tray-folder-empty {
        opacity: 0;
    }
    .doc-export-tray-icon.has-files .doc-export-tray-folder-full {
        opacity: 1;
    }
    .doc-export-tray-badge {
        position: absolute;
        left: 50%;
        top: 58%;
        min-width: 12px;
        padding: 0 1px;
        font-size: 13px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #ffffff;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: translate(-50%, calc(-50% + 3px)) scale(0.6);
        transform-origin: center center;
        transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
        pointer-events: none;
        z-index: 2;
        text-shadow: 0 0 2px rgba(0, 0, 0, 0.35);
    }
    .doc-export-tray-badge.visible {
        opacity: 1;
        transform: translate(-50%, calc(-50% + 3px)) scale(1);
    }
    .doc-export-tray-badge.bump {
        animation: doc-export-tray-badge-bump 0.45s ease;
    }
    @keyframes doc-export-tray-badge-bump {
        0%, 100% { transform: translate(-50%, calc(-50% + 3px)) scale(1); }
        45% { transform: translate(-50%, calc(-50% - 1px)) scale(1.28); }
    }
    .doc-export-file-flyer {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        transform: translate(-50%, -50%);
    }
    .doc-export-file-flyer-sheet {
        width: 18px;
        height: 22px;
        border-radius: 2px;
        background: linear-gradient(180deg, #5B88EE 0%, #507ACE 100%);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding: 0 3px;
        box-sizing: border-box;
    }
    .doc-export-file-flyer-sheet span {
        display: block;
        height: 1.5px;
        border-radius: 1px;
        background: rgba(255, 255, 255, 0.92);
    }
    .doc-export-file-flyer-sheet span:nth-child(1) { width: 100%; }
    .doc-export-file-flyer-sheet span:nth-child(2) { width: 78%; }
    .doc-export-file-flyer-sheet span:nth-child(3) { width: 55%; }
    .doc-export-toolbar-wrap:not(.doc-export-toolbar-expanded) .doc-export-toolbar-toggle:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16), 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .doc-export-toolbar-wrap:not(.doc-export-toolbar-dragging) .doc-export-toolbar-toggle:hover {
        cursor: pointer;
    }
    .doc-export-toolbar-wrap.doc-export-toolbar-expanded .doc-export-toolbar-toggle {
        cursor: move;
    }
    .doc-export-toolbar-dragging .doc-export-toolbar-toggle {
        cursor: move;
    }
    .doc-export-toolbar-wrap.doc-export-toolbar-expanded .doc-export-toolbar-toggle {
        width: 36px;
        height: 40px;
        background-color: #ffffff;
        box-shadow: none;
        border-radius: 0 10px 10px 0;
        border-left: 1px solid rgba(0, 0, 0, 0.08);
    }
    .doc-export-toolbar-dragging { cursor: move !important; }
    .doc-export-toolbar-dragging * { cursor: move !important; }
    .doc-export-panel-drag,
    .content-panel .title-bar { cursor: move; }
    .doc-export-toolbar-dragging .doc-export-panel-drag,
    .doc-export-toolbar-dragging .content-panel .title-bar { cursor: move; }
    .doc-export-toolbar-drawer {
        display: flex;
        gap: 0;
        flex-shrink: 0;
        overflow: hidden;
        box-sizing: border-box;
        max-width: 0;
        opacity: 0;
        padding: 0;
        margin-right: 0;
        background-color: transparent;
        border-radius: 10px 0 0 10px;
        box-shadow: none;
        pointer-events: none;
        transition: max-width 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.22s ease,
                    border-radius 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .doc-export-toolbar-wrap.doc-export-toolbar-expanded .doc-export-toolbar-drawer {
        max-width: 108px;
        opacity: 1;
        pointer-events: auto;
    }
    .doc-export-toolbar-wrap.doc-export-toolbar-expanded .doc-export-toolbar-btn {
        width: 36px !important;
        height: 36px !important;
        min-width: 36px;
        min-height: 36px;
        border-radius: 0 !important;
        background-color: transparent !important;
        box-shadow: none !important;
        border-right: 1px solid rgba(0, 0, 0, 0.08);
        box-sizing: border-box;
    }
    .doc-export-toolbar-wrap.doc-export-toolbar-expanded .doc-export-toolbar-btn:last-child {
        border-right: none;
    }
`;
appendDocExportUIStyles(dockDragStyleEl.textContent);

let dockPos = { right: 20, bottom: 5 };
let dockDragging = false;
let dockDragMoved = false;
let dockDragStartClient = { x: 0, y: 0 };
let dockDragStartPos = { right: 20, bottom: 5 };

/** 控制区（工具栏+三灯）中心是否落在视口上半：是则浮窗应出现在控制区下方 */
function isDockInUpperScreenHalf() {
    const vh = window.innerHeight;
    const b = dockPos.bottom;
    const toolbarH = buttonsContainer.offsetHeight || 40;
    const centerFromTop = vh - b - toolbarH / 2;
    return centerFromTop < vh / 2;
}

function updateFloatingPanelsPosition() {
    const vh = window.innerHeight;
    const r = dockPos.right;
    const b = dockPos.bottom;
    const toolbarH = buttonsContainer.offsetHeight || 40;
    const gapAboveToolbar = toolbarH + PANEL_DOCK_GAP;
    const gapBelowToolbar = PANEL_DOCK_GAP;
    const toolbarBottomFromTop = vh - b;
    const panelsOpenBelow = isDockInUpperScreenHalf();

    contentPanel.style.right = r + 'px';
    optionsPanel.style.right = r + 'px';
    contentPanel.style.zIndex = '1001';
    optionsPanel.style.zIndex = '1001';

    if (panelsOpenBelow) {
        const topPx = Math.max(8, toolbarBottomFromTop + gapBelowToolbar);
        contentPanel.style.top = topPx + 'px';
        contentPanel.style.bottom = 'auto';
        optionsPanel.style.top = topPx + 'px';
        optionsPanel.style.bottom = 'auto';
        const maxH = Math.max(120, Math.min(650, vh - topPx - 10));
        contentPanel.style.maxHeight = maxH + 'px';
        optionsPanel.style.maxHeight = maxH + 'px';
    } else {
        contentPanel.style.bottom = (b + gapAboveToolbar) + 'px';
        contentPanel.style.top = 'auto';
        optionsPanel.style.bottom = (b + gapAboveToolbar) + 'px';
        optionsPanel.style.top = 'auto';
        contentPanel.style.maxHeight = '650px';
        optionsPanel.style.maxHeight = '650px';
    }
}

function applyDockPosition() {
    const r = dockPos.right;
    const b = dockPos.bottom;
    dockRoot.style.right = r + 'px';
    dockRoot.style.bottom = b + 'px';
    updateFloatingPanelsPosition();
    if (typeof exportActionMenuVisible !== 'undefined' && exportActionMenuVisible && exportActionMenuEl) {
        positionExportActionMenu();
    }
    if (typeof dockContextMenuVisible !== 'undefined' && dockContextMenuVisible && dockContextMenuEl) {
        positionDockContextMenu();
    }
}

function clampDockPosition() {
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    dockPos.right = Math.min(Math.max(pad, dockPos.right), vw - pad);
    dockPos.bottom = Math.min(Math.max(pad, dockPos.bottom), vh - pad);
}

function onDockDragMove(e) {
    if (!dockDragging) return;
    const dx = e.clientX - dockDragStartClient.x;
    const dy = e.clientY - dockDragStartClient.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dockDragMoved = true;
    dockPos.right = dockDragStartPos.right - dx;
    dockPos.bottom = dockDragStartPos.bottom - dy;
    clampDockPosition();
    applyDockPosition();
}

function onDockDragEnd() {
    if (!dockDragging) return;
    dockDragging = false;
    document.removeEventListener('mousemove', onDockDragMove);
    document.removeEventListener('mouseup', onDockDragEnd);
    document.body.style.userSelect = '';
    buttonsContainer.classList.remove('doc-export-toolbar-dragging');
    if (dockDragMoved) {
        dockSuppressToggleClick = true;
        try {
            chrome.storage.local.set({ [DOCK_STORAGE_KEY]: dockPos });
        } catch (err) {
            console.warn('保存工具栏位置失败:', err);
        }
    }
    dockDragMoved = false;
}

function startDockDrag(e) {
    if (e.button !== 0) return;
    if (typeof dockContextMenuVisible !== 'undefined' && dockContextMenuVisible) {
        hideDockContextMenu();
    }
    dockDragging = true;
    dockDragMoved = false;
    dockDragStartClient.x = e.clientX;
    dockDragStartClient.y = e.clientY;
    dockDragStartPos.right = dockPos.right;
    dockDragStartPos.bottom = dockPos.bottom;
    e.preventDefault();
    document.body.style.userSelect = 'none';
    buttonsContainer.classList.add('doc-export-toolbar-dragging');
    document.addEventListener('mousemove', onDockDragMove);
    document.addEventListener('mouseup', onDockDragEnd);
}

buttonsContainer.addEventListener('mousedown', function dockToolbarMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.doc-export-toolbar-btn')) return;
    if (e.target.closest('.doc-export-toolbar-toggle')) return;
    if (!buttonsContainer.contains(e.target)) return;
    startDockDrag(e);
});

contentPanel.addEventListener('mousedown', function dockContentTitleMouseDown(e) {
    if (e.button !== 0) return;
    const bar = e.target.closest('.title-bar');
    if (!bar || !contentPanel.contains(bar)) return;
    startDockDrag(e);
});

optionsPanel.addEventListener('mousedown', function dockOptionsTitleMouseDown(e) {
    if (e.button !== 0) return;
    const bar = e.target.closest('.doc-export-panel-drag');
    if (!bar || !optionsPanel.contains(bar)) return;
    startDockDrag(e);
});

window.addEventListener('resize', function onDockResize() {
    clampDockPosition();
    applyDockPosition();
});

try {
    chrome.storage.local.get([DOCK_STORAGE_KEY], function onDockStorageLoaded(result) {
        const saved = result && result[DOCK_STORAGE_KEY];
        if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') {
            dockPos.right = saved.right;
            dockPos.bottom = saved.bottom;
            clampDockPosition();
            applyDockPosition();
        }
    });
} catch (err) {
    console.warn('读取工具栏位置失败:', err);
}
applyDockPosition();

function getHeadingFonts() {
    return i18n.getCommonFonts();
}

function renderHeadingRecognizeOptions(selectedType, defaultType) {
    const types = i18n.getHeadingRecognizeTypes();
    let selected = selectedType || defaultType;
    if (!types.some(function (item) { return item.value === selected; })) {
        selected = defaultType || types[0].value;
    }
    return types.map(function (item) {
        return `<option value="${item.value}" ${selected === item.value ? 'selected' : ''}>${t(item.labelKey)}</option>`;
    }).join('');
}

function renderHeadingFontOptions(selectedFont) {
    return i18n.renderFontOptions(selectedFont, getHeadingFonts());
}

function renderFontCustomBlock(selectId, customId, selectedFont, fontList) {
    const isCustom = i18n.isCustomFontValue(selectedFont, fontList);
    return `
        <div id="${customId}Container" style="display: ${isCustom ? 'block' : 'none'}; margin-top: 8px;">
            <input type="text" id="${customId}" placeholder="${t('customFontPlaceholder')}" value="${isCustom ? selectedFont : ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
        </div>`;
}

function renderHeadingLevelPanel(level, label, result) {
    const recognizeKey = `heading${level}RecognizeType`;
    const fontKey = `heading${level}FontStyle`;
    const sizeKey = `heading${level}FontSize`;
    const customId = `heading${level}FontCustom`;
    const fontValue = result[fontKey];
    const isCustom = i18n.isCustomFontValue(fontValue, getHeadingFonts());
    const defaults = settingsManager.getDefaultValues();

    const dividerStyle = level > 1 ? 'border-top: 1px solid #E5E5EA; padding-top: 16px;' : '';

    return `
    <div style="${dividerStyle}">
        <div style="font-size: 14px; font-weight: 600; color: #3A3A3C; margin-bottom: 12px;">${label}</div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
            <div>
                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('recognizeType')}</label>
                <select id="${recognizeKey}" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                    ${renderHeadingRecognizeOptions(result[recognizeKey], defaults[recognizeKey])}
                </select>
            </div>
            <div style="display: flex; gap: 12px;">
                <div style="flex: 1; min-width: 0;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('fontStyle')}</label>
                    <select id="${fontKey}" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                        ${renderHeadingFontOptions(fontValue || defaults[fontKey])}
                    </select>
                    ${renderFontCustomBlock(fontKey, customId, fontValue, getHeadingFonts())}
                </div>
                <div style="flex: 1; min-width: 0;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('fontSize')}</label>
                    <div style="position: relative;">
                        <input type="range" id="${sizeKey}" min="5" max="42" value="${result[sizeKey] || defaults[sizeKey]}" style="width: 100%; margin-bottom: 8px; box-sizing: border-box;">
                        <span id="${sizeKey}Display" style="font-size: 12px; color: #8E8E93; display: block; text-align: center;"></span>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

// 加载设置面板内容
function loadOptionsPanel() {
    // 从chrome.storage获取当前设置
    settingsManager.loadSettings().then(result => {
        const VALID_ARTICLE_SEPARATORS = ['newline', 'pagebreak', 'custom'];
        const articleSeparatorNormalized = VALID_ARTICLE_SEPARATORS.includes(result.articleSeparator)
            ? result.articleSeparator
            : settingsManager.getDefaultValues().articleSeparator;

        const titleFonts = i18n.getTitleFonts();
        const commonFonts = i18n.getCommonFonts();
        const titleFontVal = result.titleFontStyle;
        const bodyFontVal = result.bodyFontStyle;
        const pageNumFontVal = result.pageNumberFontStyle;
        const tocTitleFontVal = result.tocTitleFontStyle;
        const tocEntryFontVal = result.tocEntryFontStyle;

        // 创建设置面板HTML
        optionsPanel.innerHTML = `
            <div class="doc-export-panel-drag" style="display: flex; justify-content: center; align-items: center; padding: 15px; margin-bottom: 5px;">
                <div style="text-align: center;">
                    <h3 style="margin: 0; font-size: 18px; color: #333; font-weight: 600;">${t('formatSettingsTitle')}</h3>
                    <p style="margin: 6px 0 0 0; font-size: 12px; color: #8E8E93; font-weight: 400; line-height: 1.4;">${t('formatAutoSaveHint')}</p>
                </div>
            </div>

            <!-- 字体设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('fontSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <!-- 字体选择行 -->
                        <div style="display: flex; gap: 12px;">
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('titleFont')}</label>
                                <select id="titleFontStyle" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                    ${i18n.renderFontOptions(titleFontVal, titleFonts)}
                </select>
                                ${renderFontCustomBlock('titleFontStyle', 'titleFontCustom', titleFontVal, titleFonts)}
            </div>

                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('bodyFont')}</label>
                                <select id="bodyFontStyle" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                    ${i18n.renderFontOptions(bodyFontVal, commonFonts)}
                </select>
                                ${renderFontCustomBlock('bodyFontStyle', 'bodyFontCustom', bodyFontVal, commonFonts)}
            </div>
            </div>

                        <!-- 字号设置行 -->
                        <div style="display: flex; gap: 12px;">
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('titleFontSize')}</label>
                                <div style="position: relative;">
                                    <input type="range" id="titleFontSize" min="5" max="42" value="${result.titleFontSize || 18}" style="width: 100%; margin-bottom: 8px; box-sizing: border-box;">
                                    <span id="titleFontSizeDisplay" style="font-size: 12px; color: #8E8E93; display: block; text-align: center;"></span>
            </div>
            </div>

                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('bodyFontSize')}</label>
                                <div style="position: relative;">
                                    <input type="range" id="bodyFontSize" min="5" max="42" value="${result.bodyFontSize || 16}" style="width: 100%; margin-bottom: 8px; box-sizing: border-box;">
                                    <span id="bodyFontSizeDisplay" style="font-size: 12px; color: #8E8E93; display: block; text-align: center;"></span>
            </div>
                    </div>
                    </div>
                    </div>
                    </div>
                </div>

            <!-- 标题层级设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('headingSettings')}</div>
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 0;">
                        ${renderHeadingLevelPanel(1, t('heading1'), result)}
                        ${renderHeadingLevelPanel(2, t('heading2'), result)}
                        ${renderHeadingLevelPanel(3, t('heading3'), result)}
                    </div>
                </div>
            </div>

            <!-- 段落设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 10px;">${t('paragraphSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <!-- 段前段后间距行 -->
                        <div style="display: flex; gap: 12px;">
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('spacingBefore')}</label>
                                <input type="number" id="paragraphSpacingBefore" value="${result.paragraphSpacingBefore || 0}" min="0" max="100" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
            </div>

                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('spacingAfter')}</label>
                                <input type="number" id="paragraphSpacingAfter" value="${result.paragraphSpacingAfter || 0}" min="0" max="100" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            </div>
                        </div>
                        
                        <!-- 首行缩进行 -->
                        <div>
                            <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('firstLineIndent')}</label>
                            <input type="number" id="firstLineIndent" value="${result.firstLineIndent || 2}" min="0" max="10" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                        </div>
                    

                        <div>
                            <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('lineSpacingType')}</label>
                            <select id="lineSpacing" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                    <option value="single" ${result.lineSpacing === 'single' ? 'selected' : ''}>${t('lineSpacingSingle')}</option>
                    <option value="1.5" ${result.lineSpacing === '1.5' ? 'selected' : ''}>${t('lineSpacing15')}</option>
                    <option value="2" ${result.lineSpacing === '2' ? 'selected' : ''}>${t('lineSpacing2')}</option>
                    <option value="fixed" ${result.lineSpacing === 'fixed' ? 'selected' : ''}>${t('lineSpacingFixed')}</option>
                    <option value="multiple" ${result.lineSpacing === 'multiple' ? 'selected' : ''}>${t('lineSpacingMultiple')}</option>
                </select>
            </div>

                        <!-- 固定行距（条件显示） -->
                        <div id="fixedLineSpacingContainer" style="${result.lineSpacing === 'fixed' ? '' : 'display: none;'}">
                            <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('fixedLineSpacing')}</label>
                            <input type="number" id="fixedLineSpacing" value="${result.fixedLineSpacing || 20}" min="1" max="100" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
            </div>

                        <!-- 多倍行距（条件显示） -->
                        <div id="multipleLineSpacingContainer" style="${result.lineSpacing === 'multiple' ? '' : 'display: none;'}">
                            <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('multipleLineSpacing')}</label>
                            <input type="number" id="multipleLineSpacing" value="${result.multipleLineSpacing || 3}" min="1" max="3" step="0.1" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
            </div>
            </div>
                </div>
            </div>
            
            <!-- 页边距设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 10px;">${t('marginSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <!-- 上下边距行 -->
                        <div style="display: flex; gap: 12px;">
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('marginTop')}</label>
                                <input type="number" id="pageMarginTop" value="${result.pageMargins?.top || 2.8}" min="0" max="10" step="0.1" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('marginBottom')}</label>
                                <input type="number" id="pageMarginBottom" value="${result.pageMargins?.bottom || 2.8}" min="0" max="10" step="0.1" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            </div>
                        </div>
                        <!-- 左右边距行 -->
                        <div style="display: flex; gap: 12px;">
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('marginLeft')}</label>
                                <input type="number" id="pageMarginLeft" value="${result.pageMargins?.left || 2.8}" min="0" max="10" step="0.1" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('marginRight')}</label>
                                <input type="number" id="pageMarginRight" value="${result.pageMargins?.right || 2.8}" min="0" max="10" step="0.1" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 页码设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('pageNumberSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <!-- 添加页码 -->
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <label style="font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('addPageNumbers')}</label>
                                <div style="font-size: 12px; color: #8E8E93; margin-top: 2px;">${t('addPageNumbersHelp')}</div>
                            </div>
                            <div style="position: relative;">
                                <input type="checkbox" id="addPageNumbers" ${result.addPageNumbers === 'yes' ? 'checked' : ''} style="display: none;">
                                <label for="addPageNumbers" style="
                                    display: inline-block;
                                    width: 51px;
                                    height: 31px;
                                    background-color: ${result.addPageNumbers === 'yes' ? '#34C759' : '#E5E5EA'};
                                    border-radius: 16px;
                                    position: relative;
                                    cursor: pointer;
                                    transition: background-color 0.3s ease;
                                    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
                                ">
                                    <span style="
                                        position: absolute;
                                        top: 2px;
                                        left: ${result.addPageNumbers === 'yes' ? '22px' : '2px'};
                                        width: 27px;
                                        height: 27px;
                                        background-color: white;
                                        border-radius: 50%;
                                        transition: left 0.3s ease;
                                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                                    "></span>
                                </label>
                            </div>
                        </div>

                        <!-- 页码位置和样式（条件显示） -->
                        <div class="page-number-setting" style="display: ${result.addPageNumbers === 'yes' ? 'flex' : 'none'}; gap: 12px;">
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('pageNumberPosition')}</label>
                                <select id="pageNumberPosition" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                                    <option value="footerLeft" ${result.pageNumberPosition === 'footerLeft' ? 'selected' : ''}>${t('footerLeft')}</option>
                                    <option value="footerCenter" ${result.pageNumberPosition === 'footerCenter' ? 'selected' : ''}>${t('footerCenter')}</option>
                                    <option value="footerRight" ${result.pageNumberPosition === 'footerRight' ? 'selected' : ''}>${t('footerRight')}</option>
                </select>
            </div>

                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('pageNumberStyle')}</label>
                                <select id="pageNumberStyle" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                    <option value="1,2,3" ${result.pageNumberStyle === '1,2,3' ? 'selected' : ''}>1,2,3...</option>
                </select>
                            </div>
            </div>

                        <!-- 页码字体和字号（条件显示） -->
                        <div class="page-number-setting" style="display: ${result.addPageNumbers === 'yes' ? '' : 'none'}; gap: 12px;">
                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('pageNumberFont')}</label>
                                <select id="pageNumberFontStyle" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                    ${i18n.renderFontOptions(pageNumFontVal, commonFonts)}
                </select>
                                ${renderFontCustomBlock('pageNumberFontStyle', 'pageNumberFontCustom', pageNumFontVal, commonFonts)}
            </div>

                            <div style="flex: 1; min-width: 0;">
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('pageNumberFontSize')}</label>
                                <div style="position: relative;">
                                    <input type="range" id="pageNumberFontSize" value="${result.pageNumberFontSize || 12}" min="8" max="24" style="width: 100%; margin-bottom: 8px; box-sizing: border-box;">
                                    <span id="pageNumberFontSizeValue" style="font-size: 12px; color: #8E8E93; display: block; text-align: center;">${result.pageNumberFontSize || 12}</span>
            </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 表格保存设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('tableSettings')}</div>
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <label style="font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('saveTables')}</label>
                            <div style="font-size: 12px; color: #8E8E93; margin-top: 2px;">${t('saveTablesHelp')}</div>
                        </div>
                        <div style="position: relative;">
                            <input type="checkbox" id="saveTables" ${result.saveTables === 'yes' ? 'checked' : ''} style="display: none;">
                            <label for="saveTables" style="
                                display: inline-block;
                                width: 51px;
                                height: 31px;
                                background-color: ${result.saveTables === 'yes' ? '#34C759' : '#E5E5EA'};
                                border-radius: 16px;
                                position: relative;
                                cursor: pointer;
                                transition: background-color 0.3s ease;
                                box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
                            ">
                                <span style="
                                    position: absolute;
                                    top: 2px;
                                    left: ${result.saveTables === 'yes' ? '22px' : '2px'};
                                    width: 27px;
                                    height: 27px;
                                    background-color: white;
                                    border-radius: 50%;
                                    transition: left 0.3s ease;
                                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                                "></span>
                            </label>
                        </div>
                    </div>
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #F2F2F7;">
                        <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('cellAlignment')}</label>
                        <select id="tableCellAlignment" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            <option value="left" ${(result.tableCellAlignment || 'center') === 'left' ? 'selected' : ''}>${t('alignLeft')}</option>
                            <option value="center" ${(result.tableCellAlignment || 'center') === 'center' ? 'selected' : ''}>${t('alignCenter')}</option>
                            <option value="right" ${(result.tableCellAlignment || 'center') === 'right' ? 'selected' : ''}>${t('alignRight')}</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- 图片保存设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('imageSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <!-- 保存图片选项 -->
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <label style="font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('saveImages')}</label>
                                <div style="font-size: 12px; color: #8E8E93; margin-top: 2px;">${t('saveImagesHelp')}</div>
                            </div>
                            <div style="position: relative;">
                                <input type="checkbox" id="saveImages" ${result.saveImages === 'yes' ? 'checked' : ''} style="display: none;">
                                <label for="saveImages" style="
                                    display: inline-block;
                                    width: 51px;
                                    height: 31px;
                                    background-color: ${result.saveImages === 'yes' ? '#34C759' : '#E5E5EA'};
                                    border-radius: 16px;
                                    position: relative;
                                    cursor: pointer;
                                    transition: background-color 0.3s ease;
                                    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
                                ">
                                    <span style="
                                        position: absolute;
                                        top: 2px;
                                        left: ${result.saveImages === 'yes' ? '22px' : '2px'};
                                        width: 27px;
                                        height: 27px;
                                        background-color: white;
                                        border-radius: 50%;
                                        transition: left 0.3s ease;
                                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                                    "></span>
                                </label>
                            </div>
                        </div>

                        <!-- 图片质量设置（条件显示） -->
                        <div id="imageSettingsContainer" style="display: flex; flex-direction: column; gap: 16px; ${result.saveImages === 'no' ? 'display: none;' : ''}">
                            <!-- 图片质量和格式行 -->
                            <div style="display: flex; gap: 12px;">
                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('imageQuality')}</label>
                                    <select id="imageQuality" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                                        <option value="high" ${result.imageQuality === 'high' ? 'selected' : ''}>${t('qualityHigh')}</option>
                        <option value="medium" ${result.imageQuality === 'medium' ? 'selected' : ''}>${t('qualityMedium')}</option>
                        <option value="low" ${result.imageQuality === 'low' ? 'selected' : ''}>${t('qualityLow')}</option>
                    </select>
                </div>

                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('imageFormat')}</label>
                                    <select id="imageFormat" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                        <option value="jpeg" ${result.imageFormat === 'jpeg' ? 'selected' : ''}>${t('formatJpeg')}</option>
                        <option value="png" ${result.imageFormat === 'png' ? 'selected' : ''}>${t('formatPng')}</option>
                    </select>
                                </div>
                </div>

                            <!-- 图片尺寸设置行 -->
                            <div style="display: flex; gap: 12px;">
                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('imageMaxWidth')}</label>
                                    <input type="number" id="imageMaxWidth" value="${result.imageMaxWidth || 600}" min="100" max="2000" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                                    <div style="font-size: 12px; color: #8E8E93; margin-top: 6px;">${t('imageScaleWidthHelp')}</div>
                </div>

                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('imageMaxHeight')}</label>
                                    <input type="number" id="imageMaxHeight" value="${result.imageMaxHeight || 800}" min="100" max="2000" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                                    <div style="font-size: 12px; color: #8E8E93; margin-top: 6px;">${t('imageScaleHeightHelp')}</div>
                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
            </div>

            <!-- 超链接设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('hyperlinkSettings')}</div>
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <label style="font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('preserveHyperlinks')}</label>
                            <div style="font-size: 12px; color: #8E8E93; margin-top: 2px;">${t('preserveHyperlinksHelp')}</div>
                        </div>
                        <div style="position: relative;">
                            <input type="checkbox" id="preserveHyperlinks" ${result.preserveHyperlinks === 'yes' ? 'checked' : ''} style="display: none;">
                            <label for="preserveHyperlinks" style="
                                display: inline-block;
                                width: 51px;
                                height: 31px;
                                background-color: ${result.preserveHyperlinks === 'yes' ? '#34C759' : '#E5E5EA'};
                                border-radius: 16px;
                                position: relative;
                                cursor: pointer;
                                transition: background-color 0.3s ease;
                                box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
                            ">
                                <span style="
                                    position: absolute;
                                    top: 2px;
                                    left: ${result.preserveHyperlinks === 'yes' ? '22px' : '2px'};
                                    width: 27px;
                                    height: 27px;
                                    background-color: white;
                                    border-radius: 50%;
                                    transition: left 0.3s ease;
                                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                                "></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 目录设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('tocSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <!-- 生成目录选项 -->
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <label style="font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('generateToc')}</label>
                                <div style="font-size: 12px; color: #8E8E93; margin-top: 2px;">${t('generateTocHelp')}</div>
                            </div>
                            <div style="position: relative;">
                                <input type="checkbox" id="generateTableOfContents" ${result.generateTableOfContents === 'yes' ? 'checked' : ''} style="display: none;">
                                <label for="generateTableOfContents" style="
                                    display: inline-block;
                                    width: 51px;
                                    height: 31px;
                                    background-color: ${result.generateTableOfContents === 'yes' ? '#34C759' : '#E5E5EA'};
                                    border-radius: 16px;
                                    position: relative;
                                    cursor: pointer;
                                    transition: background-color 0.3s ease;
                                    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
                                ">
                                    <span style="
                                        position: absolute;
                                        top: 2px;
                                        left: ${result.generateTableOfContents === 'yes' ? '22px' : '2px'};
                                        width: 27px;
                                        height: 27px;
                                        background-color: white;
                                        border-radius: 50%;
                                        transition: left 0.3s ease;
                                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                                    "></span>
                                </label>
                            </div>
                        </div>

                        <!-- 目录详细设置（条件显示） -->
                        <div id="tocSettingsContainer" style="display: flex; flex-direction: column; gap: 16px;">
                            <!-- 目录标题设置 -->
                            <div>
                                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('tocTitle')}</label>
                                <input type="text" id="tocTitle" value="${result.tocTitle || t('defaultTocTitle')}" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            </div>

                            <!-- 目录字体设置 -->
                            <div style="display: flex; gap: 12px;">
                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('tocTitleFont')}</label>
                                    <select id="tocTitleFontStyle" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                                        ${i18n.renderFontOptions(tocTitleFontVal, commonFonts)}
                                    </select>
                                    ${renderFontCustomBlock('tocTitleFontStyle', 'tocTitleFontCustom', tocTitleFontVal, commonFonts)}
                                </div>
                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('tocEntryFont')}</label>
                                    <select id="tocEntryFontStyle" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                                        ${i18n.renderFontOptions(tocEntryFontVal, commonFonts)}
                                    </select>
                                    ${renderFontCustomBlock('tocEntryFontStyle', 'tocEntryFontCustom', tocEntryFontVal, commonFonts)}
                                </div>
                            </div>

                            <!-- 目录字号设置 -->
                            <div style="display: flex; gap: 12px;">
                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('tocTitleFontSize')}</label>
                                    <div style="position: relative;">
                                        <input type="range" id="tocTitleFontSize" value="${result.tocTitleFontSize || 16}" min="12" max="24" style="width: 100%; margin-bottom: 8px; box-sizing: border-box;">
                                        <span id="tocTitleFontSizeValue" style="font-size: 12px; color: #8E8E93; display: block; text-align: center;">${result.tocTitleFontSize || 16}</span>
                                    </div>
                                </div>
                                <div style="flex: 1; min-width: 0;">
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('tocEntryFontSize')}</label>
                                    <div style="position: relative;">
                                        <input type="range" id="tocEntryFontSize" value="${result.tocEntryFontSize || 12}" min="8" max="20" style="width: 100%; margin-bottom: 8px; box-sizing: border-box;">
                                        <span id="tocEntryFontSizeValue" style="font-size: 12px; color: #8E8E93; display: block; text-align: center;">${result.tocEntryFontSize || 12}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
             <!-- 文章分隔设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('articleSeparatorSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <!-- 文章分隔方式 -->
                        <div>
                            <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('articleSeparator')}</label>
                            <select id="articleSeparator" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                                <option value="newline" ${articleSeparatorNormalized === 'newline' ? 'selected' : ''}>${t('separatorNewline')}</option>
                                <option value="pagebreak" ${articleSeparatorNormalized === 'pagebreak' ? 'selected' : ''}>${t('separatorPagebreak')}</option>
                                <option value="custom" ${articleSeparatorNormalized === 'custom' ? 'selected' : ''}>${t('separatorCustom')}</option>
                            </select>
                        </div>
                        
                        <!-- 自定义分隔符（条件显示） -->
                        <div id="customSeparatorContainer" style="${articleSeparatorNormalized === 'custom' ? '' : 'display: none;'}">
                            <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('customSeparator')}</label>
                            <input type="text" id="customSeparator" value="${result.customSeparator || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                            <div style="font-size: 12px; color: #8E8E93; margin-top: 6px;">${t('customSeparatorHelp')}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 文件名设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('filenameSettings')}</div>
                
                <div style="background-color: white; border-radius: 12px; padding: 16px; margin-bottom: 12px;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('exportFormat')}</label>
                    <select id="exportFormat" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                        <option value="docx" ${(result.exportFormat || 'docx') === 'docx' ? 'selected' : ''}>${t('exportFormatDocx')}</option>
                        <option value="pdf" ${result.exportFormat === 'pdf' ? 'selected' : ''}>${t('exportFormatPdf')}</option>
                    </select>
                    <div style="font-size: 12px; color: #8E8E93; margin-top: 6px;">${t('exportFormatHelp')}</div>
                </div>

                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('filenameFormat')}</label>
                    <input type="text" id="filenameFormat" value="${i18n.localizeFilenameFormat(result.filenameFormat)}" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 14px; color: #1C1C1E; box-sizing: border-box;">
                    <div style="font-size: 12px; color: #8E8E93; margin-top: 6px;">${t('filenameFormatHelp')}</div>
                </div>
            </div>

            <!-- 内容过滤设置组 -->
            <div style="background-color: #F2F2F7; border-radius: 16px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1C1C1E; margin-bottom: 16px;">${t('exportTextExcludeSettings')}</div>

                <div style="background-color: white; border-radius: 12px; padding: 16px; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <div style="font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('exportTextExcludeEnabled')}</div>
                            <div style="font-size: 12px; color: #8E8E93; margin-top: 4px;">${t('exportTextExcludeEnabledHelp')}</div>
                        </div>
                        <div>
                            <input type="checkbox" id="exportTextExcludeEnabled" ${(result.exportTextExcludeEnabled || 'yes') === 'yes' ? 'checked' : ''} style="display: none;">
                            <label for="exportTextExcludeEnabled" style="
                                display: inline-block;
                                width: 51px;
                                height: 31px;
                                background-color: ${(result.exportTextExcludeEnabled || 'yes') === 'yes' ? '#34C759' : '#E5E5EA'};
                                border-radius: 16px;
                                position: relative;
                                cursor: pointer;
                                transition: background-color 0.3s ease;
                                box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
                            ">
                                <span style="
                                    position: absolute;
                                    top: 2px;
                                    left: ${(result.exportTextExcludeEnabled || 'yes') === 'yes' ? '22px' : '2px'};
                                    width: 27px;
                                    height: 27px;
                                    background-color: white;
                                    border-radius: 50%;
                                    transition: left 0.3s ease;
                                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                                "></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div style="background-color: white; border-radius: 12px; padding: 16px;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #3A3A3C; font-size: 14px;">${t('exportTextExcludeCustom')}</label>
                    <textarea id="exportTextExcludeCustom" rows="4" placeholder="${t('exportTextExcludeCustomPlaceholder')}" style="width: 100%; padding: 8px 12px; border: 1px solid #D1D1D6; border-radius: 8px; background-color: #F9F9F9; font-size: 13px; color: #1C1C1E; box-sizing: border-box; resize: vertical; font-family: inherit;">${result.exportTextExcludeCustom || ''}</textarea>
                    <div style="font-size: 12px; color: #8E8E93; margin-top: 6px;">${t('exportTextExcludeCustomHelp')}</div>
                </div>
            </div>
        `;

        // 添加事件监听器
        getOptionsEl('titleFontSize').addEventListener('input', function() {
            settingsManager.updateFontSizeDisplay('title');
        });

        getOptionsEl('bodyFontSize').addEventListener('input', function() {
            settingsManager.updateFontSizeDisplay('body');
        });

        // 添加页码字号滑块事件监听器
        getOptionsEl('pageNumberFontSize').addEventListener('input', function() {
            const value = this.value;
            getOptionsEl('pageNumberFontSizeValue').textContent = value;
        });

        getOptionsEl('lineSpacing').addEventListener('change', function() {
            settingsManager.updateLineSpacingDisplay();
        });

        // 添加页码设置选项的事件监听器
        getOptionsEl('addPageNumbers').addEventListener('change', function() {
            const pageNumberSettings = queryOptionsAll('.page-number-setting');
            const switchLabel = this.nextElementSibling;
            const switchCircle = switchLabel.querySelector('span');
            
            // 更新开关样式
            if (this.checked) {
                switchLabel.style.backgroundColor = '#34C759';
                switchCircle.style.left = '22px';
            } else {
                switchLabel.style.backgroundColor = '#E5E5EA';
                switchCircle.style.left = '2px';
            }
            
            // 显示/隐藏页码设置
            pageNumberSettings.forEach(setting => {
                setting.style.display = this.checked ? 'flex' : 'none';
            });
        });

        getOptionsEl('articleSeparator').addEventListener('change', function() {
            const customSeparatorContainer = getOptionsEl('customSeparatorContainer');
            customSeparatorContainer.style.display = this.value === 'custom' ? 'block' : 'none';
        });

        // 添加表格保存选项的事件监听器
        getOptionsEl('saveTables').addEventListener('change', function() {
            const switchLabel = this.nextElementSibling;
            const switchCircle = switchLabel.querySelector('span');
            if (this.checked) {
                switchLabel.style.backgroundColor = '#34C759';
                switchCircle.style.left = '22px';
            } else {
                switchLabel.style.backgroundColor = '#E5E5EA';
                switchCircle.style.left = '2px';
            }
        });

        if (getOptionsEl('exportTextExcludeEnabled')) {
            getOptionsEl('exportTextExcludeEnabled').addEventListener('change', function() {
                const switchLabel = this.nextElementSibling;
                const switchCircle = switchLabel.querySelector('span');
                if (this.checked) {
                    switchLabel.style.backgroundColor = '#34C759';
                    switchCircle.style.left = '22px';
                } else {
                    switchLabel.style.backgroundColor = '#E5E5EA';
                    switchCircle.style.left = '2px';
                }
            });
        }

        // 添加图片保存选项的事件监听器
        getOptionsEl('saveImages').addEventListener('change', function() {
            const imageSettingsContainer = getOptionsEl('imageSettingsContainer');
            const switchLabel = this.nextElementSibling;
            const switchCircle = switchLabel.querySelector('span');
            
            // 更新开关样式
            if (this.checked) {
                switchLabel.style.backgroundColor = '#34C759';
                switchCircle.style.left = '22px';
            } else {
                switchLabel.style.backgroundColor = '#E5E5EA';
                switchCircle.style.left = '2px';
            }
            
            // 显示/隐藏图片设置
            imageSettingsContainer.style.display = this.checked ? 'flex' : 'none';
        });

        getOptionsEl('preserveHyperlinks').addEventListener('change', function() {
            const switchLabel = this.nextElementSibling;
            const switchCircle = switchLabel.querySelector('span');
            if (this.checked) {
                switchLabel.style.backgroundColor = '#34C759';
                switchCircle.style.left = '22px';
            } else {
                switchLabel.style.backgroundColor = '#E5E5EA';
                switchCircle.style.left = '2px';
            }
        });

        // 添加目录生成选项的事件监听器
        getOptionsEl('generateTableOfContents').addEventListener('change', function() {
            const tocSettingsContainer = getOptionsEl('tocSettingsContainer');
            const switchLabel = this.nextElementSibling;
            const switchCircle = switchLabel.querySelector('span');
            
            // 更新开关样式
            if (this.checked) {
                switchLabel.style.backgroundColor = '#34C759';
                switchCircle.style.left = '22px';
            } else {
                switchLabel.style.backgroundColor = '#E5E5EA';
                switchCircle.style.left = '2px';
            }
            
            // 显示/隐藏目录设置
            tocSettingsContainer.style.display = this.checked ? 'flex' : 'none';
        });

        // 添加目录标题字号滑块事件监听器
        getOptionsEl('tocTitleFontSize').addEventListener('input', function() {
            const value = this.value;
            getOptionsEl('tocTitleFontSizeValue').textContent = value;
        });

        // 添加目录条目字号滑块事件监听器
        getOptionsEl('tocEntryFontSize').addEventListener('input', function() {
            const value = this.value;
            getOptionsEl('tocEntryFontSizeValue').textContent = value;
        });

        // 添加字体选择框的事件监听器
        getOptionsEl('titleFontStyle').addEventListener('change', function() {
            const customContainer = getOptionsEl('titleFontCustomContainer');
            customContainer.style.display = this.value === 'custom' ? 'block' : 'none';
        });

        getOptionsEl('bodyFontStyle').addEventListener('change', function() {
            const customContainer = getOptionsEl('bodyFontCustomContainer');
            customContainer.style.display = this.value === 'custom' ? 'block' : 'none';
        });

        getOptionsEl('pageNumberFontStyle').addEventListener('change', function() {
            const customContainer = getOptionsEl('pageNumberFontCustomContainer');
            customContainer.style.display = this.value === 'custom' ? 'block' : 'none';
        });

        getOptionsEl('tocTitleFontStyle').addEventListener('change', function() {
            const customContainer = getOptionsEl('tocTitleFontCustomContainer');
            customContainer.style.display = this.value === 'custom' ? 'block' : 'none';
        });

        getOptionsEl('tocEntryFontStyle').addEventListener('change', function() {
            const customContainer = getOptionsEl('tocEntryFontCustomContainer');
            customContainer.style.display = this.value === 'custom' ? 'block' : 'none';
        });

        [1, 2, 3].forEach(function (level) {
            const fontStyleEl = getOptionsEl(`heading${level}FontStyle`);
            if (fontStyleEl) {
                fontStyleEl.addEventListener('change', function () {
                    const customContainer = getOptionsEl(`heading${level}FontCustomContainer`);
                    if (customContainer) {
                        customContainer.style.display = this.value === 'custom' ? 'block' : 'none';
                    }
                });
            }
            const fontSizeEl = getOptionsEl(`heading${level}FontSize`);
            if (fontSizeEl) {
                fontSizeEl.addEventListener('input', function () {
                    settingsManager.updateHeadingFontSizeDisplay(level);
                });
            }
        });

        // 自动保存格式设置
        let formatAutoSaveTimer = null;
        function scheduleFormatAutoSave() {
            clearTimeout(formatAutoSaveTimer);
            formatAutoSaveTimer = setTimeout(function () {
                const newSettings = settingsManager.getCurrentSettings();
                const validationErrors = validateSettings(newSettings);
                if (validationErrors.length > 0) {
                    return;
                }
                settingsManager.saveSettings(newSettings);
            }, 500);
        }

        optionsPanel.querySelectorAll('input, select, textarea').forEach(function (el) {
            el.addEventListener('change', scheduleFormatAutoSave);
            if (el.type === 'text' || el.type === 'number' || el.type === 'range') {
                el.addEventListener('input', scheduleFormatAutoSave);
            }
        });

        // 初始化显示
        settingsManager.updateFontSizeDisplay('title');
        settingsManager.updateFontSizeDisplay('body');
        [1, 2, 3].forEach(function (level) {
            settingsManager.updateHeadingFontSizeDisplay(level);
        });
        settingsManager.updateLineSpacingDisplay();
        
        // 初始化目录字号显示值
        const tocTitleFontSizeElement = getOptionsEl('tocTitleFontSize');
        const tocTitleFontSizeValueElement = getOptionsEl('tocTitleFontSizeValue');
        if (tocTitleFontSizeElement && tocTitleFontSizeValueElement) {
            tocTitleFontSizeValueElement.textContent = tocTitleFontSizeElement.value;
        }
        
        const tocEntryFontSizeElement = getOptionsEl('tocEntryFontSize');
        const tocEntryFontSizeValueElement = getOptionsEl('tocEntryFontSizeValue');
        if (tocEntryFontSizeElement && tocEntryFontSizeValueElement) {
            tocEntryFontSizeValueElement.textContent = tocEntryFontSizeElement.value;
        }
        
        // 初始化页码设置显示
        const pageNumberSettings = queryOptionsAll('.page-number-setting');
        const addPageNumbersCheckbox = getOptionsEl('addPageNumbers');
        if (pageNumberSettings.length > 0 && addPageNumbersCheckbox) {
            pageNumberSettings.forEach(setting => {
                setting.style.display = addPageNumbersCheckbox.checked ? 'flex' : 'none';
            });
        }
        
        // 初始化图片设置显示
        const imageSettingsContainer = getOptionsEl('imageSettingsContainer');
        if (imageSettingsContainer) {
            imageSettingsContainer.style.display = result.saveImages === 'yes' ? 'flex' : 'none';
        }
        // 初始化目录设置显示
        const tocSettingsContainer = getOptionsEl("tocSettingsContainer");
        const generateTocCheckbox = getOptionsEl("generateTableOfContents");
        if (tocSettingsContainer && generateTocCheckbox) {
            tocSettingsContainer.style.display = generateTocCheckbox.checked ? "flex" : "none";
        }
        
        // 为所有输入框和选择框添加焦点效果
        const inputs = optionsPanel.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('focus', function() {
                this.style.borderColor = '#007AFF';
                this.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)';
            });
            input.addEventListener('blur', function() {
                this.style.borderColor = '#D1D1D6';
                this.style.boxShadow = 'none';
            });
        });
        
        // 为滑块控件添加iOS风格样式
        const sliders = optionsPanel.querySelectorAll('input[type="range"]');
        sliders.forEach(slider => {
            slider.style.webkitAppearance = 'none';
            slider.style.appearance = 'none';
            slider.style.height = '6px';
            slider.style.borderRadius = '3px';
            slider.style.outline = 'none';
            slider.style.margin = '8px 0';
            slider.style.cursor = 'pointer';
            
            // 计算初始渐变值
            const initialValue = (slider.value - slider.min) / (slider.max - slider.min) * 100;
            slider.style.background = `linear-gradient(to right, #007AFF 0%, #007AFF ${initialValue}%, #D1D1D6 ${initialValue}%, #D1D1D6 100%)`;
            
            // 滑块样式
            slider.addEventListener('input', function() {
                const value = (this.value - this.min) / (this.max - this.min) * 100;
                this.style.background = `linear-gradient(to right, #007AFF 0%, #007AFF ${value}%, #D1D1D6 ${value}%, #D1D1D6 100%)`;
            });
            
            // 滑块按钮样式
            slider.style.webkitSliderThumb = 'none';
            slider.style.sliderThumb = 'none';
            
            // 添加自定义滑块按钮样式
            const style = document.createElement('style');
            style.textContent = `
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: #007AFF;
                    cursor: pointer;
                    border: 2px solid white;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                }
                input[type="range"]::-moz-range-thumb {
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: #007AFF;
                    cursor: pointer;
                    border: 2px solid white;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                }
            `;
            appendDocExportUIStyles(style.textContent);
        });
    }).catch(error => {
        console.warn('Error loading options panel:', error);
    });
}

// 验证设置
function validateSettings(settings) {
    const errors = [];
    
    if (settings.titleFontSize < 5 || settings.titleFontSize > 42) {
        errors.push(t('errTitleFontSize'));
    }
    
    if (settings.bodyFontSize < 5 || settings.bodyFontSize > 42) {
        errors.push(t('errBodyFontSize'));
    }

    const validHeadingRecognizeTypes = ['chinese_paren', 'chinese_comma', 'number_dot', 'circle_number', 'number_paren'];
    const headingLevelLabels = { 1: t('heading1'), 2: t('heading2'), 3: t('heading3') };
    [1, 2, 3].forEach(function (level) {
        const fontSize = settings[`heading${level}FontSize`];
        if (fontSize < 5 || fontSize > 42) {
            errors.push(t('errHeadingFontSize', { level: headingLevelLabels[level] }));
        }
        const recognizeType = settings[`heading${level}RecognizeType`];
        if (!validHeadingRecognizeTypes.includes(recognizeType)) {
            errors.push(t('errHeadingRecognizeType', { level: headingLevelLabels[level] }));
        }
    });
    
    if (settings.paragraphSpacingBefore < 0 || settings.paragraphSpacingBefore > 100) {
        errors.push(t('errSpacingBefore'));
    }
    
    if (settings.paragraphSpacingAfter < 0 || settings.paragraphSpacingAfter > 100) {
        errors.push(t('errSpacingAfter'));
    }
    
    if (settings.pageMargins.top < 0 || settings.pageMargins.top > 10) {
        errors.push(t('errMarginTop'));
    }
    
    if (settings.pageMargins.right < 0 || settings.pageMargins.right > 10) {
        errors.push(t('errMarginRight'));
    }
    
    if (settings.pageMargins.bottom < 0 || settings.pageMargins.bottom > 10) {
        errors.push(t('errMarginBottom'));
    }
    
    if (settings.pageMargins.left < 0 || settings.pageMargins.left > 10) {
        errors.push(t('errMarginLeft'));
    }
    
    if (settings.lineSpacing === 'fixed' && (settings.fixedLineSpacing < 1 || settings.fixedLineSpacing > 100)) {
        errors.push(t('errFixedLineSpacing'));
    }
    
    if (settings.lineSpacing === 'multiple' && (settings.multipleLineSpacing < 1 || settings.multipleLineSpacing > 3)) {
        errors.push(t('errMultipleLineSpacing'));
    }
    
    if (settings.firstLineIndent < 0 || settings.firstLineIndent > 10) {
        errors.push(t('errFirstLineIndent'));
    }
    
    if (settings.pageNumberFontSize < 8 || settings.pageNumberFontSize > 24) {
        errors.push(t('errPageNumberFontSize'));
    }
    
    // 图片设置验证
    if (settings.saveImages === 'yes') {
    if (settings.imageMaxWidth < 100 || settings.imageMaxWidth > 2000) {
        errors.push(t('errImageMaxWidth'));
    }
    
    if (settings.imageMaxHeight < 100 || settings.imageMaxHeight > 2000) {
        errors.push(t('errImageMaxHeight'));
    }
    
    if (!['jpeg', 'png'].includes(settings.imageFormat)) {
        errors.push(t('errImageFormat'));
    }
    
    if (!['high', 'medium', 'low'].includes(settings.imageQuality)) {
        errors.push(t('errImageQuality'));
        }
    }
    
    // 目录设置验证
    if (settings.generateTableOfContents === 'yes') {
        if (!settings.tocTitle || settings.tocTitle.trim() === '') {
            errors.push(t('errTocTitleEmpty'));
        }
        
        if (settings.tocTitleFontSize < 12 || settings.tocTitleFontSize > 24) {
            errors.push(t('errTocTitleFontSize'));
        }
        
        if (settings.tocEntryFontSize < 8 || settings.tocEntryFontSize > 20) {
            errors.push(t('errTocEntryFontSize'));
        }
        
    }
    
    return errors;
}

// 导出单篇文章
function exportSingleArticle(article, index) {
    // 获取用户设置的文件名格式
    safeStorageGet(EXPORT_STORAGE_SETTING_KEYS, function(settings) {
        const processedSettings = buildProcessedExportSettings(settings);

        // 显示导出提示
        showNotification(t('exporting'));

        try {
            // 创建导出页面的iframe
            const exportFrame = attachExportIframe();

            // 给脚本足够时间加载
            setTimeout(() => {
                exportFrame.contentWindow.postMessage({
                    type: 'EXPORT_SINGLE_ARTICLE',
                    article: article,
                    settings: processedSettings,
                    filenameFormat: settings.filenameFormat || getDefaultFilenameFormat()
                }, '*');
            }, 1000);

            // 监听导出完成事件
            window.addEventListener('message', function exportCompleteHandler(event) {
                if (event.data && event.data.type === 'EXPORT_COMPLETE') {
                    showNotification(t('singleExportSuccess'));
                    
                    window.removeEventListener('message', exportCompleteHandler);
                    // 移除iframe
                    setTimeout(() => {
                        if (exportFrame && exportFrame.parentNode) {
                            exportFrame.parentNode.removeChild(exportFrame);
                        }
                    }, 1000);
                } else if (event.data && event.data.type === 'EXPORT_ERROR') {
                    showNotification(t('exportDocFailed', { error: event.data.error }));
                    window.removeEventListener('message', exportCompleteHandler);
                    // 移除iframe
                    setTimeout(() => {
                        if (exportFrame && exportFrame.parentNode) {
                            exportFrame.parentNode.removeChild(exportFrame);
                        }
                    }, 1000);
                }
            });
        } catch (error) {
            console.warn('Error creating export frame:', error);
            showNotification(t('createExportPageFailed'));
        }
    });
}

// 添加错误处理辅助函数
let extensionContextInvalidNotified = false;

function isExtensionContextValid() {
    try {
        if (!chrome.runtime || !chrome.runtime.id) {
            return false;
        }
        chrome.runtime.getURL('manifest.json');
        return true;
    } catch (error) {
        return false;
    }
}

function notifyExtensionContextInvalidatedOnce() {
    if (extensionContextInvalidNotified) {
        return;
    }
    extensionContextInvalidNotified = true;
    const message = (typeof t === 'function') ? t('extensionContextInvalid') : 'Extension updated — please refresh this page (F5)';
    if (typeof showNotification === 'function') {
        showNotification(message, { duration: 8000 });
    } else {
        console.warn(message);
    }
}

function safeGetURL(path) {
    try {
        if (!isExtensionContextValid()) {
            notifyExtensionContextInvalidatedOnce();
            return '';
        }
        return chrome.runtime.getURL(path);
    } catch (error) {
        notifyExtensionContextInvalidatedOnce();
        return '';
    }
}

function safeStorageGet(keys, callback) {
    callback = typeof callback === 'function' ? callback : function () {};
    try {
        if (!isExtensionContextValid()) {
            notifyExtensionContextInvalidatedOnce();
            callback({});
            return;
        }
        chrome.storage.local.get(keys, function (result) {
            if (chrome.runtime.lastError) {
                console.warn('storage.local.get:', chrome.runtime.lastError.message);
                callback({});
                return;
            }
            callback(result);
        });
    } catch (error) {
        notifyExtensionContextInvalidatedOnce();
        callback({});
    }
}

// 添加安全的存储设置函数
function safeStorageSet(items, callback) {
    try {
        if (!isExtensionContextValid()) {
            notifyExtensionContextInvalidatedOnce();
            if (callback) callback();
            return;
        }
        chrome.storage.local.set(items, function () {
            if (chrome.runtime.lastError) {
                console.warn('storage.local.set:', chrome.runtime.lastError.message);
            }
            if (callback) callback();
        });
    } catch (error) {
        notifyExtensionContextInvalidatedOnce();
        if (callback) callback();
    }
}

/**
 * 将 CSS 颜色转为 6 位十六进制（不含 #）
 */
function cssColorToHex(color) {
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
    const named = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000' };
    const lower = String(color).trim().toLowerCase();
    if (named[lower]) return named[lower];
    if (lower.startsWith('#')) {
        const hex = lower.slice(1);
        if (hex.length === 3) {
            return hex.split('').map(function (c) { return c + c; }).join('').toUpperCase();
        }
        return hex.slice(0, 6).toUpperCase();
    }
    const rgbMatch = lower.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    if (rgbMatch) {
        const r = Math.min(255, Math.round(parseFloat(rgbMatch[1])));
        const g = Math.min(255, Math.round(parseFloat(rgbMatch[2])));
        const b = Math.min(255, Math.round(parseFloat(rgbMatch[3])));
        return [r, g, b].map(function (n) { return n.toString(16).padStart(2, '0'); }).join('').toUpperCase();
    }
    return null;
}

function cssPxToTwips(pxValue) {
    const px = parseFloat(pxValue);
    if (isNaN(px) || px <= 0) return 0;
    return Math.round(px * 15);
}

function cssFontSizeToHalfPoints(fontSize) {
    const match = String(fontSize || '').match(/([\d.]+)px/);
    if (!match) return null;
    const pt = parseFloat(match[1]) * 72 / 96;
    return Math.round(pt * 2);
}

function cssBorderSideToDocx(width, style, color) {
    const w = parseFloat(width);
    if (!style || style === 'none' || style === 'hidden' || isNaN(w) || w <= 0) {
        return { style: 'none', size: 0, color: 'auto' };
    }
    return {
        style: style === 'double' ? 'double' : 'single',
        size: Math.max(2, Math.round(w * 8)),
        color: cssColorToHex(color) || 'auto'
    };
}

function extractCellStyle(cell) {
    const cs = window.getComputedStyle(cell);
    let backgroundColor = cssColorToHex(cs.backgroundColor);
    if (!backgroundColor && cell.parentElement) {
        const parentCs = window.getComputedStyle(cell.parentElement);
        backgroundColor = cssColorToHex(parentCs.backgroundColor);
    }
    return {
        backgroundColor: backgroundColor,
        color: cssColorToHex(cs.color),
        fontWeight: cs.fontWeight,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        textAlign: cs.textAlign,
        verticalAlign: cs.verticalAlign,
        borders: {
            top: cssBorderSideToDocx(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor),
            right: cssBorderSideToDocx(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor),
            bottom: cssBorderSideToDocx(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor),
            left: cssBorderSideToDocx(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor)
        },
        margins: {
            top: cssPxToTwips(cs.paddingTop),
            right: cssPxToTwips(cs.paddingRight),
            bottom: cssPxToTwips(cs.paddingBottom),
            left: cssPxToTwips(cs.paddingLeft)
        }
    };
}

function makeTableCellFromElement(cellEl, isHeader) {
    return {
        text: (cellEl.innerText || cellEl.textContent || '').trim(),
        isHeader: !!isHeader,
        colSpan: parseInt(cellEl.colSpan, 10) || 1,
        rowSpan: parseInt(cellEl.rowSpan, 10) || 1,
        style: extractCellStyle(cellEl)
    };
}

function computeTableColumnCount(rows) {
    return rows.reduce(function (max, row) {
        return Math.max(max, row.cells.reduce(function (sum, cell) {
            return sum + (cell.colSpan || 1);
        }, 0));
    }, 0) || 1;
}

function isDivTableRoot(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || el.tagName === 'TABLE') {
        return false;
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'table' || role === 'grid') {
        return true;
    }
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/\b(grid-table|grid-merge|flex-table|a11y-table|fake-table|el-table|ant-table)\b/.test(cls)) {
        return true;
    }
    if (el.matches && el.matches('.el-table, .ant-table, .ant-table-container')) {
        return true;
    }
    try {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'table') {
            if (el.querySelector(':scope > [role="row"], :scope > .fake-row, :scope > .a11y-row, :scope > .row')) {
                return true;
            }
        }
        if (cs.display === 'grid' && el.children.length >= 4) {
            const rect = el.getBoundingClientRect();
            if (rect.width >= 80 && rect.height >= 40) {
                return true;
            }
        }
    } catch (e) { /* ignore */ }
    return false;
}

function isTableRootElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    return el.tagName === 'TABLE' || isDivTableRoot(el);
}

function hasAncestorTableRoot(el, boundary) {
    let parent = el.parentElement;
    while (parent && parent !== boundary) {
        if (isTableRootElement(parent)) {
            return true;
        }
        parent = parent.parentElement;
    }
    return false;
}

function getOrderedTableRoots(container) {
    const roots = [];
    const seen = new Set();

    function addRoot(el) {
        if (!el || seen.has(el)) {
            return;
        }
        seen.add(el);
        roots.push(el);
    }

    container.querySelectorAll('table').forEach(function (tableEl) {
        if (tableEl.closest('table') !== tableEl) {
            return;
        }
        if (shouldSkipNodeForExtract(tableEl, container)) {
            return;
        }
        // 跳过组件表格（如 .el-table）内部的 native table，避免与外层根重复计数
        if (hasAncestorTableRoot(tableEl, container)) {
            return;
        }
        addRoot(tableEl);
    });

    container.querySelectorAll(
        '[role="table"], [role="grid"], .grid-table, .grid-merge, .flex-table, .a11y-table, .fake-table, .el-table, .ant-table'
    ).forEach(function (el) {
        if (el.tagName === 'TABLE' || el.closest('table')) {
            return;
        }
        if (!isDivTableRoot(el)) {
            return;
        }
        if (shouldSkipNodeForExtract(el, container)) {
            return;
        }
        if (hasAncestorTableRoot(el, container)) {
            return;
        }
        addRoot(el);
    });

    // 仅保留最外层表格根，与文本遍历时的占位符逻辑一致
    const outermostRoots = roots.filter(function (root) {
        return !roots.some(function (other) {
            return other !== root && other.contains(root);
        });
    });

    outermostRoots.sort(function (a, b) {
        if (a === b) {
            return 0;
        }
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
            return -1;
        }
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
            return 1;
        }
        return 0;
    });

    return outermostRoots;
}

function detectGridColumnCount(gridEl, cellElements) {
    try {
        const tcols = window.getComputedStyle(gridEl).gridTemplateColumns;
        if (tcols && tcols !== 'none' && tcols !== 'auto') {
            const parts = tcols.split(/\s+/).filter(function (p) {
                return p && p !== '0px';
            });
            if (parts.length > 0) {
                return parts.length;
            }
        }
    } catch (e) { /* ignore */ }
    let headerCount = 0;
    for (let i = 0; i < cellElements.length; i++) {
        const c = cellElements[i];
        if (c.classList && (c.classList.contains('head') || c.getAttribute('role') === 'columnheader')) {
            headerCount++;
        } else {
            break;
        }
    }
    if (headerCount > 0) {
        return headerCount;
    }
    for (let cols = 12; cols >= 2; cols--) {
        if (cellElements.length % cols === 0) {
            return cols;
        }
    }
    return Math.max(1, Math.min(4, cellElements.length));
}

function readGridAxisRange(startVal, endVal) {
    const start = parseInt(String(startVal), 10);
    const end = parseInt(String(endVal), 10);
    if (isNaN(start) || isNaN(end)) {
        return null;
    }
    return {
        start0: start - 1,
        span: Math.max(1, end - start)
    };
}

function getItemGridPlacement(item) {
    try {
        const cs = window.getComputedStyle(item);
        const col = readGridAxisRange(cs.gridColumnStart, cs.gridColumnEnd);
        const row = readGridAxisRange(cs.gridRowStart, cs.gridRowEnd);
        if (!col || !row) {
            return null;
        }
        return {
            col0: col.start0,
            row0: row.start0,
            colSpan: col.span,
            rowSpan: row.span
        };
    } catch (e) {
        return null;
    }
}

function buildRowBandIndexes(items, gridRect) {
    const tops = items.map(function (item) {
        return item.getBoundingClientRect().top;
    }).sort(function (a, b) { return a - b; });

    const bands = [];
    const minHeight = Math.max(1, Math.min.apply(null, items.map(function (item) {
        return item.getBoundingClientRect().height;
    })));

    tops.forEach(function (top) {
        const exists = bands.some(function (bandTop) {
            return Math.abs(bandTop - top) <= minHeight * 0.45;
        });
        if (!exists) {
            bands.push(top);
        }
    });

    bands.sort(function (a, b) { return a - b; });
    return { bands: bands, minHeight: minHeight };
}

function getBandIndex(top, bands, minHeight) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    bands.forEach(function (bandTop, index) {
        const distance = Math.abs(bandTop - top);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });
    if (bestDistance > minHeight * 0.75) {
        return Math.max(0, Math.round((top - bands[0]) / minHeight));
    }
    return bestIndex;
}

/** 基于元素几何位置解析 CSS Grid 合并单元格（比读取 grid-row/col 更可靠） */
function extractCssGridTableByGeometry(gridEl, items) {
    const gridRect = gridEl.getBoundingClientRect();
    const colCount = detectGridColumnCount(gridEl, items);
    if (!items.length || gridRect.width < 1) {
        return { rows: [], columnCount: colCount || 1 };
    }

    const colWidth = gridRect.width / colCount;
    const bandInfo = buildRowBandIndexes(items, gridRect);
    const rowBands = bandInfo.bands;
    const minHeight = bandInfo.minHeight;

    const placements = items.map(function (item) {
        const rect = item.getBoundingClientRect();
        const col0 = Math.max(0, Math.min(colCount - 1, Math.round((rect.left - gridRect.left) / colWidth)));
        const colSpan = Math.max(1, Math.min(colCount - col0, Math.round(rect.width / colWidth)));
        const row0 = getBandIndex(rect.top, rowBands, minHeight);
        const rowSpan = Math.max(1, Math.round(rect.height / minHeight));
        return {
            item: item,
            row0: row0,
            col0: col0,
            colSpan: colSpan,
            rowSpan: rowSpan,
            area: colSpan * rowSpan
        };
    });

    placements.sort(function (a, b) {
        return b.area - a.area || a.row0 - b.row0 || a.col0 - b.col0;
    });

    const matrix = [];
    placements.forEach(function (p) {
        let row0 = p.row0;
        let col0 = p.col0;
        if (!isMatrixCellFree(matrix, row0, col0, p.rowSpan, p.colSpan)) {
            const slot = findNextAutoGridSlot(matrix, colCount, p.rowSpan, p.colSpan);
            row0 = slot.row0;
            col0 = slot.col0;
        }
        const cellData = makeTableCellFromElement(p.item, false);
        cellData.colSpan = p.colSpan;
        cellData.rowSpan = p.rowSpan;
        placeCellOnMatrix(matrix, cellData, row0, col0, p.rowSpan, p.colSpan);
    });

    return matrixToTableRows(matrix);
}

function isMatrixCellFree(matrix, row0, col0, rowSpan, colSpan) {
    for (let r = row0; r < row0 + rowSpan; r++) {
        for (let c = col0; c < col0 + colSpan; c++) {
            if (matrix[r] && matrix[r][c]) {
                return false;
            }
        }
    }
    return true;
}

function findNextAutoGridSlot(matrix, colCount, rowSpan, colSpan) {
    const maxScan = Math.max(matrix.length + rowSpan + 4, 16);
    for (let r = 0; r < maxScan; r++) {
        for (let c = 0; c < colCount; c++) {
            if (isMatrixCellFree(matrix, r, c, rowSpan, colSpan)) {
                return { row0: r, col0: c };
            }
        }
    }
    return { row0: matrix.length, col0: 0 };
}

function placeCellOnMatrix(matrix, cellData, row0, col0, rowSpan, colSpan) {
    while (matrix.length < row0 + rowSpan) {
        matrix.push([]);
    }
    for (let r = row0; r < row0 + rowSpan; r++) {
        while (matrix[r].length < col0 + colSpan) {
            matrix[r].push(null);
        }
        for (let c = col0; c < col0 + colSpan; c++) {
            if (r === row0 && c === col0) {
                matrix[r][c] = cellData;
            } else {
                matrix[r][c] = { merged: true };
            }
        }
    }
}

function matrixToTableRows(matrix) {
    let maxCol = 0;
    matrix.forEach(function (row) {
        maxCol = Math.max(maxCol, row.length);
    });
    const rows = [];
    matrix.forEach(function (row) {
        const cells = [];
        for (let c = 0; c < maxCol; c++) {
            const cell = row[c];
            if (cell && !cell.merged) {
                cells.push(cell);
            }
        }
        if (cells.length > 0) {
            rows.push({ cells: cells });
        }
    });
    return { rows: rows, columnCount: maxCol || 1 };
}

function extractCssGridTableData(gridEl) {
    const items = Array.from(gridEl.children).filter(function (c) {
        return c.nodeType === Node.ELEMENT_NODE;
    });
    if (!items.length) {
        return { rows: [], columnCount: 1 };
    }

    let hasExplicitPlacement = gridEl.classList && gridEl.classList.contains('grid-merge');
    if (!hasExplicitPlacement) {
        items.forEach(function (item) {
            const placement = getItemGridPlacement(item);
            if (placement && (placement.colSpan > 1 || placement.rowSpan > 1)) {
                hasExplicitPlacement = true;
            }
        });
    }

    if (!hasExplicitPlacement) {
        const colCount = detectGridColumnCount(gridEl, items);
        const rows = [];
        for (let i = 0; i < items.length; i += colCount) {
            const slice = items.slice(i, i + colCount);
            rows.push({
                cells: slice.map(function (cellEl) {
                    const isHeader = cellEl.classList && (
                        cellEl.classList.contains('head') ||
                        cellEl.getAttribute('role') === 'columnheader'
                    );
                    return makeTableCellFromElement(cellEl, isHeader);
                })
            });
        }
        return { rows: rows, columnCount: colCount };
    }

    return extractCssGridTableByGeometry(gridEl, items);
}

function extractRowBasedDivTableData(rootEl) {
    const rows = [];
    const rowSelectors = [
        ':scope > .el-table__row',
        ':scope > .ant-table-row',
        ':scope > [role="row"]',
        ':scope > .a11y-row',
        ':scope > .fake-row',
        ':scope > .row'
    ];
    let rowEls = [];
    for (let i = 0; i < rowSelectors.length; i++) {
        rowEls = rootEl.querySelectorAll(rowSelectors[i]);
        if (rowEls.length > 0) {
            break;
        }
    }
    if (!rowEls.length && rootEl.classList && rootEl.classList.contains('el-table')) {
        rowEls = rootEl.querySelectorAll('.el-table__body tr, .el-table__body-wrapper tr');
    }
    if (!rowEls.length && rootEl.classList && rootEl.classList.contains('ant-table')) {
        rowEls = rootEl.querySelectorAll('.ant-table-tbody > tr, tbody tr');
    }

    rowEls.forEach(function (rowEl) {
        let cellEls = rowEl.querySelectorAll(
            ':scope > [role="columnheader"], :scope > [role="cell"], :scope > .a11y-cell, :scope > .el-table__cell, :scope > .ant-table-cell, :scope > .col, :scope > th, :scope > td'
        );
        if (!cellEls.length) {
            cellEls = rowEl.querySelectorAll(':scope > div');
        }
        const cells = [];
        cellEls.forEach(function (cellEl) {
            const isHeader = cellEl.tagName === 'TH' ||
                cellEl.getAttribute('role') === 'columnheader' ||
                (rowEl.classList && rowEl.classList.contains('header')) ||
                (cellEl.classList && cellEl.classList.contains('head'));
            cells.push(makeTableCellFromElement(cellEl, isHeader));
        });
        if (cells.length > 0) {
            rows.push({ cells: cells });
        }
    });
    return { rows: rows, columnCount: computeTableColumnCount(rows) };
}

function extractDivTableData(rootEl) {
    if (rootEl.classList && rootEl.classList.contains('grid-merge')) {
        return extractCssGridTableData(rootEl);
    }
    const role = (rootEl.getAttribute('role') || '').toLowerCase();
    if (role === 'grid' || (rootEl.classList && rootEl.classList.contains('grid-table'))) {
        return extractCssGridTableData(rootEl);
    }

    const rowBased = extractRowBasedDivTableData(rootEl);
    if (rowBased.rows.length > 0) {
        return rowBased;
    }

    try {
        if (window.getComputedStyle(rootEl).display === 'grid' &&
            rootEl.children.length >= 4 &&
            !rootEl.querySelector(':scope > [role="row"], :scope > .row, :scope > .fake-row')) {
            return extractCssGridTableData(rootEl);
        }
    } catch (e) { /* ignore */ }

    const direct = Array.from(rootEl.children).filter(function (c) {
        return c.nodeType === Node.ELEMENT_NODE;
    });
    if (direct.length >= 2) {
        return extractCssGridTableData(rootEl);
    }

    return { rows: [], columnCount: 1 };
}

function extractTableLikeData(rootEl) {
    if (rootEl.tagName === 'TABLE') {
        return extractTableDataFromElement(rootEl);
    }
    return extractDivTableData(rootEl);
}

function extractTableDataFromElement(tableEl) {
    const rows = [];
    tableEl.querySelectorAll('tr').forEach(function (tr) {
        const cells = [];
        tr.querySelectorAll('th, td').forEach(function (cell) {
            cells.push(makeTableCellFromElement(cell, cell.tagName === 'TH'));
        });
        if (cells.length > 0) {
            rows.push({ cells: cells });
        }
    });
    return { rows: rows, columnCount: computeTableColumnCount(rows) };
}

function tableDataSignature(tableEntry) {
    const rows = (tableEntry.data && tableEntry.data.rows) || [];
    return rows.map(function (row) {
        return (row.cells || []).map(function (cell) {
            return String(cell.text || '').trim();
        }).join('\t');
    }).join('\n');
}

function deduplicateTablesByContent(tables) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < tables.length; i++) {
        const sig = tableDataSignature(tables[i]);
        if (!sig || seen.has(sig)) {
            continue;
        }
        seen.add(sig);
        result.push(tables[i]);
    }
    return result;
}

function extractTablesFromContainer(container) {
    const roots = getOrderedTableRoots(container);
    const tables = roots.map(function (tableEl, index) {
        return {
            tableIndex: index,
            placeholder: '[table' + String(index).padStart(2, '0') + ']',
            data: extractTableLikeData(tableEl),
            sourceType: tableEl.tagName === 'TABLE' ? 'native' : 'div'
        };
    });
    return deduplicateTablesByContent(tables).map(function (tableEntry, index) {
        return Object.assign({}, tableEntry, {
            tableIndex: index,
            placeholder: '[table' + String(index).padStart(2, '0') + ']'
        });
    });
}

const NON_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'HEAD', 'TITLE']);

function isNonContentElement(el) {
    return el && el.nodeType === Node.ELEMENT_NODE && NON_CONTENT_TAGS.has(el.tagName);
}

function isMobileViewport() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

/** 判断元素是否应对内容提取隐藏（含 PC/移动双版本页面的 mhide/pchide） */
function isElementHiddenForExtract(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    if (isNonContentElement(el)) {
        return true;
    }
    if (el.hasAttribute('hidden')) {
        return true;
    }
    const ariaHidden = el.getAttribute('aria-hidden');
    if (ariaHidden === 'true') {
        return true;
    }
    const inlineStyle = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(inlineStyle) || /visibility\s*:\s*hidden/i.test(inlineStyle)) {
        return true;
    }
    const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
    if (cls) {
        const mobile = isMobileViewport();
        if (mobile && /\bmhide\b/.test(cls)) {
            return true;
        }
        if (!mobile && /\bpchide\b/.test(cls)) {
            return true;
        }
        if (/\b(?:sr-only|visually-hidden|d-none)\b/.test(cls)) {
            return true;
        }
    }
    if (el.isConnected) {
        try {
            const cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') {
                return true;
            }
        } catch (e) { /* ignore */ }
    }
    return false;
}

/** 两个矩形是否有可见重叠（排除仅边缘相切） */
function rectsIntersect(a, b, minOverlapPx) {
    const minOverlap = minOverlapPx == null ? 1 : minOverlapPx;
    const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlapW >= minOverlap && overlapH >= minOverlap;
}

function getSelectionClientRects(range) {
    if (!range) {
        return [];
    }
    const clientRects = Array.from(range.getClientRects());
    if (clientRects.length > 0) {
        return clientRects;
    }
    try {
        const boundingRect = range.getBoundingClientRect();
        if (boundingRect && (boundingRect.width > 0 || boundingRect.height > 0)) {
            return [boundingRect];
        }
    } catch (e) { /* ignore */ }
    return [];
}

function selectionHasGeometricHighlight(range) {
    return getSelectionClientRects(range).length > 0;
}

/** 元素是否与选区高亮区域在屏幕上有几何重叠 */
function isGeometricallyInSelection(range, node) {
    if (!range || !node || node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    if (!node.isConnected) {
        return false;
    }
    try {
        const nodeRect = node.getBoundingClientRect();
        if (nodeRect.width < 1 && nodeRect.height < 1) {
            return false;
        }
        const selectionRects = getSelectionClientRects(range);
        if (selectionRects.length === 0) {
            return rangeIntersectsNodeSafely(range, node);
        }
        for (let i = 0; i < selectionRects.length; i++) {
            if (rectsIntersect(selectionRects[i], nodeRect)) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

function rangeIntersectsNodeSafely(range, node) {
    if (!range || !node) {
        return false;
    }
    try {
        if (typeof range.intersectsNode === 'function') {
            return range.intersectsNode(node);
        }
    } catch (e) { /* fall through */ }
    try {
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);
        return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0 &&
            range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;
    } catch (e) {
        return false;
    }
}

function getElementRootFromRange(range) {
    if (!range) {
        return null;
    }
    const root = range.commonAncestorContainer;
    if (!root) {
        return null;
    }
    return root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
}

function resolveBackgroundImageUrl(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }
    if (el.style && el.style.backgroundImage && el.style.backgroundImage !== 'none') {
        const match = el.style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

/**
 * 仅收集与选区高亮区域有几何重叠的图片。
 * 解决 float/侧栏作者块在 DOM 顺序上位于选区内、但视觉上不在选区的问题。
 */
function collectImagesGeometricallyInRange(range, selectedText) {
    const images = [];
    if (!range) {
        return images;
    }
    const elementRoot = getElementRootFromRange(range);
    if (!elementRoot) {
        return images;
    }
    const seenImageSrcs = new Set();
    let imageIndex = 0;

    function pushImage(data) {
        const srcKey = normalizeImageSrc(data.src);
        if (!srcKey || srcKey.startsWith('data:') || seenImageSrcs.has(srcKey)) {
            return;
        }
        seenImageSrcs.add(srcKey);

        let startOffset = 0;
        let endOffset = 0;
        let positionCalculated = false;

        if (data.element && data.element.isConnected) {
            try {
                const imgRange = document.createRange();
                imgRange.selectNode(data.element);
                if (range.compareBoundaryPoints(Range.START_TO_START, imgRange) <= 0 &&
                    range.compareBoundaryPoints(Range.END_TO_END, imgRange) >= 0) {
                    const tempRange = document.createRange();
                    tempRange.setStart(range.startContainer, range.startOffset);
                    tempRange.setEnd(imgRange.startContainer, imgRange.startOffset);
                    startOffset = tempRange.toString().length;
                    endOffset = startOffset + 1;
                    if (startOffset < 0) startOffset = 0;
                    if (endOffset <= startOffset) endOffset = startOffset + 1;
                    positionCalculated = true;
                }
            } catch (e) { /* use fallback */ }
        }

        if (!positionCalculated) {
            startOffset = (selectedText || '').length + imageIndex;
            endOffset = startOffset + 1;
        }

        images.push({
            src: data.src,
            alt: data.alt || '',
            width: data.width || 0,
            height: data.height || 0,
            position: {
                startOffset: startOffset,
                endOffset: endOffset,
                type: data.type || 'img'
            }
        });
        imageIndex++;
    }

    function considerImageElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        if (shouldSkipNodeForExtract(el, elementRoot)) {
            return;
        }
        if (!rangeIntersectsNodeSafely(range, el)) {
            return;
        }
        if (!isGeometricallyInSelection(range, el)) {
            return;
        }
        if (el.tagName === 'IMG') {
            const src = el.getAttribute('src') || el.src || '';
            if (src) {
                pushImage({
                    element: el,
                    src: src,
                    alt: el.getAttribute('alt') || '',
                    width: el.naturalWidth || el.width || 0,
                    height: el.naturalHeight || el.height || 0,
                    type: 'img'
                });
            }
            return;
        }
        const bgSrc = resolveBackgroundImageUrl(el);
        if (bgSrc) {
            pushImage({
                element: el,
                src: bgSrc,
                alt: '背景图片',
                width: el.offsetWidth || 100,
                height: el.offsetHeight || 100,
                type: 'background'
            });
        }
    }

    elementRoot.querySelectorAll('img').forEach(considerImageElement);

    const walker = document.createTreeWalker(elementRoot, NodeFilter.SHOW_ELEMENT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        if (node.tagName === 'IMG') {
            continue;
        }
        if (node.style && node.style.backgroundImage && node.style.backgroundImage !== 'none') {
            considerImageElement(node);
        }
    }

    return images;
}

function buildAllowedImageSrcSetFromRange(range) {
    const set = new Set();
    if (!range) {
        return set;
    }
    collectImagesGeometricallyInRange(range, '').forEach(function (img) {
        const key = normalizeImageSrc(img.src);
        if (key) {
            set.add(key);
        }
    });
    return set;
}

function rectsIntersectAny(rectListA, rectListB, minOverlapPx) {
    if (!rectListA.length || !rectListB.length) {
        return false;
    }
    for (let i = 0; i < rectListA.length; i++) {
        for (let j = 0; j < rectListB.length; j++) {
            if (rectsIntersect(rectListA[i], rectListB[j], minOverlapPx)) {
                return true;
            }
        }
    }
    return false;
}

function isTextNodeGeometricallyInSelection(range, textNode) {
    if (!range || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return false;
    }
    const content = textNode.textContent;
    if (!content || !/[^\s]/.test(content)) {
        return true;
    }
    try {
        const textRange = document.createRange();
        textRange.selectNodeContents(textNode);
        return rectsIntersectAny(
            getSelectionClientRects(range),
            Array.from(textRange.getClientRects())
        );
    } catch (e) {
        return false;
    }
}

/** 块级/侧栏容器在 DOM 选区内但不在蓝色高亮区域时，跳过整棵子树 */
function shouldSkipElementSubtreeGeometrically(range, el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || !el.isConnected) {
        return false;
    }
    const blockLikeTags = {
        DIV: true, P: true, H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
        SECTION: true, ARTICLE: true, HEADER: true, FOOTER: true, NAV: true, MAIN: true,
        ASIDE: true, BLOCKQUOTE: true, PRE: true, TABLE: true, UL: true, OL: true, LI: true,
        FORM: true, FIELDSET: true, FIGURE: true, FIGCAPTION: true, DETAILS: true, SUMMARY: true
    };
    if (!blockLikeTags[el.tagName]) {
        return false;
    }
    if (!selectionHasGeometricHighlight(range)) {
        return false;
    }
    return !isGeometricallyInSelection(range, el);
}

/**
 * 按选区蓝色高亮区域提取文本/链接/占位符，排除 float/侧栏等在 DOM 顺序上被包含的内容。
 */
function extractRichTextFromRangeGeometrically(range, options) {
    options = options || {};
    const saveImages = options.saveImages === true;
    const saveTables = options.saveTables === true;
    const allowedImageSrcs = options.allowedImageSrcs || null;
    const relaxTextGeometry = options.relaxTextGeometry === true;
    const elementRoot = getElementRootFromRange(range);

    let result = '';
    let imageIndex = 0;
    let tableIndex = 0;
    const links = [];
    const seenImageSrcs = new Set();

    if (!range || !elementRoot) {
        return { text: '', links: [] };
    }

    function resolveLinkHref(href) {
        if (!href || !String(href).trim()) return '';
        const trimmed = String(href).trim();
        if (/^javascript:/i.test(trimmed)) return '';
        try {
            return new URL(trimmed, document.baseURI || window.location.href).href;
        } catch (e) {
            return trimmed;
        }
    }

    function appendImagePlaceholder() {
        if (result.length > 0 && result[result.length - 1] !== '\n') {
            result += '\n';
        }
        result += '[image' + String(imageIndex).padStart(2, '0') + ']\n';
        imageIndex++;
    }

    function walkLiveNode(node) {
        if (!rangeIntersectsNodeSafely(range, node)) {
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            if (!rangeIntersectsNodeSafely(range, node)) {
                return;
            }

            let start = 0;
            let end = node.textContent.length;
            if (range.startContainer === node) {
                start = range.startOffset;
            }
            if (range.endContainer === node) {
                end = range.endOffset;
            }
            if (start >= end) {
                return;
            }

            if (!relaxTextGeometry && selectionHasGeometricHighlight(range)) {
                try {
                    const subRange = document.createRange();
                    subRange.setStart(node, start);
                    subRange.setEnd(node, end);
                    const selRects = getSelectionClientRects(range);
                    const subRects = Array.from(subRange.getClientRects());
                    if (selRects.length > 0 && subRects.length > 0) {
                        if (!rectsIntersectAny(selRects, subRects)) {
                            return;
                        }
                    } else if (selRects.length > 0 && subRects.length === 0) {
                        const parentEl = node.parentElement;
                        if (parentEl && !isGeometricallyInSelection(range, parentEl)) {
                            return;
                        }
                    }
                } catch (e) {
                    if (!isTextNodeGeometricallyInSelection(range, node)) {
                        return;
                    }
                }
            }

            result += node.textContent.slice(start, end);
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        if (shouldSkipNodeForExtract(node, elementRoot)) {
            return;
        }
        if (shouldSkipElementSubtreeGeometrically(range, node)) {
            return;
        }

        if (node.tagName === 'BR') {
            result += '\n';
            return;
        }

        if (node.tagName === 'A') {
            const absHref = resolveLinkHref(node.getAttribute('href'));
            const start = result.length;
            for (let i = 0; i < node.childNodes.length; i++) {
                walkLiveNode(node.childNodes[i]);
            }
            const addedLength = result.length - start;
            if (absHref && addedLength > 0) {
                links.push({ start: start, length: addedLength, href: absHref });
            }
            if (isBlockElement(node) && result.length > start && result[result.length - 1] !== '\n') {
                result += '\n';
            }
            return;
        }

        if (saveTables && isTableRootElement(node) && !hasAncestorTableRoot(node, elementRoot)) {
            result += '[table' + String(tableIndex).padStart(2, '0') + ']';
            tableIndex++;
            if (isBlockElement(node)) {
                result += '\n';
            }
            return;
        }

        if (saveImages && node.tagName === 'IMG') {
            const src = node.getAttribute('src') || node.src || '';
            const srcKey = normalizeImageSrc(src);
            if (srcKey && !srcKey.startsWith('data:') && !seenImageSrcs.has(srcKey)) {
                if (allowedImageSrcs && !allowedImageSrcs.has(srcKey)) {
                    return;
                }
                if (!isGeometricallyInSelection(range, node)) {
                    return;
                }
                seenImageSrcs.add(srcKey);
                appendImagePlaceholder();
            }
            return;
        }

        if (saveImages && node.style && node.style.backgroundImage && node.style.backgroundImage !== 'none') {
            const bgMatch = node.style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/);
            const srcKey = bgMatch && bgMatch[1] ? normalizeImageSrc(bgMatch[1]) : '';
            if (srcKey && !srcKey.startsWith('data:') && !seenImageSrcs.has(srcKey)) {
                if (allowedImageSrcs && !allowedImageSrcs.has(srcKey)) {
                    return;
                }
                if (!isGeometricallyInSelection(range, node)) {
                    return;
                }
                seenImageSrcs.add(srcKey);
                appendImagePlaceholder();
            }
            return;
        }

        const blockLenBefore = result.length;
        for (let i = 0; i < node.childNodes.length; i++) {
            walkLiveNode(node.childNodes[i]);
        }
        if (isBlockElement(node) && result.length > blockLenBefore && result[result.length - 1] !== '\n') {
            result += '\n';
        }
    }

    walkLiveNode(elementRoot);

    result = result.replace(/\n{4,}/g, '\n\n\n');
    return { text: result, links: links };
}

function selectionHasMeaningfulText(text) {
    return !!(text && /[^\s\u00a0]/.test(text));
}

/** 从选区提取内容；几何过滤无结果时回退到 DOM 选区文本，保证工具栏与导出可用 */
function getSelectionContentFromRange(range, options) {
    options = options || {};
    if (!range) {
        return { text: '', links: [] };
    }

    const geometric = extractRichTextFromRangeGeometrically(range, options);
    if (selectionHasMeaningfulText(geometric.text)) {
        return geometric;
    }

    const domText = range.toString();
    if (!selectionHasMeaningfulText(domText)) {
        return { text: '', links: [] };
    }

    const blockFiltered = extractRichTextFromRangeGeometrically(range, Object.assign({}, options, {
        relaxTextGeometry: true
    }));
    if (selectionHasMeaningfulText(blockFiltered.text)) {
        return blockFiltered;
    }

    return {
        text: domText,
        links: extractTextAndLinksFromSelection(domText, range).links || []
    };
}

function extractTablesGeometricallyInRange(range) {
    const elementRoot = getElementRootFromRange(range);
    if (!range || !elementRoot) {
        return [];
    }
    const roots = getOrderedTableRoots(elementRoot).filter(function (tableEl) {
        if (shouldSkipNodeForExtract(tableEl, elementRoot)) {
            return false;
        }
        if (!rangeIntersectsNodeSafely(range, tableEl)) {
            return false;
        }
        return isGeometricallyInSelection(range, tableEl);
    });
    const tables = roots.map(function (tableEl, index) {
        return {
            tableIndex: index,
            placeholder: '[table' + String(index).padStart(2, '0') + ']',
            data: extractTableLikeData(tableEl),
            sourceType: tableEl.tagName === 'TABLE' ? 'native' : 'div'
        };
    });
    return deduplicateTablesByContent(tables).map(function (tableEntry, index) {
        return Object.assign({}, tableEntry, {
            tableIndex: index,
            placeholder: '[table' + String(index).padStart(2, '0') + ']'
        });
    });
}

function hasHiddenExtractAncestor(node, stopAt) {
    let cur = node.parentNode;
    while (cur && cur !== stopAt) {
        if (cur.nodeType === Node.ELEMENT_NODE && isElementHiddenForExtract(cur)) {
            return true;
        }
        cur = cur.parentNode;
    }
    return false;
}

function shouldSkipNodeForExtract(node, container) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    if (isElementHiddenForExtract(node)) {
        return true;
    }
    return hasHiddenExtractAncestor(node, container);
}

function normalizeImageSrc(src) {
    if (!src) {
        return '';
    }
    try {
        return new URL(src, document.baseURI || window.location.href).href;
    } catch (e) {
        return String(src).trim();
    }
}

function deduplicateImagesBySrc(images) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < images.length; i++) {
        const key = normalizeImageSrc(images[i].src);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(images[i]);
    }
    return result;
}

/**
 * 获取包含图片/表格位置信息的文本内容
 * @param {Element} container - 包含选中内容的容器
 * @param {{ saveImages?: boolean, saveTables?: boolean }} [options]
 * @returns {{ text: string, links: Array<{start: number, length: number, href: string}> }}
 */
function getTextWithRichContent(container, options) {
    options = options || {};
    const saveImages = options.saveImages === true;
    const saveTables = options.saveTables === true;
    const allowedImageSrcs = options.allowedImageSrcs || null;
    let result = '';
    let imageIndex = 0;
    let tableIndex = 0;
    const links = [];
    const seenImageSrcs = new Set();

    function resolveLinkHref(href) {
        if (!href || !String(href).trim()) return '';
        const trimmed = String(href).trim();
        if (/^javascript:/i.test(trimmed)) return '';
        try {
            return new URL(trimmed, document.baseURI || window.location.href).href;
        } catch (e) {
            return trimmed;
        }
    }

    function appendImagePlaceholder() {
        if (result.length > 0 && result[result.length - 1] !== '\n') {
            result += '\n';
        }
        result += '[image' + String(imageIndex).padStart(2, '0') + ']\n';
        imageIndex++;
    }

    function traverseNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (shouldSkipNodeForExtract(node, container)) {
                return;
            }
            if (node.tagName === 'BR') {
                result += '\n';
                return;
            }
            if (node.tagName === 'A') {
                const absHref = resolveLinkHref(node.getAttribute('href'));
                const linkText = node.textContent || '';
                const start = result.length;
                result += linkText;
                if (absHref && linkText.length > 0) {
                    links.push({ start: start, length: linkText.length, href: absHref });
                }
                if (isBlockElement(node)) {
                    result += '\n';
                }
                return;
            }
            if (saveTables && isTableRootElement(node) && !hasAncestorTableRoot(node, container)) {
                result += '[table' + String(tableIndex).padStart(2, '0') + ']';
                tableIndex++;
                if (isBlockElement(node)) {
                    result += '\n';
                }
                return;
            }
            if (saveImages && node.tagName === 'IMG') {
                const src = node.getAttribute('src') || node.src || '';
                const srcKey = normalizeImageSrc(src);
                if (srcKey && !srcKey.startsWith('data:') && !seenImageSrcs.has(srcKey)) {
                    if (allowedImageSrcs && !allowedImageSrcs.has(srcKey)) {
                        return;
                    }
                    seenImageSrcs.add(srcKey);
                    appendImagePlaceholder();
                }
                return;
            } else if (saveImages && node.style && node.style.backgroundImage && node.style.backgroundImage !== 'none') {
                const bgMatch = node.style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/);
                const srcKey = bgMatch && bgMatch[1] ? normalizeImageSrc(bgMatch[1]) : '';
                if (srcKey && !srcKey.startsWith('data:') && !seenImageSrcs.has(srcKey)) {
                    if (allowedImageSrcs && !allowedImageSrcs.has(srcKey)) {
                        return;
                    }
                    seenImageSrcs.add(srcKey);
                    appendImagePlaceholder();
                }
                return;
            } else {
                for (let child of node.childNodes) {
                    traverseNode(child);
                }
                if (isBlockElement(node)) {
                    result += '\n';
                }
            }
        }
    }

    if (container.nodeType === Node.DOCUMENT_FRAGMENT_NODE || container.nodeType === Node.ELEMENT_NODE) {
        for (let child of container.childNodes) {
            traverseNode(child);
        }
    } else {
        traverseNode(container);
    }

    result = result.replace(/\n{4,}/g, '\n\n\n');
    return { text: result, links: links };
}

/**
 * 获取包含图片位置信息的文本内容（兼容旧调用）
 */
function getTextWithImagePositions(container, options) {
    if (!options) {
        return getTextWithRichContent(container, { saveImages: true, saveTables: false });
    }
    return getTextWithRichContent(container, options);
}

/** 从当前选区提取文本与超链接（严格按蓝色高亮区域） */
function extractTextAndLinksFromSelection(fallbackText, capturedRange) {
    let range = capturedRange || null;
    if (!range) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            range = selection.getRangeAt(0);
        }
    }
    if (!range) {
        return { text: fallbackText || '', links: [] };
    }
    const rich = getSelectionContentFromRange(range, {
        saveImages: false,
        saveTables: false
    });
    return {
        text: rich.text || fallbackText || '',
        links: rich.links || []
    };
}

/** 与 getTextWithRichContent 遍历顺序一致，从容器提取图片列表 */
function extractImagesFromContainer(container, options) {
    options = options || {};
    const saveTables = options.saveTables === true;
    const allowedImageSrcs = options.allowedImageSrcs || null;
    const images = [];
    const seenImageSrcs = new Set();

    function resolveBackgroundSrc(node) {
        return resolveBackgroundImageUrl(node);
    }

    function pushImageEntry(src, entry) {
        const srcKey = normalizeImageSrc(src);
        if (!srcKey || srcKey.startsWith('data:') || seenImageSrcs.has(srcKey)) {
            return;
        }
        if (allowedImageSrcs && !allowedImageSrcs.has(srcKey)) {
            return;
        }
        seenImageSrcs.add(srcKey);
        images.push(entry);
    }

    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        if (shouldSkipNodeForExtract(node, container)) {
            return;
        }
        if (node.tagName === 'BR') {
            return;
        }
        if (node.tagName === 'A') {
            return;
        }
        if (saveTables && isTableRootElement(node) && !hasAncestorTableRoot(node, container)) {
            return;
        }
        if (node.tagName === 'IMG') {
            const src = node.getAttribute('src') || node.src || '';
            pushImageEntry(src, {
                src: src,
                alt: node.getAttribute('alt') || '',
                width: node.naturalWidth || node.width || 0,
                height: node.naturalHeight || node.height || 0
            });
            return;
        }
        const bgSrc = resolveBackgroundSrc(node);
        if (bgSrc) {
            pushImageEntry(bgSrc, {
                src: bgSrc,
                alt: '背景图片',
                width: node.offsetWidth || 100,
                height: node.offsetHeight || 100,
                isBackground: true
            });
            return;
        }
        for (let i = 0; i < node.childNodes.length; i++) {
            walk(node.childNodes[i]);
        }
    }

    if (container.nodeType === Node.DOCUMENT_FRAGMENT_NODE || container.nodeType === Node.ELEMENT_NODE) {
        for (let i = 0; i < container.childNodes.length; i++) {
            walk(container.childNodes[i]);
        }
    } else {
        walk(container);
    }

    return images;
}

/** 去除重复的图片占位符行，保留与 expectedCount 一致的数量 */
function normalizeImagePlaceholders(text, expectedCount) {
    if (!text || expectedCount <= 0) {
        return String(text || '').replace(/\[image\d{2}\]/g, '');
    }
    const imageLineRe = /^\[image\d{2}\]$/;
    let imageFound = 0;
    const result = [];
    String(text).split('\n').forEach(function (line) {
        if (imageLineRe.test(line.trim())) {
            if (imageFound < expectedCount) {
                result.push('[image' + String(imageFound).padStart(2, '0') + ']');
                imageFound++;
            }
        } else {
            result.push(line);
        }
    });
    return result.join('\n');
}

/** 去除重复的表格占位符行，保留与 expectedCount 一致的数量 */
function normalizeTablePlaceholders(text, expectedCount) {
    if (!text || expectedCount <= 0) {
        return String(text || '').replace(/\[table\d{2}\]/g, '');
    }
    const tableLineRe = /^\[table\d{2}\]$/;
    let tableFound = 0;
    const result = [];
    String(text).split('\n').forEach(function (line) {
        if (tableLineRe.test(line.trim())) {
            if (tableFound < expectedCount) {
                result.push('[table' + String(tableFound).padStart(2, '0') + ']');
                tableFound++;
            }
        } else {
            result.push(line);
        }
    });
    return result.join('\n');
}

/**
 * 从选区克隆 DOM 并提取富文本、图片与表格
 * @param {string} selectedText
 * @param {{ saveImages?: boolean, saveTables?: boolean, capturedRange?: Range }} [options]
 */
function extractRichContentFromSelection(selectedText, options) {
    options = options || {};
    const saveImages = options.saveImages === true;
    const saveTables = options.saveTables === true;
    let fullTextContent = selectedText;
    if (saveImages) {
        fullTextContent = fullTextContent.replace(/\[image\d{2}\]/g, '');
    }
    if (saveTables) {
        fullTextContent = fullTextContent.replace(/\[table\d{2}\]/g, '');
    }
    let storedLinks = [];
    let processedTables = [];
    let extractedImages = [];

    let range = options.capturedRange || null;
    if (!range) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            range = selection.getRangeAt(0);
        }
    }

    if (range) {
        const allowedImageSrcs = saveImages ? buildAllowedImageSrcSetFromRange(range) : null;
        const rich = getSelectionContentFromRange(range, {
            saveImages: saveImages,
            saveTables: saveTables,
            allowedImageSrcs: allowedImageSrcs
        });
        fullTextContent = rich.text;
        storedLinks = rich.links || [];
        if (saveTables) {
            processedTables = extractTablesGeometricallyInRange(range);
        }
        if (saveImages) {
            extractedImages = collectImagesGeometricallyInRange(range, fullTextContent);
        }
    } else {
        const fallback = extractTextAndLinksFromSelection(fullTextContent, null);
        fullTextContent = fallback.text;
        storedLinks = fallback.links || [];
    }

    return { text: fullTextContent, links: storedLinks, tables: processedTables, images: extractedImages };
}

/** 暂存前统一处理文本、图片与表格（严格只保留选区高亮内的内容） */
async function prepareContentForStorage(selectedText, selectedImages, storageSettings, capturedRange) {
    const saveImages = storageSettings.saveImages === 'yes';
    const saveTables = storageSettings.saveTables === 'yes';

    const extracted = extractRichContentFromSelection(selectedText, {
        saveImages: saveImages,
        saveTables: saveTables,
        capturedRange: capturedRange || null
    });

    let textWithPlaceholders = extracted.text;
    let storedLinks = extracted.links || [];
    let processedTables = extracted.tables || [];
    let processedImages = [];

    if (saveTables && processedTables.length > 0) {
        const tablePlaceholderCount = (textWithPlaceholders.match(/\[table\d{2}\]/g) || []).length;
        if (tablePlaceholderCount !== processedTables.length) {
            if (tablePlaceholderCount > processedTables.length) {
                textWithPlaceholders = normalizeTablePlaceholders(textWithPlaceholders, processedTables.length);
            } else {
                processedTables = processedTables.slice(0, tablePlaceholderCount);
            }
        }
        processedTables = processedTables.map(function (tableEntry, index) {
            return Object.assign({}, tableEntry, {
                tableIndex: index,
                placeholder: '[table' + String(index).padStart(2, '0') + ']'
            });
        });
    }

    const candidateImages = deduplicateImagesBySrc(
        (extracted.images && extracted.images.length > 0) ? extracted.images : selectedImages
    );
    const imagePlaceholderCount = (textWithPlaceholders.match(/\[image\d{2}\]/g) || []).length;

    if (saveImages && imagePlaceholderCount > 0 && candidateImages.length > 0) {
        showNotification(t('processingContent'), { replaceKey: 'store-progress' });

        const sortedImages = [...candidateImages].sort(function (a, b) {
            if (a.position && b.position) {
                return a.position.startOffset - b.position.startOffset;
            }
            return 0;
        });
        const imagesToProcess = sortedImages.slice(0, imagePlaceholderCount);

        for (let i = 0; i < imagesToProcess.length; i++) {
            const img = imagesToProcess[i];
            const placeholder = '[image' + String(i).padStart(2, '0') + ']';
            try {
                const processedImage = await Utility.imageToBase64(
                    img.src,
                    storageSettings.imageQuality,
                    storageSettings.imageMaxWidth,
                    storageSettings.imageMaxHeight,
                    storageSettings.imageFormat,
                    { referer: window.location.href }
                );
                processedImages.push(Object.assign({}, processedImage, {
                    alt: img.alt,
                    originalWidth: img.width,
                    originalHeight: img.height,
                    placeholder: placeholder,
                    imageIndex: i,
                    uniqueId: Utility.generateUniqueId()
                }));
            } catch (error) {
                console.warn('Failed to process image:', img.src, error);
                processedImages.push({
                    data: '',
                    alt: img.alt || '图片加载失败',
                    originalWidth: img.width || 100,
                    originalHeight: img.height || 100,
                    placeholder: placeholder,
                    imageIndex: i,
                    uniqueId: Utility.generateUniqueId()
                });
            }
        }

        if (processedImages.length < imagePlaceholderCount) {
            textWithPlaceholders = normalizeImagePlaceholders(textWithPlaceholders, processedImages.length);
        }
    }

    if (!selectionHasMeaningfulText(textWithPlaceholders) && selectionHasMeaningfulText(selectedText)) {
        textWithPlaceholders = selectedText;
    }

    const excludeSettings = await loadExportTextExcludeSettings();
    const prepared = {
        text: textWithPlaceholders,
        images: processedImages,
        tables: processedTables,
        links: storedLinks
    };
    if (window.DocExportTextFilter) {
        return window.DocExportTextFilter.filterFormattedArticle(prepared, excludeSettings);
    }
    return prepared;
}

function loadExportTextExcludeSettings() {
    return new Promise(function (resolve) {
        safeStorageGet(['exportTextExcludeEnabled', 'exportTextExcludeCustom'], function (result) {
            resolve({
                exportTextExcludeEnabled: result.exportTextExcludeEnabled !== 'no' ? 'yes' : 'no',
                exportTextExcludeCustom: result.exportTextExcludeCustom || ''
            });
        });
    });
}

async function loadStorageSettings() {
    const defaults = {
        saveTables: 'yes',
        saveImages: 'yes',
        imageQuality: 0.8,
        imageMaxWidth: 600,
        imageMaxHeight: 800,
        imageFormat: 'jpeg'
    };
    try {
        const settings = await new Promise(function (resolve) {
            safeStorageGet(['saveTables', 'saveImages', 'imageQuality', 'imageMaxWidth', 'imageMaxHeight', 'imageFormat'], resolve);
        });
        return {
            saveTables: settings.saveTables || defaults.saveTables,
            saveImages: settings.saveImages || defaults.saveImages,
            imageQuality: settings.imageQuality === 'high' ? 1.0 : settings.imageQuality === 'low' ? 0.6 : 0.8,
            imageMaxWidth: settings.imageMaxWidth || defaults.imageMaxWidth,
            imageMaxHeight: settings.imageMaxHeight || defaults.imageMaxHeight,
            imageFormat: settings.imageFormat || defaults.imageFormat
        };
    } catch (error) {
        console.warn('Failed to load storage settings:', error);
        return defaults;
    }
}

/**
 * 判断元素是否为块级元素
 * @param {Element} element - 要检查的元素
 * @returns {boolean} 是否为块级元素
 */
function isBlockElement(element) {
    const blockTags = [
        'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV',
        'MAIN', 'ASIDE', 'BLOCKQUOTE', 'PRE', 'TABLE',
        'UL', 'OL', 'LI', 'FORM', 'FIELDSET'
    ];
    
    return blockTags.includes(element.tagName) || 
           getComputedStyle(element).display === 'block';
}

/**
 * 智能更新图片占位符
 * @param {string} text - 包含占位符的文本
 * @param {Array} originalImages - 原始图片数组
 * @param {Array} currentImages - 当前图片数组
 * @returns {string} 更新后的文本
 */
function updateImagePlaceholders(text, originalImages, currentImages) {
    // 如果没有图片，移除所有占位符
    if (currentImages.length === 0) {
        return text.replace(/\[image\d{2}\]/g, '');
    }
    
    // 如果图片数量相同，只需要重新排序占位符
    if (originalImages.length === currentImages.length) {
        // 创建占位符映射
        const placeholderMap = new Map();
        originalImages.forEach((img, index) => {
            const oldPlaceholder = `[image${String(index).padStart(2, '0')}]`;
            // 优先使用唯一标识符匹配，如果没有则使用数据和alt匹配
            const newIndex = currentImages.findIndex(currentImg => 
                (currentImg.uniqueId && img.uniqueId && currentImg.uniqueId === img.uniqueId) ||
                (currentImg.data === img.data && currentImg.alt === img.alt)
            );
            if (newIndex !== -1) {
                const newPlaceholder = `[image${String(newIndex).padStart(2, '0')}]`;
                placeholderMap.set(oldPlaceholder, newPlaceholder);
            }
        });
        
        // 替换占位符
        let updatedText = text;
        placeholderMap.forEach((newPlaceholder, oldPlaceholder) => {
            updatedText = updatedText.replace(new RegExp(oldPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPlaceholder);
        });
        
        return updatedText;
    }
    
    // 图片数量不同，需要删除对应的占位符并重新排序
    const deletedImageIndices = [];
    const remainingImages = [];
    
    // 找出被删除的图片索引
    originalImages.forEach((originalImg, originalIndex) => {
        // 优先使用唯一标识符匹配，如果没有则使用数据和alt匹配
        const stillExists = currentImages.some(currentImg => 
            (currentImg.uniqueId && originalImg.uniqueId && currentImg.uniqueId === originalImg.uniqueId) ||
            (currentImg.data === originalImg.data && currentImg.alt === originalImg.alt)
        );
        if (!stillExists) {
            deletedImageIndices.push(originalIndex);
        } else {
            remainingImages.push(originalImg);
        }
    });
    
    // 移除被删除图片的占位符
    let updatedText = text;
    deletedImageIndices.forEach(deletedIndex => {
        const placeholderToRemove = `[image${String(deletedIndex).padStart(2, '0')}]`;
        updatedText = updatedText.replace(new RegExp(placeholderToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    });
    
    // 重新排序剩余占位符
    remainingImages.forEach((remainingImg, newIndex) => {
        // 优先使用唯一标识符匹配，如果没有则使用数据和alt匹配
        const oldIndex = originalImages.findIndex(originalImg => 
            (originalImg.uniqueId && remainingImg.uniqueId && originalImg.uniqueId === remainingImg.uniqueId) ||
            (originalImg.data === remainingImg.data && originalImg.alt === remainingImg.alt)
        );
        if (oldIndex !== -1) {
            const oldPlaceholder = `[image${String(oldIndex).padStart(2, '0')}]`;
            const newPlaceholder = `[image${String(newIndex).padStart(2, '0')}]`;
            updatedText = updatedText.replace(new RegExp(oldPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPlaceholder);
        }
    });
    
    return updatedText;
}

/**
 * 初始化拖拽排序功能
 * 使用原生JavaScript实现拖拽排序
 */
function initializeDragAndDrop() {
    
    // 获取所有文章容器
    const articleContainers = contentPanel.querySelectorAll('div[data-index]');
    console.log(`找到 ${articleContainers.length} 个文章容器`);
    
    if (articleContainers.length === 0) {
        return;
    }
    
    let draggedElement = null;
    let draggedIndex = -1;
    let isDragging = false;
    let placeholder = null;
    
    // 为每个拖拽手柄添加事件监听
    articleContainers.forEach((container) => {
        const dragHandle = container.querySelector('.drag-handle');
        if (!dragHandle) {
            return;
        }
        
        // 鼠标按下事件
        dragHandle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            if (isDragging) {
                return;
            }
            
            isDragging = true;
            draggedElement = container;
            draggedIndex = parseInt(container.getAttribute('data-index'));
            
            // 创建占位符
            placeholder = createPlaceholder(container);
            
            // 设置拖拽元素的样式
            container.style.opacity = '0.5';
            container.style.transform = 'rotate(2deg) scale(0.98)';
            container.style.zIndex = '1000';
            container.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
            
            // 隐藏按钮
            const buttonContainer = container.querySelector('div[style*="position: absolute"]');
            const deleteButton = container.querySelector('button');
            
            if (buttonContainer) buttonContainer.style.opacity = '0';
            if (deleteButton) deleteButton.style.opacity = '0';
            
            // 插入占位符到原位置，并从 DOM 移除被拖拽项（避免索引计算重复计数）
            container.parentNode.insertBefore(placeholder, container);
            container.remove();
            
            // 添加全局事件监听
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    });
    
    // 创建占位符函数
    function createPlaceholder(originalElement) {
        const placeholder = document.createElement('div');
        placeholder.className = 'drag-placeholder';
        
        // 复制原始元素的基本样式
        const rect = originalElement.getBoundingClientRect();
        placeholder.style.width = rect.width + 'px';
        placeholder.style.height = rect.height + 'px';
        placeholder.style.marginBottom = '10px';
        placeholder.style.backgroundColor = 'rgba(248, 249, 250, 0.9)';
        placeholder.style.border = '3px dashed #007AFF';
        placeholder.style.borderRadius = '12px';
        placeholder.style.opacity = '0.9';
        placeholder.style.pointerEvents = 'none';
        placeholder.style.position = 'relative';
        placeholder.style.boxSizing = 'border-box';
        placeholder.style.transition = 'all 0.3s ease';
        placeholder.style.boxShadow = '0 4px 12px rgba(0, 122, 255, 0.2)';
        placeholder.style.backdropFilter = 'blur(2px)';
        
        // 添加占位符内容（flex居中）
        const placeholderContent = document.createElement('div');
        placeholderContent.style.display = 'flex';
        placeholderContent.style.flexDirection = 'column';
        placeholderContent.style.alignItems = 'center';
        placeholderContent.style.justifyContent = 'center';
        placeholderContent.style.height = '100%';
        placeholderContent.style.width = '100%';
        placeholderContent.style.color = '#007AFF';
        placeholderContent.style.fontSize = '14px';
        placeholderContent.style.fontWeight = '600';
        placeholderContent.style.textAlign = 'center';
        placeholderContent.style.padding = '20px';
        placeholderContent.style.boxSizing = 'border-box';
        placeholderContent.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-size:32px;line-height:1;margin-bottom:8px;">📄</div>
                <div style="font-size:15px;">拖拽到此位置</div>
            </div>
        `;
        placeholder.appendChild(placeholderContent);
        
        return placeholder;
    }
    
    // 鼠标移动事件处理
    function handleMouseMove(e) {
        if (!isDragging || !draggedElement || !placeholder) return;
        
        e.preventDefault();
        
        const containers = Array.from(contentPanel.querySelectorAll('div[data-index]'));
        
        // 移除所有高亮
        containers.forEach(container => {
            container.style.borderTop = 'none';
            container.style.borderBottom = 'none';
        });
        
        if (containers.length === 0) return;
        
        const mouseY = e.clientY;
        const firstRect = containers[0].getBoundingClientRect();
        const lastRect = containers[containers.length - 1].getBoundingClientRect();
        
        // 鼠标在列表顶部之上：插入到首位
        if (mouseY < firstRect.top) {
            containers[0].style.borderTop = '2px solid #007AFF';
            placeholder.parentNode.insertBefore(placeholder, containers[0]);
            return;
        }
        
        // 鼠标在列表底部之下：插入到末位
        if (mouseY > lastRect.bottom) {
            containers[containers.length - 1].style.borderBottom = '2px solid #007AFF';
            placeholder.parentNode.insertBefore(placeholder, containers[containers.length - 1].nextSibling);
            return;
        }
        
        // 根据鼠标 Y 坐标找到最近的插入位置
        for (const targetContainer of containers) {
            const targetRect = targetContainer.getBoundingClientRect();
            const targetMiddle = targetRect.top + targetRect.height / 2;
            
            if (mouseY >= targetRect.top && mouseY <= targetRect.bottom) {
                if (mouseY < targetMiddle) {
                    targetContainer.style.borderTop = '2px solid #007AFF';
                    placeholder.parentNode.insertBefore(placeholder, targetContainer);
                } else {
                    targetContainer.style.borderBottom = '2px solid #007AFF';
                    placeholder.parentNode.insertBefore(placeholder, targetContainer.nextSibling);
                }
                return;
            }
        }
    }
    
    // 鼠标释放事件处理
    function handleMouseUp(e) {
        if (!isDragging || !draggedElement) return;
        
        e.preventDefault();
        
        // 保存必要的变量值，避免被清理
        const originalDraggedIndex = draggedIndex;
        const originalDraggedElement = draggedElement;
        
        // 获取新的位置
        const newIndex = getNewIndex();
        
        const shouldReorder = newIndex !== -1 && newIndex !== originalDraggedIndex;
        
        if (!shouldReorder) {
            // 未发生排序：将被拖拽项恢复到占位符位置
            originalDraggedElement.style.opacity = '1';
            originalDraggedElement.style.transform = 'none';
            originalDraggedElement.style.zIndex = 'auto';
            originalDraggedElement.style.boxShadow = 'none';
            
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.insertBefore(originalDraggedElement, placeholder);
            }
        }
        
        // 移除占位符
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
        
        // 清除所有高亮
        contentPanel.querySelectorAll('div[data-index]').forEach(container => {
            container.style.borderTop = 'none';
            container.style.borderBottom = 'none';
        });
        
        // 清理变量
        draggedElement = null;
        draggedIndex = -1;
        isDragging = false;
        placeholder = null;
        
        // 移除全局事件监听
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        
        // 如果位置发生了变化，执行重排序
        if (shouldReorder) {
            reorderArticles(originalDraggedIndex, newIndex);
        }
    }
    
    // 获取新的索引位置（被拖拽项已从 DOM 移除，直接统计占位符前的文章数）
    function getNewIndex() {
        if (!placeholder || !placeholder.parentNode) {
            return -1;
        }
        
        const placeholderParent = placeholder.parentNode;
        const placeholderIndex = Array.from(placeholderParent.children).indexOf(placeholder);
        
        let articleCount = 0;
        for (let i = 0; i < placeholderIndex; i++) {
            if (placeholderParent.children[i].hasAttribute('data-index')) {
                articleCount++;
            }
        }
        
        return articleCount;
    }
    
    // 添加拖拽相关的CSS样式（避免重复注入）
    if (document.getElementById('doc-export-drag-styles')) {
        return;
    }
    const dragStyles = document.createElement('style');
    dragStyles.id = 'doc-export-drag-styles';
    dragStyles.textContent = `
        .drag-handle {
            cursor: grab !important;
        }
        
        .drag-handle:active {
            cursor: grabbing !important;
        }
        
        div[data-index] {
            transition: all 0.2s ease;
        }
        
        div[data-index]:hover {
            transform: translateY(-1px);
        }
        
        .drag-placeholder {
            animation: placeholderPulse 2s ease-in-out infinite;
            position: relative;
            overflow: hidden;
        }
        
        .drag-placeholder::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(0, 122, 255, 0.1), transparent);
            animation: placeholderShine 2s ease-in-out infinite;
        }
        
        @keyframes placeholderPulse {
            0%, 100% {
                opacity: 0.9;
                border-color: #007AFF;
                box-shadow: 0 4px 12px rgba(0, 122, 255, 0.2);
            }
            50% {
                opacity: 1;
                border-color: #0056CC;
                box-shadow: 0 6px 20px rgba(0, 122, 255, 0.4);
                transform: scale(1.02);
            }
        }
        
        @keyframes placeholderShine {
            0% {
                left: -100%;
            }
            50% {
                left: 100%;
            }
            100% {
                left: 100%;
            }
        }
        
        .drag-placeholder:hover {
            animation-play-state: paused;
        }
    `;
    document.head.appendChild(dragStyles);
}

// 按设置将暂存/复制按钮组显示在鼠标指针的左上/左下/右上/右下方位
function applySelectionButtonGroupPosition(buttonGroup, pageX, pageY) {
    const gap = 8;
    const w = buttonGroup.offsetWidth || 120;
    const h = buttonGroup.offsetHeight || 40;
    let left;
    let top;

    const position = pluginSettings.selectionButtonPosition || 'bottomRight';
    switch (position) {
        case 'topLeft':
            left = pageX - w - gap;
            top = pageY - h - gap;
            break;
        case 'bottomLeft':
            left = pageX - w - gap;
            top = pageY + gap;
            break;
        case 'topRight':
            left = pageX + gap;
            top = pageY - h - gap;
            break;
        case 'bottomRight':
        default:
            left = pageX + gap;
            top = pageY + gap;
            break;
    }

    const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const pad = 8;
    left = Math.max(scrollX + pad, Math.min(left, scrollX + vw - w - pad));
    top = Math.max(scrollY + pad, Math.min(top, scrollY + vh - h - pad));

    buttonGroup.style.left = `${left}px`;
    buttonGroup.style.top = `${top}px`;
}

const SELECTION_BUTTON_ICON_MAP = {
    store: 'images/mouse_storage.svg',
    export: 'images/mouse_output.svg',
    copy: 'images/mouse_copy.svg'
};

const SELECTION_TOOLBAR_BLUE = '#2563EB';
const SELECTION_ICON_BLUE_FILTER = 'brightness(0) saturate(100%) invert(32%) sepia(93%) saturate(2000%) hue-rotate(210deg) brightness(98%) contrast(96%)';

const selectionToolbarStyleEl = document.createElement('style');
selectionToolbarStyleEl.textContent = `
    .doc-export-selection-toolbar {
        display: flex !important;
        align-items: center !important;
        gap: 0 !important;
        background-color: #ffffff !important;
        border-radius: 12px !important;
        padding: 8px 12px !important;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1), 0 0 1px rgba(0, 0, 0, 0.06) !important;
        border: none !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        user-select: none !important;
        box-sizing: border-box !important;
        line-height: normal !important;
    }
    .doc-export-selection-toolbar button,
    .doc-export-selection-toolbar .doc-export-selection-toolbar-btn,
    .doc-export-selection-toolbar .copy-button,
    .doc-export-selection-toolbar .temporary-save-button,
    .doc-export-selection-toolbar .selection-export-button {
        all: unset;
        box-sizing: border-box !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 4px !important;
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        padding: 6px 12px !important;
        margin: 0 !important;
        cursor: pointer !important;
        border-radius: 4px !important;
        font-family: inherit !important;
        min-width: 0 !important;
        max-width: none !important;
        width: auto !important;
        height: auto !important;
        outline: none !important;
        box-shadow: none !important;
        appearance: none !important;
        -webkit-appearance: none !important;
    }
    .doc-export-selection-toolbar button img,
    .doc-export-selection-toolbar .doc-export-selection-toolbar-btn img {
        width: 16px !important;
        height: 16px !important;
        max-width: 16px !important;
        max-height: 16px !important;
        flex-shrink: 0 !important;
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        transition: filter 0.15s ease !important;
    }
    .doc-export-selection-toolbar button span,
    .doc-export-selection-toolbar .doc-export-selection-toolbar-btn span {
        color: #333333 !important;
        font-size: 14px !important;
        font-weight: 400 !important;
        line-height: 1 !important;
        white-space: nowrap !important;
        transition: color 0.15s ease !important;
    }
    .doc-export-selection-toolbar button:hover img,
    .doc-export-selection-toolbar .doc-export-selection-toolbar-btn:hover img {
        filter: ${SELECTION_ICON_BLUE_FILTER} !important;
    }
    .doc-export-selection-toolbar button:hover span,
    .doc-export-selection-toolbar .doc-export-selection-toolbar-btn:hover span {
        color: ${SELECTION_TOOLBAR_BLUE} !important;
    }
`;
document.head.appendChild(selectionToolbarStyleEl);

// 创建现代化按钮组容器
function createModernButtonGroup(x, y) {
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'doc-export-selection-toolbar';
    buttonGroup.style.position = 'absolute';
    buttonGroup.style.zIndex = '1000';

    return buttonGroup;
}

// 创建现代化按钮
function createModernButton(text, type, container) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'doc-export-selection-toolbar-btn';
    button.dataset.actionType = type;

    const icon = document.createElement('img');
    icon.src = safeGetURL(SELECTION_BUTTON_ICON_MAP[type] || SELECTION_BUTTON_ICON_MAP.copy);
    icon.alt = '';
    icon.draggable = false;

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    button.appendChild(icon);
    button.appendChild(textSpan);

    container.appendChild(button);
    return button;
}

// 创建按钮的辅助函数（保留原有函数以兼容其他用途）
function createButton(text, bgColor, hoverColor, left, top) {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.position = 'absolute';
    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
    button.style.zIndex = 1000;
    button.style.backgroundColor = bgColor;
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.padding = '8px 16px';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.fontSize = '14px';
    button.style.fontWeight = '500';
    button.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
    button.style.transition = 'all 0.2s ease';
    
    // 添加悬停效果
    button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = hoverColor;
        button.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.25)';
    });
    button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = bgColor;
        button.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
    });
    
    return button;
}

// 处理暂存按钮点击
async function handleStoreClick(selectedText, selectedImages, buttons, capturedRange, flyFrom) {
    if (storeOperationInProgress) return;
    storeOperationInProgress = true;
    if (autoStoreTimeout) {
        clearTimeout(autoStoreTimeout);
        autoStoreTimeout = null;
    }

    isButtonVisible = false;

    if (flyFrom && typeof flyFrom.x === 'number' && typeof flyFrom.y === 'number') {
        playDockFileFlyAnimation(flyFrom.x, flyFrom.y);
    }
    
    // 处理选中的文本，确保至少有一行作为标题
    if (!selectedText.includes('\n')) {
        selectedText = selectedText + '\n';
    }

    let storageSettings;
    let prepared;
    try {
        storageSettings = await loadStorageSettings();
        prepared = await prepareContentForStorage(selectedText, selectedImages, storageSettings, capturedRange);
    } catch (err) {
        storeOperationInProgress = false;
        showNotification(t('storeFailed'));
        console.error('暂存失败:', err);
        buttons.forEach(function (button) {
            if (button.parentElement) button.remove();
        });
        return;
    }
    
    // 创建保存对象
    const saveObject = {
        text: prepared.text,
        images: prepared.images,
        tables: prepared.tables,
        timestamp: Date.now()
    };
    if (prepared.links.length > 0) {
        saveObject.links = prepared.links;
    }
    
    // 发送到background.js
    chrome.runtime.sendMessage({ 
        action: 'saveText', 
        data: saveObject 
    }, function(response) {
        storeOperationInProgress = false;
        if (chrome.runtime.lastError) {
            showNotification(t('storeCommError'), { replaceKey: 'store-progress' });
            console.warn('saveText message:', chrome.runtime.lastError.message);
            return;
        }
        if (response && response.success) {
            const imageCount = prepared.images.length;
            const tableCount = prepared.tables.length;
            if (imageCount > 0 || tableCount > 0) {
                const parts = [];
                if (tableCount > 0) parts.push(t('partTableCount', { count: tableCount }));
                if (imageCount > 0) parts.push(t('partImageCount', { count: imageCount }));
                showNotification(t('contentStoredWith', { parts: parts.join(i18n.getLang() === 'zh' ? '、' : ', ') }), { replaceKey: 'store-progress' });
            } else {
                showNotification(t('contentStored'), { replaceKey: 'store-progress' });
            }
            lastStoredText = selectedText;
        } else {
            const err = (response && response.error) || '';
            if (/quota/i.test(err)) {
                showNotification(t('storeFull'), { replaceKey: 'store-progress' });
            } else {
                showNotification(t('storeFailed'), { replaceKey: 'store-progress' });
            }
            console.error("暂存失败:", err || "未知错误");
        }
    });
    
    // 清理UI元素
    buttons.forEach(button => {
        if (button.parentElement) button.remove();
    });
}

// 处理复制按钮点击
function handleCopyClick(selectedText, buttons) {
    isButtonVisible = false;
    
    const tempInput = document.createElement('textarea');
    tempInput.value = selectedText;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showNotification(t('copiedToClipboard'));
    
    // 清理UI元素
    buttons.forEach(button => {
        if (button.parentElement) button.remove();
    });
}

// 处理选区导出按钮点击：直接导出为 Word，格式与设置一致
async function handleExportClick(selectedText, selectedImages, buttons, capturedRange) {
    isButtonVisible = false;

    if (!selectionHasMeaningfulText(selectedText) || !selectedText.trim()) {
        showNotification(t('nothingToExport'));
        buttons.forEach(function (button) {
            if (button.parentElement) button.remove();
        });
        return;
    }

    if (!selectedText.includes('\n')) {
        selectedText = selectedText + '\n';
    }

    const storageSettings = await loadStorageSettings();
    const prepared = await prepareContentForStorage(selectedText, selectedImages, storageSettings, capturedRange);

    const exportItem = {
        text: prepared.text,
        images: prepared.images,
        tables: prepared.tables,
        timestamp: Date.now()
    };
    if (prepared.links.length > 0) {
        exportItem.links = prepared.links;
    }

    runMergedWordExport([exportItem]);

    buttons.forEach(function (button) {
        if (button.parentElement) button.remove();
    });
}

// 自动暂存文本
async function autoStoreText(selectedText, selectedImages, capturedRange) {
    if (storeOperationInProgress) return;
    if (!selectedText || selectedText === lastStoredText) {
        return;
    }
    storeOperationInProgress = true;
    
    // 处理选中的文本
    if (!selectedText.includes('\n')) {
        selectedText = selectedText + '\n';
    }

    let storageSettings;
    let prepared;
    try {
        storageSettings = await loadStorageSettings();
        prepared = await prepareContentForStorage(selectedText, selectedImages, storageSettings, capturedRange);
    } catch (err) {
        storeOperationInProgress = false;
        console.error('自动暂存失败:', err);
        return;
    }
    
    // 创建保存对象
    const saveObject = {
        text: prepared.text,
        images: prepared.images,
        tables: prepared.tables,
        timestamp: Date.now()
    };
    if (prepared.links.length > 0) {
        saveObject.links = prepared.links;
    }
    
    // 检查是否启用自动导出功能，如果启用则提前设置检测标志位
    if (pluginSettings.autoExportEnabled) {
        console.log('自动导出功能已启用，提前设置检测标志位');
        console.log('当前基线长度:', baselineStorageLength);
        // 提前设置检测标志位，防止基线长度在发送消息时被更新
        window.isAutoExportDetecting = true;
    }
    
    // 发送到background.js
    chrome.runtime.sendMessage({ 
        action: 'saveText', 
        data: saveObject 
    }, function(response) {
        storeOperationInProgress = false;
        if (chrome.runtime.lastError) {
            if (pluginSettings.autoExportEnabled) {
                window.isAutoExportDetecting = false;
            }
            console.warn('saveText message:', chrome.runtime.lastError.message);
            return;
        }
        if (response && response.success) {
            const imageCount = prepared.images.length;
            const tableCount = prepared.tables.length;
            if (imageCount > 0 || tableCount > 0) {
                const parts = [];
                if (tableCount > 0) parts.push(t('partTableCount', { count: tableCount }));
                if (imageCount > 0) parts.push(t('partImageCount', { count: imageCount }));
                showNotification(t('autoStoredWith', { parts: parts.join(i18n.getLang() === 'zh' ? '、' : ', ') }), { replaceKey: 'store-progress' });
            } else {
                showNotification(t('autoStored'), { replaceKey: 'store-progress' });
            }
            lastStoredText = selectedText;
            
            // 更新暂存历史（与保存对象使用相同时间戳，便于撤销定位）
            storedItemsHistory.unshift({
                text: selectedText.length > 4000 ? selectedText.slice(0, 4000) + '\n…' : selectedText,
                timestamp: saveObject.timestamp,
                type: 'auto'
            });
            
            // 限制历史记录数量（默认最多100个）
            if (storedItemsHistory.length > 100) {
                storedItemsHistory = storedItemsHistory.slice(0, 100);
            }
            
            // 保存历史记录
            safeStorageSet({ storedItemsHistory: storedItemsHistory });
            
            // 检查是否启用自动导出功能
            if (pluginSettings.autoExportEnabled) {
                console.log('开始状态检测，基线长度已锁定:', baselineStorageLength);
                // 使用全局基线长度进行状态检测
                autoExportOnStorageUpdate(saveObject);
            } else {
                console.log('自动导出功能未启用，pluginSettings.autoExportEnabled:', pluginSettings.autoExportEnabled);
            }
        } else {
            // 如果保存失败，清除检测标志位
            if (pluginSettings.autoExportEnabled) {
                window.isAutoExportDetecting = false;
            }
            const err = (response && response.error) || '';
            if (/quota/i.test(err)) {
                showNotification(t('autoStoreFull'));
            }
            console.error("自动暂存失败:", err || "未知错误");
        }
    });
}

// 通过状态检测触发自动导出（按新增序号/数量判断）
function autoExportOnStorageUpdate(saveObject) {
    let checkCount = 0;
    const maxChecks = 20; // 最多检查20次（20 * 500ms = 10秒）
    const checkInterval = 500; // 每500ms检查一次

    console.log('开始自动导出状态检测，初始saveObject:', saveObject, '基线长度:', baselineStorageLength);
    
    // 检测标志位已在autoStoreText中设置，这里不需要重复设置

    const checkAndExport = () => {
        checkCount++;

        chrome.storage.local.get(['temporaryStorage'], function(result) {
            if (chrome.runtime.lastError) {
                console.warn('storage get:', chrome.runtime.lastError.message);
                window.isAutoExportDetecting = false;
                return;
            }
            const temporaryStorage = result.temporaryStorage || [];

            console.log(`第${checkCount}次检查 - 基线长度:${baselineStorageLength}, 当前长度:${temporaryStorage.length}`);

            if (temporaryStorage.length > baselineStorageLength) {
                // 有新增内容，取最后一项作为新内容导出
                const newItem = temporaryStorage[temporaryStorage.length - 1];
                console.log('检测到新增暂存内容，开始自动导出', newItem);
                
                // 检测完成，清除标志位并更新基线长度
                window.isAutoExportDetecting = false;
                baselineStorageLength = temporaryStorage.length;
                console.log('检测完成，更新基线长度:', baselineStorageLength);
                
                autoExportSingleArticle(newItem || saveObject);
            } else if (checkCount < maxChecks) {
                console.log(`第${checkCount}次检查未发现新增内容，继续检测...`);
                setTimeout(checkAndExport, checkInterval);
            } else {
                // 检测超时，清除标志位
                window.isAutoExportDetecting = false;
                console.warn('自动导出超时：未检测到新增暂存内容');
                showNotification(t('autoExportNoContent'));
            }
        });
    };

    // 开始检查
    setTimeout(checkAndExport, checkInterval);
}

// 自动导出单篇文章
function autoExportSingleArticle(saveObject) {
    console.log('开始自动导出单篇文章:', saveObject);
    
    // 直接调用exportSingleArticle函数，模拟点击"导出此文章"按钮
    // 注意：这里传递index为-1，因为这是新添加的文章，在temporaryStorage中的索引
    exportSingleArticle(saveObject, -1);
    
    // 显示自动导出提示
    showNotification(t('autoExporting'));
}

// 添加键盘快捷键支持
document.addEventListener('keydown', function(event) {
    if (!isExtensionActiveOnPage()) return;

    // 检查是否按下了暂存快捷键
    if (isHotkeyPressed(event, pluginSettings.storeHotkey)) {
        event.preventDefault();
        const selection = window.getSelection();
        let selectedText = '';
        let capturedRange = null;
        if (selection.rangeCount > 0) {
            try {
                capturedRange = selection.getRangeAt(0).cloneRange();
                selectedText = getSelectionContentFromRange(capturedRange, {
                    saveImages: false,
                    saveTables: false
                }).text.trim();
            } catch (e) {
                capturedRange = null;
                selectedText = selection.toString().trim();
            }
        } else {
            selectedText = selection.toString().trim();
        }
        if (selectedText) {
            autoStoreText(selectedText, [], capturedRange);
        }
    }
    
    // 检查是否按下了撤销暂存快捷键
    if (isHotkeyPressed(event, pluginSettings.undoStoreHotkey)) {
        event.preventDefault();
        undoLastStore();
    }
    
    // 检查是否按下了导出快捷键
    if (isHotkeyPressed(event, pluginSettings.exportHotkey)) {
        event.preventDefault();
        exportAllStoredContent();
    }
});

// 检查快捷键是否被按下
function isHotkeyPressed(event, hotkey) {
    if (!hotkey) return false;
    
    const keys = hotkey.split('+');
    const pressedKeys = [];
    
    if (event.ctrlKey) pressedKeys.push('Ctrl');
    if (event.shiftKey) pressedKeys.push('Shift');
    if (event.altKey) pressedKeys.push('Alt');
    if (event.metaKey) pressedKeys.push('Meta');
    
    const key = event.key.toUpperCase();
    if (key !== 'Control' && key !== 'Shift' && key !== 'Alt' && key !== 'Meta') {
        pressedKeys.push(key);
    }
    
    return keys.length === pressedKeys.length && 
           keys.every(key => pressedKeys.includes(key));
}

// 检查快捷键冲突
function checkHotkeyConflict(hotkey) {
    if (!hotkey) return null;
    
    const conflicts = [];
    
    // 检查系统快捷键冲突
    const systemHotkeys = [
        'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+F',
        'Ctrl+P', 'Ctrl+S', 'Ctrl+O', 'Ctrl+N', 'Ctrl+W', 'Ctrl+T', 'Ctrl+R',
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
        'Ctrl+F1', 'Ctrl+F2', 'Ctrl+F3', 'Ctrl+F4', 'Ctrl+F5', 'Ctrl+F6',
        'Ctrl+F7', 'Ctrl+F8', 'Ctrl+F9', 'Ctrl+F10', 'Ctrl+F11', 'Ctrl+F12',
        'Alt+F4', 'Alt+Tab', 'Alt+Esc', 'Alt+Enter', 'Alt+Space',
        'Shift+F10', 'Shift+Delete', 'Shift+Insert',
        'Ctrl+Shift+Esc', 'Ctrl+Alt+Delete', 'Ctrl+Shift+I', 'Ctrl+Shift+J',
        'Ctrl+Shift+C', 'Ctrl+Shift+V', 'Ctrl+Shift+X', 'Ctrl+Shift+Z'
    ];
    
    if (systemHotkeys.includes(hotkey)) {
        conflicts.push(`系统快捷键: ${hotkey}`);
    }
    
    // 检查浏览器快捷键冲突
    const browserHotkeys = [
        'Ctrl+L', 'Ctrl+Shift+L', 'Ctrl+Shift+O', 'Ctrl+Shift+T',
        'Ctrl+Shift+N', 'Ctrl+Shift+W', 'Ctrl+Shift+Q', 'Ctrl+Shift+J',
        'Ctrl+Shift+Delete', 'Ctrl+Shift+B', 'Ctrl+Shift+M',
        'Alt+D', 'Alt+Home', 'Alt+Left', 'Alt+Right', 'Alt+Up', 'Alt+Down',
        'F5', 'Ctrl+F5', 'Shift+F5', 'Ctrl+R', 'Ctrl+Shift+R',
        'Ctrl+U', 'Ctrl+Shift+U', 'Ctrl+Shift+I', 'Ctrl+Shift+J',
        'Ctrl+Shift+C', 'Ctrl+Shift+V', 'Ctrl+Shift+X', 'Ctrl+Shift+Z'
    ];
    
    if (browserHotkeys.includes(hotkey)) {
        conflicts.push(`浏览器快捷键: ${hotkey}`);
    }
    
    // 检查插件内部快捷键冲突
    const pluginHotkeys = [
        pluginSettings.storeHotkey,
        pluginSettings.undoStoreHotkey
    ].filter(h => h && h !== hotkey);
    
    if (pluginHotkeys.includes(hotkey)) {
        conflicts.push(`插件快捷键冲突: ${hotkey}`);
    }
    
    return conflicts.length > 0 ? conflicts : null;
}

// 撤销最后一次暂存
function undoLastStore() {
    if (storedItemsHistory.length === 0) {
        showNotification(t('noUndoContent'));
        return;
    }

    // 获取最近一条历史记录（按时间顺序，unshift插入，因此最近的一条在数组开头）
    const lastItem = storedItemsHistory.shift();

    chrome.storage.local.set({ storedItemsHistory: storedItemsHistory });
    showNotification(t('undoStored', { preview: lastItem.text.substring(0, 50) }));

    // 根据唯一时间戳删除 temporaryStorage 中对应项，避免与排序视图不一致
    chrome.storage.local.get(['temporaryStorage'], function(result) {
        const temporaryStorage = result.temporaryStorage || [];
        const index = temporaryStorage.findIndex(item => item.timestamp === lastItem.timestamp);
        if (index !== -1) {
            temporaryStorage.splice(index, 1);
            chrome.storage.local.set({ temporaryStorage: temporaryStorage }, () => {
                // 刷新列表以反映变动
                refreshArticleList();
                // 通知其他标签页更新
                chrome.runtime.sendMessage({ 
                    action: 'updateArticleList',
                    data: { removed: true }
                });
            });
        } else {
            // 如果未找到精确匹配，则回退到删除最后一个元素（保持兼容）
            if (temporaryStorage.length > 0) {
                temporaryStorage.pop();
                chrome.storage.local.set({ temporaryStorage: temporaryStorage }, () => {
                    refreshArticleList();
                    chrome.runtime.sendMessage({ action: 'updateArticleList', data: { removed: true } });
                });
            }
        }
    });
}

// 切换自动导出功能
function toggleAutoExport() {
    pluginSettings.autoExportEnabled = !pluginSettings.autoExportEnabled;
    
    // 保存设置到存储
    chrome.storage.local.set({ autoExportEnabled: pluginSettings.autoExportEnabled }, () => {
        showNotification(pluginSettings.autoExportEnabled ? t('autoExportOn') : t('autoExportOff'));
        updateOutputButtonStyle();
    });
}

// 删除content文章列表中的上一次暂存内容
function removeLastStoredArticle() {
    // 获取当前的暂存内容
    chrome.storage.local.get(['temporaryStorage'], function(result) {
        const temporaryStorage = result.temporaryStorage || [];
        
        if (temporaryStorage.length > 0) {
            // 删除最后一个暂存项目
            temporaryStorage.pop();
            
            // 保存更新后的暂存内容
            chrome.storage.local.set({ temporaryStorage: temporaryStorage }, () => {
                console.log("已从暂存列表中删除最后一个项目");
                
                // 直接刷新文章列表，确保立即更新
                refreshArticleList();
                
                // 通知其他标签页更新文章列表
                chrome.runtime.sendMessage({ 
                    action: 'updateArticleList',
                    data: { removed: true }
                });
            });
        }
    });
}

// 暂存列表面板已打开时，重新渲染列表并保持面板可见
function refreshStoredContentPanel() {
    if (!isPanelVisible || !isViewingStoredContent || !contentPanel) return;
    if (isRefreshingStoredPanel) return;

    isRefreshingStoredPanel = true;
    suppressOutsideClickClose = true;
    isButtonClickInProgress = true;
    setTimeout(function () {
        suppressOutsideClickClose = false;
        isButtonClickInProgress = false;
        isRefreshingStoredPanel = false;
    }, 500);

    // 重置标志位后触发「打开」分支，避免先关闭面板
    isPanelVisible = false;
    isViewingStoredContent = false;
    toggleButtonContainer.click();
}

// 刷新文章列表
function refreshArticleList() {
    // 重新加载暂存内容并更新显示
    chrome.storage.local.get(['temporaryStorage'], function(result) {
        const temporaryStorage = result.temporaryStorage || [];
        
        // 如果文章列表面板是可见的，则刷新显示
        if (isPanelVisible && contentPanel) {
            // 清空当前显示
            const contentContainer = contentPanel.querySelector('.content-container');
            if (contentContainer) {
                contentContainer.innerHTML = '';
                
                // 重新显示暂存内容
                if (temporaryStorage.length === 0) {
                    const noContent = document.createElement('div');
                    noContent.style.textAlign = 'center';
                    noContent.style.padding = '20px';
                    noContent.style.color = '#666';
                    noContent.textContent = t('noStoredContent');
                    contentContainer.appendChild(noContent);
                } else {
                    temporaryStorage.forEach((item, index) => {
                        // 创建文章元素
                        const articleDiv = document.createElement('div');
                        articleDiv.style.border = '1px solid #ddd';
                        articleDiv.style.margin = '10px 0';
                        articleDiv.style.padding = '10px';
                        articleDiv.style.borderRadius = '5px';
                        articleDiv.style.backgroundColor = '#f9f9f9';
                        
                        // 显示文本内容（截取前100个字符）
                        const textPreview = item.text.substring(0, 100) + (item.text.length > 100 ? '...' : '');
                        articleDiv.textContent = textPreview;
                        
                        contentContainer.appendChild(articleDiv);
                    });
                }
            }
        }
        
        // 同时更新articles数组（用于list按钮显示）
        articles.length = 0; // 清空数组
        temporaryStorage.forEach(item => {
            articles.push(item);
        });
        
        console.log("文章列表已刷新，当前有", articles.length, "个项目");
    });
}

// 导出所有暂存内容（快捷键；等同于菜单中的「合并导出 Word」）
function exportAllStoredContent() {
    try {
        safeStorageGet(['temporaryStorage'], function(result) {
            if (!result.temporaryStorage || result.temporaryStorage.length === 0) {
                showNotification(t('noContentToExport'));
                return;
            }
            runMergedWordExport(result.temporaryStorage);
        });
    } catch (error) {
        console.warn('Error in exportAllStoredContent:', error);
        showNotification(t('exportFailed'));
    }
}
