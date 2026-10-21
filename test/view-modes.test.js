const test = require("node:test");
const assert = require("node:assert");
const ViewModes = require("../view-modes.js");

const viewport = {width: 1000, height: 500};
const video = {width: 1920, height: 1080};

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: function (key) {
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
        },
        setItem: function (key, value) {
            data[key] = String(value);
        }
    };
}

test("显示方式的尺寸", async (t) => {
    await t.test("适应窗口：铺满元素，交给 contain 等比留黑边", () => {
        assert.deepStrictEqual(ViewModes.layout("fit", viewport, video, 1),
            {objectFit: "contain", width: 1000, height: 500});
    });

    await t.test("拉伸填满：fill，不保持比例", () => {
        assert.deepStrictEqual(ViewModes.layout("fill", viewport, video, 1),
            {objectFit: "fill", width: 1000, height: 500});
    });

    await t.test("1:1 按设备像素比换算成 CSS 尺寸", () => {
        assert.deepStrictEqual(ViewModes.layout("native", viewport, video, 1),
            {objectFit: "fill", width: 1920, height: 1080});
        assert.deepStrictEqual(ViewModes.layout("native", viewport, video, 1.5),
            {objectFit: "fill", width: 1280, height: 720});
    });

    await t.test("放大以适应窗口的大小为基准", () => {
        // 适应窗口时受高度限制：500/1080，宽约 888.9；放大 2 倍
        const box = ViewModes.layout("zoom200", viewport, video, 1);
        assert.strictEqual(box.objectFit, "fill");
        assert.ok(Math.abs(box.height - 1000) < 1e-9);
        assert.ok(Math.abs(box.width - 1920 * 500 / 1080 * 2) < 1e-9);
    });

    await t.test("还没拿到画面尺寸时 1:1 和放大先按适应窗口摆", () => {
        const unknown = {width: 0, height: 0};
        assert.deepStrictEqual(ViewModes.layout("native", viewport, unknown, 1),
            {objectFit: "contain", width: 1000, height: 500});
        assert.deepStrictEqual(ViewModes.layout("zoom300", viewport, null, 1),
            {objectFit: "contain", width: 1000, height: 500});
    });

    await t.test("不认识的方式按适应窗口处理", () => {
        assert.deepStrictEqual(ViewModes.layout("bogus", viewport, video, 1),
            ViewModes.layout("fit", viewport, video, 1));
    });
});

test("超出窗口时跟着指针平移", async (t) => {
    const box = {width: 2000, height: 1000};

    await t.test("指针在左上角看到画面左上角，右下角看到右下角", () => {
        assert.deepStrictEqual(ViewModes.panOffset(box, viewport, {x: 0, y: 0}), {left: -0, top: -0});
        assert.deepStrictEqual(ViewModes.panOffset(box, viewport, {x: 1000, y: 500}), {left: -1000, top: -500});
    });

    await t.test("指针下面正好是它在画面里对应的点，本机和被控端光标重合", () => {
        [{x: 0, y: 0}, {x: 250, y: 100}, {x: 731, y: 333}, {x: 1000, y: 500}].forEach(function (pointer) {
            const offset = ViewModes.panOffset(box, viewport, pointer);
            // 坐标换算：(clientX - left) / width
            const nx = (pointer.x - offset.left) / box.width;
            const ny = (pointer.y - offset.top) / box.height;
            assert.ok(Math.abs(nx - pointer.x / viewport.width) < 1e-9);
            assert.ok(Math.abs(ny - pointer.y / viewport.height) < 1e-9);
        });
    });

    await t.test("指针跑到窗口外时夹在边上", () => {
        assert.deepStrictEqual(ViewModes.panOffset(box, viewport, {x: -50, y: 900}), {left: -0, top: -500});
    });

    await t.test("比窗口小的方向居中，不跟指针", () => {
        const small = {width: 600, height: 1000};
        assert.deepStrictEqual(ViewModes.panOffset(small, viewport, {x: 0, y: 250}), {left: 200, top: -250});
    });

    await t.test("没有指针位置时居中", () => {
        assert.deepStrictEqual(ViewModes.panOffset(box, viewport, null), {left: -500, top: -250});
    });

    await t.test("只有超出窗口时才需要跟着指针重新摆", () => {
        assert.strictEqual(ViewModes.pans(box, viewport), true);
        assert.strictEqual(ViewModes.pans({width: 1000, height: 500}, viewport), false);
        assert.strictEqual(ViewModes.pans({width: 1000, height: 501}, viewport), true);
    });
});

test("显示方式的存取", async (t) => {
    await t.test("默认是适应窗口", () => {
        assert.strictEqual(ViewModes.load(memoryStorage()), "fit");
        assert.strictEqual(ViewModes.load(null), "fit");
    });

    await t.test("存进去再读出来", () => {
        const storage = memoryStorage();
        assert.strictEqual(ViewModes.save(storage, "zoom200"), "zoom200");
        assert.strictEqual(ViewModes.load(storage), "zoom200");
    });

    await t.test("存储里是坏值时退回默认", () => {
        assert.strictEqual(ViewModes.load(memoryStorage({[ViewModes.STORAGE_KEY]: "huge"})), "fit");
    });

    await t.test("每种方式都有名称和说明", () => {
        ViewModes.MODES.forEach(function (mode) {
            assert.ok(mode.label && mode.hint, mode.id);
            assert.strictEqual(ViewModes.label(mode.id), mode.label);
        });
    });
});
