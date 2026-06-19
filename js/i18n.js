(function (global) {
    'use strict';

    var STORAGE_KEY = 'uiLanguage';
    var currentLang = 'zh';

    var CHINESE_FONTS = ['方正小标宋简体', '宋体', '黑体', '楷体_GB2312', '仿宋_GB2312'];
    var CHINESE_BODY_FONTS = ['宋体', '黑体', '楷体_GB2312', '仿宋_GB2312'];
    var COMMON_ENGLISH_FONTS = ['Times New Roman', 'Calibri'];
    var ENGLISH_FONTS = ['Times New Roman', 'Calibri', 'Arial', 'Cambria', 'Georgia', 'Verdana', 'Tahoma', 'Courier New'];

    var ZH_FORMAT_DEFAULTS = {
        titleFontStyle: '方正小标宋简体',
        bodyFontStyle: '仿宋_GB2312',
        pageNumberFontStyle: '宋体',
        tocTitleFontStyle: '黑体',
        tocEntryFontStyle: '宋体',
        heading1FontStyle: '黑体',
        heading2FontStyle: '楷体_GB2312',
        heading3FontStyle: '仿宋_GB2312',
        tocTitle: '目录',
        filenameFormat: '日期-标题'
    };

    var EN_FORMAT_DEFAULTS = {
        titleFontStyle: 'Times New Roman',
        bodyFontStyle: 'Times New Roman',
        pageNumberFontStyle: 'Times New Roman',
        tocTitleFontStyle: 'Calibri',
        tocEntryFontStyle: 'Times New Roman',
        heading1FontStyle: 'Calibri',
        heading2FontStyle: 'Calibri',
        heading3FontStyle: 'Calibri',
        tocTitle: 'Contents',
        filenameFormat: 'date-title'
    };

    var FORMAT_SETTING_KEYS = Object.keys(ZH_FORMAT_DEFAULTS);

    function getTitleFonts() {
        if (currentLang === 'en') {
            return ENGLISH_FONTS.slice();
        }
        return CHINESE_FONTS.concat(COMMON_ENGLISH_FONTS);
    }

    function getCommonFonts() {
        if (currentLang === 'en') {
            return ENGLISH_FONTS.slice();
        }
        return CHINESE_BODY_FONTS.concat(COMMON_ENGLISH_FONTS);
    }

    function getFormatDefaults(lang) {
        if ((lang || currentLang) === 'en') {
            return Object.assign({}, EN_FORMAT_DEFAULTS);
        }
        return Object.assign({}, ZH_FORMAT_DEFAULTS);
    }

    function getFormatSettingKeys() {
        return FORMAT_SETTING_KEYS.slice();
    }

    function localizeFilenameFormat(format, lang) {
        var activeLang = lang || currentLang;
        if (!format) {
            return activeLang === 'en' ? EN_FORMAT_DEFAULTS.filenameFormat : ZH_FORMAT_DEFAULTS.filenameFormat;
        }
        if (format === ZH_FORMAT_DEFAULTS.filenameFormat) {
            return activeLang === 'en' ? EN_FORMAT_DEFAULTS.filenameFormat : ZH_FORMAT_DEFAULTS.filenameFormat;
        }
        if (format === EN_FORMAT_DEFAULTS.filenameFormat) {
            return activeLang === 'en' ? EN_FORMAT_DEFAULTS.filenameFormat : ZH_FORMAT_DEFAULTS.filenameFormat;
        }
        if (activeLang === 'en') {
            return format.replace(/日期/g, 'date').replace(/时间/g, 'time').replace(/标题/g, 'title');
        }
        return format.replace(/\bdate\b/gi, '日期').replace(/\btime\b/gi, '时间').replace(/\btitle\b/gi, '标题');
    }

    function convertFormatSettingsForLang(settings, fromLang, toLang) {
        if (!settings || !fromLang || !toLang || fromLang === toLang) {
            return settings ? Object.assign({}, settings) : {};
        }
        var fromDefaults = getFormatDefaults(fromLang);
        var toDefaults = getFormatDefaults(toLang);
        var result = Object.assign({}, settings);
        FORMAT_SETTING_KEYS.forEach(function (key) {
            if (key === 'filenameFormat') {
                result.filenameFormat = localizeFilenameFormat(settings.filenameFormat, toLang);
                return;
            }
            if (settings[key] !== undefined && settings[key] === fromDefaults[key]) {
                result[key] = toDefaults[key];
            }
        });
        return result;
    }

    function getDefaultUntitledDocName() {
        return currentLang === 'en' ? 'Document' : '文档';
    }

    function getHeadingRecognizeTypes() {
        var types = [
            { value: 'chinese_comma', labelKey: 'headingChineseComma' },
            { value: 'chinese_paren', labelKey: 'headingChineseParen' },
            { value: 'number_dot', labelKey: 'headingNumberDot' },
            { value: 'circle_number', labelKey: 'headingCircleNumber' },
            { value: 'number_paren', labelKey: 'headingNumberParen' }
        ];
        if (currentLang === 'en') {
            return types.filter(function (item) {
                return item.value !== 'chinese_comma' && item.value !== 'chinese_paren';
            });
        }
        return types;
    }

    var messages = {
        zh: {
            // Common
            yes: '是',
            no: '否',
            add: '添加',
            remove: '移除',
            save: '保存设置',
            settings: '设置',
            customFont: '自定义',
            customFontPlaceholder: '请输入自定义字体名称',
            switchToEn: '切换到英文',
            switchToZh: '切换到中文',
            langEn: 'EN',
            langZh: '中',

            // Options page
            optionsTitle: '网页导出助手设置',
            optionsAutoSaveHint: '修改后将自动保存，并应用于所有网页。',
            optionsFooter: '保存设置后将在所有网页中自动应用。',
            blacklistLegend: '网站禁用名单',
            blacklistHelp: '列入名单的网站不会显示悬浮工具栏，也无法使用暂存、复制等功能。可在扩展图标弹窗中快速开关当前网站。',
            blacklistPlaceholder: '例如：example.com',
            blacklistEmpty: '暂无禁用网站',
            autoStoreLegend: '自动暂存设置',
            autoStoreEnabled: '启用自动暂存',
            autoStoreEnabledHelp: '选中文本时自动暂存',
            autoStoreDelay: '自动暂存延迟（毫秒）',
            autoStoreDelayHelp: '选中文本后延迟多少毫秒自动暂存',
            buttonDisplayLegend: '按钮显示设置',
            showStoreButton: '显示暂存按钮',
            showStoreButtonHelp: '选中文本时显示暂存按钮',
            showCopyButton: '显示复制按钮',
            showCopyButtonHelp: '选中文本时显示复制按钮',
            showExportButton: '显示导出按钮',
            showExportButtonHelp: '选中文本时显示导出按钮',
            selectionButtonPosition: '按钮出现位置',
            selectionButtonPositionHelp: '暂存、复制、导出按钮显示在鼠标指针的所选方位',
            posTopLeft: '鼠标的左上角',
            posTopRight: '鼠标的右上角',
            posBottomLeft: '鼠标的左下角',
            posBottomRight: '鼠标的右下角',
            hotkeyLegend: '快捷键设置',
            storeHotkey: '暂存快捷键',
            storeHotkeyHelp: '手动暂存当前选中的文本',
            undoStoreHotkey: '撤销暂存快捷键',
            undoStoreHotkeyHelp: '撤销上一次暂存的内容',
            setHotkey: '设置快捷键',
            settingsSaved: '设置已保存',
            settingsSaveFailed: '保存设置失败：',
            invalidDomain: '请输入有效域名',
            invalidDomainFormat: '域名格式不正确',
            domainAlreadyListed: '该域名已在名单中',
            domainAdded: '已添加',
            domainRemoved: '已移除',
            autoStoreDelayError: '自动暂存延迟必须在0-5000毫秒之间',
            storeHotkeyError: '暂存快捷键格式不正确',
            undoStoreHotkeyError: '撤销暂存快捷键格式不正确',
            recordingHotkey: '请按下快捷键...',
            hotkeySet: '快捷键已设置为: {hotkey}',
            hotkeyConflict: '检测到快捷键冲突：\n{message}\n\n是否仍要使用此快捷键？',

            // Popup
            popupTitle: '网页导出助手',
            loading: '加载中…',
            pageUnavailable: '当前页面不可用',
            cannotGetPage: '无法获取页面',
            currentPage: '当前页面',
            siteEnabledTitle: '在本站启用网页导出助手',
            autoStore: '自动暂存',
            quickActions: '快捷操作',
            storageBadge: '暂存 {count} 篇',
            clearStorage: '清空暂存',
            enabledOnSite: '已在本站启用',
            addedToBlacklist: '已加入禁用名单',
            storageEmpty: '暂存列表已为空',
            confirmClearStorage: '确定清空所有暂存内容？',
            storageCleared: '已清空暂存',

            // Toolbar
            formatSettings: '格式设置',
            contentManagement: '内容管理',
            exportDocument: '导出文档',
            collapsePanel: '收起面板',
            expandPanel: '展开面板',
            store: '暂存',
            copy: '复制',
            export: '导出',

            // Format panel
            formatSettingsTitle: '文档格式设置',
            formatAutoSaveHint: '修改后将自动保存，并应用于后续导出。',
            fontSettings: '字体设置',
            titleFont: '标题字体',
            bodyFont: '正文字体',
            titleFontSize: '标题字号',
            bodyFontSize: '正文字号',
            headingSettings: '标题设置',
            heading1: '一级标题',
            heading2: '二级标题',
            heading3: '三级标题',
            recognizeType: '识别类型',
            fontStyle: '字体样式',
            fontSize: '字号',
            paragraphSettings: '段落设置',
            spacingBefore: '段前间距（磅）',
            spacingAfter: '段后间距（磅）',
            firstLineIndent: '首行缩进（字符）',
            lineSpacingType: '行间距类型',
            lineSpacingSingle: '单倍行距',
            lineSpacing15: '1.5倍行距',
            lineSpacing2: '2倍行距',
            lineSpacingFixed: '固定值',
            lineSpacingMultiple: '多倍行距',
            fixedLineSpacing: '固定行距（磅）',
            multipleLineSpacing: '多倍行距',
            marginSettings: '页边距设置',
            marginTop: '上边距（cm）',
            marginBottom: '下边距（cm）',
            marginLeft: '左边距（cm）',
            marginRight: '右边距（cm）',
            pageNumberSettings: '页码设置',
            addPageNumbers: '添加页码',
            addPageNumbersHelp: '选择是否在文档中添加页码',
            pageNumberPosition: '页码位置',
            pageNumberStyle: '页码样式',
            pageNumberFont: '页码字体',
            pageNumberFontSize: '页码字号',
            footerLeft: '页脚左侧',
            footerCenter: '页脚中间',
            footerRight: '页脚右侧',
            tableSettings: '表格保存设置',
            saveTables: '保存表格',
            saveTablesHelp: '选择是否在暂存内容时保存表格',
            cellAlignment: '单元格对齐',
            alignLeft: '靠左',
            alignCenter: '居中',
            alignRight: '靠右',
            imageSettings: '图片保存设置',
            saveImages: '保存图片',
            saveImagesHelp: '选择是否在暂存内容时保存图片',
            imageQuality: '图片质量',
            imageFormat: '图片格式',
            imageMaxWidth: '最大宽度（像素）',
            imageMaxHeight: '最大高度（像素）',
            imageScaleWidthHelp: '缩放图片到此宽度以内',
            imageScaleHeightHelp: '缩放图片到此高度以内',
            qualityHigh: '高质量 (100%)',
            qualityMedium: '中等质量 (80%)',
            qualityLow: '低质量 (60%)',
            formatJpeg: 'JPEG (推荐)',
            formatPng: 'PNG (无损)',
            hyperlinkSettings: '超链接保存设置',
            preserveHyperlinks: '保留超链接',
            preserveHyperlinksHelp: '选择是否保留网页超链接文本内的链接地址',
            tocSettings: '目录设置',
            generateToc: '生成目录',
            generateTocHelp: '选择是否在文档开头生成目录',
            tocTitle: '目录标题',
            tocTitleFont: '标题字体',
            tocEntryFont: '条目字体',
            tocTitleFontSize: '标题字号',
            tocEntryFontSize: '条目字号',
            defaultTocTitle: '目录',
            articleSeparatorSettings: '文章分隔设置',
            articleSeparator: '文章分隔方式',
            separatorNewline: '段落标记 (^p)',
            separatorPagebreak: '手动分页符 (^m)',
            separatorCustom: '自定义分隔符',
            customSeparator: '自定义分隔符',
            customSeparatorHelp: '输入自定义分隔符，例如：***、---、=== 等',
            filenameSettings: '文件名设置',
            filenameFormat: '文件名格式',
            filenameFormatHelp: '可用标签: 日期、时间、标题',
            defaultFilenameFormat: '日期-标题',
            fontSizeCustom: '自定义',
            fontSizeDisplay: '（{name}，约 {px}px）',

            // Heading recognize types
            headingChineseComma: '一、二、三、……',
            headingChineseParen: '（一）（二）（三）……',
            headingNumberDot: '1.2.3.……',
            headingCircleNumber: '①②③……',
            headingNumberParen: '（1）（2）（3）……',

            // Stored content panel
            storedContentTitle: '暂存内容管理',
            batchExport: '批量导出',
            searchPlaceholder: '搜索暂存内容...',
            noStoredContent: '暂无暂存内容',
            noStoredContentHint: '选中文本后点击暂存按钮',
            selectAll: '全选',
            exportSelected: '导出选中',
            edit: '编辑',
            delete: '删除',
            exportSingle: '导出',
            batchDelete: '批量删除',
            untitled: '无标题',
            includesImages: '包含 {count} 张图片',
            dragSort: '拖拽排序',
            exportThisArticle: '导出此文章',
            selectContentToExport: '请先选择要导出的内容！',
            confirmDeleteSelected: '确定删除选中的内容吗？',
            selectContentToDelete: '请先选择要删除的内容！',
            confirmDeleteArticle: '确定删除此文章吗？',
            editTitle: '标题',
            editBody: '正文',
            imagesCount: '图片 ({count}张)',
            imageN: '图片 {n}',
            saveEdit: '保存',
            cancel: '取消',
            confirmDeleteImage: '确定删除这张图片吗？',
            noUndoContent: '没有可撤销的暂存内容',
            undoStored: '已撤销暂存: {preview}...',
            autoExportOn: '自动导出功能已开启',
            autoExportOff: '自动导出功能已关闭',
            errTitleFontSize: '标题字体大小必须在5-42之间',
            errBodyFontSize: '正文字体大小必须在5-42之间',
            errHeadingFontSize: '{level}标题字号必须在5-42之间',
            errHeadingRecognizeType: '{level}标题识别类型无效',
            errSpacingBefore: '段前间距必须在0-100之间',
            errSpacingAfter: '段后间距必须在0-100之间',
            errMarginTop: '上边距必须在0-10之间',
            errMarginRight: '右边距必须在0-10之间',
            errMarginBottom: '下边距必须在0-10之间',
            errMarginLeft: '左边距必须在0-10之间',
            errFixedLineSpacing: '固定行间距必须在1-100之间',
            errMultipleLineSpacing: '多倍行间距必须在1-3之间',
            errFirstLineIndent: '首行缩进必须在0-10之间',
            errPageNumberFontSize: '页码字体大小必须在8-24之间',
            errImageMaxWidth: '图片最大宽度必须在100-2000像素之间',
            errImageMaxHeight: '图片最大高度必须在100-2000像素之间',
            errImageFormat: '图片格式必须是JPEG或PNG',
            errImageQuality: '图片质量必须是high、medium或low',
            errTocTitleEmpty: '目录标题不能为空',
            errTocTitleFontSize: '目录标题字号必须在12-24之间',
            errTocEntryFontSize: '目录条目字号必须在8-20之间',

            // Export menu
            exportModeTitle: '导出方式',
            exportMerged: '合并导出 Word',
            exportPerArticle: '逐篇导出 Word（ZIP 压缩包）',

            // Notifications
            noStoredContent: '没有暂存内容',
            exportFailed: '导出操作失败，请刷新页面后重试',
            noContentToExport: '没有暂存内容，无法导出',
            exporting: '正在导出文档...',
            exportSuccess: '文档导出成功，共导出 {count} 篇文章',
            exportDocFailed: '导出文档失败: {error}',
            createExportPageFailed: '创建导出页面失败，请刷新页面后重试',
            generatingZip: '正在生成 ZIP（内含逐篇 Word）…',
            zipDownloaded: 'ZIP 已下载（含 {count} 篇 DOCX）',
            zipFailed: '逐篇打包失败: {error}',
            cannotStartExport: '无法启动导出，请刷新页面后重试',
            exportingSelected: '正在导出选中的文章...',
            batchExportSuccess: '批量导出成功，共导出 {count} 篇文章',
            batchExportFailed: '批量导出失败: {error}',
            contentSaved: '内容已保存',
            orderUpdated: '文章顺序已更新',
            formatSettingsSaved: '设置已保存',
            singleExportSuccess: '单篇文章导出成功',
            processingContent: '正在处理内容...',
            storeFailed: '暂存失败',
            storeCommError: '暂存失败：扩展通信异常',
            contentStored: '内容已暂存',
            contentStoredWith: '内容已暂存（包含{parts}）',
            storeFull: '暂存空间已满：请在弹窗中删除旧条目或关闭「保存图片/表格」后重试',
            copiedToClipboard: '内容已复制到剪贴板',
            nothingToExport: '没有可导出的内容',
            autoStored: '内容已自动暂存',
            autoStoredWith: '内容已自动暂存（包含{parts}）',
            autoStoreFull: '自动暂存失败：存储空间已满，请打开弹窗清理暂存',
            autoExportNoContent: '自动导出失败：未检测到新增暂存内容',
            autoExporting: '正在自动导出文档...',
            partText: '文本',
            partImage: '图片',
            partTable: '表格',
            partTableCount: '{count}个表格',
            partImageCount: '{count}张图片',
            errDocxUndefined: 'docx对象未定义，请确保docxgen.min.js已加载',
            errNoExportContent: '没有可导出的暂存内容',
            errDocxNotLoaded: 'docx 未加载',
            errJszipNotLoaded: 'JSZip 未加载',

            // Font size names (Chinese)
            fs42: '初号', fs36: '小初', fs26: '一号', fs24: '小一',
            fs22: '二号', fs18: '小二', fs16: '三号', fs15: '小三',
            fs14: '四号', fs12: '小四', fs105: '五号', fs9: '小五',
            fs75: '六号', fs65: '小六', fs55: '七号', fs5: '八号'
        },
        en: {
            yes: 'Yes',
            no: 'No',
            add: 'Add',
            remove: 'Remove',
            save: 'Save Settings',
            settings: 'Settings',
            customFont: 'Custom',
            customFontPlaceholder: 'Enter custom font name',
            switchToEn: 'Switch to English',
            switchToZh: 'Switch to Chinese',
            langEn: 'EN',
            langZh: '中',

            optionsTitle: 'Web to Doc Settings',
            optionsAutoSaveHint: 'Changes are saved automatically and apply to all web pages.',
            optionsFooter: 'Settings apply to all web pages after saving.',
            blacklistLegend: 'Site Blocklist',
            blacklistHelp: 'Blocked sites will not show the floating toolbar or support store/copy features. Toggle the current site quickly from the extension popup.',
            blacklistPlaceholder: 'e.g. example.com',
            blacklistEmpty: 'No blocked sites',
            autoStoreLegend: 'Auto Store',
            autoStoreEnabled: 'Enable auto store',
            autoStoreEnabledHelp: 'Automatically store selected text',
            autoStoreDelay: 'Auto store delay (ms)',
            autoStoreDelayHelp: 'Delay in milliseconds before auto storing selected text',
            buttonDisplayLegend: 'Button Display',
            showStoreButton: 'Show store button',
            showStoreButtonHelp: 'Show store button when text is selected',
            showCopyButton: 'Show copy button',
            showCopyButtonHelp: 'Show copy button when text is selected',
            showExportButton: 'Show export button',
            showExportButtonHelp: 'Show export button when text is selected',
            selectionButtonPosition: 'Button position',
            selectionButtonPositionHelp: 'Show store, copy, and export buttons relative to the mouse cursor',
            posTopLeft: 'Top left of cursor',
            posTopRight: 'Top right of cursor',
            posBottomLeft: 'Bottom left of cursor',
            posBottomRight: 'Bottom right of cursor',
            hotkeyLegend: 'Hotkeys',
            storeHotkey: 'Store hotkey',
            storeHotkeyHelp: 'Manually store the current selection',
            undoStoreHotkey: 'Undo store hotkey',
            undoStoreHotkeyHelp: 'Undo the last stored content',
            setHotkey: 'Set hotkey',
            settingsSaved: 'Settings saved',
            settingsSaveFailed: 'Failed to save settings: ',
            invalidDomain: 'Please enter a valid domain',
            invalidDomainFormat: 'Invalid domain format',
            domainAlreadyListed: 'Domain already in list',
            domainAdded: 'Added',
            domainRemoved: 'Removed',
            autoStoreDelayError: 'Auto store delay must be between 0–5000 ms',
            storeHotkeyError: 'Invalid store hotkey format',
            undoStoreHotkeyError: 'Invalid undo store hotkey format',
            recordingHotkey: 'Press a hotkey...',
            hotkeySet: 'Hotkey set to: {hotkey}',
            hotkeyConflict: 'Hotkey conflict detected:\n{message}\n\nUse this hotkey anyway?',

            popupTitle: 'Web to Doc',
            loading: 'Loading…',
            pageUnavailable: 'Page not available',
            cannotGetPage: 'Cannot get page',
            currentPage: 'Current page',
            siteEnabledTitle: 'Enable Web to Doc on this site',
            autoStore: 'Auto store',
            quickActions: 'Quick Actions',
            storageBadge: '{count} stored',
            clearStorage: 'Clear storage',
            enabledOnSite: 'Enabled on this site',
            addedToBlacklist: 'Added to blocklist',
            storageEmpty: 'Storage is already empty',
            confirmClearStorage: 'Clear all stored content?',
            storageCleared: 'Storage cleared',

            formatSettings: 'Format Settings',
            contentManagement: 'Content Manager',
            exportDocument: 'Export Document',
            collapsePanel: 'Collapse panel',
            expandPanel: 'Expand panel',
            store: 'Store',
            copy: 'Copy',
            export: 'Export',

            formatSettingsTitle: 'Document Format Settings',
            formatAutoSaveHint: 'Changes are saved automatically and apply to future exports.',
            fontSettings: 'Font Settings',
            titleFont: 'Title font',
            bodyFont: 'Body font',
            titleFontSize: 'Title size',
            bodyFontSize: 'Body size',
            headingSettings: 'Heading Settings',
            heading1: 'Heading 1',
            heading2: 'Heading 2',
            heading3: 'Heading 3',
            recognizeType: 'Recognition type',
            fontStyle: 'Font style',
            fontSize: 'Font size',
            paragraphSettings: 'Paragraph Settings',
            spacingBefore: 'Space before (pt)',
            spacingAfter: 'Space after (pt)',
            firstLineIndent: 'First line indent (chars)',
            lineSpacingType: 'Line spacing',
            lineSpacingSingle: 'Single',
            lineSpacing15: '1.5 lines',
            lineSpacing2: 'Double',
            lineSpacingFixed: 'Fixed',
            lineSpacingMultiple: 'Multiple',
            fixedLineSpacing: 'Fixed spacing (pt)',
            multipleLineSpacing: 'Multiple spacing',
            marginSettings: 'Page Margins',
            marginTop: 'Top margin (cm)',
            marginBottom: 'Bottom margin (cm)',
            marginLeft: 'Left margin (cm)',
            marginRight: 'Right margin (cm)',
            pageNumberSettings: 'Page Numbers',
            addPageNumbers: 'Add page numbers',
            addPageNumbersHelp: 'Whether to add page numbers to the document',
            pageNumberPosition: 'Position',
            pageNumberStyle: 'Number style',
            pageNumberFont: 'Page number font',
            pageNumberFontSize: 'Page number size',
            footerLeft: 'Footer left',
            footerCenter: 'Footer center',
            footerRight: 'Footer right',
            tableSettings: 'Table Settings',
            saveTables: 'Save tables',
            saveTablesHelp: 'Whether to save tables when storing content',
            cellAlignment: 'Cell alignment',
            alignLeft: 'Left',
            alignCenter: 'Center',
            alignRight: 'Right',
            imageSettings: 'Image Settings',
            saveImages: 'Save images',
            saveImagesHelp: 'Whether to save images when storing content',
            imageQuality: 'Image quality',
            imageFormat: 'Image format',
            imageMaxWidth: 'Max width (px)',
            imageMaxHeight: 'Max height (px)',
            imageScaleWidthHelp: 'Scale images to this width',
            imageScaleHeightHelp: 'Scale images to this height',
            qualityHigh: 'High (100%)',
            qualityMedium: 'Medium (80%)',
            qualityLow: 'Low (60%)',
            formatJpeg: 'JPEG (recommended)',
            formatPng: 'PNG (lossless)',
            hyperlinkSettings: 'Hyperlink Settings',
            preserveHyperlinks: 'Preserve hyperlinks',
            preserveHyperlinksHelp: 'Whether to keep hyperlink URLs in exported text',
            tocSettings: 'Table of Contents',
            generateToc: 'Generate TOC',
            generateTocHelp: 'Whether to add a table of contents at the start',
            tocTitle: 'TOC title',
            tocTitleFont: 'Title font',
            tocEntryFont: 'Entry font',
            tocTitleFontSize: 'Title size',
            tocEntryFontSize: 'Entry size',
            defaultTocTitle: 'Contents',
            articleSeparatorSettings: 'Article Separator',
            articleSeparator: 'Separator type',
            separatorNewline: 'Paragraph mark (^p)',
            separatorPagebreak: 'Manual page break (^m)',
            separatorCustom: 'Custom separator',
            customSeparator: 'Custom separator',
            customSeparatorHelp: 'Enter a custom separator, e.g. ***, ---, ===',
            filenameSettings: 'Filename Settings',
            filenameFormat: 'Filename format',
            filenameFormatHelp: 'Available tags: date, time, title',
            defaultFilenameFormat: 'date-title',
            fontSizeCustom: 'Custom',
            fontSizeDisplay: '({name}, ~{px}px)',

            headingChineseComma: '一、二、三、……',
            headingChineseParen: '（一）（二）（三）……',
            headingNumberDot: '1. 2. 3. …',
            headingCircleNumber: '① ② ③ …',
            headingNumberParen: '(1) (2) (3) …',

            storedContentTitle: 'Stored Content',
            batchExport: 'Batch export',
            searchPlaceholder: 'Search stored content...',
            noStoredContent: 'No stored content',
            noStoredContentHint: 'Select text and click Store',
            selectAll: 'Select all',
            exportSelected: 'Export selected',
            edit: 'Edit',
            delete: 'Delete',
            exportSingle: 'Export',
            batchDelete: 'Batch delete',
            untitled: 'Untitled',
            includesImages: '{count} image(s)',
            dragSort: 'Drag to reorder',
            exportThisArticle: 'Export this article',
            selectContentToExport: 'Please select content to export first.',
            confirmDeleteSelected: 'Delete selected content?',
            selectContentToDelete: 'Please select content to delete first.',
            confirmDeleteArticle: 'Delete this article?',
            editTitle: 'Title',
            editBody: 'Body',
            imagesCount: 'Images ({count})',
            imageN: 'Image {n}',
            saveEdit: 'Save',
            cancel: 'Cancel',
            confirmDeleteImage: 'Delete this image?',
            noUndoContent: 'No stored content to undo',
            undoStored: 'Undone: {preview}...',
            autoExportOn: 'Auto export enabled',
            autoExportOff: 'Auto export disabled',
            errTitleFontSize: 'Title font size must be between 5 and 42',
            errBodyFontSize: 'Body font size must be between 5 and 42',
            errHeadingFontSize: '{level} font size must be between 5 and 42',
            errHeadingRecognizeType: 'Invalid {level} recognition type',
            errSpacingBefore: 'Space before must be between 0 and 100',
            errSpacingAfter: 'Space after must be between 0 and 100',
            errMarginTop: 'Top margin must be between 0 and 10',
            errMarginRight: 'Right margin must be between 0 and 10',
            errMarginBottom: 'Bottom margin must be between 0 and 10',
            errMarginLeft: 'Left margin must be between 0 and 10',
            errFixedLineSpacing: 'Fixed line spacing must be between 1 and 100',
            errMultipleLineSpacing: 'Multiple line spacing must be between 1 and 3',
            errFirstLineIndent: 'First line indent must be between 0 and 10',
            errPageNumberFontSize: 'Page number font size must be between 8 and 24',
            errImageMaxWidth: 'Image max width must be between 100 and 2000 px',
            errImageMaxHeight: 'Image max height must be between 100 and 2000 px',
            errImageFormat: 'Image format must be JPEG or PNG',
            errImageQuality: 'Image quality must be high, medium, or low',
            errTocTitleEmpty: 'TOC title cannot be empty',
            errTocTitleFontSize: 'TOC title size must be between 12 and 24',
            errTocEntryFontSize: 'TOC entry size must be between 8 and 20',

            exportModeTitle: 'Export Mode',
            exportMerged: 'Merge into one Word file',
            exportPerArticle: 'Export each as Word (ZIP)',

            noStoredContent: 'No stored content',
            exportFailed: 'Export failed. Please refresh the page and try again.',
            noContentToExport: 'No stored content to export',
            exporting: 'Exporting document...',
            exportSuccess: 'Export successful — {count} article(s)',
            exportDocFailed: 'Export failed: {error}',
            createExportPageFailed: 'Failed to create export page. Please refresh and try again.',
            generatingZip: 'Generating ZIP (individual Word files)…',
            zipDownloaded: 'ZIP downloaded ({count} DOCX files)',
            zipFailed: 'ZIP export failed: {error}',
            cannotStartExport: 'Cannot start export. Please refresh and try again.',
            exportingSelected: 'Exporting selected articles...',
            batchExportSuccess: 'Batch export successful — {count} article(s)',
            batchExportFailed: 'Batch export failed: {error}',
            contentSaved: 'Content saved',
            orderUpdated: 'Article order updated',
            formatSettingsSaved: 'Settings saved',
            singleExportSuccess: 'Article exported successfully',
            processingContent: 'Processing content...',
            storeFailed: 'Store failed',
            storeCommError: 'Store failed: extension communication error',
            contentStored: 'Content stored',
            contentStoredWith: 'Content stored (includes {parts})',
            storeFull: 'Storage full: delete items in popup or disable save images/tables',
            copiedToClipboard: 'Copied to clipboard',
            nothingToExport: 'Nothing to export',
            autoStored: 'Content auto-stored',
            autoStoredWith: 'Content auto-stored (includes {parts})',
            autoStoreFull: 'Auto store failed: storage full. Open popup to clear storage.',
            autoExportNoContent: 'Auto export failed: no new stored content',
            autoExporting: 'Auto exporting document...',
            partText: 'text',
            partImage: 'images',
            partTable: 'tables',
            partTableCount: '{count} tables',
            partImageCount: '{count} images',
            errDocxUndefined: 'docx is undefined. Ensure docxgen.min.js is loaded.',
            errNoExportContent: 'No stored content to export',
            errDocxNotLoaded: 'docx not loaded',
            errJszipNotLoaded: 'JSZip not loaded',

            fs42: '42pt', fs36: '36pt', fs26: '26pt', fs24: '24pt',
            fs22: '22pt', fs18: '18pt', fs16: '16pt', fs15: '15pt',
            fs14: '14pt', fs12: '12pt', fs105: '10.5pt', fs9: '9pt',
            fs75: '7.5pt', fs65: '6.5pt', fs55: '5.5pt', fs5: '5pt'
        }
    };

    function interpolate(str, params) {
        if (!params) return str;
        return str.replace(/\{(\w+)\}/g, function (_, key) {
            return params[key] !== undefined ? params[key] : '{' + key + '}';
        });
    }

    function t(key, params) {
        var lang = messages[currentLang] || messages.zh;
        var str = lang[key];
        if (str === undefined) {
            str = messages.zh[key] || key;
        }
        return interpolate(str, params);
    }

    function getLang() {
        return currentLang;
    }

    function setLang(lang, callback) {
        if (lang !== 'zh' && lang !== 'en') lang = 'zh';
        currentLang = lang;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ uiLanguage: lang }, function () {
                if (callback) callback(lang);
            });
        } else {
            try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
            if (callback) callback(lang);
        }
    }

    function detectBrowserLang() {
        var langs = (navigator.languages && navigator.languages.length)
            ? navigator.languages
            : [navigator.language || 'zh-CN'];
        for (var i = 0; i < langs.length; i++) {
            if ((langs[i] || '').toLowerCase().indexOf('zh') === 0) {
                return 'zh';
            }
        }
        return 'en';
    }

    function resolveLang(stored) {
        if (stored === 'en' || stored === 'zh') {
            return stored;
        }
        return detectBrowserLang();
    }

    function loadLang(callback) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['uiLanguage'], function (result) {
                var lang = resolveLang(result.uiLanguage);
                currentLang = lang;
                if (result.uiLanguage !== 'en' && result.uiLanguage !== 'zh') {
                    chrome.storage.local.set({ uiLanguage: lang }, function () {
                        if (callback) callback(currentLang);
                    });
                    return;
                }
                if (callback) callback(currentLang);
            });
        } else {
            try {
                var stored = localStorage.getItem(STORAGE_KEY);
                currentLang = resolveLang(stored);
                if (stored !== 'en' && stored !== 'zh') {
                    localStorage.setItem(STORAGE_KEY, currentLang);
                }
            } catch (e) { currentLang = detectBrowserLang(); }
            if (callback) callback(currentLang);
        }
    }

    function applyPageI18n(root) {
        var container = root || document;
        container.querySelectorAll('[data-i18n]').forEach(function (el) {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        container.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
        });
        container.querySelectorAll('[data-i18n-title]').forEach(function (el) {
            el.title = t(el.getAttribute('data-i18n-title'));
        });
        container.querySelectorAll('option[data-i18n]').forEach(function (el) {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        document.documentElement.lang = currentLang === 'en' ? 'en' : 'zh';
    }

    function updateLangToggleButton(btn) {
        if (!btn) return;
        if (currentLang === 'zh') {
            btn.textContent = t('langEn');
            btn.title = t('switchToEn');
        } else {
            btn.textContent = t('langZh');
            btn.title = t('switchToZh');
        }
    }

    function initLangToggle(btn, onChange) {
        if (!btn) return;
        updateLangToggleButton(btn);
        btn.addEventListener('click', function () {
            var next = currentLang === 'zh' ? 'en' : 'zh';
            setLang(next, function () {
                updateLangToggleButton(btn);
                if (onChange) onChange(next);
            });
        });
    }

    function getFontSizeName(size) {
        var keyMap = {
            42: 'fs42', 36: 'fs36', 26: 'fs26', 24: 'fs24',
            22: 'fs22', 18: 'fs18', 16: 'fs16', 15: 'fs15',
            14: 'fs14', 12: 'fs12', 10.5: 'fs105', 9: 'fs9',
            7.5: 'fs75', 6.5: 'fs65', 5.5: 'fs55', 5: 'fs5'
        };
        return t(keyMap[size] || 'fontSizeCustom');
    }

    function renderFontOptions(selectedFont, fontList) {
        var html = fontList.map(function (f) {
            return '<option value="' + f + '"' + (selectedFont === f ? ' selected' : '') + '>' + f + '</option>';
        }).join('');
        var isCustom = selectedFont && fontList.indexOf(selectedFont) === -1;
        html += '<option value="custom"' + (isCustom ? ' selected' : '') + '>' + t('customFont') + '</option>';
        return html;
    }

    function isCustomFontValue(value, fontList) {
        return value && fontList.indexOf(value) === -1;
    }

    function getAllFontLists() {
        return {
            title: getTitleFonts(),
            common: getCommonFonts()
        };
    }

    var api = {
        t: t,
        getLang: getLang,
        setLang: setLang,
        loadLang: loadLang,
        applyPageI18n: applyPageI18n,
        initLangToggle: initLangToggle,
        updateLangToggleButton: updateLangToggleButton,
        getTitleFonts: getTitleFonts,
        getCommonFonts: getCommonFonts,
        getHeadingRecognizeTypes: getHeadingRecognizeTypes,
        getAllFontLists: getAllFontLists,
        renderFontOptions: renderFontOptions,
        isCustomFontValue: isCustomFontValue,
        getFontSizeName: getFontSizeName,
        getFormatDefaults: getFormatDefaults,
        getFormatSettingKeys: getFormatSettingKeys,
        localizeFilenameFormat: localizeFilenameFormat,
        convertFormatSettingsForLang: convertFormatSettingsForLang,
        getDefaultUntitledDocName: getDefaultUntitledDocName,
        STORAGE_KEY: STORAGE_KEY
    };

    global.DocExportI18n = api;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes.uiLanguage) {
                currentLang = changes.uiLanguage.newValue === 'en' ? 'en' : 'zh';
            }
        });
    }
})(typeof window !== 'undefined' ? window : self);
