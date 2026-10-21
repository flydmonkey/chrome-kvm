// 界面语言。词典在 locales/ 下，每种语言一个文件，浏览器里靠 <script> 依次
// register 进来；node 下直接 require。必须在所有用到 I18n.t 的脚本之前加载。
var I18n = (function () {
    var STORAGE_KEY = "chrome-kvm-lang";
    var LANGUAGES = [
        {code: "zh-CN", name: "简体中文"},
        {code: "zh-TW", name: "繁體中文"},
        {code: "en", name: "English"},
        {code: "ja", name: "日本語"},
        {code: "ko", name: "한국어"}
    ];
    var FALLBACKS = ["en", "zh-CN"];
    var TRADITIONAL_REGIONS = ["tw", "hk", "mo"];

    var dictionaries = {};
    var lang = null;

    function isSupported(code) {
        return LANGUAGES.some(function (language) {
            return language.code === code;
        });
    }

    function match(tag) {
        var parts = String(tag || "").toLowerCase().split(/[-_]/);
        if (parts[0] === "zh") {
            // 写明了字形就按字形：zh-Hans-HK 是在香港用简体
            if (parts.indexOf("hans") > 0) {
                return "zh-CN";
            }
            var traditional = parts.slice(1).some(function (part) {
                return part === "hant" || TRADITIONAL_REGIONS.indexOf(part) >= 0;
            });
            return traditional ? "zh-TW" : "zh-CN";
        }
        return isSupported(parts[0]) ? parts[0] : null;
    }

    // 按浏览器的首选顺序找第一个认识的，都不认识就用英文
    function detect(preferred) {
        var list = preferred || [];
        for (var i = 0; i < list.length; i++) {
            var code = match(list[i]);
            if (code) {
                return code;
            }
        }
        return "en";
    }

    function storage() {
        try {
            return typeof localStorage !== "undefined" ? localStorage : null;
        } catch (e) {
            return null;
        }
    }

    function initialLanguage() {
        // node 下跑单测：断言都是按简体中文原文写的
        if (typeof window === "undefined") {
            return "zh-CN";
        }
        var store = storage();
        var saved = store && store.getItem(STORAGE_KEY);
        if (isSupported(saved)) {
            return saved;
        }
        var nav = typeof navigator !== "undefined" ? navigator : {};
        return detect(nav.languages && nav.languages.length ? nav.languages : [nav.language]);
    }

    function current() {
        if (!lang) {
            lang = initialLanguage();
        }
        return lang;
    }

    function setLanguage(code, options) {
        if (!isSupported(code)) {
            return false;
        }
        lang = code;
        if (!options || options.persist !== false) {
            var store = storage();
            if (store) {
                store.setItem(STORAGE_KEY, code);
            }
        }
        return true;
    }

    function register(code, messages) {
        dictionaries[code] = messages;
    }

    function lookup(key) {
        var order = [current()].concat(FALLBACKS);
        for (var i = 0; i < order.length; i++) {
            var dictionary = dictionaries[order[i]];
            if (dictionary && Object.prototype.hasOwnProperty.call(dictionary, key)) {
                return dictionary[key];
            }
        }
        return key;
    }

    function format(text, params) {
        if (!params) {
            return text;
        }
        return text.replace(/\{(\w+)\}/g, function (whole, name) {
            return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole;
        });
    }

    function t(key, params) {
        return format(lookup(key), params);
    }

    // data-i18n 翻文字，data-i18n-title / -placeholder / -aria-label 翻对应属性。
    // 只认这几个，免得把 innerHTML 交给词典
    var ATTRIBUTES = ["title", "placeholder", "aria-label"];

    function apply(root) {
        var scope = root || document;
        if (scope === document) {
            document.documentElement.lang = current();
        }
        scope.querySelectorAll("[data-i18n]").forEach(function (element) {
            element.textContent = t(element.getAttribute("data-i18n"));
        });
        ATTRIBUTES.forEach(function (attribute) {
            scope.querySelectorAll("[data-i18n-" + attribute + "]").forEach(function (element) {
                element.setAttribute(attribute, t(element.getAttribute("data-i18n-" + attribute)));
            });
        });
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        LANGUAGES: LANGUAGES,
        detect: detect,
        current: current,
        setLanguage: setLanguage,
        register: register,
        t: t,
        format: format,
        apply: apply,
        dictionaries: dictionaries
    };
})();

if (typeof module !== "undefined" && module.exports) {
    I18n.LANGUAGES.forEach(function (language) {
        I18n.register(language.code, require("./locales/" + language.code + ".js"));
    });
    module.exports = I18n;
}
