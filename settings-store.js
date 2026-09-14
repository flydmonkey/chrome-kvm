// 配置的唯一入口。两个页面都靠它读写 localStorage，免得各自重复一份
// 解析、迁移和错误处理——之前 migrateSettings 就在两个页面里各有一份拷贝。
var SettingsStore = (function () {
    var KEY = "settings";
    var storage = null;
    var storageResolved = false;

    function currentStorage() {
        if (!storageResolved) {
            storage = (typeof window !== "undefined" && window.localStorage) ? window.localStorage : null;
            storageResolved = true;
        }
        return storage;
    }

    // 测试用的注入口：node 下没有 localStorage
    function useStorage(next) {
        storage = next;
        storageResolved = true;
    }

    // 旧版「绝对模式」实际写入的是 relative；没有版本号的配置迁回 absolute。
    // 已经是 absolute 的（含修复后重存的）保持不变。
    function migrate(settings) {
        if (!settings) {
            return settings;
        }
        if (!settings.mouseModeVersion) {
            if (settings.mouseClickMode !== "absolute") {
                settings.mouseClickMode = "absolute";
            }
            settings.mouseModeVersion = 1;
            write(settings);
        }
        return settings;
    }

    // 从没保存过返回 null，这和「保存过但是空对象」要区分开：
    // 控制页靠它判断要不要跳去设置页
    function read() {
        var store = currentStorage();
        if (!store) {
            return null;
        }
        var raw = null;
        try {
            raw = store.getItem(KEY);
        } catch (e) {
            return null;
        }
        if (!raw) {
            return null;
        }
        try {
            return migrate(JSON.parse(raw));
        } catch (e) {
            console.warn("配置解析失败，当作没有配置处理", e);
            return null;
        }
    }

    // 只想读几个字段、不关心有没有存过的场景用这个
    function readOrEmpty() {
        return read() || {};
    }

    function write(settings) {
        var store = currentStorage();
        if (!store) {
            return false;
        }
        try {
            store.setItem(KEY, JSON.stringify(settings));
            return true;
        } catch (e) {
            console.warn("配置写入失败", e);
            return false;
        }
    }

    // 只改个别字段，值没变就不写，避免无意义的 storage 事件
    function patch(changes) {
        var settings = readOrEmpty();
        var changed = false;
        for (var key in changes) {
            if (Object.prototype.hasOwnProperty.call(changes, key) && settings[key] !== changes[key]) {
                settings[key] = changes[key];
                changed = true;
            }
        }
        if (!changed) {
            return false;
        }
        return write(settings);
    }

    // 串口设备在配置里存的是 {usbVendorId, usbProductId}，历史上既有对象也有 JSON 字符串
    function parseUsbFilter(deviceId) {
        if (!deviceId) {
            return null;
        }
        if (typeof deviceId === "object") {
            return deviceId;
        }
        try {
            return JSON.parse(deviceId);
        } catch (e) {
            return null;
        }
    }

    function savedUsbFilter(settings) {
        if (!settings || !settings.usb) {
            return null;
        }
        return parseUsbFilter(settings.usb.deviceId);
    }

    function hasUsableFilter(filter) {
        return !!filter && (filter.usbVendorId != null || filter.usbProductId != null);
    }

    // 筛选条件里为 null 的字段当通配处理。
    // 同一颗 CH340 插到另一个 USB 口就是另一个端口对象，而 Chrome 还可能同时
    // 列出已经不在位的旧授权——两者 VID/PID 完全一样。只认第一个的话，一旦
    // 它正好是那个开不了的，用户就永远连不上，所以把匹配项全给出来逐个试。
    function matchPorts(ports, filter) {
        var hits = [];
        if (!ports || !hasUsableFilter(filter)) {
            return hits;
        }
        for (var i = 0; i < ports.length; i++) {
            var info = ports[i].getInfo();
            var vendorOk = filter.usbVendorId == null || info.usbVendorId === filter.usbVendorId;
            var productOk = filter.usbProductId == null || info.usbProductId === filter.usbProductId;
            if (vendorOk && productOk) {
                hits.push(ports[i]);
            }
        }
        return hits;
    }

    function matchPort(ports, filter) {
        var hits = matchPorts(ports, filter);
        return hits.length ? hits[0] : null;
    }

    function pickSerialPorts(ports, deviceId) {
        if (!ports || ports.length === 0) {
            return [];
        }
        var filter = parseUsbFilter(deviceId);
        if (!hasUsableFilter(filter)) {
            // 没有可用的筛选条件时只在唯一端口下自动选，否则宁可报错也不要开错设备
            return ports.length === 1 ? [ports[0]] : [];
        }
        return matchPorts(ports, filter);
    }

    function pickSerialPort(ports, deviceId) {
        var hits = pickSerialPorts(ports, deviceId);
        return hits.length ? hits[0] : null;
    }

    // 相对模式灵敏度会直接乘进鼠标位移，脏值（0、负数、NaN、离谱的大数）会让
    // 鼠标不动、反向或者一下飞出屏幕。localStorage 是用户能手改的，所以读出来
    // 就夹好，别让坏数据有机会传到发包那一层
    var RELATIVE_SPEED_MIN = 0.1;
    var RELATIVE_SPEED_MAX = 10;

    function normalizeRelativeSpeed(value) {
        var n = typeof value === "number" ? value : parseFloat(value);
        if (!isFinite(n) || n <= 0) {
            return 1;
        }
        return Math.min(Math.max(n, RELATIVE_SPEED_MIN), RELATIVE_SPEED_MAX);
    }

    // 上次用过的波特率排最前，这样正常情况下第一次就能连上
    function baudRateOrder(saved, available) {
        var list = (available || []).slice();
        var at = list.indexOf(saved);
        if (saved && at !== -1) {
            list.splice(at, 1);
            list.unshift(saved);
        }
        return list;
    }

    return {
        KEY: KEY,
        useStorage: useStorage,
        migrate: migrate,
        read: read,
        readOrEmpty: readOrEmpty,
        write: write,
        patch: patch,
        parseUsbFilter: parseUsbFilter,
        savedUsbFilter: savedUsbFilter,
        matchPort: matchPort,
        matchPorts: matchPorts,
        pickSerialPort: pickSerialPort,
        pickSerialPorts: pickSerialPorts,
        baudRateOrder: baudRateOrder,
        normalizeRelativeSpeed: normalizeRelativeSpeed,
        RELATIVE_SPEED_MIN: RELATIVE_SPEED_MIN,
        RELATIVE_SPEED_MAX: RELATIVE_SPEED_MAX
    };
})();

// 浏览器里靠 <script> 全局引入；这里只是让 node 下的测试能 require
if (typeof module !== "undefined" && module.exports) {
    module.exports = SettingsStore;
}
