const test = require("node:test");
const assert = require("node:assert");
const AtxRelay = require("../atx-relay.js");

const CH340 = {usbVendorId: 0x1a86, usbProductId: 0x7523};

function fakePort(info, options) {
    options = options || {};
    const port = {
        info: info,
        isOpen: false,
        written: [],
        getInfo: () => info,
        open: async (config) => {
            if (options.openFails) {
                throw new Error("busy");
            }
            port.baudRate = config.baudRate;
            port.isOpen = true;
        },
        close: async () => {
            port.isOpen = false;
        },
        writable: {
            getWriter: () => ({
                write: async (bytes) => {
                    if (options.writeFails && options.writeFails(port.written.length)) {
                        port.written.push(null);
                        throw new Error("write failed");
                    }
                    port.written.push(Array.from(bytes));
                },
                releaseLock: () => {
                    port.released = true;
                }
            })
        }
    };
    return port;
}

test("LCUS 指令", async (t) => {
    await t.test("第 1 路吸合 / 断开与常见文档一致", () => {
        assert.deepStrictEqual(AtxRelay.command(1, true), [0xA0, 0x01, 0x01, 0xA2]);
        assert.deepStrictEqual(AtxRelay.command(1, false), [0xA0, 0x01, 0x00, 0xA1]);
    });

    await t.test("其他通道校验和跟着变", () => {
        assert.deepStrictEqual(AtxRelay.command(2, true), [0xA0, 0x02, 0x01, 0xA3]);
        assert.deepStrictEqual(AtxRelay.command(4, false), [0xA0, 0x04, 0x00, 0xA4]);
    });
});

test("继电器配置", async (t) => {
    await t.test("没选串口视为不用", () => {
        assert.strictEqual(AtxRelay.normalize(null), null);
        assert.strictEqual(AtxRelay.normalize({}), null);
        assert.strictEqual(AtxRelay.normalize({deviceId: "", channel: 2}), null);
    });

    await t.test("通道只认 1 到 4，坏值退回 1", () => {
        const device = JSON.stringify(CH340);
        assert.strictEqual(AtxRelay.normalize({deviceId: device, channel: "3"}).channel, 3);
        assert.strictEqual(AtxRelay.normalize({deviceId: device, channel: 9}).channel, 1);
        assert.strictEqual(AtxRelay.normalize({deviceId: device}).channel, 1);
        assert.deepStrictEqual(AtxRelay.normalize({deviceId: device, label: "LCUS", channel: 2}),
            {deviceId: device, label: "LCUS", channel: 2, resetChannel: null});
    });

    await t.test("复位键可以不接；和电源键同一路或越界时视为不接", () => {
        const device = JSON.stringify(CH340);
        assert.strictEqual(AtxRelay.normalize({deviceId: device, channel: 1, resetChannel: "2"}).resetChannel, 2);
        assert.strictEqual(AtxRelay.normalize({deviceId: device, channel: 1, resetChannel: 1}).resetChannel, null);
        assert.strictEqual(AtxRelay.normalize({deviceId: device, channel: 1, resetChannel: 7}).resetChannel, null);
        assert.strictEqual(AtxRelay.normalize({deviceId: device, channel: 1, resetChannel: ""}).resetChannel, null);
    });

    await t.test("按哪个键用哪一路", () => {
        const atx = {channel: 1, resetChannel: 2};
        assert.strictEqual(AtxRelay.channelFor(atx, "short"), 1);
        assert.strictEqual(AtxRelay.channelFor(atx, "long"), 1);
        assert.strictEqual(AtxRelay.channelFor(atx, "reset"), 2);
        assert.strictEqual(AtxRelay.channelFor({channel: 1, resetChannel: null}, "reset"), null);
        assert.strictEqual(AtxRelay.channelFor(atx, "nope"), null);
    });
});

test("挑继电器串口", async (t) => {
    await t.test("排除键鼠正在用的同型号串口", () => {
        const chip = fakePort(CH340);
        const relay = fakePort(CH340);
        const other = fakePort({usbVendorId: 0x10c4, usbProductId: 0xea60});
        assert.deepStrictEqual(AtxRelay.candidatePorts([chip, relay, other], CH340, chip), [relay]);
    });

    await t.test("没有筛选条件时一个都不选", () => {
        assert.deepStrictEqual(AtxRelay.candidatePorts([fakePort(CH340)], null, null), []);
        assert.deepStrictEqual(AtxRelay.candidatePorts([fakePort(CH340)], {}, null), []);
    });

    await t.test("只有一个能打开就用它，打不开的旧授权跳过", async () => {
        const stale = fakePort(CH340, {openFails: true});
        const relay = fakePort(CH340);
        const result = await AtxRelay.openRelayPort([stale, relay], CH340, null);
        assert.strictEqual(result.port, relay);
        assert.strictEqual(relay.baudRate, 9600);
    });

    await t.test("两个都能打开时报错并全部关回去", async () => {
        const a = fakePort(CH340);
        const b = fakePort(CH340);
        const result = await AtxRelay.openRelayPort([a, b], CH340, null);
        assert.ok(result.error.includes("分不清"));
        assert.strictEqual(a.isOpen, false);
        assert.strictEqual(b.isOpen, false);
    });

    await t.test("找不到或全打不开分别提示", async () => {
        assert.ok((await AtxRelay.openRelayPort([], CH340, null)).error.includes("没有找到"));
        const busy = fakePort(CH340, {openFails: true});
        assert.ok((await AtxRelay.openRelayPort([busy], CH340, null)).error.includes("打不开"));
    });
});

test("按电源键", async (t) => {
    await t.test("先吸合、到时间再断开", async () => {
        const port = fakePort(CH340);
        const started = Date.now();
        await AtxRelay.press(port, 1, 50);
        assert.ok(Date.now() - started >= 45);
        assert.deepStrictEqual(port.written, [[0xA0, 1, 1, 0xA2], [0xA0, 1, 0, 0xA1]]);
        assert.strictEqual(port.released, true);
    });

    await t.test("可以提前松开", async () => {
        const port = fakePort(CH340);
        const cancel = {};
        const started = Date.now();
        const pending = AtxRelay.press(port, 2, 5000, cancel);
        await new Promise((resolve) => setTimeout(resolve, 20));
        cancel.release();
        await pending;
        assert.ok(Date.now() - started < 1000);
        assert.deepStrictEqual(port.written[1], [0xA0, 2, 0, 0xA2]);
    });

    await t.test("吸合失败也要尝试断开", async () => {
        const port = fakePort(CH340, {writeFails: (n) => n === 0});
        await assert.rejects(AtxRelay.press(port, 1, 10));
        assert.deepStrictEqual(port.written, [null, [0xA0, 1, 0, 0xA1]]);
        assert.strictEqual(port.released, true);
    });
});
