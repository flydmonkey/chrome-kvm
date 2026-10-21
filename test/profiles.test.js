const test = require("node:test");
const assert = require("node:assert");
const Profiles = require("../profiles.js");

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

const officePc = {
    video: {deviceId: "cam-a", label: "USB Video A"},
    audio: {deviceId: "mic-a", label: "USB Audio A"},
    usb: {deviceId: "{\"usbVendorId\":6790,\"usbProductId\":29987}", label: "WCH CH340"},
    resolution: {width: 1920, height: 1080},
    frameRate: 60,
    mouseClickMode: "absolute",
    relativeSpeed: 1,
    atx: {deviceId: "{\"usbVendorId\":6790,\"usbProductId\":29987}", label: "LCUS", channel: 1},
    baudRate: 115200,
    workingMode: 2,
    mouseModeVersion: 1
};

const server = Object.assign({}, officePc, {
    video: {deviceId: "cam-b", label: "USB Video B"},
    resolution: {width: 1024, height: 768},
    frameRate: 0,
    mouseClickMode: "relative",
    relativeSpeed: 2
});

test("配置快照", async (t) => {
    await t.test("只留跟着被控机走的字段，芯片状态不存", () => {
        const snap = Profiles.snapshot(officePc);
        assert.deepStrictEqual(Object.keys(snap).sort(), Profiles.FIELDS.slice().sort());
        assert.strictEqual(snap.baudRate, undefined);
        assert.strictEqual(snap.workingMode, undefined);
    });

    await t.test("是深拷贝，之后改原设置不影响快照", () => {
        const settings = JSON.parse(JSON.stringify(officePc));
        const snap = Profiles.snapshot(settings);
        settings.resolution.width = 800;
        assert.strictEqual(snap.resolution.width, 1920);
    });

    await t.test("缺的字段不补", () => {
        assert.deepStrictEqual(Profiles.snapshot({mouseClickMode: "relative"}), {mouseClickMode: "relative"});
        assert.deepStrictEqual(Profiles.snapshot(null), {});
    });
});

test("另存为、切换、删除", async (t) => {
    await t.test("另存为后成为当前配置", () => {
        const result = Profiles.saveAs(null, "  办公室电脑 ", officePc);
        assert.strictEqual(result.state.active, "办公室电脑");
        assert.strictEqual(result.state.profiles.length, 1);
        assert.deepStrictEqual(result.state.profiles[0].settings, Profiles.snapshot(officePc));
    });

    await t.test("同名覆盖，不会多出一份", () => {
        let state = Profiles.saveAs(null, "服务器", officePc).state;
        state = Profiles.saveAs(state, "服务器", server).state;
        assert.strictEqual(state.profiles.length, 1);
        assert.strictEqual(state.profiles[0].settings.mouseClickMode, "relative");
    });

    await t.test("名字为空或太长", () => {
        assert.ok(Profiles.saveAs(null, "   ", officePc).error);
        const long = "机".repeat(Profiles.MAX_NAME_LENGTH + 3);
        assert.strictEqual(Profiles.saveAs(null, long, officePc).state.active.length, Profiles.MAX_NAME_LENGTH);
    });

    await t.test("份数有上限，但覆盖已有的不受限", () => {
        let state = null;
        for (let i = 0; i < Profiles.MAX_PROFILES; i++) {
            state = Profiles.saveAs(state, "机器" + i, officePc).state;
        }
        assert.ok(Profiles.saveAs(state, "再来一台", officePc).error);
        assert.ok(Profiles.saveAs(state, "机器0", server).state);
    });

    await t.test("切换时合并：配置里的字段覆盖，波特率和工作模式沿用当前值", () => {
        let state = Profiles.saveAs(null, "办公室电脑", officePc).state;
        state = Profiles.saveAs(state, "服务器", server).state;
        const current = Object.assign({}, officePc, {baudRate: 921600, workingMode: 0});
        const result = Profiles.apply(state, "服务器", current);
        assert.strictEqual(result.state.active, "服务器");
        assert.strictEqual(result.settings.video.deviceId, "cam-b");
        assert.strictEqual(result.settings.mouseClickMode, "relative");
        assert.strictEqual(result.settings.baudRate, 921600);
        assert.strictEqual(result.settings.workingMode, 0);
        assert.strictEqual(result.settings.mouseModeVersion, 1);
    });

    await t.test("继电器跟着配置走，旧配置里没有就清空而不是沿用", () => {
        let state = Profiles.saveAs(null, "办公室电脑", officePc).state;
        const legacy = Object.assign({}, server);
        delete legacy.atx;
        state = Profiles.saveAs(state, "服务器", legacy).state;
        assert.strictEqual(Profiles.apply(state, "服务器", officePc).settings.atx, null);
        assert.strictEqual(Profiles.apply(state, "办公室电脑", legacy).settings.atx.label, "LCUS");
    });

    await t.test("切到不存在的配置报错", () => {
        assert.match(Profiles.apply(null, "不存在", officePc).error, /不存在/);
    });

    await t.test("删除当前配置后没有当前配置", () => {
        let state = Profiles.saveAs(null, "办公室电脑", officePc).state;
        state = Profiles.saveAs(state, "服务器", server).state;
        state = Profiles.remove(state, "服务器");
        assert.strictEqual(state.active, null);
        assert.deepStrictEqual(state.profiles.map(function (p) { return p.name; }), ["办公室电脑"]);
        assert.strictEqual(Profiles.remove(state, "没有这个").profiles.length, 1);
    });

    await t.test("保存设置时同步进当前配置；没有当前配置时什么都不改", () => {
        let state = Profiles.saveAs(null, "办公室电脑", officePc).state;
        const changed = Object.assign({}, officePc, {resolution: {width: 2560, height: 1440}});
        state = Profiles.updateActive(state, changed);
        assert.deepStrictEqual(state.profiles[0].settings.resolution, {width: 2560, height: 1440});

        const inactive = Object.assign({}, state, {active: null});
        assert.deepStrictEqual(Profiles.updateActive(inactive, server).profiles[0].settings.resolution,
            {width: 2560, height: 1440});
    });

    await t.test("不会改到传进来的旧状态", () => {
        const state = Profiles.saveAs(null, "办公室电脑", officePc).state;
        Profiles.saveAs(state, "服务器", server);
        Profiles.remove(state, "办公室电脑");
        assert.strictEqual(state.profiles.length, 1);
        assert.strictEqual(state.active, "办公室电脑");
    });
});

test("配置摘要", () => {
    assert.strictEqual(Profiles.summary(officePc), "1920×1080 · 绝对鼠标 · USB Video A");
    assert.strictEqual(Profiles.summary({mouseClickMode: "relative"}), "相对鼠标");
    assert.strictEqual(Profiles.summary(null), "绝对鼠标");
});

test("配置的存取", async (t) => {
    await t.test("存进去再读出来", () => {
        const storage = memoryStorage();
        const state = Profiles.saveAs(null, "办公室电脑", officePc).state;
        Profiles.save(storage, state);
        assert.deepStrictEqual(Profiles.load(storage), state);
    });

    await t.test("坏数据读成空", () => {
        const empty = {active: null, profiles: []};
        assert.deepStrictEqual(Profiles.load(memoryStorage()), empty);
        assert.deepStrictEqual(Profiles.load(memoryStorage({[Profiles.STORAGE_KEY]: "{broken"})), empty);
        assert.deepStrictEqual(Profiles.load(memoryStorage({[Profiles.STORAGE_KEY]: "[]"})), empty);
        assert.deepStrictEqual(Profiles.load(null), empty);
    });

    await t.test("丢掉坏条目和重名，active 指向不存在的配置时清空", () => {
        const state = Profiles.normalize({
            active: "鬼",
            profiles: [null, {name: ""}, {name: "A", settings: {frameRate: 30}}, {name: "A", settings: {}}, "x"]
        });
        assert.deepStrictEqual(state, {active: null, profiles: [{name: "A", settings: {frameRate: 30}}]});
    });
});
