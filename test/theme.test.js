const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Theme = require("../theme.js");

const ROOT = path.join(__dirname, "..");

test("跟随系统时按系统偏好定深浅", () => {
    assert.strictEqual(Theme.resolve("auto", true), "light");
    assert.strictEqual(Theme.resolve("auto", false), "dark");
});

test("手动选择不受系统偏好影响", () => {
    assert.strictEqual(Theme.resolve("light", false), "light");
    assert.strictEqual(Theme.resolve("dark", true), "dark");
});

test("存储里的坏值当作跟随系统", () => {
    assert.strictEqual(Theme.normalize("blue"), "auto");
    assert.strictEqual(Theme.normalize(null), "auto");
    assert.strictEqual(Theme.resolve("blue", true), "light");
});

// 页面样式里漏了一个变量，浅色下就会出现一块深色或者看不见的字
test("页面用到的颜色变量两套主题都有定义", () => {
    const themeCss = fs.readFileSync(path.join(ROOT, "theme.css"), "utf8");
    const [dark, light] = themeCss.split(':root[data-theme="light"]');
    const defined = block => new Set(Array.from(block.matchAll(/(--[\w-]+)\s*:/g), m => m[1]));
    const darkVars = defined(dark);
    const lightVars = defined(light);
    assert.deepStrictEqual([...darkVars].sort(), [...lightVars].sort());

    for (const file of ["index.html", "settings.html", "notices.css"]) {
        const source = fs.readFileSync(path.join(ROOT, file), "utf8");
        for (const match of source.matchAll(/var\((--[\w-]+)\)/g)) {
            assert.ok(darkVars.has(match[1]), `${file} 用了未定义的 ${match[1]}`);
        }
    }
});

test("两个页面都在 <head> 里先加载 theme.js 和 theme.css", () => {
    for (const file of ["index.html", "settings.html"]) {
        const head = fs.readFileSync(path.join(ROOT, file), "utf8").split("</head>")[0];
        assert.ok(head.includes('<script src="theme.js"></script>'), `${file} 缺 theme.js`);
        assert.ok(head.includes('href="theme.css"'), `${file} 缺 theme.css`);
    }
});
