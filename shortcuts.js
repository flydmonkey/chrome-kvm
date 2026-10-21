// 快捷键面板的纯逻辑：组合键文本解析、预设列表、自定义快捷键的存取。
// 不碰 DOM 和串口，方便单测；按键名用 KeyboardEvent.code，和 Ch9329.KEYBOARD_MAP 对得上
var Shortcuts = (function () {
    // 修饰键别名 -> [code, 显示名]。macOS 用户习惯写 Cmd/Option，显示时保留原叫法
    var MODIFIERS = {
        ctrl: ["ControlLeft", "Ctrl"],
        control: ["ControlLeft", "Ctrl"],
        shift: ["ShiftLeft", "Shift"],
        alt: ["AltLeft", "Alt"],
        option: ["AltLeft", "Option"],
        opt: ["AltLeft", "Option"],
        win: ["MetaLeft", "Win"],
        meta: ["MetaLeft", "Win"],
        super: ["MetaLeft", "Super"],
        cmd: ["MetaLeft", "Cmd"],
        command: ["MetaLeft", "Cmd"]
    };

    var KEYS = {
        esc: ["Escape", "Esc"],
        escape: ["Escape", "Esc"],
        tab: ["Tab", "Tab"],
        enter: ["Enter", "Enter"],
        return: ["Enter", "Enter"],
        space: ["Space", "Space"],
        backspace: ["Backspace", "Backspace"],
        del: ["Delete", "Del"],
        delete: ["Delete", "Del"],
        ins: ["Insert", "Ins"],
        insert: ["Insert", "Ins"],
        home: ["Home", "Home"],
        end: ["End", "End"],
        pgup: ["PageUp", "PgUp"],
        pageup: ["PageUp", "PgUp"],
        pgdn: ["PageDown", "PgDn"],
        pagedown: ["PageDown", "PgDn"],
        up: ["ArrowUp", "Up"],
        down: ["ArrowDown", "Down"],
        left: ["ArrowLeft", "Left"],
        right: ["ArrowRight", "Right"],
        prtsc: ["PrintScreen", "PrtSc"],
        printscreen: ["PrintScreen", "PrtSc"],
        // Linux 的 Magic SysRq 就是 Alt+PrintScreen，键码相同
        sysrq: ["PrintScreen", "SysRq"],
        pause: ["Pause", "Pause"],
        break: ["Pause", "Break"],
        capslock: ["CapsLock", "CapsLock"],
        numlock: ["NumLock", "NumLock"],
        scrolllock: ["ScrollLock", "ScrollLock"],
        menu: ["ContextMenu", "Menu"],
        "-": ["Minus", "-"],
        "=": ["Equal", "="],
        "[": ["BracketLeft", "["],
        "]": ["BracketRight", "]"],
        "\\": ["Backslash", "\\"],
        ";": ["Semicolon", ";"],
        "'": ["Quote", "'"],
        ",": ["Comma", ","],
        ".": ["Period", "."],
        "/": ["Slash", "/"],
        "`": ["Backquote", "`"]
    };

    // 一份 HID 报告最多带 6 个普通键
    var MAX_KEYS = 6;
    var MAX_STEPS = 16;
    var MAX_CUSTOM = 30;
    var MAX_LABEL_LENGTH = 20;
    var STORAGE_KEY = "chrome-kvm-shortcuts";
    // 开机连按：BIOS 只在自检那一两秒里认热键，按早了按晚了都会错过，所以
    // 从开机前就开始每 0.2 秒按一次。60 秒足够走完自检，忘了停也不会一直按下去
    var REPEAT_INTERVAL_MS = 200;
    var REPEAT_MAX_MS = 60000;

    function resolveToken(token) {
        var lower = token.toLowerCase();
        if (MODIFIERS[lower]) {
            return {code: MODIFIERS[lower][0], name: MODIFIERS[lower][1], modifier: true};
        }
        if (KEYS[lower]) {
            return {code: KEYS[lower][0], name: KEYS[lower][1], modifier: false};
        }
        if (/^[a-z]$/.test(lower)) {
            return {code: "Key" + lower.toUpperCase(), name: lower.toUpperCase(), modifier: false};
        }
        if (/^[0-9]$/.test(lower)) {
            return {code: "Digit" + lower, name: lower, modifier: false};
        }
        var f = /^f([1-9]|1[0-2])$/.exec(lower);
        if (f) {
            return {code: "F" + f[1], name: "F" + f[1], modifier: false};
        }
        return null;
    }

    // "Ctrl+Alt+F2" -> {codes: ["ControlLeft", "AltLeft", "F2"], text: "Ctrl+Alt+F2"}
    // 单独一个修饰键也合法：只按 Win 是打开开始菜单
    function parseCombo(text) {
        var raw = String(text == null ? "" : text).trim();
        if (!raw) {
            return {error: "组合键是空的"};
        }
        var tokens = raw.split("+").map(function (part) {
            return part.trim();
        });
        if (tokens.some(function (part) { return !part; })) {
            return {error: "「" + raw + "」里有多余的 +"};
        }
        var modifiers = [];
        var keys = [];
        for (var i = 0; i < tokens.length; i++) {
            var key = resolveToken(tokens[i]);
            if (!key) {
                return {error: "不认识的按键「" + tokens[i] + "」"};
            }
            var bucket = key.modifier ? modifiers : keys;
            var seen = bucket.some(function (item) { return item.code === key.code; });
            if (!seen) {
                bucket.push(key);
            }
        }
        if (keys.length > MAX_KEYS) {
            return {error: "一次最多同时按 " + MAX_KEYS + " 个普通键"};
        }
        // 修饰键排在前面：发送时要先按住修饰键，再按普通键
        var all = modifiers.concat(keys);
        return {
            codes: all.map(function (item) { return item.code; }),
            text: all.map(function (item) { return item.name; }).join("+")
        };
    }

    // 多步序列用空格或逗号隔开："Ctrl+K Ctrl+C"、"Win+R, Enter"
    function parseSequence(text) {
        var raw = String(text == null ? "" : text).trim();
        if (!raw) {
            return {error: "快捷键是空的"};
        }
        var parts = raw.split(/[\s,，]+/).filter(Boolean);
        if (parts.length > MAX_STEPS) {
            return {error: "一个快捷键最多 " + MAX_STEPS + " 步"};
        }
        var steps = [];
        var texts = [];
        for (var i = 0; i < parts.length; i++) {
            var combo = parseCombo(parts[i]);
            if (combo.error) {
                return {error: combo.error};
            }
            steps.push(combo.codes);
            texts.push(combo.text);
        }
        return {steps: steps, text: texts.join(" ")};
    }

    // repeatable：开机时要连按的键，面板里打开「连按」后这一组会反复按
    var PRESETS = [
        {
            title: "Windows",
            items: [
                {label: "开始菜单", combo: "Win"},
                {label: "锁屏", combo: "Win+L"},
                {label: "显示桌面", combo: "Win+D"},
                {label: "运行", combo: "Win+R"},
                {label: "资源管理器", combo: "Win+E"},
                {label: "任务管理器", combo: "Ctrl+Shift+Esc"},
                {label: "切换窗口", combo: "Alt+Tab"},
                {label: "关闭窗口", combo: "Alt+F4"},
                {label: "截图工具", combo: "Win+Shift+S"}
            ]
        },
        {
            title: "macOS",
            items: [
                {label: "聚焦搜索", combo: "Cmd+Space"},
                {label: "切换应用", combo: "Cmd+Tab"},
                {label: "退出应用", combo: "Cmd+Q"},
                {label: "强制退出", combo: "Cmd+Option+Esc"},
                {label: "锁屏", combo: "Ctrl+Cmd+Q"}
            ]
        },
        {
            title: "Linux",
            items: [
                {label: "终端", combo: "Ctrl+Alt+T"},
                {label: "TTY1", combo: "Ctrl+Alt+F1"},
                {label: "TTY2", combo: "Ctrl+Alt+F2"},
                {label: "TTY3", combo: "Ctrl+Alt+F3"},
                {label: "TTY4", combo: "Ctrl+Alt+F4"},
                {label: "TTY5", combo: "Ctrl+Alt+F5"},
                {label: "TTY6", combo: "Ctrl+Alt+F6"},
                {label: "TTY7", combo: "Ctrl+Alt+F7"}
            ]
        },
        {
            title: "开机 / BIOS",
            repeatable: true,
            items: [
                {label: "进 BIOS（台式机）", combo: "Del"},
                {label: "进 BIOS（笔记本）", combo: "F2"},
                {label: "启动菜单", combo: "F12"},
                {label: "启动菜单", combo: "F11"},
                {label: "启动菜单", combo: "F8"},
                {label: "退出 / 返回", combo: "Esc"}
            ]
        },
        {
            title: "其他",
            items: [
                {label: "全屏截图", combo: "PrtSc"},
                {label: "暂停", combo: "Pause"},
                {label: "滚动锁定", combo: "ScrollLock"},
                {label: "数字锁定", combo: "NumLock"},
                {label: "右键菜单", combo: "Menu"}
            ]
        }
    ];

    function normalizeLabel(label, fallback) {
        var text = String(label == null ? "" : label).trim();
        if (!text) {
            return fallback;
        }
        return Array.from(text).slice(0, MAX_LABEL_LENGTH).join("");
    }

    // 校验一条自定义快捷键，返回规范化后的 {label, combo} 或 {error}
    function makeCustom(label, combo) {
        var parsed = parseSequence(combo);
        if (parsed.error) {
            return {error: parsed.error};
        }
        return {label: normalizeLabel(label, parsed.text), combo: parsed.text};
    }

    // 存储里的东西可能是旧版本或手改坏的，读出来时丢掉坏条目而不是整个报错
    function normalizeCustomList(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < list.length && result.length < MAX_CUSTOM; i++) {
            var item = list[i];
            if (!item || typeof item !== "object") {
                continue;
            }
            var custom = makeCustom(item.label, item.combo);
            if (!custom.error) {
                result.push(custom);
            }
        }
        return result;
    }

    function loadCustom(storage) {
        try {
            var raw = storage && storage.getItem(STORAGE_KEY);
            return raw ? normalizeCustomList(JSON.parse(raw)) : [];
        } catch (e) {
            return [];
        }
    }

    function saveCustom(storage, list) {
        var normalized = normalizeCustomList(list);
        storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    return {
        MAX_KEYS: MAX_KEYS,
        MAX_STEPS: MAX_STEPS,
        MAX_CUSTOM: MAX_CUSTOM,
        MAX_LABEL_LENGTH: MAX_LABEL_LENGTH,
        STORAGE_KEY: STORAGE_KEY,
        REPEAT_INTERVAL_MS: REPEAT_INTERVAL_MS,
        REPEAT_MAX_MS: REPEAT_MAX_MS,
        PRESETS: PRESETS,
        parseCombo: parseCombo,
        parseSequence: parseSequence,
        makeCustom: makeCustom,
        normalizeCustomList: normalizeCustomList,
        loadCustom: loadCustom,
        saveCustom: saveCustom
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = Shortcuts;
}
