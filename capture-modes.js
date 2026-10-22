// 采集卡原生支持哪些分辨率。浏览器只给得出宽高的上限，要知道具体档位只能逐个试：
// 禁止浏览器缩放（resizeMode: none）后精确要某个尺寸，成功就是卡本身能出的。
// 采集卡正被别的页面用着时，要换格式的档位会失败、小的又会假成功，所以结果按设备缓存，
// 由用户在关掉控制页后手动重测
var CaptureModes = (function () {
    var STORAGE_KEY = "chrome-kvm-capture-modes";
    var HIGH_FRAME_RATE = 60;

    function parseSize(value) {
        var match = /^(\d+)x(\d+)$/.exec(String(value || ""));
        if (!match) {
            return null;
        }
        var size = {width: parseInt(match[1], 10), height: parseInt(match[2], 10)};
        return size.width > 0 && size.height > 0 ? size : null;
    }

    function exact(size, frameRate) {
        var constraints = {width: {exact: size.width}, height: {exact: size.height}, resizeMode: "none"};
        if (frameRate) {
            constraints.frameRate = {exact: frameRate};
        }
        return constraints;
    }

    async function probe(track, sizes) {
        var modes = [];
        for (var i = 0; i < sizes.length; i++) {
            var size = parseSize(sizes[i]);
            if (!size) {
                continue;
            }
            try {
                await track.applyConstraints(exact(size));
                modes.push(sizes[i]);
            } catch (e) {
                // 不支持这个档位，接着试下一个
            }
        }
        if (!modes.length) {
            return {modes: modes, max: null};
        }
        // 列表从大到小排，第一个就是最大的
        var biggest = parseSize(modes[0]);
        var frameRate;
        try {
            await track.applyConstraints(exact(biggest, HIGH_FRAME_RATE));
            frameRate = HIGH_FRAME_RATE;
        } catch (e) {
            await track.applyConstraints(exact(biggest)).catch(function () {});
            frameRate = Math.round(track.getSettings().frameRate || 0) || null;
        }
        return {modes: modes, max: {size: modes[0], frameRate: frameRate}};
    }

    // Chrome 挑档位用的「适合度距离」：宽、高各自的相对差加起来，越小越接近
    function distance(want, have) {
        return Math.abs(have.width - want.width) / Math.max(have.width, want.width)
            + Math.abs(have.height - want.height) / Math.max(have.height, want.height);
    }

    // 在这张卡上选这个分辨率会怎样：原生、由浏览器从更大的档位缩出来、或者退回最接近的档位。
    // 没检测过返回 null
    function outcome(value, modes) {
        var want = parseSize(value);
        if (!want || !modes || !modes.length) {
            return null;
        }
        if (modes.indexOf(value) !== -1) {
            return {kind: "native"};
        }
        var sizes = modes.map(parseSize).filter(Boolean);
        var covers = sizes.some(function (size) {
            return size.width >= want.width && size.height >= want.height;
        });
        if (covers) {
            return {kind: "scaled"};
        }
        var best = null;
        sizes.forEach(function (size) {
            if (!best || distance(want, size) < distance(want, best)) {
                best = size;
            }
        });
        return {kind: "fallback", size: best.width + "x" + best.height};
    }

    function readAll(storage) {
        try {
            var raw = storage && storage.getItem(STORAGE_KEY);
            var all = raw ? JSON.parse(raw) : {};
            return all && typeof all === "object" ? all : {};
        } catch (e) {
            return {};
        }
    }

    function load(storage, deviceId) {
        var entry = readAll(storage)[deviceId];
        return entry && Array.isArray(entry.modes) ? entry : null;
    }

    function save(storage, deviceId, result) {
        var all = readAll(storage);
        all[deviceId] = result;
        storage.setItem(STORAGE_KEY, JSON.stringify(all));
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        parseSize: parseSize,
        probe: probe,
        outcome: outcome,
        load: load,
        save: save
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = CaptureModes;
}
