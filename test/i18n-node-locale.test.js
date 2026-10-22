// 单独一个文件，因为要在 require 之前伪造环境：有的测试会补一个 global.window，
// Node 21 起又自带 navigator，语言取的是系统语言。断言都是按简体中文原文写的，
// 在英文系统（比如 GitHub Actions）上也得是中文
const test = require("node:test");
const assert = require("node:assert");

global.window = {};
Object.defineProperty(globalThis, "navigator", {
    value: {language: "en-US", languages: ["en-US"]},
    configurable: true
});

const I18n = require("../i18n.js");

test("node 下不管系统语言，一律用简体中文", () => {
    assert.strictEqual(I18n.current(), "zh-CN");
    assert.strictEqual(I18n.t("ocr.lang.eng"), "英文");
});
