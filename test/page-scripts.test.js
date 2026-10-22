const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function pageScripts(page) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    return Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), m => m[1]);
}

// 只认写在行首的声明：缩进的都在函数里，不占全局名字。var 不算：
// 「var I18n = typeof I18n !== "undefined" ? I18n : require(...)」这种重复声明是故意的
function topLevelNames(file) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    return Array.from(source.matchAll(/^(?:let|const|(?:async )?function)\s+([A-Za-z_$][\w$]*)/gm), m => m[1]);
}

test("控制页的 kvm-*.js 都由 index.html 加载，入口 kvm-page.js 排第一", () => {
    const scripts = pageScripts("index.html");
    const kvm = scripts.filter(src => /^kvm-.*\.js$/.test(src));
    const files = fs.readdirSync(ROOT).filter(name => /^kvm-.*\.js$/.test(name));
    assert.deepStrictEqual([...kvm].sort(), files.sort());
    assert.strictEqual(kvm[0], "kvm-page.js");
});

// 普通 <script> 共用一个全局作用域：两个文件顶层各 let 一个同名变量，后加载的整个文件
// 会直接报错不执行；同名函数则是后面的悄悄覆盖前面的
test("同一个页面的脚本之间没有重名的顶层声明", () => {
    for (const page of ["index.html", "settings.html"]) {
        const seen = new Map();
        for (const src of pageScripts(page)) {
            for (const name of topLevelNames(src)) {
                assert.ok(!seen.has(name), `${page}: ${name} 在 ${seen.get(name)} 和 ${src} 里都有`);
                seen.set(name, src);
            }
        }
    }
});
