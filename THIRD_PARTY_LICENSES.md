# Third-Party Licenses

This project includes third-party open-source libraries. They are not authored by this project and remain licensed under their respective licenses.

| Library | Version / Source | License |
| --- | --- | --- |
| docx | npm package `docx@9.7.1`, bundled as `js/docx.js` and related generated builds | MIT |
| JSZip | `js/jszip.min.js`, also bundled inside generated docx builds | MIT or GPL-3.0-or-later |
| SortableJS | `js/Sortable.min.js` | MIT |
| lottie-web / bodymovin | `js/lottie.min.js` | MIT |
| pako | Transitive dependency used by JSZip | MIT and Zlib |
| readable-stream and related stream helpers | Transitive dependency of JSZip | MIT |
| hash.js | Transitive dependency of docx | MIT |
| nanoid | Transitive dependency of docx | MIT |
| xml | Transitive dependency of docx | MIT |
| xml-js | Transitive dependency of docx | MIT |
| sax | Transitive dependency of xml-js | BlueOak-1.0.0 |

The repository may contain minified or generated vendor files for browser-extension packaging. When redistributing this extension, keep the original license notices contained in those files and comply with the terms of the licenses above.
