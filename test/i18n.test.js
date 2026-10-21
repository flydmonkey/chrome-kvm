const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const I18n = require("../i18n.js");

const ROOT = path.join(__dirname, "..");
const BASE = I18n.dictionaries["zh-CN"];
const CODES = I18n.LANGUAGES.map(language => language.code);

function placeholders(text) {
    return (text.match(/\{\w+\}/g) || []).slice().sort();
}

// 页面脚本和 HTML 里出现的全部键：t("…")、三元里的 "…"、data-i18n*="…"
function referencedKeys() {
    const namespaces = new Set(Object.keys(BASE).map(key => key.split(".")[0]));
    const files = fs.readdirSync(ROOT).filter(name => /\.(js|html)$/.test(name));
    const keys = new Set();
    for (const name of files) {
        const source = fs.readFileSync(path.join(ROOT, name), "utf8");
        for (const match of source.matchAll(/["']([a-zA-Z]+(?:\.[a-zA-Z0-9]+)+)["']/g)) {
            const key = match[1];
            if (namespaces.has(key.split(".")[0]) && !/\.(html|js|css|json|png|svg)$/.test(key)) {
                keys.add(key);
            }
        }
    }
    return keys;
}

test("语言检测", async (t) => {
    await t.test("按首选顺序找第一个认识的", () => {
        assert.strictEqual(I18n.detect(["fr-FR", "ja-JP", "en-US"]), "ja");
        assert.strictEqual(I18n.detect(["ko-KR"]), "ko");
        assert.strictEqual(I18n.detect(["en-GB"]), "en");
    });
    await t.test("台湾、香港、澳门和 Hant 用繁体，其余中文用简体", () => {
        assert.strictEqual(I18n.detect(["zh-TW"]), "zh-TW");
        assert.strictEqual(I18n.detect(["zh-HK"]), "zh-TW");
        assert.strictEqual(I18n.detect(["zh-MO"]), "zh-TW");
        assert.strictEqual(I18n.detect(["zh-Hant-SG"]), "zh-TW");
        assert.strictEqual(I18n.detect(["zh-CN"]), "zh-CN");
        assert.strictEqual(I18n.detect(["zh"]), "zh-CN");
        assert.strictEqual(I18n.detect(["zh-Hans-HK"]), "zh-CN");
    });
    await t.test("都不认识或为空时用英文", () => {
        assert.strictEqual(I18n.detect(["de-DE"]), "en");
        assert.strictEqual(I18n.detect([]), "en");
        assert.strictEqual(I18n.detect([undefined]), "en");
    });
    await t.test("node 下默认简体中文，现有测试按原文断言", () => {
        assert.strictEqual(I18n.current(), "zh-CN");
    });
});

test("取词", async (t) => {
    await t.test("替换占位符，没给的占位符原样保留", () => {
        assert.strictEqual(I18n.format("已粘贴 {typed} 个字符", {typed: 3}), "已粘贴 3 个字符");
        assert.strictEqual(I18n.format("{a} 和 {b}", {a: 1}), "1 和 {b}");
    });
    await t.test("切换语言后取对应词典，缺的键先退回英文再退回简体中文", () => {
        I18n.setLanguage("ja", {persist: false});
        const saved = I18n.dictionaries.ja["view.fit"];
        delete I18n.dictionaries.ja["view.fit"];
        try {
            assert.strictEqual(I18n.t("view.fit"), I18n.dictionaries.en["view.fit"]);
        } finally {
            I18n.dictionaries.ja["view.fit"] = saved;
            I18n.setLanguage("zh-CN", {persist: false});
        }
    });
    await t.test("哪里都没有的键显示键名本身", () => {
        assert.strictEqual(I18n.t("no.such.key"), "no.such.key");
    });
    await t.test("不支持的语言不切换", () => {
        assert.strictEqual(I18n.setLanguage("fr", {persist: false}), false);
        assert.strictEqual(I18n.current(), "zh-CN");
    });
});

test("词典完整", async (t) => {
    for (const code of CODES.filter(code => code !== "zh-CN")) {
        await t.test(code + " 的键和简体中文一致", () => {
            const dictionary = I18n.dictionaries[code];
            const missing = Object.keys(BASE).filter(key => !(key in dictionary));
            const extra = Object.keys(dictionary).filter(key => !(key in BASE));
            assert.deepStrictEqual({missing, extra}, {missing: [], extra: []});
        });
        await t.test(code + " 的占位符和简体中文一致", () => {
            const dictionary = I18n.dictionaries[code];
            const mismatched = Object.keys(BASE).filter(key =>
                key in dictionary && placeholders(dictionary[key]).join() !== placeholders(BASE[key]).join());
            assert.deepStrictEqual(mismatched, []);
        });
        await t.test(code + " 没有留空的词条", () => {
            const dictionary = I18n.dictionaries[code];
            assert.deepStrictEqual(Object.keys(dictionary).filter(key => !String(dictionary[key]).trim()), []);
        });
    }
    await t.test("代码和页面里用到的键都在词典里", () => {
        const missing = [...referencedKeys()].filter(key => !(key in BASE));
        assert.deepStrictEqual(missing, []);
    });
    await t.test("词典里没有用不到的键", () => {
        const used = referencedKeys();
        assert.deepStrictEqual(Object.keys(BASE).filter(key => !used.has(key)), []);
    });
});
