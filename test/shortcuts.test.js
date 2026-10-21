const test = require("node:test");
const assert = require("node:assert");
const Shortcuts = require("../shortcuts.js");
const Ch9329 = require("../ch9329.js");

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: function (key) {
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
        },
        setItem: function (key, value) {
            data[key] = String(value);
        },
        data: data
    };
}

test("组合键解析", async (t) => {
    await t.test("修饰键加普通键", () => {
        assert.deepStrictEqual(Shortcuts.parseCombo("Ctrl+Alt+F2"), {
            codes: ["ControlLeft", "AltLeft", "F2"],
            text: "Ctrl+Alt+F2"
        });
    });

    await t.test("大小写和空格随意，显示时统一写法", () => {
        assert.deepStrictEqual(Shortcuts.parseCombo(" ctrl + shift + esc "), {
            codes: ["ControlLeft", "ShiftLeft", "Escape"],
            text: "Ctrl+Shift+Esc"
        });
    });

    await t.test("修饰键写在后面也会被挪到前面，发送时才能先按住", () => {
        assert.deepStrictEqual(Shortcuts.parseCombo("L+Win").codes, ["MetaLeft", "KeyL"]);
    });

    await t.test("单独一个修饰键是合法的（只按 Win 打开开始菜单）", () => {
        assert.deepStrictEqual(Shortcuts.parseCombo("Win"), {codes: ["MetaLeft"], text: "Win"});
    });

    await t.test("Mac 的叫法映射到同一个键，但显示保留原叫法", () => {
        assert.deepStrictEqual(Shortcuts.parseCombo("cmd+option+esc"), {
            codes: ["MetaLeft", "AltLeft", "Escape"],
            text: "Cmd+Option+Esc"
        });
    });

    await t.test("字母、数字、F1~F12、符号", () => {
        assert.deepStrictEqual(Shortcuts.parseCombo("a").codes, ["KeyA"]);
        assert.deepStrictEqual(Shortcuts.parseCombo("7").codes, ["Digit7"]);
        assert.deepStrictEqual(Shortcuts.parseCombo("F12").codes, ["F12"]);
        assert.deepStrictEqual(Shortcuts.parseCombo("Ctrl+-").codes, ["ControlLeft", "Minus"]);
    });

    await t.test("重复的键只算一次", () => {
        assert.deepStrictEqual(Shortcuts.parseCombo("Ctrl+Control+A+a").codes, ["ControlLeft", "KeyA"]);
    });

    await t.test("不认识的键要指出是哪个", () => {
        assert.match(Shortcuts.parseCombo("Ctrl+F13").error, /F13/);
        assert.match(Shortcuts.parseCombo("Hyper+A").error, /Hyper/);
    });

    await t.test("空的、多余的 + 都报错", () => {
        assert.ok(Shortcuts.parseCombo("").error);
        assert.ok(Shortcuts.parseCombo("   ").error);
        assert.ok(Shortcuts.parseCombo("Ctrl++A").error);
        assert.ok(Shortcuts.parseCombo("Ctrl+").error);
    });

    await t.test("普通键超过 6 个装不进一份报告", () => {
        assert.ok(Shortcuts.parseCombo("A+B+C+D+E+F").codes);
        assert.match(Shortcuts.parseCombo("A+B+C+D+E+F+G").error, /6/);
    });
});

test("多步序列", async (t) => {
    await t.test("空格或逗号分隔", () => {
        assert.deepStrictEqual(Shortcuts.parseSequence("Win+R, enter"), {
            steps: [["MetaLeft", "KeyR"], ["Enter"]],
            text: "Win+R Enter"
        });
        assert.deepStrictEqual(Shortcuts.parseSequence("ctrl+k  ctrl+c").steps, [
            ["ControlLeft", "KeyK"], ["ControlLeft", "KeyC"]
        ]);
    });

    await t.test("中文逗号也认", () => {
        assert.strictEqual(Shortcuts.parseSequence("Win+R，Enter").steps.length, 2);
    });

    await t.test("任何一步有错整个都不收", () => {
        assert.match(Shortcuts.parseSequence("Win+R Foo").error, /Foo/);
    });

    await t.test("步数有上限", () => {
        const many = new Array(Shortcuts.MAX_STEPS + 1).fill("A").join(" ");
        assert.ok(Shortcuts.parseSequence(many).error);
    });
});

test("预设快捷键", async (t) => {
    await t.test("每一个都能解析", () => {
        Shortcuts.PRESETS.forEach(function (group) {
            group.items.forEach(function (item) {
                const parsed = Shortcuts.parseSequence(item.combo);
                assert.ok(!parsed.error, group.title + " / " + item.combo + "：" + parsed.error);
            });
        });
    });

    await t.test("解析出的每个键码协议层都认得，否则点了没反应", () => {
        Shortcuts.PRESETS.forEach(function (group) {
            group.items.forEach(function (item) {
                Shortcuts.parseSequence(item.combo).steps.forEach(function (codes) {
                    codes.forEach(function (code) {
                        const known = Ch9329.CONTROL_KEY_BITS[code] || Ch9329.KEYBOARD_MAP[code] != null;
                        assert.ok(known, item.combo + " 里的 " + code + " 在协议层查不到");
                    });
                });
            });
        });
    });

    await t.test("预设的写法已经是规范写法，显示和解析结果一致", () => {
        Shortcuts.PRESETS.forEach(function (group) {
            group.items.forEach(function (item) {
                assert.strictEqual(Shortcuts.parseSequence(item.combo).text, item.combo);
            });
        });
    });

    await t.test("只有开机那一组支持连按", () => {
        const repeatable = Shortcuts.PRESETS.filter(function (group) { return group.repeatable; });
        assert.strictEqual(repeatable.length, 1);
        assert.ok(repeatable[0].items.some(function (item) { return item.combo === "Del"; }));
    });
});

test("解析器认得的所有键协议层都认得", () => {
    const tokens = [
        "Ctrl", "Shift", "Alt", "Option", "Win", "Super", "Cmd",
        "Esc", "Tab", "Enter", "Space", "Backspace", "Del", "Ins", "Home", "End", "PgUp", "PgDn",
        "Up", "Down", "Left", "Right", "PrtSc", "SysRq", "Pause", "Break", "CapsLock", "NumLock",
        "ScrollLock", "Menu", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"
    ];
    for (let c = 0; c < 26; c++) {
        tokens.push(String.fromCharCode(65 + c));
    }
    for (let d = 0; d < 10; d++) {
        tokens.push(String(d));
    }
    for (let f = 1; f <= 12; f++) {
        tokens.push("F" + f);
    }
    tokens.forEach(function (token) {
        const parsed = Shortcuts.parseCombo(token);
        assert.ok(!parsed.error, token + "：" + parsed.error);
        const code = parsed.codes[0];
        assert.ok(Ch9329.CONTROL_KEY_BITS[code] || Ch9329.KEYBOARD_MAP[code] != null, token + " -> " + code);
    });
});

test("自定义快捷键", async (t) => {
    await t.test("没填名称就用组合键本身当名称", () => {
        assert.deepStrictEqual(Shortcuts.makeCustom("", "ctrl+alt+f2"), {label: "Ctrl+Alt+F2", combo: "Ctrl+Alt+F2"});
    });

    await t.test("名称去掉首尾空白并截到上限", () => {
        const long = "很".repeat(Shortcuts.MAX_LABEL_LENGTH + 5);
        assert.strictEqual(Shortcuts.makeCustom("  " + long, "A").label.length, Shortcuts.MAX_LABEL_LENGTH);
        assert.strictEqual(Shortcuts.makeCustom(" 切到 TTY2 ", "Ctrl+Alt+F2").label, "切到 TTY2");
    });

    await t.test("组合键无效时给出原因", () => {
        assert.ok(Shortcuts.makeCustom("x", "Ctrl+Nope").error);
    });

    await t.test("存进去再读出来", () => {
        const storage = memoryStorage();
        const saved = Shortcuts.saveCustom(storage, [{label: "TTY2", combo: "ctrl+alt+f2"}]);
        assert.deepStrictEqual(saved, [{label: "TTY2", combo: "Ctrl+Alt+F2"}]);
        assert.deepStrictEqual(Shortcuts.loadCustom(storage), saved);
    });

    await t.test("存储里是坏数据时读成空列表，不抛错", () => {
        assert.deepStrictEqual(Shortcuts.loadCustom(memoryStorage({[Shortcuts.STORAGE_KEY]: "{oops"})), []);
        assert.deepStrictEqual(Shortcuts.loadCustom(memoryStorage({[Shortcuts.STORAGE_KEY]: "42"})), []);
        assert.deepStrictEqual(Shortcuts.loadCustom(memoryStorage()), []);
        assert.deepStrictEqual(Shortcuts.loadCustom(null), []);
    });

    await t.test("只丢掉坏条目，好的留下", () => {
        const list = Shortcuts.normalizeCustomList([
            null, "Win+L", {label: "坏的", combo: "Ctrl+Nope"}, {label: "好的", combo: "Win+L"}
        ]);
        assert.deepStrictEqual(list, [{label: "好的", combo: "Win+L"}]);
    });

    await t.test("条数有上限", () => {
        const many = [];
        for (let i = 0; i < Shortcuts.MAX_CUSTOM + 5; i++) {
            many.push({label: "k" + i, combo: "A"});
        }
        assert.strictEqual(Shortcuts.normalizeCustomList(many).length, Shortcuts.MAX_CUSTOM);
    });
});
