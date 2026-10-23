const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const PAGES = ["index.html", "settings.html", "terminal.html"];

// vendor/ 下是压缩过的第三方库，不按本项目的写法检查
function pageScripts(page) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    return Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), m => m[1])
        .filter(src => !src.startsWith("vendor/"));
}

// 只认写在行首的声明：缩进的都在函数里，不占全局名字。var 不算：
// 「var I18n = typeof I18n !== "undefined" ? I18n : require(...)」这种重复声明是故意的
function topLevelNames(file) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    return Array.from(source.matchAll(/^(?:let|const|(?:async )?function)\s+([A-Za-z_$][\w$]*)/gm), m => m[1]);
}

function declaredFunctions(source) {
    return Array.from(source.matchAll(/^(?:async )?function\s+([A-Za-z_$][\w$]*)/gm), m => m[1]);
}

// 去掉顶层函数声明的函数体、注释和字符串，剩下的是加载时就会执行的代码
function loadTimeLines(source) {
    const lines = [];
    let inside = false;
    source.split(/\r?\n/).forEach((line, index) => {
        if (!inside && /^(?:async )?function\s/.test(line)) {
            inside = !/}\s*$/.test(line);
        } else if (inside) {
            inside = !/^}/.test(line);
        } else {
            lines.push({
                text: line.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""'),
                number: index + 1
            });
        }
    });
    return lines;
}

// 后加载的脚本里的函数，加载时还不存在：顶层直接调用会报错；当成值传出去
// （比如 addEventListener 的回调）也一样，取值那一刻就 ReferenceError。
// 写在别的函数里调用没关系，那时候所有脚本都加载完了。
// sources 按加载顺序给 [{name, source}]；var X = (function () {...})() 这种模块
// 里面的名字都是局部的，不查
function earlyReferences(sources) {
    const problems = [];
    sources.forEach(({name, source}, index) => {
        if (/^var\s+\w+\s*=\s*\(function/m.test(source)) {
            return;
        }
        const later = new Map();
        sources.slice(index + 1).forEach(next => {
            declaredFunctions(next.source).forEach(fn => later.set(fn, next.name));
        });
        for (const {text, number} of loadTimeLines(source)) {
            for (const m of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$])\s*(\()?/g)) {
                if (later.has(m[1]) && (!m[2] || /^\S/.test(text))) {
                    problems.push(`${name}:${number} 用到了 ${later.get(m[1])} 里的 ${m[1]}`);
                }
            }
        }
    });
    return problems;
}

test("加载时就用到后加载脚本里的函数，能查出来", () => {
    const sources = [
        {name: "a.js", source: [
            "function later() {",
            "    lateFn();",
            "}",
            "[1].forEach(function (x) {",
            "    el.addEventListener(\"resize\", lateFn);",
            "});",
            "lateFn();"
        ].join("\n")},
        {name: "b.js", source: "function lateFn() {\n}\n"}
    ];
    assert.deepStrictEqual(earlyReferences(sources), [
        "a.js:5 用到了 b.js 里的 lateFn",
        "a.js:7 用到了 b.js 里的 lateFn"
    ]);
});

test("页面脚本加载时不会用到后加载脚本里的函数", () => {
    for (const page of PAGES) {
        const sources = pageScripts(page).map(src => ({
            name: src,
            source: fs.readFileSync(path.join(ROOT, src), "utf8")
        }));
        assert.deepStrictEqual(earlyReferences(sources), [], page);
    }
});

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
    for (const page of PAGES) {
        const seen = new Map();
        for (const src of pageScripts(page)) {
            for (const name of topLevelNames(src)) {
                assert.ok(!seen.has(name), `${page}: ${name} 在 ${seen.get(name)} 和 ${src} 里都有`);
                seen.set(name, src);
            }
        }
    }
});
