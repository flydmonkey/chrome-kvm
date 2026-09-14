const test = require("node:test");
const assert = require("node:assert");

const SettingsStore = require("../settings-store.js");

// localStorage 的最小替身，顺便记下写了几次，好断言「值没变就不写」
function createFakeStorage(initial) {
    return {
        data: initial == null ? {} : Object.assign({}, initial),
        writes: 0,
        failOnWrite: false,
        failOnRead: false,
        getItem: function (key) {
            if (this.failOnRead) {
                throw new Error("读取被拒绝");
            }
            return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
        },
        setItem: function (key, value) {
            if (this.failOnWrite) {
                throw new Error("配额不足");
            }
            this.writes++;
            this.data[key] = value;
        }
    };
}

function useSettings(settings) {
    let storage = createFakeStorage(
        settings === undefined ? {} : {settings: JSON.stringify(settings)}
    );
    SettingsStore.useStorage(storage);
    return storage;
}

function stored(storage) {
    return JSON.parse(storage.data.settings);
}

// getInfo() 返回的形状就是 {usbVendorId, usbProductId}
function fakePort(usbVendorId, usbProductId) {
    return {
        getInfo: function () {
            return {usbVendorId: usbVendorId, usbProductId: usbProductId};
        }
    };
}

test("配置迁移", async (t) => {
    await t.test("空配置原样返回，不去写存储", () => {
        let storage = useSettings();
        assert.strictEqual(SettingsStore.migrate(null), null);
        assert.strictEqual(SettingsStore.migrate(undefined), undefined);
        assert.strictEqual(storage.writes, 0);
    });

    await t.test("没有版本号的配置迁回绝对模式并落盘", () => {
        let storage = useSettings();
        let result = SettingsStore.migrate({mouseClickMode: "relative"});
        assert.strictEqual(result.mouseClickMode, "absolute");
        assert.strictEqual(result.mouseModeVersion, 1);
        assert.strictEqual(storage.writes, 1);
        assert.strictEqual(stored(storage).mouseClickMode, "absolute");
    });

    await t.test("已有版本号的配置不动，包括显式选了相对模式的", () => {
        let storage = useSettings();
        let result = SettingsStore.migrate({mouseClickMode: "relative", mouseModeVersion: 1});
        assert.strictEqual(result.mouseClickMode, "relative");
        assert.strictEqual(storage.writes, 0);
    });
});

test("配置读写", async (t) => {
    await t.test("从没保存过返回 null，好让控制页跳去设置页", () => {
        useSettings();
        assert.strictEqual(SettingsStore.read(), null);
        assert.deepStrictEqual(SettingsStore.readOrEmpty(), {});
    });

    await t.test("存的内容不是合法 JSON 时当作没有配置，而不是抛异常", () => {
        let storage = createFakeStorage({settings: "{这不是 json"});
        SettingsStore.useStorage(storage);
        assert.strictEqual(SettingsStore.read(), null);
    });

    await t.test("读取时顺带完成迁移", () => {
        let storage = useSettings({mouseClickMode: "relative"});
        let settings = SettingsStore.read();
        assert.strictEqual(settings.mouseClickMode, "absolute");
        assert.strictEqual(stored(storage).mouseModeVersion, 1);
    });

    await t.test("存储读取抛异常时返回 null", () => {
        let storage = createFakeStorage({settings: "{}"});
        storage.failOnRead = true;
        SettingsStore.useStorage(storage);
        assert.strictEqual(SettingsStore.read(), null);
    });

    await t.test("写入失败返回 false，调用方才能提示用户", () => {
        let storage = useSettings({});
        storage.failOnWrite = true;
        assert.strictEqual(SettingsStore.write({baudRate: 115200}), false);
    });

    await t.test("没有 localStorage 时读写都不炸", () => {
        SettingsStore.useStorage(null);
        assert.strictEqual(SettingsStore.read(), null);
        assert.strictEqual(SettingsStore.write({}), false);
    });
});

test("局部更新", async (t) => {
    await t.test("改动的字段会写进去", () => {
        let storage = useSettings({baudRate: 9600, mouseModeVersion: 1});
        assert.strictEqual(SettingsStore.patch({baudRate: 115200}), true);
        assert.strictEqual(stored(storage).baudRate, 115200);
    });

    await t.test("值没变就不写", () => {
        let storage = useSettings({baudRate: 9600, mouseModeVersion: 1});
        let before = storage.writes;
        assert.strictEqual(SettingsStore.patch({baudRate: 9600}), false);
        assert.strictEqual(storage.writes, before);
    });

    await t.test("更新不会丢掉其它字段", () => {
        let storage = useSettings({
            video: {deviceId: "v1", label: "USB Video"},
            mouseModeVersion: 1
        });
        SettingsStore.patch({baudRate: 115200});
        let after = stored(storage);
        assert.strictEqual(after.video.deviceId, "v1");
        assert.strictEqual(after.baudRate, 115200);
    });
});

test("USB 筛选条件解析", async (t) => {
    await t.test("空值返回 null", () => {
        assert.strictEqual(SettingsStore.parseUsbFilter(null), null);
        assert.strictEqual(SettingsStore.parseUsbFilter(undefined), null);
        assert.strictEqual(SettingsStore.parseUsbFilter(""), null);
    });

    await t.test("对象原样返回", () => {
        let filter = {usbVendorId: 6790, usbProductId: 29987};
        assert.strictEqual(SettingsStore.parseUsbFilter(filter), filter);
    });

    await t.test("JSON 字符串会被解析，历史配置里存的就是字符串", () => {
        let parsed = SettingsStore.parseUsbFilter('{"usbVendorId":6790,"usbProductId":29987}');
        assert.deepStrictEqual(parsed, {usbVendorId: 6790, usbProductId: 29987});
    });

    await t.test("坏字符串返回 null 而不是抛异常", () => {
        assert.strictEqual(SettingsStore.parseUsbFilter("{坏的"), null);
    });

    await t.test("从配置里取筛选条件", () => {
        assert.strictEqual(SettingsStore.savedUsbFilter(null), null);
        assert.strictEqual(SettingsStore.savedUsbFilter({}), null);
        assert.strictEqual(SettingsStore.savedUsbFilter({usb: {}}), null);
        assert.deepStrictEqual(
            SettingsStore.savedUsbFilter({usb: {deviceId: '{"usbVendorId":6790}'}}),
            {usbVendorId: 6790}
        );
    });
});

test("串口端口匹配", async (t) => {
    let ch9329 = fakePort(6790, 29987);
    let other = fakePort(1234, 5678);

    await t.test("两个 id 都对上才算匹配", () => {
        let ports = [other, ch9329];
        let hit = SettingsStore.matchPort(ports, {usbVendorId: 6790, usbProductId: 29987});
        assert.strictEqual(hit, ch9329);
    });

    await t.test("筛选条件里缺的字段当通配", () => {
        let ports = [other, ch9329];
        assert.strictEqual(SettingsStore.matchPort(ports, {usbVendorId: 6790}), ch9329);
        assert.strictEqual(SettingsStore.matchPort(ports, {usbProductId: 29987}), ch9329);
    });

    await t.test("对不上返回 null", () => {
        assert.strictEqual(SettingsStore.matchPort([other], {usbVendorId: 6790, usbProductId: 29987}), null);
    });

    await t.test("筛选条件不可用时返回 null，不去猜", () => {
        assert.strictEqual(SettingsStore.matchPort([ch9329], null), null);
        assert.strictEqual(SettingsStore.matchPort([ch9329], {}), null);
        assert.strictEqual(SettingsStore.matchPort([ch9329], {usbVendorId: null, usbProductId: null}), null);
    });

    await t.test("没有端口返回 null", () => {
        assert.strictEqual(SettingsStore.pickSerialPort([], '{"usbVendorId":6790}'), null);
        assert.strictEqual(SettingsStore.pickSerialPort(null, '{"usbVendorId":6790}'), null);
    });

    await t.test("筛选条件不可用且只有一个端口时才自动选它", () => {
        assert.strictEqual(SettingsStore.pickSerialPort([ch9329], null), ch9329);
    });

    await t.test("筛选条件不可用且有多个端口时宁可不选，避免开错设备", () => {
        assert.strictEqual(SettingsStore.pickSerialPort([ch9329, other], null), null);
    });

    await t.test("有筛选条件时按条件挑，不受端口数量影响", () => {
        let picked = SettingsStore.pickSerialPort([other, ch9329], '{"usbVendorId":6790,"usbProductId":29987}');
        assert.strictEqual(picked, ch9329);
    });

    await t.test("有筛选条件但一个都对不上时返回 null，不退化成第一个", () => {
        assert.strictEqual(SettingsStore.pickSerialPort([other], '{"usbVendorId":6790,"usbProductId":29987}'), null);
    });
});

test("同一 VID/PID 有多个端口时要全部给出", async (t) => {
    // 换个 USB 口就是另一个端口对象，Chrome 也可能还留着已失效的旧授权，
    // 两者 VID/PID 一模一样。只返回第一个的话，撞上开不了的那个就彻底连不上。
    let first = fakePort(6790, 29987);
    let second = fakePort(6790, 29987);
    let other = fakePort(1234, 5678);

    await t.test("匹配项按原顺序全部返回", () => {
        let hits = SettingsStore.matchPorts([other, first, second], {usbVendorId: 6790, usbProductId: 29987});
        assert.deepStrictEqual(hits, [first, second]);
    });

    await t.test("一个都对不上时返回空数组而不是 null", () => {
        assert.deepStrictEqual(SettingsStore.matchPorts([other], {usbVendorId: 6790}), []);
    });

    await t.test("筛选条件不可用时返回空数组", () => {
        assert.deepStrictEqual(SettingsStore.matchPorts([first], null), []);
        assert.deepStrictEqual(SettingsStore.matchPorts([first], {}), []);
    });

    await t.test("pickSerialPorts 同样给出全部候选", () => {
        let hits = SettingsStore.pickSerialPorts([other, first, second], '{"usbVendorId":6790,"usbProductId":29987}');
        assert.deepStrictEqual(hits, [first, second]);
    });

    await t.test("没有筛选条件且端口唯一时给出那一个", () => {
        assert.deepStrictEqual(SettingsStore.pickSerialPorts([first], null), [first]);
    });

    await t.test("没有筛选条件且端口不唯一时一个都不给", () => {
        assert.deepStrictEqual(SettingsStore.pickSerialPorts([first, other], null), []);
    });

    await t.test("matchPort 仍然返回第一个匹配项，设置页依赖它", () => {
        assert.strictEqual(SettingsStore.matchPort([other, first, second], {usbVendorId: 6790}), first);
    });
});

test("相对模式灵敏度", async (t) => {
    // 这个值会直接乘进鼠标位移，坏值不是显示问题而是鼠标彻底不能用
    await t.test("没存过就是 1", () => {
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(undefined), 1);
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(null), 1);
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(""), 1);
    });

    await t.test("正常值原样通过", () => {
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(1.8), 1.8);
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed("1.8"), 1.8);
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(0.5), 0.5);
    });

    await t.test("0 和负数会让鼠标不动或反向，退回 1", () => {
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(0), 1);
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(-2), 1);
    });

    await t.test("NaN 和乱填的文字退回 1", () => {
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(NaN), 1);
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed("快一点"), 1);
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(Infinity), 1);
    });

    await t.test("离谱的大数夹到上限，不能一下飞出屏幕", () => {
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(9999),
            SettingsStore.RELATIVE_SPEED_MAX);
    });

    await t.test("过小的值夹到下限，不能小到完全不动", () => {
        assert.strictEqual(SettingsStore.normalizeRelativeSpeed(0.0001),
            SettingsStore.RELATIVE_SPEED_MIN);
    });
});

test("波特率排序", async (t) => {
    await t.test("上次用过的排最前", () => {
        assert.deepStrictEqual(SettingsStore.baudRateOrder(115200, [9600, 115200]), [115200, 9600]);
    });

    await t.test("已经在最前时顺序不变", () => {
        assert.deepStrictEqual(SettingsStore.baudRateOrder(9600, [9600, 115200]), [9600, 115200]);
    });

    await t.test("没存过或不在候选里就用原顺序", () => {
        assert.deepStrictEqual(SettingsStore.baudRateOrder(null, [9600, 115200]), [9600, 115200]);
        assert.deepStrictEqual(SettingsStore.baudRateOrder(57600, [9600, 115200]), [9600, 115200]);
    });

    await t.test("不修改传进来的数组", () => {
        let available = [9600, 115200];
        SettingsStore.baudRateOrder(115200, available);
        assert.deepStrictEqual(available, [9600, 115200]);
    });
});
