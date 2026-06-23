(function () {
    function getJsPDFConstructor() {
        if (window.jspdf && window.jspdf.jsPDF) {
            return window.jspdf.jsPDF;
        }
        if (typeof jspdf !== 'undefined' && jspdf.jsPDF) {
            return jspdf.jsPDF;
        }
        return null;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function halfPointsToPt(halfPoints) {
        return (halfPoints || 24) / 2;
    }

    function getLineHeightCss(settings) {
        switch (settings.lineSpacing) {
            case '1.5': return '1.5';
            case '2': return '2';
            case 'fixed':
                return String((settings.fixedLineSpacing || 20) / 10);
            case 'multiple':
                return String(settings.multipleLineSpacing || 1.5);
            default:
                return '1.6';
        }
    }

    function buildHtmlTableFromData(tableData, settings) {
        var align = settings.tableCellAlignment || 'center';
        var html = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:inherit;">';
        (tableData.rows || []).forEach(function (row) {
            html += '<tr>';
            (row.cells || []).forEach(function (cell) {
                var tag = cell.isHeader ? 'th' : 'td';
                var attrs = '';
                if (cell.colSpan > 1) attrs += ' colspan="' + cell.colSpan + '"';
                if (cell.rowSpan > 1) attrs += ' rowspan="' + cell.rowSpan + '"';
                var weight = cell.isHeader ? 'font-weight:bold;' : '';
                html += '<' + tag + attrs + ' style="border:1px solid #ccc;padding:6px;text-align:' + align + ';' + weight + '">' +
                    escapeHtml(cell.text || '') + '</' + tag + '>';
            });
            html += '</tr>';
        });
        html += '</table>';
        return html;
    }

    function sectionTextToHtml(text, links, settings, styleCss) {
        var preserveLinks = settings.preserveHyperlinks === 'yes';
        if (!preserveLinks || !links || !links.length) {
            return escapeHtml(text);
        }
        var segments = mergeHyperlinkSegments(text, links);
        var html = '';
        var pos = 0;
        segments.forEach(function (seg) {
            if (seg.start > pos) {
                html += escapeHtml(text.slice(pos, seg.start));
            }
            html += '<a href="' + escapeHtml(seg.href) + '" style="color:#0563C1;text-decoration:underline;">' +
                escapeHtml(text.slice(seg.start, seg.end)) + '</a>';
            pos = seg.end;
        });
        if (pos < text.length) {
            html += escapeHtml(text.slice(pos));
        }
        return '<span style="' + styleCss + '">' + html + '</span>';
    }

    function paragraphStyle(settings, overrides) {
        overrides = overrides || {};
        var bodyFont = overrides.font || settings.bodyFontStyle || 'SimSun';
        var pt = halfPointsToPt(overrides.size || settings.bodyFontSize);
        var weight = overrides.bold ? 'bold' : 'normal';
        var indent = overrides.noIndent ? '0' : ((settings.firstLineIndent || 0) * 2) + 'em';
        return 'font-family:' + bodyFont + ',Microsoft YaHei,SimSun,serif;font-size:' + pt +
            'pt;font-weight:' + weight + ';line-height:' + getLineHeightCss(settings) +
            ';margin:0 0 8px;text-indent:' + indent + ';word-break:break-word;';
    }

    function extractFirstParagraphTitle(formattedTexts) {
        if (!formattedTexts || !formattedTexts.length) {
            return '文档';
        }
        var item = formattedTexts[0];
        var textParts = (item.text || '').split('\n\n\n');
        if (!textParts.length) {
            return '文档';
        }
        var sections = textParts[0].trim().split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!sections.length) {
            return '文档';
        }
        return sanitizeTitle(sections[0]) || '文档';
    }

    function buildPdfHtmlContent(formattedTexts, settings) {
        var parts = [];
        var textCursor = 0;

        formattedTexts.forEach(function (item, articleIndex) {
            if (articleIndex > 0) {
                if (settings.articleSeparator === 'pagebreak') {
                    parts.push('<div style="page-break-before:always;"></div>');
                } else if (settings.articleSeparator === 'custom' && settings.customSeparator) {
                    parts.push('<p style="text-align:center;margin:16px 0;">' + escapeHtml(settings.customSeparator) + '</p>');
                } else {
                    parts.push('<hr style="margin:16px 0;border:none;border-top:1px solid #ddd;">');
                }
            }

            var isFirstSectionOfArticle = true;
            var textParts = (item.text || '').split('\n\n\n');
            textCursor = 0;

            textParts.forEach(function (textBlock) {
                var sections = textBlock.trim().split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
                sections.forEach(function (section) {
                    var sectionTrimmed = section.trim();
                    var sectionStart = item.text.indexOf(section, textCursor);
                    var absStart = sectionStart >= 0 ? sectionStart : textCursor;
                    var sectionLinks = mapLinksToSection(item.links, absStart, section.length);
                    textCursor = absStart + section.length;

                    if (isExactMediaPlaceholderLine(sectionTrimmed)) {
                        if (sectionTrimmed.startsWith('[table')) {
                            var tableEntry = findStoredTable(item, sectionTrimmed);
                            if (tableEntry && tableEntry.data) {
                                parts.push(buildHtmlTableFromData(tableEntry.data, settings));
                            } else {
                                parts.push('<p style="color:#666;">[表格]</p>');
                            }
                        } else {
                            var imageIndex = parseInt(sectionTrimmed.match(/\d+/)[0], 10);
                            var image = item.images ? item.images.find(function (img) {
                                return img.imageIndex === imageIndex;
                            }) : null;
                            if (image && image.data) {
                                var mime = (image.format || settings.imageFormat || 'jpeg') === 'png' ? 'image/png' : 'image/jpeg';
                                parts.push('<div style="text-align:center;margin:12px 0;"><img src="data:' + mime +
                                    ';base64,' + image.data + '" style="max-width:100%;height:auto;" alt="' +
                                    escapeHtml(image.alt || '') + '"></div>');
                            }
                        }
                        if (isFirstSectionOfArticle) {
                            isFirstSectionOfArticle = false;
                        }
                        return;
                    }

                    var isArticleFirstSection = isFirstSectionOfArticle && section.length > 0;
                    var headingInfo = getHeadingLevel(section, settings);

                    if (headingInfo) {
                        var headingText = section.substring(0, headingInfo.endPosition);
                        var bodyText = section.substring(headingInfo.endPosition);
                        var headingStyle = getFontStyleForHeading(headingInfo.level, settings);
                        var headingLinks = sectionLinks.filter(function (l) { return l.start < headingInfo.endPosition; });
                        parts.push('<p style="' + paragraphStyle(settings, {
                            font: isArticleFirstSection ? settings.titleFontStyle : headingStyle.font,
                            size: isArticleFirstSection ? settings.titleFontSize : headingStyle.size,
                            bold: true,
                            noIndent: isArticleFirstSection
                        }) + '">' + sectionTextToHtml(headingText, headingLinks, settings, '') + '</p>');
                        if (bodyText) {
                            var bodyLinks = sectionLinks.filter(function (l) {
                                return l.start + l.length > headingInfo.endPosition;
                            }).map(function (l) {
                                var ls = Math.max(l.start, headingInfo.endPosition);
                                var le = Math.min(l.start + l.length, section.length);
                                return { start: ls - headingInfo.endPosition, length: le - ls, href: l.href };
                            }).filter(function (l) { return l.length > 0; });
                            parts.push('<p style="' + paragraphStyle(settings, { bold: false }) + '">' +
                                sectionTextToHtml(bodyText, bodyLinks, settings, '') + '</p>');
                        }
                    } else if (isArticleFirstSection) {
                        parts.push('<p style="' + paragraphStyle(settings, {
                            font: settings.titleFontStyle,
                            size: settings.titleFontSize,
                            bold: true,
                            noIndent: true
                        }) + '">' + sectionTextToHtml(section, sectionLinks, settings, '') + '</p>');
                    } else {
                        parts.push('<p style="' + paragraphStyle(settings, { bold: false }) + '">' +
                            sectionTextToHtml(section, sectionLinks, settings, '') + '</p>');
                    }

                    if (isFirstSectionOfArticle) {
                        isFirstSectionOfArticle = false;
                    }
                });
            });
        });

        return parts.join('\n');
    }

    function waitForImages(root) {
        var imgs = root.querySelectorAll('img');
        if (!imgs.length) {
            return Promise.resolve();
        }
        return Promise.all(Array.prototype.map.call(imgs, function (img) {
            if (img.complete && img.naturalWidth > 0) {
                return Promise.resolve();
            }
            return new Promise(function (resolve) {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 8000);
            });
        }));
    }

    function addCanvasToPdf(pdf, canvas, margins) {
        var marginLeft = parseFloat(margins.left) * 10;
        var marginRight = parseFloat(margins.right) * 10;
        var marginTop = parseFloat(margins.top) * 10;
        var marginBottom = parseFloat(margins.bottom) * 10;
        var pageWidth = 210;
        var pageHeight = 297;
        var contentWidth = pageWidth - marginLeft - marginRight;
        var contentHeight = pageHeight - marginTop - marginBottom;
        var imgData = canvas.toDataURL('image/jpeg', 0.92);
        var imgHeight = (canvas.height * contentWidth) / canvas.width;
        var heightLeft = imgHeight;
        var y = marginTop;

        pdf.addImage(imgData, 'JPEG', marginLeft, y, contentWidth, imgHeight);
        heightLeft -= contentHeight;

        while (heightLeft > 0) {
            pdf.addPage();
            y = marginTop - (imgHeight - heightLeft);
            pdf.addImage(imgData, 'JPEG', marginLeft, y, contentWidth, imgHeight);
            heightLeft -= contentHeight;
        }
    }

    function createAndDownloadPdf(formattedTexts, settings, lineSpacingValue, filenameFormat, options) {
        options = options || {};
        return new Promise(function (resolve, reject) {
            var JsPDF = getJsPDFConstructor();
            if (!JsPDF) {
                reject(new Error(typeof t === 'function' ? t('errPdfNotLoaded') : 'PDF library not loaded'));
                return;
            }
            if (typeof html2canvas === 'undefined') {
                reject(new Error(typeof t === 'function' ? t('errHtml2canvasNotLoaded') : 'html2canvas not loaded'));
                return;
            }

            try {
                var margins = settings.pageMarginsCm || { top: 2.8, right: 2.8, bottom: 2.8, left: 2.8 };
                var contentHtml = buildPdfHtmlContent(formattedTexts, settings);
                if (!contentHtml || !contentHtml.replace(/\s/g, '')) {
                    reject(new Error(typeof t === 'function' ? t('errNoExportContent') : 'No content to export'));
                    return;
                }

                var firstParagraphText = extractFirstParagraphTitle(formattedTexts);
                var wrapper = document.createElement('div');
                wrapper.style.cssText = 'position:absolute;left:0;top:0;width:794px;background:#fff;color:#000;overflow:visible;';
                wrapper.innerHTML = '<div class="pdf-export-root" style="box-sizing:border-box;padding:' +
                    margins.top + 'cm ' + margins.right + 'cm ' + margins.bottom + 'cm ' + margins.left + 'cm;">' +
                    contentHtml + '</div>';
                document.body.appendChild(wrapper);
                void wrapper.offsetHeight;

                waitForImages(wrapper).then(function () {
                    return html2canvas(wrapper, {
                        scale: 2,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#ffffff',
                        width: wrapper.scrollWidth,
                        height: wrapper.scrollHeight,
                        windowWidth: wrapper.scrollWidth,
                        windowHeight: wrapper.scrollHeight
                    });
                }).then(function (canvas) {
                    if (!canvas || canvas.width < 2 || canvas.height < 2) {
                        throw new Error(typeof t === 'function' ? t('errPdfRenderEmpty') : 'PDF render produced empty content');
                    }
                    var pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
                    addCanvasToPdf(pdf, canvas, margins);
                    var baseName = buildFormattedFileBaseName(filenameFormat, firstParagraphText);
                    if (options.returnBlobOnly) {
                        resolve({ blob: pdf.output('blob'), baseName: baseName });
                    } else {
                        pdf.save(baseName + '.pdf');
                        resolve();
                    }
                }).catch(function (err) {
                    reject(err);
                }).finally(function () {
                    if (wrapper.parentElement) {
                        wrapper.parentElement.removeChild(wrapper);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    window.DocExportPdf = {
        createAndDownloadPdf: createAndDownloadPdf,
        getJsPDFConstructor: getJsPDFConstructor
    };
})();
