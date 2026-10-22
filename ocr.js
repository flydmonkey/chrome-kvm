// OCR 文字识别里不碰 DOM、不碰识别引擎的那部分：框选区域怎么换算成画面像素、
// 截下来的图怎么预处理、识别结果怎么整理、语言怎么选。引擎是 vendor/tesseract
// 下的 Tesseract.js，完全在本机跑，画面不会发到任何服务器
var I18n = typeof I18n !== "undefined" ? I18n : require("./i18n.js");

var Ocr = (function () {
    var t = I18n.t;
    var STORAGE_KEY = "chrome-kvm-ocr";
    var VENDOR_DIR = "vendor/tesseract/";
    var LANGUAGES = [
        {id: "eng", label: t("ocr.lang.eng")},
        {id: "chi_sim", label: t("ocr.lang.chiSim")},
        {id: "chi_tra", label: t("ocr.lang.chiTra")},
        {id: "jpn", label: t("ocr.lang.jpn")},
        {id: "kor", label: t("ocr.lang.kor")}
    ];
    // 语言越多越慢；繁体、日文、韩文默认不开，要用时在面板里勾上
    var DEFAULT_LANGS = ["eng", "chi_sim"];
    // 框选时手一抖拖出来的几像素不算数
    var MIN_SELECTION_PX = 8;
    // 放大后的图边长上限：再大识别时间和内存都涨得厉害，准确率却不再提高
    var MAX_SIDE_PX = 4000;

    function normalizeLangs(list) {
        var picked = [];
        if (Array.isArray(list)) {
            LANGUAGES.forEach(function (lang) {
                if (list.indexOf(lang.id) !== -1) {
                    picked.push(lang.id);
                }
            });
        }
        return picked.length ? picked : DEFAULT_LANGS.slice();
    }

    function langString(list) {
        return normalizeLangs(list).join("+");
    }

    // Tesseract 对排在前面的语言更偏心：英文在前，中文里的个别词会被认成英文
    // （「网关」→「PIX」）；中文在前，英文里的数字又会认乱（0x0000007B → 9x9999997B）。
    // 所以先按英文优先认一遍，结果里有中日韩文字再按它们优先重认，纯英文画面只认一遍。
    // 日文、韩文和英文混排时也是同样的毛病
    function recognitionPlan(list) {
        var langs = normalizeLangs(list);
        var cjk = langs.filter(function (id) {
            return id !== "eng";
        });
        if (langs.indexOf("eng") === -1 || !cjk.length) {
            return {first: langs.join("+"), second: null};
        }
        return {first: ["eng"].concat(cjk).join("+"), second: cjk.concat("eng").join("+")};
    }

    function loadLangs(storage) {
        try {
            var raw = storage && storage.getItem(STORAGE_KEY);
            return normalizeLangs(raw ? JSON.parse(raw).langs : null);
        } catch (e) {
            return DEFAULT_LANGS.slice();
        }
    }

    function saveLangs(storage, list) {
        var langs = normalizeLangs(list);
        storage.setItem(STORAGE_KEY, JSON.stringify({langs: langs}));
        return langs;
    }

    // 视频元素里真正有画面的那块（object-fit: contain 会在两边留黑边），
    // 和 Ch9329.getContentRect 是同一套算法；这里不依赖串口连接，没连键鼠也能识别
    function contentRect(box, video, objectFit) {
        var fit = String(objectFit || "fill").toLowerCase();
        if (!video || !video.width || !video.height || fit === "fill" || fit === "none") {
            return {left: box.left, top: box.top, width: box.width, height: box.height};
        }
        var scale = fit === "cover"
            ? Math.max(box.width / video.width, box.height / video.height)
            : Math.min(box.width / video.width, box.height / video.height);
        var width = video.width * scale;
        var height = video.height * scale;
        return {
            left: box.left + (box.width - width) / 2,
            top: box.top + (box.height - height) / 2,
            width: width,
            height: height
        };
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 屏幕上框出来的矩形（两个角，顺序随意）→ 画面原始像素里的矩形。
    // 框到黑边或窗口外的部分裁掉；太小或完全落在画面外返回 null
    function selectionToVideo(start, end, content, video) {
        if (Math.abs(end.x - start.x) < MIN_SELECTION_PX || Math.abs(end.y - start.y) < MIN_SELECTION_PX) {
            return null;
        }
        if (!content || content.width <= 0 || content.height <= 0 || !video || !video.width || !video.height) {
            return null;
        }
        var sx = video.width / content.width;
        var sy = video.height / content.height;
        var x1 = clamp((Math.min(start.x, end.x) - content.left) * sx, 0, video.width);
        var x2 = clamp((Math.max(start.x, end.x) - content.left) * sx, 0, video.width);
        var y1 = clamp((Math.min(start.y, end.y) - content.top) * sy, 0, video.height);
        var y2 = clamp((Math.max(start.y, end.y) - content.top) * sy, 0, video.height);
        var rect = {
            x: Math.floor(x1),
            y: Math.floor(y1),
            width: Math.ceil(x2) - Math.floor(x1),
            height: Math.ceil(y2) - Math.floor(y1)
        };
        if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {
            return null;
        }
        return rect;
    }

    // Tesseract 认字号在二三十像素高的字最准，采集画面里的字常常只有十几像素，
    // 所以先放大。框得越小越可能是一两行小字，放得越多
    function scaleFor(width, height) {
        var side = Math.max(width, height);
        if (side <= 0) {
            return 1;
        }
        var scale = side <= 600 ? 3 : 2;
        while (scale > 1 && side * scale > MAX_SIDE_PX) {
            scale--;
        }
        return scale;
    }

    // 就地转灰度；整体偏暗（BIOS、终端这类深底浅字）时反色成浅底深字，
    // Tesseract 对浅底深字明显认得更准。返回是否反了色
    function preprocess(rgba) {
        var count = rgba.length / 4;
        if (!count) {
            return false;
        }
        var total = 0;
        for (var i = 0; i < rgba.length; i += 4) {
            var gray = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
            rgba[i] = rgba[i + 1] = rgba[i + 2] = gray;
            total += gray;
        }
        var invert = total / count < 128;
        if (invert) {
            for (var j = 0; j < rgba.length; j += 4) {
                rgba[j] = rgba[j + 1] = rgba[j + 2] = 255 - rgba[j];
            }
        }
        return invert;
    }

    // 汉字、假名、全角标点之间 Tesseract 会插空格（「系统 无 法 启动」「見つかり ませ ん」），
    // 复制出去没法用，去掉；英文单词之间的空格保留。韩文词之间本来就用空格隔开，不在此列
    var HAN = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
    var KANA = "\\u3040-\\u30ff\\u31f0-\\u31ff\\uff66-\\uff9f";
    var HANGUL = "\\u1100-\\u11ff\\u3130-\\u318f\\uac00-\\ud7af";
    var CJK = "\\u3000-\\u303f" + HAN + KANA + "\\uff00-\\uffef";
    var CJK_GAP = new RegExp("([" + CJK + "])[ \\t]+(?=[" + CJK + "])", "g");
    // 中日韩文字后面的半角标点前不该有空格（「配置 : IP」→「配置: IP」）
    var GAP_BEFORE_PUNCT = new RegExp("([" + CJK + HANGUL + "])[ \\t]+(?=[,.:;!?])", "g");
    // 夹在两个汉字或假名中间的半角标点其实是全角的（「已儲存 , 請」→「已儲存，請」）。
    // 韩文本来就用半角标点
    var IDEOGRAPH = HAN + KANA;
    var PUNCT_BETWEEN_IDEOGRAPH = new RegExp("([" + IDEOGRAPH + "])[ \\t]*([,:;!?])[ \\t]*(?=[" + IDEOGRAPH + "])", "g");
    var FULL_WIDTH = {",": "，", ":": "：", ";": "；", "!": "！", "?": "？"};
    var HAS_CJK = new RegExp("[" + HAN + KANA + HANGUL + "]");

    function cleanText(text) {
        var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map(function (line) {
            return line
                .replace(PUNCT_BETWEEN_IDEOGRAPH, function (all, han, punct) {
                    return han + FULL_WIDTH[punct];
                })
                .replace(CJK_GAP, "$1")
                .replace(GAP_BEFORE_PUNCT, "$1")
                .replace(/[ \t]+$/, "");
        });
        return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }

    function hasCjk(text) {
        return HAS_CJK.test(String(text || ""));
    }

    // 和 wasm-feature-detect 判断 SIMD 用的是同一段最小模块：能通过校验就是支持
    var SIMD_PROBE = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11];

    function simdSupported(wasm) {
        try {
            return !!wasm && typeof wasm.validate === "function" && wasm.validate(new Uint8Array(SIMD_PROBE));
        } catch (e) {
            return false;
        }
    }

    // 仓库里只放了 LSTM 引擎的 SIMD 版和通用版，自己挑好再交给 Tesseract.js，
    // 免得它去找没放进来的 relaxed-SIMD 版
    function coreFile(simd) {
        return simd ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js";
    }

    function workerOptions(baseUrl, simd) {
        var dir = baseUrl.replace(/\/?$/, "/");
        return {
            workerPath: dir + "worker.min.js",
            corePath: dir + "core/" + coreFile(simd),
            langPath: dir + "lang",
            // 语言包就在本站，读一次很快；不缓存进 IndexedDB，免得白占几十 MB
            cacheMethod: "none"
        };
    }

    var STATUS_TEXT = {
        "loading tesseract core": "ocr.status.loadingCore",
        "initializing tesseract": "ocr.status.initializing",
        "loading language traineddata": "ocr.status.loadingLang",
        "initializing api": "ocr.status.initializing",
        "recognizing text": "ocr.status.recognizing"
    };

    function progressText(status, progress) {
        var text = t(STATUS_TEXT[status] || "ocr.status.preparing");
        if (status === "recognizing text" && typeof progress === "number") {
            text += " " + Math.round(clamp(progress, 0, 1) * 100) + "%";
        }
        return text + "…";
    }

    // 统计「字」数给提示用：汉字一个算一个，空白不算
    function charCount(text) {
        return Array.from(String(text || "").replace(/\s+/g, "")).length;
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        VENDOR_DIR: VENDOR_DIR,
        LANGUAGES: LANGUAGES,
        DEFAULT_LANGS: DEFAULT_LANGS,
        MIN_SELECTION_PX: MIN_SELECTION_PX,
        MAX_SIDE_PX: MAX_SIDE_PX,
        normalizeLangs: normalizeLangs,
        langString: langString,
        recognitionPlan: recognitionPlan,
        hasCjk: hasCjk,
        loadLangs: loadLangs,
        saveLangs: saveLangs,
        contentRect: contentRect,
        selectionToVideo: selectionToVideo,
        scaleFor: scaleFor,
        preprocess: preprocess,
        cleanText: cleanText,
        simdSupported: simdSupported,
        coreFile: coreFile,
        workerOptions: workerOptions,
        progressText: progressText,
        charCount: charCount
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = Ocr;
}
