// 暂存条数上限（chrome.storage.local 约 10MB；含 base64 图片时易触顶）
const MAX_TEMP_STORAGE_ITEMS = 120;

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function fetchImageAsBase64(url, referer) {
    const headers = {};
    if (referer) {
        headers.Referer = referer;
    }
    return fetch(url, { headers }).then(async function (response) {
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        const buffer = await response.arrayBuffer();
        const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
        return {
            base64: arrayBufferToBase64(buffer),
            mimeType: mimeType
        };
    });
}

function tryPersistTemporaryStorage(temporaryStorage, sendResponse, attempt) {
    const n = typeof attempt === 'number' ? attempt : 0;
    chrome.storage.local.set({ temporaryStorage: temporaryStorage }, function () {
        if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            const quotaHit = /quota/i.test(msg);
            if (quotaHit && temporaryStorage.length > 1 && n < 12) {
                const drop = Math.max(1, Math.ceil(temporaryStorage.length * 0.2));
                temporaryStorage.splice(0, drop);
                tryPersistTemporaryStorage(temporaryStorage, sendResponse, n + 1);
                return;
            }
            console.warn('temporaryStorage save failed:', msg);
            sendResponse({ success: false, error: msg });
            return;
        }
        sendResponse({ success: true });
    });
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openOptions') {
        chrome.runtime.openOptionsPage();
    } else if (message.action === 'openPopup') {
        // 在 Manifest V3 中使用 chrome.windows.create 创建弹出窗口
        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html'),
            type: 'popup',
            width: 400,
            height: 600
        });
    } else if (message.action === 'exportDocument') {
        // 导出文档的消息
        const response = exportDocument();
        sendResponse(response || {success: true});
        return true; // 保持消息通道开放以便异步响应
    } else if (message.action === 'saveText') {
        // 使用回调方式处理storage API以确保正确响应
        chrome.storage.local.get(['temporaryStorage'], function(result) {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }
            // 处理新的数据格式（支持图片）
            let formattedText;
            
            if (message.data) {
                // 新格式：包含图片的数据对象
                formattedText = {
                    text: message.data.text,
                    images: message.data.images || [],
                    tables: message.data.tables || [],
                    timestamp: message.data.timestamp || Date.now()
                };
                if (message.data.links && message.data.links.length) {
                    formattedText.links = message.data.links;
                }
            } else if (message.text) {
                // 兼容旧格式：纯文本
                formattedText = {
                    text: message.text,
                    images: [],
                    timestamp: Date.now()
                };
            } else {
                sendResponse({ success: false, error: 'Invalid data format' });
                return;
            }
            
            const temporaryStorage = result.temporaryStorage || [];
            temporaryStorage.push(formattedText);
            while (temporaryStorage.length > MAX_TEMP_STORAGE_ITEMS) {
                temporaryStorage.shift();
            }
            
            tryPersistTemporaryStorage(temporaryStorage, sendResponse, 0);
        });
        
        return true; // 保持消息通道开放
    } else if (message.action === 'fetchImage') {
        fetchImageAsBase64(message.url, message.referer)
            .then(function (result) {
                sendResponse({ success: true, base64: result.base64, mimeType: result.mimeType });
            })
            .catch(function (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            });
        return true;
    } else if (message.action === 'updateArticleList') {
        // 处理文章列表更新消息
        if (message.data && message.data.removed) {
            // 通知所有标签页更新文章列表
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'refreshArticleList'
                    }).catch(() => {
                        // 忽略无法发送消息的标签页
                    });
                });
            });
        }
        sendResponse({ success: true });
        return true;
    }
});

// 导出文档的函数
function exportDocument() {
    // 获取当前活动标签页
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length === 0) {
            return;
        }
        
        const activeTab = tabs[0];
        
        // 获取暂存内容和相关设置
        chrome.storage.local.get(['temporaryStorage'], function(result) {
            if (chrome.runtime.lastError) {
                return;
            }
            const temporaryStorage = result.temporaryStorage || [];
            
            if (temporaryStorage.length === 0) {
                // 向内容脚本发送通知消息
                chrome.tabs.sendMessage(activeTab.id, {
                    action: 'showNotification',
                    i18nKey: 'noContentToExport'
                });
                return;
            }
            
            // 返回成功响应，通知内容脚本开始导出过程
            chrome.tabs.sendMessage(activeTab.id, {
                action: 'showNotification',
                i18nKey: 'exporting'
            });
        });
        
        // 返回成功响应
        return {success: true};
    });
}
