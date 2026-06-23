(function () {
    var SHORT_LINE_MAX_LEN = 48;
    var SECTION_SKIP_MAX_LINES = 15;

    var DEFAULT_EXCLUDE_PATTERNS = [
        'AI代码解释',
        '换一批',
        '相关问题',
        '关联问题',
        '相关推荐',
        '猜你喜欢',
        '代码语言：',
        '代码语言:',
        '复制代码',
        '运行代码',
        '登录后复制',
        '展开查看全部',
        '收起'
    ];

    var SECTION_HEADER_RE = /^(相关问题|关联问题|相关推荐|猜你喜欢)$/;

    function normalizeSettings(settings) {
        settings = settings || {};
        return {
            enabled: settings.exportTextExcludeEnabled !== 'no',
            customPatterns: String(settings.exportTextExcludeCustom || '')
        };
    }

    function parseCustomPatternLine(line) {
        var raw = String(line || '').trim();
        if (!raw) {
            return null;
        }
        if (raw.indexOf('=') === 0) {
            var exact = raw.slice(1).trim();
            return exact ? { type: 'exact', value: exact } : null;
        }
        if (raw.length > 2 && raw.charAt(0) === '/' && raw.lastIndexOf('/') > 0) {
            var lastSlash = raw.lastIndexOf('/');
            var body = raw.slice(1, lastSlash);
            var flags = raw.slice(lastSlash + 1);
            try {
                return { type: 'regex', value: new RegExp(body, flags) };
            } catch (e) {
                return { type: 'shortContains', value: raw };
            }
        }
        return { type: 'shortContains', value: raw };
    }

    function collectPatterns(settings) {
        var patterns = DEFAULT_EXCLUDE_PATTERNS.map(function (text) {
            return { type: 'shortContains', value: text };
        });
        var custom = normalizeSettings(settings).customPatterns;
        custom.split(/\r?\n/).forEach(function (line) {
            var parsed = parseCustomPatternLine(line);
            if (parsed) {
                patterns.push(parsed);
            }
        });
        return patterns;
    }

    function lineMatchesPattern(trimmed, line, pattern) {
        if (!trimmed) {
            return false;
        }
        if (pattern.type === 'exact') {
            return trimmed === pattern.value;
        }
        if (pattern.type === 'regex') {
            return pattern.value.test(line);
        }
        if (trimmed === pattern.value) {
            return true;
        }
        if (trimmed.length <= SHORT_LINE_MAX_LEN && trimmed.indexOf(pattern.value) !== -1) {
            return true;
        }
        return false;
    }

    function shouldExcludeLine(line, patterns) {
        var trimmed = String(line || '').trim();
        if (!trimmed) {
            return false;
        }
        for (var i = 0; i < patterns.length; i++) {
            if (lineMatchesPattern(trimmed, line, patterns[i])) {
                return true;
            }
        }
        return false;
    }

    function isSectionHeaderLine(line) {
        return SECTION_HEADER_RE.test(String(line || '').trim());
    }

    function looksLikeArticleResumeLine(line) {
        var trimmed = String(line || '').trim();
        if (!trimmed) {
            return false;
        }
        if (trimmed.length >= 80) {
            return true;
        }
        if (/^#{1,6}\s/.test(trimmed)) {
            return true;
        }
        if (/^第?\d+[.、．]\s/.test(trimmed)) {
            return true;
        }
        if (/^#{1,6}$/.test(trimmed)) {
            return true;
        }
        return false;
    }

    function filterLines(text, patterns) {
        var lines = String(text || '').split('\n');
        var kept = [];
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];

            if (isSectionHeaderLine(line)) {
                i++;
                var skipped = 0;
                while (i < lines.length && skipped < SECTION_SKIP_MAX_LINES) {
                    var sectionLine = lines[i];
                    var sectionTrimmed = String(sectionLine || '').trim();
                    if (!sectionTrimmed) {
                        i++;
                        break;
                    }
                    if (looksLikeArticleResumeLine(sectionLine)) {
                        break;
                    }
                    i++;
                    skipped++;
                }
                continue;
            }

            if (shouldExcludeLine(line, patterns)) {
                i++;
                continue;
            }

            kept.push(line);
            i++;
        }

        return kept.join('\n').replace(/\n{4,}/g, '\n\n\n');
    }

    function buildKeptLineRanges(oldText, patterns) {
        var lines = String(oldText || '').split('\n');
        var ranges = [];
        var pos = 0;
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];
            var lineStart = pos;
            var lineEnd = pos + line.length;
            var nextPos = lineEnd + (i < lines.length - 1 ? 1 : 0);

            if (isSectionHeaderLine(line)) {
                pos = nextPos;
                i++;
                var skipped = 0;
                while (i < lines.length && skipped < SECTION_SKIP_MAX_LINES) {
                    if (!String(lines[i] || '').trim()) {
                        pos += lines[i].length + (i < lines.length - 1 ? 1 : 0);
                        i++;
                        break;
                    }
                    if (looksLikeArticleResumeLine(lines[i])) {
                        break;
                    }
                    pos += lines[i].length + (i < lines.length - 1 ? 1 : 0);
                    i++;
                    skipped++;
                }
                continue;
            }

            if (shouldExcludeLine(line, patterns)) {
                pos = nextPos;
                i++;
                continue;
            }

            ranges.push({ start: lineStart, end: lineEnd });
            pos = nextPos;
            i++;
        }

        return ranges;
    }

    function remapLinks(oldText, newText, links, patterns) {
        if (!links || !links.length || oldText === newText) {
            return links || [];
        }
        var ranges = buildKeptLineRanges(oldText, patterns);
        if (!ranges.length) {
            return [];
        }

        var newLinks = [];
        var newPos = 0;

        for (var r = 0; r < ranges.length; r++) {
            var range = ranges[r];
            var lineText = oldText.slice(range.start, range.end);

            for (var l = 0; l < links.length; l++) {
                var link = links[l];
                var linkEnd = link.start + link.length;
                if (link.start >= range.start && linkEnd <= range.end) {
                    newLinks.push({
                        start: newPos + (link.start - range.start),
                        length: link.length,
                        href: link.href
                    });
                }
            }

            newPos += lineText.length;
            if (r < ranges.length - 1) {
                newPos += 1;
            }
        }

        return newLinks;
    }

    function applyExportTextExclusion(text, settings) {
        if (!normalizeSettings(settings).enabled) {
            return String(text || '');
        }
        return filterLines(text, collectPatterns(settings));
    }

    function filterFormattedArticle(article, settings) {
        if (!article) {
            return article;
        }
        if (!normalizeSettings(settings).enabled) {
            return article;
        }
        var patterns = collectPatterns(settings);
        var oldText = String(article.text || '');
        var newText = filterLines(oldText, patterns);
        if (newText === oldText) {
            return article;
        }
        return Object.assign({}, article, {
            text: newText,
            links: remapLinks(oldText, newText, article.links || [], patterns)
        });
    }

    function filterFormattedArticles(articles, settings) {
        if (!Array.isArray(articles) || !normalizeSettings(settings).enabled) {
            return articles;
        }
        return articles.map(function (article) {
            return filterFormattedArticle(article, settings);
        });
    }

    window.DocExportTextFilter = {
        applyExportTextExclusion: applyExportTextExclusion,
        filterFormattedArticle: filterFormattedArticle,
        filterFormattedArticles: filterFormattedArticles,
        normalizeSettings: normalizeSettings,
        DEFAULT_EXCLUDE_PATTERNS: DEFAULT_EXCLUDE_PATTERNS.slice()
    };
})();
