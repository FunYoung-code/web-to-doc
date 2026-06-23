var i18n = window.DocExportI18n;
function t(key, params) { return i18n ? i18n.t(key, params) : key; }
if (i18n) i18n.loadLang();

// 监听来自content script的消息
window.addEventListener('message', function(event) {
    if (event.data.type === 'EXPORT_DOCUMENT') {
        const { temporaryStorage, settings, filenameFormat } = event.data;
        
        // 验证数据
        if (!Array.isArray(temporaryStorage) || temporaryStorage.length === 0) {
            console.error('Invalid temporary storage data');
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: 'Invalid temporary storage data' }, '*');
            return;
        }

        // 确保导出库已加载
        if ((settings.exportFormat || 'docx') === 'pdf') {
            if (!window.DocExportPdf || !window.DocExportPdf.getJsPDFConstructor() || typeof html2canvas === 'undefined') {
                console.error('PDF 导出库未加载');
                window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errPdfNotLoaded') }, '*');
                return;
            }
        } else if (typeof docx === 'undefined') {
            console.error('docx对象未定义，请确保docxgen.min.js已加载');
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errDocxUndefined') }, '*');
            return;
        }

        try {
            // 计算行间距值
            const lineSpacingValue = getLineSpacingValue(
                settings.lineSpacing, 
                settings.fixedLineSpacing, 
                settings.multipleLineSpacing
            );

            // 执行导出
            exportByFormat(temporaryStorage, settings, lineSpacingValue, filenameFormat)
                .then(() => {
                    // 发送导出完成消息
                    window.parent.postMessage({ type: 'EXPORT_COMPLETE', success: true }, '*');
                })
                .catch(error => {
                    console.error('Export failed:', error);
                    window.parent.postMessage({ type: 'EXPORT_ERROR', error: error.message }, '*');
                });
        } catch (error) {
            console.error('Error preparing document:', error);
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: error.message }, '*');
        }
    } else if (event.data.type === 'EXPORT_ARTICLES_ZIP') {
        const { temporaryStorage, settings, filenameFormat } = event.data;

        if (!Array.isArray(temporaryStorage) || temporaryStorage.length === 0) {
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errNoExportContent') }, '*');
            return;
        }

        if ((settings.exportFormat || 'docx') === 'pdf') {
            if (!window.DocExportPdf || !window.DocExportPdf.getJsPDFConstructor() || typeof html2canvas === 'undefined') {
                window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errPdfNotLoaded') }, '*');
                return;
            }
        } else if (typeof docx === 'undefined') {
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errDocxNotLoaded') }, '*');
            return;
        }

        if (typeof JSZip === 'undefined') {
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errJszipNotLoaded') }, '*');
            return;
        }

        exportArticlesAsZipPackage(temporaryStorage, settings, filenameFormat)
            .then(function () {
                window.parent.postMessage({ type: 'EXPORT_COMPLETE', success: true }, '*');
            })
            .catch(function (error) {
                console.error('ZIP export failed:', error);
                window.parent.postMessage({ type: 'EXPORT_ERROR', error: error.message || String(error) }, '*');
            });
    } else if (event.data.type === 'EXPORT_SINGLE_ARTICLE') {
        // 处理单篇文章导出
        const { article, settings, filenameFormat } = event.data;
        
        // 验证数据
        if (!article || !article.text) {
            console.error('Invalid article data');
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: 'Invalid article data' }, '*');
            return;
        }

        if ((settings.exportFormat || 'docx') === 'pdf') {
            if (!window.DocExportPdf || !window.DocExportPdf.getJsPDFConstructor() || typeof html2canvas === 'undefined') {
                window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errPdfNotLoaded') }, '*');
                return;
            }
        } else if (typeof docx === 'undefined') {
            console.error('docx对象未定义，请确保docxgen.min.js已加载');
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: t('errDocxUndefined') }, '*');
            return;
        }

        try {
            // 计算行间距值
            const lineSpacingValue = getLineSpacingValue(
                settings.lineSpacing, 
                settings.fixedLineSpacing, 
                settings.multipleLineSpacing
            );

            // 执行单篇文章导出
            exportByFormat([article], settings, lineSpacingValue, filenameFormat)
                .then(() => {
                    // 发送导出完成消息
                    window.parent.postMessage({ type: 'EXPORT_COMPLETE', success: true }, '*');
                })
                .catch(error => {
                    console.error('Export failed:', error);
                    window.parent.postMessage({ type: 'EXPORT_ERROR', error: error.message }, '*');
                });
        } catch (error) {
            console.error('Error preparing document:', error);
            window.parent.postMessage({ type: 'EXPORT_ERROR', error: error.message }, '*');
        }
    }
});

function applyExportTextFilterToArticles(formattedTexts, settings) {
    if (!window.DocExportTextFilter || !Array.isArray(formattedTexts)) {
        return formattedTexts;
    }
    return window.DocExportTextFilter.filterFormattedArticles(formattedTexts, settings);
}

function exportByFormat(formattedTexts, settings, lineSpacingValue, filenameFormat, options) {
    formattedTexts = applyExportTextFilterToArticles(formattedTexts, settings);
    if ((settings.exportFormat || 'docx') === 'pdf') {
        if (!window.DocExportPdf || !window.DocExportPdf.createAndDownloadPdf) {
            return Promise.reject(new Error(t('errPdfNotLoaded')));
        }
        return window.DocExportPdf.createAndDownloadPdf(formattedTexts, settings, lineSpacingValue, filenameFormat, options);
    }
    return createAndDownloadDocx(formattedTexts, settings, lineSpacingValue, filenameFormat, options);
}

/**
 * 校验数字是否有效
 * @param {any} value - 需要校验的值
 * @returns {boolean} 是否是有效数字
 */
function isValidNumber(value) {
    const number = parseFloat(value);
    return !isNaN(number) && isFinite(number);
}

/**
 * 解析页边距（厘米 -> TWIP）
 * @param {any} value - 输入的页边距（厘米）
 * @param {number} defaultValue - 默认值（厘米）
 * @returns {number} 页边距（TWIP 单位）
 */
function parseMargin(value, defaultValue) {
    const margin = parseFloat(value);
    // 厘米到TWIP的精确换算：1厘米 = 566.9291338582677 TWIP
    // 1厘米 = 10毫米，1英寸 = 25.4毫米，1英寸 = 1440 TWIP
    // 所以 1厘米 = (1440 / 25.4) * 10 = 566.9291338582677 TWIP
    return isValidNumber(margin) ? Math.round(margin * 566.93) : Math.round(defaultValue * 566.93);
}

/**
 * 获取中文字号对应的半磅单位（docx 的字体大小单位）
 * @param {any} size - 用户设置的中文字号或磅值
 * @param {number} defaultSize - 默认字号（磅单位）
 * @param {object} mapping - 中文字号与磅值的映射
 * @returns {number} 字号（半磅单位）
 */
function getFontSizeInHalfPoints(size, defaultSize, mapping) {
    const parsedSize = parseFloat(size);
    if (!isValidNumber(parsedSize)) {
        return defaultSize * 2; // 返回默认大小（半磅单位）
    }
    
    // 检查是否有映射对应的值
    if (mapping && mapping[parsedSize]) {
        return mapping[parsedSize] * 2; // 使用映射表的值（半磅单位）
    }
    
    // 直接使用输入值（磅）转为半磅单位
    return parsedSize * 2;
}

/**
 * 获取行间距值
 * @param {string} lineSpacing - 行间距类型（single, fixed, multiple 等）
 * @param {number} fixedLineSpacing - 固定行距值（磅）
 * @param {number} multipleLineSpacing - 多倍行距倍数
 * @returns {object} line 和 lineRule 值（TWIP 单位）
 */
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

/**
 * 动态计算首行缩进值
 * @param {number} fontSize - 当前字体大小（半磅单位）
 * @param {number} firstLineIndent - 首行缩进字符数
 * @returns {number} 首行缩进值（TWIP 单位）
 */
function calculateFirstLineIndent(fontSize, firstLineIndent) {
    const fontSizeInPoints = fontSize / 2;
    return Math.round(fontSizeInPoints * firstLineIndent * 20);
}

/**
 * 动态生成页码段落
 * @param {object} settings - 页码设置
 * @returns {docx.Footer} 页脚对象
 */
function createFooterWithPageNumber(settings) {
    return new docx.Footer({
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
                        size: settings.pageNumberFontSize
                    })
                ]
            })
        ]
    });
}

const HEADING_RECOGNIZE_PATTERNS = {
    chinese_comma: /^[一二三四五六七八九十百千]+、.+/,
    chinese_paren: /^（[一二三四五六七八九十百千]+）.+/,
    number_dot: /^[0-9]+\..+/,
    circle_number: /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳].+/,
    number_paren: /^（[0-9]+）.+/
};

/**
 * 判断文本是否为特定级别的标题
 * @param {string} text - 待检查的文本
 * @param {object} settings - 导出设置
 * @returns {object|null} - 包含标题级别和结束位置的对象，null表示不是标题
 */
function getHeadingLevel(text, settings) {
    const trimmedText = text.trim();
    const hasPeriod = trimmedText.includes('。');
    const endPosition = hasPeriod ? trimmedText.indexOf('。') + 1 : trimmedText.length;
    const textToCheck = hasPeriod ? trimmedText.substring(0, endPosition) : trimmedText;

    const levelConfigs = [
        { level: 1, type: settings.heading1RecognizeType || 'chinese_comma' },
        { level: 2, type: settings.heading2RecognizeType || 'chinese_paren' },
        { level: 3, type: settings.heading3RecognizeType || 'number_dot' }
    ];

    for (const config of levelConfigs) {
        const pattern = HEADING_RECOGNIZE_PATTERNS[config.type];
        if (pattern && pattern.test(textToCheck)) {
            return { level: config.level, endPosition };
        }
    }

    return null;
}

/**
 * 根据标题级别获取字体样式
 * @param {number|null} headingLevel - 标题级别
 * @param {object} settings - 导出设置
 * @returns {object} 字体样式配置
 */
function getFontStyleForHeading(headingLevel, settings) {
    switch (headingLevel) {
        case 1:
            return {
                font: settings.heading1FontStyle || '黑体',
                size: settings.heading1FontSize || settings.bodyFontSize,
                bold: true
            };
        case 2:
            return {
                font: settings.heading2FontStyle || '楷体_GB2312',
                size: settings.heading2FontSize || settings.bodyFontSize,
                bold: true
            };
        case 3:
            return {
                font: settings.heading3FontStyle || '仿宋_GB2312',
                size: settings.heading3FontSize || settings.bodyFontSize,
                bold: true
            };
        default:
            return {
                font: settings.bodyFontStyle,
                size: settings.bodyFontSize,
                bold: false
            };
    }
}

// 辅助函数：将base64转换为ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64.split(',')[1]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// 标题清理函数：移除图片/表格占位符与特殊字符，保留中英文、数字、空格与顿号
function sanitizeTitle(raw) {
    if (!raw) return '';
    let text = String(raw);
    text = text.replace(/\[image\d{2}\]/g, '');
    text = text.replace(/\[table\d{2}\]/g, '');
    text = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s、]/g, '');
    return text.trim();
}

const MEDIA_PLACEHOLDER_REGEX = /\[(?:image|table)\d{2}\]/g;
const EXACT_MEDIA_PLACEHOLDER_REGEX = /^\[(?:image|table)\d{2}\]$/;

/** 占位符须独占一行，避免说明文字中的 [table00] 被误当作表格 */
function isExactMediaPlaceholderLine(text) {
    return EXACT_MEDIA_PLACEHOLDER_REGEX.test(String(text || '').trim());
}

function mapTextAlignToDocx(textAlign) {
    switch ((textAlign || '').toLowerCase()) {
        case 'center': return docx.AlignmentType.CENTER;
        case 'right': return docx.AlignmentType.RIGHT;
        case 'justify': return docx.AlignmentType.JUSTIFIED;
        default: return docx.AlignmentType.LEFT;
    }
}

function mapVerticalAlignToDocx(verticalAlign) {
    switch ((verticalAlign || '').toLowerCase()) {
        case 'middle': return docx.VerticalAlign.CENTER;
        case 'bottom': return docx.VerticalAlign.BOTTOM;
        default: return docx.VerticalAlign.TOP;
    }
}

function mapBorderSideToDocx(borderSide) {
    if (!borderSide || borderSide.style === 'none' || !borderSide.size) {
        return { style: docx.BorderStyle.NONE, size: 0, color: 'auto' };
    }
    return {
        style: borderSide.style === 'double' ? docx.BorderStyle.DOUBLE : docx.BorderStyle.SINGLE,
        size: borderSide.size,
        color: borderSide.color && borderSide.color !== 'auto' ? borderSide.color : 'CCCCCC'
    };
}

function cssFontSizeToHalfPointsExport(fontSize) {
    const match = String(fontSize || '').match(/([\d.]+)px/);
    if (!match) return null;
    const pt = parseFloat(match[1]) * 72 / 96;
    return Math.round(pt * 2);
}

function simplifyFontFamily(fontFamily) {
    if (!fontFamily) return '';
    return String(fontFamily).split(',')[0].replace(/['"]/g, '').trim();
}

function hexLuminance(hex) {
    if (!hex || hex.length < 6) {
        return 255;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function resolveDocxCellColors(style) {
    const bg = style.backgroundColor || null;
    let color = style.color || '000000';
    if (bg) {
        const lum = hexLuminance(bg);
        if (lum < 140 && (color === 'FFFFFF' || color === 'FFF')) {
            return { fill: bg, color: 'FFFFFF' };
        }
        if (lum >= 140 && (color === 'FFFFFF' || color === 'FFF')) {
            return { fill: bg, color: '000000' };
        }
        return { fill: bg, color: color };
    }
    if (color === 'FFFFFF' || color === 'FFF') {
        color = '000000';
    }
    return { fill: null, color: color };
}

function createDocxTableFromData(tableData, settings) {
    const defaultFont = settings.bodyFontStyle || '仿宋_GB2312';
    const defaultSize = settings.bodyFontSize || 32;
    const colCount = tableData.columnCount || 1;
    const columnWidth = Math.max(500, Math.floor(9000 / colCount));

    const rows = (tableData.rows || []).map(function (row) {
        const cells = (row.cells || []).map(function (cell) {
            const style = cell.style || {};
            const cellFont = simplifyFontFamily(style.fontFamily) || defaultFont;
            const cellSize = cssFontSizeToHalfPointsExport(style.fontSize) || defaultSize;
            const isBold = cell.isHeader || parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold';
            const resolvedColors = resolveDocxCellColors(style);
            const cellOptions = {
                children: [new docx.Paragraph({
                    children: [new docx.TextRun({
                        text: cell.text || '',
                        font: cellFont,
                        size: cellSize,
                        bold: isBold,
                        color: resolvedColors.color
                    })],
                    alignment: mapTextAlignToDocx(settings.tableCellAlignment || 'center')
                })],
                verticalAlign: mapVerticalAlignToDocx(style.verticalAlign),
                borders: {
                    top: mapBorderSideToDocx(style.borders && style.borders.top),
                    bottom: mapBorderSideToDocx(style.borders && style.borders.bottom),
                    left: mapBorderSideToDocx(style.borders && style.borders.left),
                    right: mapBorderSideToDocx(style.borders && style.borders.right)
                }
            };

            if (cell.colSpan > 1) cellOptions.columnSpan = cell.colSpan;
            if (cell.rowSpan > 1) cellOptions.rowSpan = cell.rowSpan;
            if (resolvedColors.fill) {
                cellOptions.shading = { fill: resolvedColors.fill, type: docx.ShadingType.CLEAR };
            }
            if (style.margins) {
                cellOptions.margins = style.margins;
            }

            return new docx.TableCell(cellOptions);
        });
        return new docx.TableRow({ children: cells });
    });

    return new docx.Table({
        rows: rows,
        width: { size: 100, type: docx.WidthType.PERCENTAGE },
        columnWidths: Array(colCount).fill(columnWidth),
        borders: {
            top: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            left: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            right: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
        }
    });
}

function findStoredTable(item, placeholder) {
    if (!item.tables || !item.tables.length) return null;
    const index = parseInt(placeholder.match(/\d+/)[0], 10);
    return item.tables.find(function (t) { return t.tableIndex === index; }) || null;
}

function pushTableContent(paragraphs, item, placeholder, settings) {
    const tableEntry = findStoredTable(item, placeholder);
    if (tableEntry && tableEntry.data && tableEntry.data.rows && tableEntry.data.rows.length) {
        paragraphs.push(createDocxTableFromData(tableEntry.data, settings));
    } else {
        paragraphs.push(new docx.Paragraph({
            children: [new docx.TextRun({
                text: '[表格]',
                font: settings.bodyFontStyle,
                size: settings.bodyFontSize,
                color: '666666'
            })],
            spacing: { before: 200, after: 200 }
        }));
    }
}

const URL_IN_TEXT_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]\u4e00-\u9fff，。；、）)]+/gi;

function mapLinksToSection(articleLinks, sectionStart, sectionLength) {
    if (!articleLinks || !articleLinks.length || !sectionLength) return [];
    const sectionEnd = sectionStart + sectionLength;
    return articleLinks
        .filter(function (l) {
            return l.start < sectionEnd && l.start + l.length > sectionStart;
        })
        .map(function (l) {
            const ls = Math.max(l.start, sectionStart);
            const le = Math.min(l.start + l.length, sectionEnd);
            return { start: ls - sectionStart, length: le - ls, href: l.href };
        })
        .filter(function (l) {
            return l.length > 0 && l.href;
        });
}

function mergeHyperlinkSegments(text, explicitLinks) {
    const segments = [];
    (explicitLinks || []).forEach(function (l) {
        segments.push({ start: l.start, end: l.start + l.length, href: l.href });
    });
    URL_IN_TEXT_REGEX.lastIndex = 0;
    var match;
    while ((match = URL_IN_TEXT_REGEX.exec(text)) !== null) {
        var start = match.index;
        var end = start + match[0].length;
        var overlaps = segments.some(function (s) {
            return start < s.end && end > s.start;
        });
        if (!overlaps) {
            segments.push({ start: start, end: end, href: match[0] });
        }
    }
    segments.sort(function (a, b) { return a.start - b.start; });
    var merged = [];
    segments.forEach(function (seg) {
        if (merged.length && seg.start < merged[merged.length - 1].end) return;
        merged.push(seg);
    });
    return merged;
}

function buildTextRunsWithHyperlinks(text, runStyle, preserveHyperlinks, explicitLinks) {
    if (!text) return [];
    if (!preserveHyperlinks) {
        return [new docx.TextRun(Object.assign({}, runStyle, { text: text }))];
    }
    var segments = mergeHyperlinkSegments(text, explicitLinks);
    if (!segments.length) {
        return [new docx.TextRun(Object.assign({}, runStyle, { text: text }))];
    }
    var children = [];
    var pos = 0;
    segments.forEach(function (seg) {
        if (seg.start > pos) {
            children.push(new docx.TextRun(Object.assign({}, runStyle, { text: text.slice(pos, seg.start) })));
        }
        var linkText = text.slice(seg.start, seg.end);
        if (linkText) {
            children.push(new docx.ExternalHyperlink({
                children: [new docx.TextRun(Object.assign({}, runStyle, {
                    text: linkText,
                    color: '0563C1',
                    underline: { type: docx.UnderlineType.SINGLE, color: '0563C1' }
                }))],
                link: seg.href
            }));
        }
        pos = seg.end;
    });
    if (pos < text.length) {
        children.push(new docx.TextRun(Object.assign({}, runStyle, { text: text.slice(pos) })));
    }
    return children;
}

function createTextChildren(text, settings, runStyle, sectionLinks) {
    return buildTextRunsWithHyperlinks(
        text,
        runStyle,
        settings.preserveHyperlinks === 'yes',
        sectionLinks || []
    );
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
                                size: tocSettings.tocEntryFontSize, // 已经是半磅单位
                                color: '000000' // 黑色
                            }),
                            // 超链接标题
                            new docx.InternalHyperlink({
                                children: [
                                    new docx.TextRun({
                                        text: titleText,
                                        font: tocSettings.tocEntryFontStyle || '宋体',
                                        size: tocSettings.tocEntryFontSize, // 已经是半磅单位
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

/**
 * 创建并下载 DOCX 文件
 * @param {Array} formattedTexts - 暂存内容
 * @param {object} settings - 用户设置
 * @param {object} lineSpacingValue - 行间距设置
 * @param {string} filenameFormat - 用户自定义文件名格式
 * @param {object} [options] — `{ returnBlobOnly: true }` 时仅生成 Blob，不触发下载（用于 ZIP 打包）
 * @returns {Promise} 默认下载；returnBlobOnly 时 resolve `{ blob, baseName }`
 */
function createAndDownloadDocx(formattedTexts, settings, lineSpacingValue, filenameFormat, options) {
    options = options || {};
    return new Promise((resolve, reject) => {
        try {
            // 中文字号映射表
            const chineseFontSizeMapping = {
                42: 42, // 初号
                36: 36, // 小初
                26: 26, // 一号
                24: 24, // 小一
                22: 22, // 二号
                18: 18, // 小二
                16: 16, // 三号
                15: 15, // 小三
                14: 14, // 四号
                12: 12, // 小四
                10.5: 10.5, // 五号
                9: 9, // 小五
                7.5: 7.5, // 六号
                6.5: 6.5, // 小六
                5.5: 5.5, // 七号
                5: 5 // 八号
            };

            const paragraphs = [];
            let firstParagraphText = "文档";
            let isFirstParagraph = true;
            let allTitles = []; // 收集所有文章的标题

            // 如果启用了目录生成，先添加目录
            if (settings.generateTableOfContents === 'yes' && formattedTexts.length > 1) {
                const tocSettings = {
                    tocTitle: settings.tocTitle || '目录',
                    tocTitleFontStyle: settings.tocTitleFontStyle || '黑体',
                    tocTitleFontSize: getFontSizeInHalfPoints(settings.tocTitleFontSize, 16, chineseFontSizeMapping),
                    tocEntryFontStyle: settings.tocEntryFontStyle || '宋体',
                    tocEntryFontSize: getFontSizeInHalfPoints(settings.tocEntryFontSize, 12, chineseFontSizeMapping),
                };
                
                const tocParagraphs = generateTableOfContents(formattedTexts, tocSettings);
                paragraphs.push(...tocParagraphs);
            }

            formattedTexts.forEach((item, index) => {
                // 为每篇文章收集一个标题
                const textParts = item.text.split('\n\n\n');
                let articleTitle = null;
                
                // 从第一段文本中提取标题
                if (textParts.length > 0) {
                    const firstTextPart = textParts[0];
                    const textSections = firstTextPart
                        .trim()
                        .split('\n')
                        .map(section => section.trim())
                        .filter(section => section.length > 0);
                    
                    if (textSections.length > 0) {
                        const cleanedTitle = sanitizeTitle(textSections[0]);
                        if (cleanedTitle) {
                            articleTitle = cleanedTitle;
                            allTitles.push(cleanedTitle);
                        }
                    }
                }
                
                // 如果没有找到标题，使用默认标题
                if (!articleTitle) {
                    articleTitle = `文章${index + 1}`;
                    allTitles.push(articleTitle);
                }

                // 统一处理每篇文章的段落（含图片和不含图片的情况）
                let isFirstSectionOfArticle = true; // 标记是否是文章的第一段
                let textCursor = 0;
                
                textParts.forEach(text => {
                    const textSections = text
                        .trim()
                        .split('\n')
                        .map(section => section.trim())
                        .filter(section => section.length > 0);

                    // 处理每个段落
                    textSections.forEach((section, sectionIndex) => {
                        const sectionStartInArticle = item.text.indexOf(section, textCursor);
                        const absStart = sectionStartInArticle >= 0 ? sectionStartInArticle : textCursor;
                        const sectionLinks = mapLinksToSection(item.links, absStart, section.length);
                        textCursor = absStart + section.length;

                        // 判断是否是整篇文章的第一段（而不是每个textParts的第一段）
                        const isArticleFirstSection = isFirstSectionOfArticle && section.length > 0;
                        
                        if (isFirstParagraph && isArticleFirstSection) {
                            // 使用完整标题（仅清理非法字符，不做长度截断）
                            firstParagraphText = sanitizeTitle(section);
                            isFirstParagraph = false;
                        }

                        // 检查段落中是否包含图片/表格占位符（仅独占一行时插入媒体）
                        const sectionTrimmed = section.trim();
                        const isExactMediaLine = isExactMediaPlaceholderLine(sectionTrimmed);
                        
                        if (isExactMediaLine) {
                            if (sectionTrimmed.startsWith('[table')) {
                                pushTableContent(paragraphs, item, sectionTrimmed, settings);
                            } else {
                                const imageIndex = parseInt(sectionTrimmed.match(/\d+/)[0], 10);
                                const image = item.images ? item.images.find(function (img) { return img.imageIndex === imageIndex; }) : null;
                                if (image) {
                                    try {
                                        const imageData = base64ToArrayBuffer(image.data);
                                        paragraphs.push(new docx.Paragraph({
                                            children: [
                                                new docx.ImageRun({
                                                    data: imageData,
                                                    transformation: {
                                                        width: image.width,
                                                        height: image.height
                                                    },
                                                    altText: {
                                                        title: image.alt || '图片',
                                                        description: image.alt || '图片描述'
                                                    }
                                                })
                                            ],
                                            spacing: { before: 200, after: 200 },
                                            alignment: docx.AlignmentType.CENTER
                                        }));
                                    } catch (error) {
                                        console.warn('Failed to add image to document:', error);
                                        paragraphs.push(new docx.Paragraph({
                                            children: [new docx.TextRun({
                                                text: `[图片: ${image.alt || '图片加载失败'}]`,
                                                font: settings.bodyFontStyle,
                                                size: settings.bodyFontSize,
                                                color: '666666'
                                            })],
                                            spacing: { before: 200, after: 200 },
                                            alignment: docx.AlignmentType.CENTER
                                        }));
                                    }
                                }
                            }

                            if (isArticleFirstSection) {
                                isFirstSectionOfArticle = false;
                            }
                        } else {
                            MEDIA_PLACEHOLDER_REGEX.lastIndex = 0;
                            // 普通段落（含说明文字里内嵌的 [table00] 等，不当作表格）
                            const headingInfo = getHeadingLevel(section, settings);
                            
                            if (headingInfo) {
                                // 如果检测到标题，将文本分为标题部分和正文部分
                                const headingText = section.substring(0, headingInfo.endPosition);
                                const bodyText = section.substring(headingInfo.endPosition);
                                
                                // 获取标题字体样式
                                const headingStyle = getFontStyleForHeading(headingInfo.level, settings);
                                
                                const paragraphChildren = [];
                                const headingLinks = sectionLinks.filter(function (l) {
                                    return l.start < headingInfo.endPosition;
                                });
                                const bodyLinks = sectionLinks.filter(function (l) {
                                    return l.start + l.length > headingInfo.endPosition;
                                }).map(function (l) {
                                    var ls = Math.max(l.start, headingInfo.endPosition);
                                    var le = Math.min(l.start + l.length, section.length);
                                    return { start: ls - headingInfo.endPosition, length: le - ls, href: l.href };
                                }).filter(function (l) { return l.length > 0; });

                                paragraphChildren.push.apply(paragraphChildren, createTextChildren(headingText, settings, {
                                    font: isArticleFirstSection ? settings.titleFontStyle : headingStyle.font,
                                    size: isArticleFirstSection ? settings.titleFontSize : headingStyle.size,
                                    bold: isArticleFirstSection ? true : headingStyle.bold,
                                    color: '000000'
                                }, headingLinks));

                                if (bodyText) {
                                    paragraphChildren.push.apply(paragraphChildren, createTextChildren(bodyText, settings, {
                                        font: settings.bodyFontStyle,
                                        size: settings.bodyFontSize,
                                        bold: false,
                                        color: '000000'
                                    }, bodyLinks));
                                }
                                
                                // 为文章的第一段添加书签（如果启用了目录且还未添加过书签）
                                const bookmarkId = settings.generateTableOfContents === 'yes' && formattedTexts.length > 1 && isArticleFirstSection ? 
                                    `bookmark_${index}` : undefined;
                                
                                const paragraph = new docx.Paragraph({
                                    children: paragraphChildren,
                                    spacing: {
                                        before: settings.paragraphSpacingBefore * 20,
                                        after: settings.paragraphSpacingAfter * 20,
                                        line: lineSpacingValue.line,
                                        lineRule: lineSpacingValue.lineRule
                                    },
                                    indent: {
                                        left: 0,
                                        right: 0,
                                        firstLine: calculateFirstLineIndent(
                                            isArticleFirstSection ? settings.titleFontSize : headingStyle.size,
                                            settings.firstLineIndent
                                        )
                                    },
                                    heading: isArticleFirstSection ? docx.HeadingLevel.HEADING_1 : undefined
                                });
                                
                                // 如果启用了目录，为第一段添加书签
                                if (bookmarkId) {
                                    const bookmarkParagraph = new docx.Paragraph({
                                        children: [
                                            new docx.Bookmark({
                                                id: bookmarkId,
                                                children: paragraphChildren
                                            })
                                        ],
                                        spacing: {
                                            before: settings.paragraphSpacingBefore * 20,
                                            after: settings.paragraphSpacingAfter * 20,
                                            line: lineSpacingValue.line,
                                            lineRule: lineSpacingValue.lineRule
                                        },
                                        indent: {
                                            left: 0,
                                            right: 0,
                                            firstLine: calculateFirstLineIndent(
                                                isArticleFirstSection ? settings.titleFontSize : headingStyle.size,
                                                settings.firstLineIndent
                                            )
                                        }
                                    });
                                    paragraphs.push(bookmarkParagraph);
                                } else {
                                    paragraphs.push(paragraph);
                                }
                            } else {
                                // 如果不是标题，使用默认样式
                                // 为文章的第一段添加书签（如果启用了目录且还未添加过书签）
                                const bookmarkId = settings.generateTableOfContents === 'yes' && formattedTexts.length > 1 && isArticleFirstSection ? 
                                    `bookmark_${index}` : undefined;

                                const sectionRunStyle = {
                                    font: isArticleFirstSection ? settings.titleFontStyle : settings.bodyFontStyle,
                                    size: isArticleFirstSection ? settings.titleFontSize : settings.bodyFontSize,
                                    bold: isArticleFirstSection ? true : false,
                                    color: '000000'
                                };
                                const sectionChildren = createTextChildren(section, settings, sectionRunStyle, sectionLinks);
                                
                                const paragraph = new docx.Paragraph({
                                    children: sectionChildren,
                                    spacing: {
                                        before: settings.paragraphSpacingBefore * 20,
                                        after: settings.paragraphSpacingAfter * 20,
                                        line: lineSpacingValue.line,
                                        lineRule: lineSpacingValue.lineRule
                                    },
                                    indent: {
                                        left: 0,
                                        right: 0,
                                        firstLine: calculateFirstLineIndent(isArticleFirstSection ? settings.titleFontSize : settings.bodyFontSize, settings.firstLineIndent)
                                    },
                                    heading: isArticleFirstSection ? docx.HeadingLevel.HEADING_1 : undefined
                                });
                                
                                // 如果启用了目录，为第一段添加书签
                                if (bookmarkId) {
                                    const bookmarkParagraph = new docx.Paragraph({
                                        children: [
                                            new docx.Bookmark({
                                                id: bookmarkId,
                                                children: sectionChildren
                                            })
                                        ],
                                        spacing: {
                                            before: settings.paragraphSpacingBefore * 20,
                                            after: settings.paragraphSpacingAfter * 20,
                                            line: lineSpacingValue.line,
                                            lineRule: lineSpacingValue.lineRule
                                        },
                                        indent: {
                                            left: 0,
                                            right: 0,
                                            firstLine: calculateFirstLineIndent(isArticleFirstSection ? settings.titleFontSize : settings.bodyFontSize, settings.firstLineIndent)
                                        }
                                    });
                                    paragraphs.push(bookmarkParagraph);
                                } else {
                                    paragraphs.push(paragraph);
                                }
                            }
                        }
                        
                        // 标记第一段已处理完成
                        if (isArticleFirstSection) {
                            isFirstSectionOfArticle = false;
                        }
                    });

                    // 段落间的空行
                    paragraphs.push(new docx.Paragraph({
                        children: [],
                        spacing: { after: 240 }, // 12pt 空间
                    }));
                });

                // 添加文章分隔符
                if (index < formattedTexts.length - 1) {
                    switch (settings.articleSeparator) {
                        case 'pagebreak':
                            // 手动分页符 (^m) - 在当前文章末尾添加分页符
                            paragraphs.push(new docx.Paragraph({
                                children: [],
                                pageBreakBefore: true,
                                spacing: {
                                    before: 400,
                                    after: 400
                                }
                            }));
                            break;
                        case 'custom':
                            if (settings.customSeparator) {
                                paragraphs.push(new docx.Paragraph({
                                    children: [
                                        new docx.TextRun({
                                            text: settings.customSeparator,
                                            font: settings.bodyFontStyle,
                                            size: settings.bodyFontSize,
                                        })
                                    ],
                                    alignment: docx.AlignmentType.CENTER,
                                    spacing: {
                                        before: 400,
                                        after: 400
                                    }
                                }));
                            }
                            break;
                        default: // 'newline' - 段落标记 (^p)
                            // 插入段落标记 - 在Word中表现为一个空段落
                            paragraphs.push(new docx.Paragraph({
                                children: [],
                                spacing: { 
                                    before: 400, 
                                    after: 400 
                                }
                            }));
                            break;
                    }
                }
            });

            const footer = settings.addPageNumbers === "yes" ? createFooterWithPageNumber(settings) : undefined;

            // 创建自定义样式，覆盖默认的一级标题颜色
            const customStyles = {
                heading1: {
                    run: {
                        color: "000000", // 黑色
                        size: settings.titleFontSize,
                        font: settings.titleFontStyle,
                        bold: true
                    }
                }
            };

            const doc = new docx.Document({
                styles: {
                    default: {
                        heading1: customStyles.heading1
                    }
                },
                sections: [{
                    properties: {
                        page: {
                            size: {
                                width: 11906,
                                height: 16838
                            },
                            margin: {
                                top: settings.pageMargins.top,
                                right: settings.pageMargins.right,
                                bottom: settings.pageMargins.bottom,
                                left: settings.pageMargins.left,
                            },
                        },
                    },
                    footers: footer ? { default: footer } : undefined,
                    children: paragraphs, // 所有内容都是段落
                }],
            });

            // 生成组合标题（单篇：完整标题；多篇：前3个标题用+连接，超过3篇追加“等X篇”）
            let combinedTitle = "";
            if (allTitles.length === 1) {
                // 单篇文章：使用完整标题
                combinedTitle = allTitles[0];
            } else if (allTitles.length > 1) {
                // 多篇文章：最多取前3个标题，每个标题最多20字
                const maxTitles = Math.min(allTitles.length, 3);
                const processedTitles = [];
                
                for (let i = 0; i < maxTitles; i++) {
                    let title = allTitles[i];
                    // 每个标题最多截取20字
                    if (title.length > 20) {
                        title = title.substring(0, 20) + '…';
                    }
                    processedTitles.push(title);
                }
                
                // 用顿号连接标题
                combinedTitle = processedTitles.join('、');
                
                // 如果文章数量超过3篇，添加"等X篇"
                if (allTitles.length > 3) {
                    combinedTitle += '等' + allTitles.length + '篇';
                }
            } else {
                // 没有标题时使用首段文本
                combinedTitle = firstParagraphText;
            }

            if (options.returnBlobOnly) {
                generateDocBlob(doc, filenameFormat, combinedTitle)
                    .then(resolve)
                    .catch(reject);
            } else {
                generateAndDownloadDoc(doc, filenameFormat, combinedTitle);
                resolve();
            }
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * 根据格式规则生成最终文件名（不含扩展名）
 */
function buildFormattedFileBaseName(filenameFormat, firstParagraphText) {
    const now = new Date();

    const formatDate = () => {
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    };

    const formatTime = () => {
        return `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    };

    const defaultUntitled = (i18n && i18n.getDefaultUntitledDocName) ? i18n.getDefaultUntitledDocName() : '文档';
    const defaultFormat = (i18n && i18n.getFormatDefaults) ? i18n.getFormatDefaults().filenameFormat : '日期-标题';
    const safeTitle = sanitizeTitle(firstParagraphText) || defaultUntitled;

    let fileName = filenameFormat || defaultFormat;
    fileName = fileName
        .replace(/标题|title/gi, safeTitle)
        .replace(/日期|date/gi, formatDate())
        .replace(/时间|time/gi, formatTime());
    return fileName;
}

/**
 * 生成 DOCX Blob（不下载）
 */
function generateDocBlob(doc, filenameFormat, firstParagraphText) {
    const baseName = buildFormattedFileBaseName(filenameFormat, firstParagraphText);
    return docx.Packer.toBlob(doc).then(function (blob) {
        return { blob: blob, baseName: baseName };
    });
}

/**
 * 生成并下载 DOCX 文件
 * @param {docx.Document} doc - DOCX 文档对象
 * @param {string} filenameFormat - 用户自定义文件名格式
 * @param {string} firstParagraphText - 文档第一段文本，用作标题
 */
function generateAndDownloadDoc(doc, filenameFormat, firstParagraphText) {
    generateDocBlob(doc, filenameFormat, firstParagraphText).then(function (_ref) {
        const blob = _ref.blob;
        const baseName = _ref.baseName;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.docx';
        a.click();
        URL.revokeObjectURL(url);
    }).catch(function (err) {
        console.error('DOCX 生成失败:', err);
    });
}

function sanitizeZipEntryStem(name) {
    const s = String(name || '').replace(/[/\\?*:|"<>]/g, '_').trim().substring(0, 120);
    return s || '文档';
}

/**
 * 将多篇暂存各生成一篇 DOCX，打入一个 ZIP 并触发浏览器下载（ZIP 内为多个 .docx；浏览器原生不支持 RAR）
 */
function exportArticlesAsZipPackage(temporaryStorage, settings, filenameFormat) {
    const lineSpacingValue = getLineSpacingValue(
        settings.lineSpacing,
        settings.fixedLineSpacing,
        settings.multipleLineSpacing
    );

    const zip = new JSZip();
    const fileExt = (settings.exportFormat || 'docx') === 'pdf' ? '.pdf' : '.docx';

    function uniqueEntryName(baseName) {
        const stem = sanitizeZipEntryStem(baseName);
        let candidate = stem + fileExt;
        let k = 1;
        while (zip.files[candidate]) {
            k += 1;
            candidate = stem + '_' + k + fileExt;
        }
        return candidate;
    }

    var i = 0;
    function appendNext() {
        if (i >= temporaryStorage.length) {
            const now = new Date();
            var d = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
            var tm = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
            var zipName = '逐篇导出_' + d + '_' + tm + '.zip';
            return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function (zipBlob) {
                var url = URL.createObjectURL(zipBlob);
                var a = document.createElement('a');
                a.href = url;
                a.download = zipName;
                a.click();
                URL.revokeObjectURL(url);
            });
        }
        var article = temporaryStorage[i];
        i += 1;
        return exportByFormat([article], settings, lineSpacingValue, filenameFormat, { returnBlobOnly: true })
            .then(function (result) {
                var entryName = uniqueEntryName(result.baseName);
                zip.file(entryName, result.blob);
                return appendNext();
            });
    }

    return appendNext();
}
