const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Build = require("../scripts/build-site.js");

const ROOT = path.join(__dirname, "..");

test("本地脚本和样式加上版本号", () => {
    const html = [
        '<script src="theme.js"></script>',
        '<link rel="stylesheet" href="theme.css">',
        '<script src="locales/zh-CN.js"></script>'
    ].join("\n");
    const out = Build.versionAssets(html, file => "h-" + file.length);
    assert.strictEqual(out, [
        '<script src="theme.js?v=h-8"></script>',
        '<link rel="stylesheet" href="theme.css?v=h-9">',
        '<script src="locales/zh-CN.js?v=h-16"></script>'
    ].join("\n"));
});

test("外站、已带查询串的、不是脚本样式的引用不动", () => {
    const html = [
        '<script src="https://example.com/a.js"></script>',
        '<script src="a.js?v=1"></script>',
        '<link rel="icon" href="app.svg">',
        '<link rel="manifest" href="manifest.json">',
        '<a href="settings.html#video">x</a>'
    ].join("\n");
    assert.strictEqual(Build.versionAssets(html, () => "x"), html);
});

test("内容不同版本号就不同", () => {
    assert.notStrictEqual(Build.hashOf("a"), Build.hashOf("b"));
    assert.match(Build.hashOf("a"), /^[0-9a-f]{10}$/);
});

test("两个页面引用的脚本和样式都会发布出去", () => {
    const files = new Set(Build.publishedFiles());
    for (const page of ["index.html", "settings.html"]) {
        assert.ok(files.has(page), page);
        const html = fs.readFileSync(path.join(ROOT, page), "utf8");
        Build.versionAssets(html, file => {
            assert.ok(files.has(file), `${page} 引用的 ${file} 不在发布列表里（没提交，或被排除了）`);
            return "x";
        });
    }
    for (const file of files) {
        assert.ok(!/^(test|openspec|scripts)\//.test(file) && !file.startsWith("."), file);
    }
});
