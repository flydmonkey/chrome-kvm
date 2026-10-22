const test = require("node:test");
const assert = require("node:assert");
const CaptureModes = require("../capture-modes.js");

// 实测 MS2109 的原生档位
const MS2109 = ["1920x1080", "1680x1050", "1600x1200", "1600x900", "1440x1050", "1440x900", "1366x768",
    "1360x768", "1280x1024", "1280x960", "1280x800", "1280x720", "1024x768", "800x600", "720x576",
    "720x480", "640x480"];

function memoryStorage() {
    const data = {};
    return {
        getItem: (key) => (key in data ? data[key] : null),
        setItem: (key, value) => {
            data[key] = String(value);
        }
    };
}

// 只认 native 里的尺寸，和真卡一样，不支持的抛 OverconstrainedError
function fakeTrack(native) {
    return {
        async applyConstraints(c) {
            assert.strictEqual(c.resizeMode, "none");
            if (native.indexOf(c.width.exact + "x" + c.height.exact) === -1) {
                const error = new Error("over");
                error.name = "OverconstrainedError";
                throw error;
            }
        }
    };
}

// 每 interval 毫秒来一帧，到 stopAt 毫秒之后不再来（模拟页面切到后台）
function fakeVideo(interval, stopAt) {
    let now = 1000;
    return {
        requestVideoFrameCallback(callback) {
            now += interval;
            if (stopAt === undefined || now - 1000 <= stopAt) {
                setImmediate(() => callback(now));
            }
        }
    };
}

test("解析分辨率", () => {
    assert.deepStrictEqual(CaptureModes.parseSize("1920x1080"), {width: 1920, height: 1080});
    assert.strictEqual(CaptureModes.parseSize("1920"), null);
    assert.strictEqual(CaptureModes.parseSize("0x0"), null);
    assert.strictEqual(CaptureModes.parseSize(null), null);
});

test("逐个试出原生档位", async () => {
    const result = await CaptureModes.probe(fakeTrack(MS2109), ["3840x2160", "1920x1200", "1920x1080", "1280x720", "640x480"]);
    assert.deepStrictEqual(result, {modes: ["1920x1080", "1280x720", "640x480"], max: {size: "1920x1080"}});
});

test("一个都不支持时 max 为 null", async () => {
    const result = await CaptureModes.probe(fakeTrack([]), ["1920x1080"]);
    assert.deepStrictEqual(result, {modes: [], max: null});
});

test("数帧：跳过开头再数，按实际间隔算出帧率", async () => {
    assert.strictEqual(await CaptureModes.countFrames(fakeVideo(1000 / 30), 500, 1500), 30);
    assert.strictEqual(await CaptureModes.countFrames(fakeVideo(1000 / 60), 500, 1500), 60);
});

test("数帧：帧停了（页面在后台）就返回 null", async () => {
    assert.strictEqual(await CaptureModes.countFrames(fakeVideo(10, 40), 20, 50), null);
});

test("帧率：实测明显不到要的才标出来", () => {
    const result = {modes: ["1920x1080", "1280x720"], measured: {"1920x1080@60": 30, "1280x720@60": 55}};
    assert.deepStrictEqual(CaptureModes.frameRateOutcome("1920x1080", 60, result), {frameRate: 30});
    // 数帧有误差，55 算够 60
    assert.strictEqual(CaptureModes.frameRateOutcome("1280x720", 60, result), null);
    assert.strictEqual(CaptureModes.frameRateOutcome("1920x1080", 30, result), null);
});

test("帧率：没测过的、没检测过的都不下结论", () => {
    assert.strictEqual(CaptureModes.frameRateOutcome("1920x1080", 60, {modes: ["1920x1080"]}), null);
    assert.strictEqual(CaptureModes.frameRateOutcome("1920x1080", 60, null), null);
});

test("原生支持的就是原生", () => {
    assert.deepStrictEqual(CaptureModes.outcome("1920x1080", MS2109), {kind: "native"});
});

// 和 Chrome 实测一致：MS2109 上要这些都拿到 1920x1080
test("比原生档位都大的，退回最接近的那个", () => {
    for (const size of ["3840x2160", "2880x1864", "2560x1664", "2560x1440", "1920x1200"]) {
        assert.deepStrictEqual(CaptureModes.outcome(size, MS2109), {kind: "fallback", size: "1920x1080"}, size);
    }
});

test("比某个原生档位小的，浏览器缩放出来", () => {
    assert.deepStrictEqual(CaptureModes.outcome("1280x800", ["1920x1080", "1280x720"]), {kind: "scaled"});
});

test("没检测过就不下结论", () => {
    assert.strictEqual(CaptureModes.outcome("1920x1080", []), null);
    assert.strictEqual(CaptureModes.outcome("1920x1080", null), null);
});

test("按设备存取检测结果，坏数据当没检测过", () => {
    const storage = memoryStorage();
    const result = {modes: ["1920x1080"], max: {size: "1920x1080"}, measured: {"1920x1080@60": 30}};
    CaptureModes.save(storage, "cam-a", result);
    assert.deepStrictEqual(CaptureModes.load(storage, "cam-a"), result);
    assert.strictEqual(CaptureModes.load(storage, "cam-b"), null);
    storage.setItem(CaptureModes.STORAGE_KEY, "{oops");
    assert.strictEqual(CaptureModes.load(storage, "cam-a"), null);
    assert.strictEqual(CaptureModes.load(null, "cam-a"), null);
});
