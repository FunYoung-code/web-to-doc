document.addEventListener("DOMContentLoaded", function () {
    const i18n = window.DocExportI18n;
    const t = i18n.t.bind(i18n);

    function refreshPageI18n() {
        i18n.applyPageI18n(document);
        i18n.updateLangToggleButton(document.getElementById("langToggle"));
        document.title = t("optionsTitle");
    }

    i18n.loadLang(function () {
        refreshPageI18n();
        i18n.initLangToggle(document.getElementById("langToggle"), refreshPageI18n);
    });

    // 默认设置值
    const defaultValues = {
        autoStoreEnabled: false,
        showStoreButton: true,
        showCopyButton: true,
        showExportButton: true,
        selectionButtonPosition: "topRight",
        storeHotkey: "Ctrl+Shift+S",
        undoStoreHotkey: "Ctrl+Shift+Z",
        autoStoreDelay: 500
    };

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

        // 生成唯一ID
        static generateUniqueId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }

        // 格式化快捷键显示
        static formatHotkey(hotkey) {
            if (!hotkey) return '';
            return hotkey.replace(/([A-Z])/g, '+$1').replace(/^\+/, '');
        }

        // 解析快捷键
        static parseHotkey(hotkey) {
            if (!hotkey) return '';
            return hotkey.replace(/\+/g, '');
        }
    }

    // DOM管理器类
    class DOMManager {
        constructor() {
            this.elements = {
                autoStoreEnabled: document.getElementById("autoStoreEnabled"),
                showStoreButton: document.getElementById("showStoreButton"),
                showCopyButton: document.getElementById("showCopyButton"),
                showExportButton: document.getElementById("showExportButton"),
                selectionButtonPosition: document.getElementById("selectionButtonPosition"),
                storeHotkey: document.getElementById("storeHotkey"),
                undoStoreHotkey: document.getElementById("undoStoreHotkey"),
                autoStoreDelay: document.getElementById("autoStoreDelay"),
                setStoreHotkey: document.getElementById("setStoreHotkey"),
                setUndoStoreHotkey: document.getElementById("setUndoStoreHotkey")
            };
        }

        // 获取元素值
        getValue(elementId) {
            const element = this.elements[elementId];
            if (!element) {
                console.error(`Element with id "${elementId}" not found`);
                return '';
            }
            return element.value;
        }

        // 设置元素值
        setValue(elementId, value) {
            const element = this.elements[elementId];
            if (!element) {
                console.error(`Element with id "${elementId}" not found`);
                return;
            }
            element.value = value;
        }

        // 获取元素
        getElement(elementId) {
            return this.elements[elementId];
        }

        // 显示元素
        show(elementId, condition = true) {
            if (condition) {
                this.elements[elementId].style.display = "block";
            } else {
                this.elements[elementId].style.display = "none";
            }
        }

        // 隐藏元素
        hide(elementId) {
            this.elements[elementId].style.display = "none";
        }

        // 添加事件监听器
        addEventListener(elementId, event, callback) {
            this.elements[elementId].addEventListener(event, callback);
        }

        // 清空输入框
        clearInput(elementId) {
            this.elements[elementId].value = '';
        }

        // 设置文本内容
        setTextContent(elementId, text) {
            this.elements[elementId].textContent = text;
        }

        // 设置禁用状态
        setDisabled(elementId, disabled) {
            this.elements[elementId].disabled = disabled;
        }
    }

    // 创建DOM管理器实例
    const domManager = new DOMManager();

    // 设置管理器类
    class SettingsManager {
        constructor() {
            this.defaultValues = defaultValues;
        }

        // 加载设置
        loadSettings() {
            return new Promise((resolve) => {
                chrome.storage.local.get(Object.keys(this.defaultValues), (result) => {
                    resolve(result);
                });
            });
        }

        // 保存设置
        saveSettings(settings) {
            return new Promise((resolve) => {
                chrome.storage.local.set(settings, () => {
                    resolve();
                });
            });
        }

        // 获取当前设置
        getCurrentSettings() {
            return {
                autoStoreEnabled: domManager.getValue("autoStoreEnabled") === "true",
                showStoreButton: domManager.getValue("showStoreButton") === "true",
                showCopyButton: domManager.getValue("showCopyButton") === "true",
                showExportButton: domManager.getValue("showExportButton") === "true",
                selectionButtonPosition: domManager.getValue("selectionButtonPosition") || this.defaultValues.selectionButtonPosition,
                storeHotkey: domManager.getValue("storeHotkey"),
                undoStoreHotkey: domManager.getValue("undoStoreHotkey"),
                autoStoreDelay: parseInt(domManager.getValue("autoStoreDelay"), 10)
            };
        }

        // 应用设置到页面
        applySettingsToPage(result) {
            // 加载设置到页面元素
            domManager.setValue('autoStoreEnabled', result.autoStoreEnabled !== undefined ? result.autoStoreEnabled.toString() : this.defaultValues.autoStoreEnabled.toString());
            domManager.setValue('showStoreButton', result.showStoreButton !== undefined ? result.showStoreButton.toString() : this.defaultValues.showStoreButton.toString());
            domManager.setValue('showCopyButton', result.showCopyButton !== undefined ? result.showCopyButton.toString() : this.defaultValues.showCopyButton.toString());
            domManager.setValue('showExportButton', result.showExportButton !== undefined ? result.showExportButton.toString() : this.defaultValues.showExportButton.toString());
            domManager.setValue('selectionButtonPosition', result.selectionButtonPosition || this.defaultValues.selectionButtonPosition);
            domManager.setValue('storeHotkey', result.storeHotkey || this.defaultValues.storeHotkey);
            domManager.setValue('undoStoreHotkey', result.undoStoreHotkey || this.defaultValues.undoStoreHotkey);
            domManager.setValue('autoStoreDelay', result.autoStoreDelay || this.defaultValues.autoStoreDelay);
        }
    }

    // 创建设置管理器实例
    const settingsManager = new SettingsManager();

    // 通知管理器类
    class NotificationManager {
        constructor() {
            this.notificationDuration = 1500;
            this.notificationStyle = {
                position: "fixed",
                top: "10px",
                left: "50%",
                transform: "translateX(-50%)",
                backgroundColor: "#4CAF50",
                color: "#fff",
                padding: "10px 20px",
                borderRadius: "5px",
                boxShadow: "0 0 10px rgba(0, 0, 0, 0.1)",
                zIndex: 1000,
                fontSize: "14px"
            };
        }

        // 显示通知
        show(message) {
            const notification = document.createElement("div");
            notification.textContent = message;
            
            // 应用样式
            Object.assign(notification.style, this.notificationStyle);
            
            document.body.appendChild(notification);

            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, this.notificationDuration);
        }

        // 显示成功通知
        showSuccess(message) {
            this.show(message);
        }

        // 显示错误通知
        showError(message) {
            const notification = document.createElement("div");
            notification.textContent = message;
            
            // 应用错误样式
            const errorStyle = {
                ...this.notificationStyle,
                backgroundColor: "#f44336"
            };
            Object.assign(notification.style, errorStyle);
            
            document.body.appendChild(notification);

            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, this.notificationDuration);
        }
    }

    // 创建通知管理器实例
    const notificationManager = new NotificationManager();

    // 验证管理器类
    class ValidationManager {
        constructor() {
            this.validationRules = {
                autoStoreDelay: { min: 0, max: 5000 }
            };
        }

        // 验证数值范围
        validateRange(value, rule) {
            return Utility.isNumberInRange(value, rule.min, rule.max);
        }

        // 验证设置
        validateSettings(settings) {
            const errors = [];

            // 验证自动暂存延迟
            if (!this.validateRange(settings.autoStoreDelay, this.validationRules.autoStoreDelay)) {
                errors.push(t("autoStoreDelayError"));
            }

            // 验证快捷键格式
            if (settings.storeHotkey && !this.validateHotkey(settings.storeHotkey)) {
                errors.push(t("storeHotkeyError"));
            }

            if (settings.undoStoreHotkey && !this.validateHotkey(settings.undoStoreHotkey)) {
                errors.push(t("undoStoreHotkeyError"));
            }

            return errors;
        }

        // 验证快捷键格式
        validateHotkey(hotkey) {
            if (!hotkey) return true;
            // 简单的快捷键格式验证，可以根据需要调整
            return /^[A-Za-z0-9+\-]+$/.test(hotkey);
        }
    }

    // 创建验证管理器实例
    const validationManager = new ValidationManager();

    // 快捷键管理器类
    class HotkeyManager {
        constructor() {
            this.isRecording = false;
            this.currentRecordingElement = null;
        }

        // 开始录制快捷键
        startRecording(elementId) {
            if (this.isRecording) {
                this.stopRecording();
            }

            this.isRecording = true;
            this.currentRecordingElement = elementId;
            
            const element = domManager.getElement(elementId);
            element.value = t("recordingHotkey");
            element.style.backgroundColor = "#fff3cd";
            
            // 添加全局键盘事件监听
            document.addEventListener('keydown', this.handleKeyDown.bind(this), true);
            document.addEventListener('keyup', this.handleKeyUp.bind(this), true);
            document.addEventListener('click', this.handleClick.bind(this), true);
        }

        // 停止录制快捷键
        stopRecording() {
            if (!this.isRecording) return;

            this.isRecording = false;
            this.currentRecordingElement = null;
            
            // 移除全局事件监听
            document.removeEventListener('keydown', this.handleKeyDown.bind(this), true);
            document.removeEventListener('keyup', this.handleKeyUp.bind(this), true);
            document.removeEventListener('click', this.handleClick.bind(this), true);
        }

        // 处理键盘按下事件
        handleKeyDown(event) {
            if (!this.isRecording) return;

            event.preventDefault();
            event.stopPropagation();

            // 如果只按了修饰键，不处理
            if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') {
                return;
            }

            const keys = [];
            if (event.ctrlKey) keys.push('Ctrl');
            if (event.shiftKey) keys.push('Shift');
            if (event.altKey) keys.push('Alt');
            if (event.metaKey) keys.push('Meta');

            // 添加主键
            const key = event.key.toUpperCase();
            
            // 处理特殊键名
            const keyMap = {
                ' ': 'Space',
                'Enter': 'Enter',
                'Escape': 'Esc',
                'Tab': 'Tab',
                'Backspace': 'Backspace',
                'Delete': 'Delete',
                'Insert': 'Insert',
                'Home': 'Home',
                'End': 'End',
                'PageUp': 'PageUp',
                'PageDown': 'PageDown',
                'ArrowUp': 'Up',
                'ArrowDown': 'Down',
                'ArrowLeft': 'Left',
                'ArrowRight': 'Right'
            };
            
            const displayKey = keyMap[key] || key;
            keys.push(displayKey);

            if (keys.length > 0) {
                const hotkey = keys.join('+');
                
                // 检查快捷键冲突
                const conflicts = this.checkHotkeyConflict(hotkey);
                
                if (conflicts && conflicts.length > 0) {
                    // 显示冲突警告
                    const conflictMessage = conflicts.join('\n');
                    if (confirm(t("hotkeyConflict", { message: conflictMessage }))) {
                        this.setHotkey(hotkey);
                    } else {
                        // 重置输入框
                        domManager.getElement(this.currentRecordingElement).style.backgroundColor = '';
                        this.stopRecording();
                    }
                } else {
                    this.setHotkey(hotkey);
                }
            }
        }

        // 处理键盘释放事件
        handleKeyUp(event) {
            if (!this.isRecording) return;
            
            // 可以在这里添加额外的逻辑，比如显示当前按下的键
            // 目前主要用于确保事件监听器正常工作
        }

        // 设置快捷键
        setHotkey(hotkey) {
            domManager.setValue(this.currentRecordingElement, hotkey);
            domManager.getElement(this.currentRecordingElement).style.backgroundColor = '';
            this.stopRecording();
            
            // 显示成功消息
            notificationManager.showSuccess(t("hotkeySet", { hotkey: hotkey }));
            if (typeof window.__optionsAutoSave === 'function') {
                window.__optionsAutoSave();
            }
        }

        // 检查快捷键冲突
        checkHotkeyConflict(hotkey) {
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
            const currentSettings = settingsManager.getCurrentSettings();
            const pluginHotkeys = [
                currentSettings.storeHotkey,
                currentSettings.undoStoreHotkey
            ].filter(h => h && h !== hotkey);
            
            if (pluginHotkeys.includes(hotkey)) {
                conflicts.push(`插件快捷键冲突: ${hotkey}`);
            }
            
            return conflicts.length > 0 ? conflicts : null;
        }

        // 处理点击事件
        handleClick(event) {
            if (!this.isRecording) return;

            // 如果点击的不是当前录制元素，停止录制
            if (event.target !== domManager.getElement(this.currentRecordingElement)) {
                this.stopRecording();
                domManager.getElement(this.currentRecordingElement).style.backgroundColor = '';
            }
        }
    }

    // 创建快捷键管理器实例
    const hotkeyManager = new HotkeyManager();

    // 事件管理器类
    class EventManager {
        constructor() {
            this.eventHandlers = new Map();
        }

        // 添加事件监听器
        addEventListener(elementId, event, handler) {
            if (!this.eventHandlers.has(elementId)) {
                this.eventHandlers.set(elementId, new Map());
            }
            this.eventHandlers.get(elementId).set(event, handler);
            domManager.addEventListener(elementId, event, handler);
        }

        // 移除事件监听器
        removeEventListener(elementId, event) {
            const handlers = this.eventHandlers.get(elementId);
            if (handlers && handlers.has(event)) {
                const handler = handlers.get(event);
                domManager.getElement(elementId).removeEventListener(event, handler);
                handlers.delete(event);
            }
        }

        // 移除所有事件监听器
        removeAllEventListeners() {
            this.eventHandlers.forEach((handlers, elementId) => {
                handlers.forEach((handler, event) => {
                    domManager.getElement(elementId).removeEventListener(event, handler);
                });
            });
            this.eventHandlers.clear();
        }
    }

    // 创建事件管理器实例
    const eventManager = new EventManager();

    // 读取并显示设置
    settingsManager.loadSettings().then(function (result) {
        settingsManager.applySettingsToPage(result);
    });

    // 添加事件监听器
    eventManager.addEventListener("setStoreHotkey", 'click', () => {
        hotkeyManager.startRecording('storeHotkey');
    });

    eventManager.addEventListener("setUndoStoreHotkey", 'click', () => {
        hotkeyManager.startRecording('undoStoreHotkey');
    });

    async function saveSettingsNow() {
        try {
            const settings = settingsManager.getCurrentSettings();
            const validationErrors = validationManager.validateSettings(settings);
            if (validationErrors.length > 0) {
                return;
            }
            await settingsManager.saveSettings(settings);
        } catch (error) {
            notificationManager.showError(t("settingsSaveFailed") + error.message);
        }
    }

    const debouncedAutoSave = Utility.debounce(saveSettingsNow, 500);
    window.__optionsAutoSave = debouncedAutoSave;

    function setupAutoSaveListeners() {
        const autoSaveFields = [
            "autoStoreEnabled",
            "showStoreButton",
            "showCopyButton",
            "showExportButton",
            "selectionButtonPosition",
            "autoStoreDelay"
        ];
        autoSaveFields.forEach(function (fieldId) {
            const el = domManager.getElement(fieldId);
            if (!el) return;
            el.addEventListener("change", debouncedAutoSave);
            if (el.tagName === "INPUT") {
                el.addEventListener("input", debouncedAutoSave);
            }
        });
    }

    setupAutoSaveListeners();

    // 网站禁用名单
    const STORAGE_KEY_BLACKLIST = 'siteBlacklist';
    const blacklistInput = document.getElementById('blacklistDomainInput');
    const blacklistListEl = document.getElementById('blacklistList');
    const blacklistEmptyEl = document.getElementById('blacklistEmpty');
    const addBlacklistBtn = document.getElementById('addBlacklistDomain');

    function normalizeDomain(domain) {
        if (!domain) return '';
        let d = String(domain).trim().toLowerCase();
        try {
            if (d.includes('://')) d = new URL(d).hostname;
        } catch (e) {
            d = d.replace(/^https?:\/\//, '').split('/')[0];
        }
        if (d.startsWith('www.')) d = d.slice(4);
        return d;
    }

    function renderBlacklist(list) {
        const domains = (list || []).map(normalizeDomain).filter(Boolean);
        if (!blacklistListEl) return;
        blacklistListEl.querySelectorAll('.blacklist-tag').forEach(function (el) { el.remove(); });
        if (blacklistEmptyEl) {
            blacklistEmptyEl.style.display = domains.length ? 'none' : 'block';
        }
        domains.forEach(function (domain, index) {
            const tag = document.createElement('span');
            tag.className = 'blacklist-tag';
            tag.innerHTML = '<span>' + domain + '</span><button type="button" title="' + t("remove") + '" aria-label="' + t("remove") + '">&times;</button>';
            tag.querySelector('button').addEventListener('click', function () {
                const next = domains.filter(function (_, i) { return i !== index; });
                chrome.storage.local.set({ [STORAGE_KEY_BLACKLIST]: next }, function () {
                    renderBlacklist(next);
                    notificationManager.showSuccess(t("domainRemoved"));
                });
            });
            blacklistListEl.appendChild(tag);
        });
    }

    function loadBlacklist() {
        chrome.storage.local.get([STORAGE_KEY_BLACKLIST], function (result) {
            renderBlacklist(result[STORAGE_KEY_BLACKLIST] || []);
        });
    }

    if (addBlacklistBtn && blacklistInput) {
        addBlacklistBtn.addEventListener('click', function () {
            const domain = normalizeDomain(blacklistInput.value);
            if (!domain) {
                notificationManager.showError(t("invalidDomain"));
                return;
            }
            if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain) && domain !== 'localhost') {
                notificationManager.showError(t("invalidDomainFormat"));
                return;
            }
            chrome.storage.local.get([STORAGE_KEY_BLACKLIST], function (result) {
                const list = (result[STORAGE_KEY_BLACKLIST] || []).map(normalizeDomain).filter(Boolean);
                if (list.includes(domain)) {
                    notificationManager.showError(t("domainAlreadyListed"));
                    return;
                }
                list.push(domain);
                chrome.storage.local.set({ [STORAGE_KEY_BLACKLIST]: list }, function () {
                    blacklistInput.value = '';
                    renderBlacklist(list);
                    notificationManager.showSuccess(t("domainAdded"));
                });
            });
        });
        blacklistInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') addBlacklistBtn.click();
        });
    }

    loadBlacklist();

    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.uiLanguage) {
            refreshPageI18n();
        }
    });
});
