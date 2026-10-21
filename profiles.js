// 被控机配置：一台 KVM 接多台机器（或配 HDMI/USB 切换器）时，每台机器的采集卡、
// 串口、分辨率、鼠标模式往往不一样，存成几份配置一键切换。
// 只存「跟着被控机走」的字段。波特率和芯片工作模式记的是 CH9329 芯片自己的状态，
// 和切到哪台机器无关，切换时保持当前值不动
var Profiles = (function () {
    var STORAGE_KEY = "chrome-kvm-profiles";
    var MAX_PROFILES = 20;
    var MAX_NAME_LENGTH = 20;
    var FIELDS = ["video", "audio", "usb", "resolution", "frameRate", "mouseClickMode", "relativeSpeed"];

    function empty() {
        return {active: null, profiles: []};
    }

    function normalizeName(name) {
        var text = String(name == null ? "" : name).trim();
        return Array.from(text).slice(0, MAX_NAME_LENGTH).join("");
    }

    function snapshot(settings) {
        var result = {};
        if (!settings || typeof settings !== "object") {
            return result;
        }
        FIELDS.forEach(function (field) {
            if (settings[field] !== undefined) {
                // 深拷贝：存进去的是快照，之后改设置不能顺带改了它
                result[field] = JSON.parse(JSON.stringify(settings[field]));
            }
        });
        return result;
    }

    function indexOf(state, name) {
        for (var i = 0; i < state.profiles.length; i++) {
            if (state.profiles[i].name === name) {
                return i;
            }
        }
        return -1;
    }

    // 存储里的东西可能是手改坏的：丢掉坏条目和重名，active 指向不存在的配置时清空
    function normalize(raw) {
        var state = empty();
        if (!raw || typeof raw !== "object" || !Array.isArray(raw.profiles)) {
            return state;
        }
        for (var i = 0; i < raw.profiles.length && state.profiles.length < MAX_PROFILES; i++) {
            var item = raw.profiles[i];
            if (!item || typeof item !== "object") {
                continue;
            }
            var name = normalizeName(item.name);
            if (!name || indexOf(state, name) !== -1) {
                continue;
            }
            state.profiles.push({name: name, settings: snapshot(item.settings)});
        }
        var active = normalizeName(raw.active);
        state.active = active && indexOf(state, active) !== -1 ? active : null;
        return state;
    }

    function load(storage) {
        try {
            var raw = storage && storage.getItem(STORAGE_KEY);
            return raw ? normalize(JSON.parse(raw)) : empty();
        } catch (e) {
            return empty();
        }
    }

    function save(storage, state) {
        var normalized = normalize(state);
        storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    // 同名覆盖，新名字追加；存完这份就是当前配置
    function saveAs(state, name, settings) {
        var clean = normalizeName(name);
        if (!clean) {
            return {error: "配置名不能为空"};
        }
        var next = normalize(state);
        var at = indexOf(next, clean);
        if (at === -1) {
            if (next.profiles.length >= MAX_PROFILES) {
                return {error: "最多保存 " + MAX_PROFILES + " 份配置"};
            }
            next.profiles.push({name: clean, settings: snapshot(settings)});
        } else {
            next.profiles[at].settings = snapshot(settings);
        }
        next.active = clean;
        return {state: next};
    }

    function remove(state, name) {
        var next = normalize(state);
        var at = indexOf(next, name);
        if (at !== -1) {
            next.profiles.splice(at, 1);
        }
        if (next.active === name) {
            next.active = null;
        }
        return next;
    }

    // 切到某份配置：返回合并后的完整设置。配置里没有的字段（以及波特率、
    // 工作模式这些芯片状态）沿用当前设置
    function apply(state, name, current) {
        var next = normalize(state);
        var at = indexOf(next, name);
        if (at === -1) {
            return {error: "找不到配置「" + name + "」"};
        }
        var merged = Object.assign({}, current || {}, snapshot(next.profiles[at].settings));
        next.active = name;
        return {state: next, settings: merged};
    }

    // 在设置页点「保存」时，把改动同步进当前配置，免得切走再切回来又变回老样子
    function updateActive(state, settings) {
        var next = normalize(state);
        var at = next.active ? indexOf(next, next.active) : -1;
        if (at !== -1) {
            next.profiles[at].settings = snapshot(settings);
        }
        return next;
    }

    // 切换面板里每份配置下面那行小字，让人认得出是哪台
    function summary(settings) {
        var parts = [];
        settings = settings || {};
        if (settings.resolution && settings.resolution.width && settings.resolution.height) {
            parts.push(settings.resolution.width + "×" + settings.resolution.height);
        }
        parts.push(settings.mouseClickMode === "relative" ? "相对鼠标" : "绝对鼠标");
        if (settings.video && settings.video.label) {
            parts.push(settings.video.label);
        }
        return parts.join(" · ");
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        summary: summary,
        MAX_PROFILES: MAX_PROFILES,
        MAX_NAME_LENGTH: MAX_NAME_LENGTH,
        FIELDS: FIELDS,
        normalizeName: normalizeName,
        snapshot: snapshot,
        normalize: normalize,
        load: load,
        save: save,
        saveAs: saveAs,
        remove: remove,
        apply: apply,
        updateActive: updateActive
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = Profiles;
}
