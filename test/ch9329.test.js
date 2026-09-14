"use strict";

const test = require("node:test");
const assert = require("node:assert");

// getContentRect 会读 window.getComputedStyle，require 之前先补上
global.window = {
    getComputedStyle: function () {
        return {objectFit: global.__objectFit || "fill"};
    }
};

const Ch9329 = require("../ch9329.js");
const {createFakeChip, createFakePort} = require("./fake-ch9329.js");

function hex(bytes) {
    return Array.from(bytes)
        .map(function (b) {
            return b.toString(16).padStart(2, "0");
        })
        .join(" ");
}

function newChip(options) {
    const chip = createFakeChip(options);
    const ch = new Ch9329(chip.writer, true, chip.reader);
    return {chip: chip, ch: ch};
}

// 等发送队列真正排空。拆包连发一次能产生十几个包，固定睡几十毫秒会随机不够
async function drain(ch, maxMs) {
    const deadline = Date.now() + (maxMs == null ? 5000 : maxMs);
    while (Date.now() < deadline) {
        if (!ch._queueRunning && ch._queue.length === 0) {
            // 再让一轮微任务跑完，确保最后一个包已经写进 fake chip
            await new Promise(function (r) { setTimeout(r, 5); });
            return;
        }
        await new Promise(function (r) { setTimeout(r, 5); });
    }
    throw new Error("发送队列没能在 " + maxMs + "ms 内排空");
}

function fakeVideo(width, height, videoWidth, videoHeight) {
    return {
        videoWidth: videoWidth == null ? width : videoWidth,
        videoHeight: videoHeight == null ? height : videoHeight,
        getBoundingClientRect: function () {
            return {left: 0, top: 0, width: width, height: height};
        }
    };
}

function framesOf(chip, cmd) {
    return chip.state.raw.filter(function (bytes) {
        return bytes[3] === cmd;
    });
}

// 以下期望值全部抄自 CH9329 串口通信协议 V1.3 的命令样例
test("帧编码与协议文档样例逐字节一致", async function (t) {
    const {ch} = newChip();

    await t.test("CMD_GET_INFO", function () {
        assert.strictEqual(
            hex(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x01, 0x00])),
            "57 ab 00 01 00 03"
        );
    });

    await t.test("键盘：按下 A / 释放 A", function () {
        assert.strictEqual(
            hex(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00])),
            "57 ab 00 02 08 00 00 04 00 00 00 00 00 10"
        );
        assert.strictEqual(
            hex(ch.keyboardReleasePacket),
            "57 ab 00 02 08 00 00 00 00 00 00 00 00 0c"
        );
    });

    await t.test("键盘：左 Shift + A", function () {
        assert.strictEqual(
            hex(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00])),
            "57 ab 00 02 08 02 00 04 00 00 00 00 00 12"
        );
    });
});

test("绝对鼠标包与文档样例一致", async function (t) {
    await t.test("按下左键 / 释放左键", async function () {
        const {chip, ch} = newChip();
        await ch.sendAbsolutePacket(0x01, 0x00);
        await ch.sendAbsolutePacket(0x00, 0x00);
        const frames = framesOf(chip, 0x04);
        assert.strictEqual(hex(frames[0]), "57 ab 00 04 07 02 01 00 00 00 00 00 10");
        assert.strictEqual(hex(frames[1]), "57 ab 00 04 07 02 00 00 00 00 00 00 0f");
    });

    await t.test("移动到 1280x768 屏幕的 (100,100) 和 (968,500)", async function () {
        const {chip, ch} = newChip();
        ch.lastAbsX = 320;
        ch.lastAbsY = 533;
        await ch.sendAbsolutePacket(0x00, 0x00);
        ch.lastAbsX = 3097;
        ch.lastAbsY = 2667;
        await ch.sendAbsolutePacket(0x00, 0x00);
        const frames = framesOf(chip, 0x04);
        assert.strictEqual(hex(frames[0]), "57 ab 00 04 07 02 00 40 01 15 02 00 67");
        assert.strictEqual(hex(frames[1]), "57 ab 00 04 07 02 00 19 0c 6b 0a 00 a9");
    });
});

test("相对鼠标包与文档样例一致", async function (t) {
    const chip = createFakeChip();
    const ch = new Ch9329(chip.writer, false, chip.reader);

    await t.test("按下左键 / 释放左键", async function () {
        await ch.sendRelativePacket(0x01, 0, 0, 0);
        await ch.sendRelativePacket(0x00, 0, 0, 0);
        const frames = framesOf(chip, 0x05);
        assert.strictEqual(hex(frames[0]), "57 ab 00 05 05 01 01 00 00 00 0e");
        assert.strictEqual(hex(frames[1]), "57 ab 00 05 05 01 00 00 00 00 0d");
    });

    await t.test("向左 3 像素 / 向下 5 像素", async function () {
        chip.state.raw.length = 0;
        await ch.sendRelativePacket(0x00, -3, 0, 0);
        await ch.sendRelativePacket(0x00, 0, 5, 0);
        const frames = framesOf(chip, 0x05);
        assert.strictEqual(hex(frames[0]), "57 ab 00 05 05 01 00 fd 00 00 0a");
        assert.strictEqual(hex(frames[1]), "57 ab 00 05 05 01 00 00 05 00 12");
    });
});

test("视口坐标按 4096 分辨率换算", async function (t) {
    const {ch} = newChip();

    await t.test("与文档的 1280x768 算例吻合", function () {
        const video = fakeVideo(1280, 768);
        assert.deepStrictEqual(ch.mapToAbsolute(video, 100, 100), {x: 320, y: 533});
        // 文档把 500 的 Y 写成 2667 是四舍五入，按公式截断应为 2666，差 1/4096 可忽略
        assert.deepStrictEqual(ch.mapToAbsolute(video, 968, 500), {x: 3097, y: 2666});
    });

    await t.test("边界落在 0 和 4095，不溢出 12 位坐标域", function () {
        const video = fakeVideo(1920, 1080);
        assert.deepStrictEqual(ch.mapToAbsolute(video, 0, 0), {x: 0, y: 0});
        assert.deepStrictEqual(ch.mapToAbsolute(video, 1920, 1080), {x: 4095, y: 4095});
        assert.deepStrictEqual(ch.mapToAbsolute(video, 9999, 9999), {x: 4095, y: 4095});
    });

    await t.test("object-fit: contain 时扣掉黑边", function () {
        global.__objectFit = "contain";
        // 16:9 的画面塞进 1000x1000 的框，上下各留 218.75 黑边
        const video = fakeVideo(1000, 1000, 1600, 900);
        const center = ch.mapToAbsolute(video, 500, 500);
        assert.deepStrictEqual(center, {x: 2048, y: 2048});
        const topBar = ch.mapToAbsolute(video, 500, 10);
        assert.strictEqual(topBar.y, 0, "点在黑边上应夹到画面顶边");
        global.__objectFit = "fill";
    });
});

test("每条命令都等芯片应答", async function (t) {
    await t.test("拿到应答后才 resolve", async function () {
        const {chip, ch} = newChip({replyDelayMs: 20});
        const started = Date.now();
        const frame = await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert.ok(Date.now() - started >= 15, "不应在收到应答前返回");
        assert.strictEqual(frame.cmd, 0x82);
        assert.strictEqual(chip.state.received.length, 1);
    });

    await t.test("芯片回错误应答时重发一次", async function () {
        const {chip, ch} = newChip({errorsToInject: 1});
        await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert.strictEqual(chip.state.received.length, 2, "首次被拒后应重发");
    });

    await t.test("芯片组包正确，不会被判校验和错误", async function () {
        const {chip, ch} = newChip();
        await ch.getInfo();
        await ch.sendAbsolutePacket(0x01, 0x00);
        await ch.tapKey(0x04, true);
        assert.deepStrictEqual(chip.state.rejected, []);
    });

    await t.test("连续无应答后降级为只发不等", async function () {
        const warn = console.warn;
        console.warn = function () {
        };
        try {
            const {chip, ch} = newChip({silent: true});
            assert.strictEqual(ch.isAckEnabled(), true);
            await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
            await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
            assert.strictEqual(ch.isAckEnabled(), false);

            const started = Date.now();
            for (let i = 0; i < 5; i++) {
                await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
            }
            assert.ok(Date.now() - started < 100, "降级后不应再空等 500ms");
            assert.ok(chip.state.received.length >= 8, "降级后仍然继续发包");
        } finally {
            console.warn = warn;
        }
    });
});

test("不等应答时要留出包间隔", async function (t) {
    // 协议：芯片超过 3ms 没收到下一个字节才认为本包结束。等应答时这个间隔
    // 天然存在，不等应答时如果连发，芯片会把两包粘成一包。
    await t.test("连发多包时每包之间都有间隔", async function () {
        const chip = createFakeChip({silent: true});
        // 没有 reader 就是「只发不等」模式
        const ch = new Ch9329(chip.writer, true, null);
        const started = Date.now();
        await Promise.all([
            ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x00])),
            ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x00])),
            ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x00]))
        ]);
        const spent = Date.now() - started;
        assert.ok(spent >= Ch9329.PACKET_GAP_MS * 2,
            "3 包之间至少要有 2 个间隔，实际只用了 " + spent + "ms");
    });

    await t.test("间隔可以调，调成 0 就退回连发", async function () {
        const original = Ch9329.PACKET_GAP_MS;
        try {
            Ch9329.PACKET_GAP_MS = 0;
            const chip = createFakeChip({silent: true});
            const ch = new Ch9329(chip.writer, true, null);
            const started = Date.now();
            for (let i = 0; i < 5; i++) {
                await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x00]));
            }
            assert.ok(Date.now() - started < 40, "间隔归零后不该还在等");
        } finally {
            Ch9329.PACKET_GAP_MS = original;
        }
    });

    await t.test("包还是照常发出去，间隔不能吃掉数据", async function () {
        const chip = createFakeChip({silent: true});
        const ch = new Ch9329(chip.writer, true, null);
        await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x00]));
        await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x00]));
        assert.strictEqual(chip.state.raw.length, 2, "两包都要真的写出去");
    });
});

test("端口打不开时要说清原因", async function (t) {
    await t.test("每个波特率都打不开就抛错，而不是假装连上了", async function () {
        const fake = createFakePort({failOpen: true});
        await assert.rejects(
            () => Ch9329.connect(fake.port, [9600, 115200], true),
            /打不开串口/
        );
    });

    await t.test("提示里要点明端口独占，并给出可以照着做的动作", async function () {
        const fake = createFakePort({failOpen: true});
        let message = null;
        try {
            await Ch9329.connect(fake.port, [9600, 115200], true);
        } catch (e) {
            message = e.message;
        }
        assert.ok(message, "应该抛出错误");
        assert.ok(message.indexOf("独占") !== -1, "要解释为什么打不开：" + message);
        assert.ok(message.indexOf("标签页") !== -1, "要告诉用户关掉其它标签页：" + message);
        // 原始报错也得留着，否则真遇到别的原因就没法排查了
        assert.ok(message.indexOf("Failed to open serial port") !== -1, "要带上原始报错：" + message);
    });

    await t.test("错误上带着 attempts 和原始异常，方便排查", async function () {
        const fake = createFakePort({failOpen: true});
        try {
            await Ch9329.connect(fake.port, [9600, 115200], true);
            assert.fail("应该抛错");
        } catch (e) {
            assert.strictEqual(e.attempts.length, 2, "两个波特率都该有记录");
            assert.ok(e.attempts.every((a) => a.outcome === "open-failed"));
            assert.ok(e.cause, "要保留原始异常");
        }
    });

    await t.test("打得开但芯片不应答，不能误报成端口被占用", async function () {
        // 这种情况要退回「只发不等」的降级连接，不该抛错
        const fake = createFakePort({silent: true});
        const warn = console.warn;
        console.warn = function () {
        };
        let connection;
        try {
            connection = await Ch9329.connect(fake.port, [9600, 115200], true);
        } finally {
            console.warn = warn;
        }
        assert.strictEqual(connection.info, null, "无应答时仍然给出降级连接");
        assert.ok(connection.ch, "降级连接照样要能发命令");
        await connection.ch.dispose();
    });

    await t.test("无应答的措辞不该提端口独占，免得把人带偏", function () {
        const text = Ch9329.explainConnectFailure([
            {baudRate: 9600, outcome: "no-reply"},
            {baudRate: 115200, outcome: "no-reply"}
        ]);
        assert.ok(text.indexOf("独占") === -1, text);
        assert.ok(text.indexOf("无应答") !== -1, text);
    });
});

test("指针锁定下的相对移动", async function (t) {
    function newRelativeChip() {
        const chip = createFakeChip();
        return {chip: chip, ch: new Ch9329(chip.writer, false, chip.reader)};
    }

    await t.test("直接按浏览器给的位移下发，不再差分光标位置", async function () {
        const {chip, ch} = newRelativeChip();
        ch.mouseMoveBy(30, -20);
        await new Promise(function (r) { setTimeout(r, 30); });
        const frame = framesOf(chip, 0x05)[0];
        assert.ok(frame, "应该发出相对移动包");
        assert.strictEqual(frame[7], 30, "dx 原样下发");
        assert.strictEqual(frame[8], (-20) & 0xff, "dy 原样下发");
    });

    await t.test("第一次移动就能生效，不像差分那样要先丢一帧取基准", async function () {
        const {chip, ch} = newRelativeChip();
        // mouseMove 的第一帧只用来记基准，会被丢掉；指针锁定没有这个问题
        ch.mouseMoveBy(10, 10);
        await new Promise(function (r) { setTimeout(r, 30); });
        assert.strictEqual(framesOf(chip, 0x05).length, 1, "首帧不该被吞掉");
    });

    await t.test("单包不能溢出成反方向", async function () {
        const {chip, ch} = newRelativeChip();
        ch.mouseMoveBy(400, -400);
        await new Promise(function (r) { setTimeout(r, 30); });
        const frame = framesOf(chip, 0x05)[0];
        assert.strictEqual(frame[7], 127, "正向截到 127");
        assert.strictEqual(frame[8], (-127) & 0xff, "负向截到 -127");
    });

    await t.test("没动就不发包", async function () {
        const {chip, ch} = newRelativeChip();
        ch.mouseMoveBy(0, 0);
        await new Promise(function (r) { setTimeout(r, 30); });
        assert.strictEqual(framesOf(chip, 0x05).length, 0, "零位移不该占用串口");
    });

    await t.test("绝对模式下什么也不做", async function () {
        const {chip, ch} = newChip();
        ch.mouseMoveBy(50, 50);
        await new Promise(function (r) { setTimeout(r, 30); });
        assert.strictEqual(chip.state.raw.length, 0, "绝对模式要的是真实坐标，不该被位移干扰");
    });

    await t.test("isMouseAbsolute 如实反映模式，页面靠它决定要不要锁", function () {
        assert.strictEqual(newChip().ch.isMouseAbsolute(), true);
        assert.strictEqual(newRelativeChip().ch.isMouseAbsolute(), false);
    });

    await t.test("解锁后重新取基准，下一次移动不会跳一大段", async function () {
        const {chip, ch} = newRelativeChip();
        const video = fakeVideo(1920, 1080);
        // 锁定前在左边，解锁后光标出现在别处
        ch.mouseMove(video, 100, 100);
        ch.mouseMove(video, 110, 100);
        ch.resetRelativeOrigin();
        await new Promise(function (r) { setTimeout(r, 30); });
        const before = framesOf(chip, 0x05).length;

        // 这一帧只该用来记新基准
        ch.mouseMove(video, 900, 700);
        await new Promise(function (r) { setTimeout(r, 30); });
        assert.strictEqual(framesOf(chip, 0x05).length, before, "重置后的首帧应只取基准，不发包");

        ch.mouseMove(video, 905, 700);
        await new Promise(function (r) { setTimeout(r, 30); });
        const frame = framesOf(chip, 0x05)[before];
        assert.ok(frame, "第二帧才开始真正移动");
        assert.strictEqual(frame[7], 5, "位移应相对新基准，而不是锁定前的老位置");
    });
});

test("拖拽死区", async function (t) {
    // 死区按客户端像素算，和被控端分辨率无关。绝对模式的鼠标包是 CMD 0x04
    const zone = Ch9329.DRAG_DEAD_ZONE_PX;

    await t.test("按住后小幅抖动不发移动包，避免点击被当成拖拽", async function () {
        const {chip, ch} = newChip();
        const video = fakeVideo(1920, 1080);
        ch.mouseButtonDown(video, 500, 500, 0x01);
        await new Promise(function (r) { setTimeout(r, 30); });
        const before = framesOf(chip, 0x04).length;
        assert.ok(before > 0, "按下本身应该已经发过包，否则后面的对比没有意义");

        // 斜着挪一点点，距离仍在死区内
        ch.mouseMove(video, 500 + zone - 2, 500);
        ch.mouseMove(video, 500, 500 + zone - 2);
        await new Promise(function (r) { setTimeout(r, 50); });

        assert.strictEqual(framesOf(chip, 0x04).length, before, "死区内不该发出移动包");
    });

    await t.test("超过死区就进入拖拽", async function () {
        const {chip, ch} = newChip();
        const video = fakeVideo(1920, 1080);
        ch.mouseButtonDown(video, 500, 500, 0x01);
        await new Promise(function (r) { setTimeout(r, 30); });
        const before = framesOf(chip, 0x04).length;

        ch.mouseMove(video, 500 + zone + 2, 500);
        await new Promise(function (r) { setTimeout(r, 50); });

        assert.ok(framesOf(chip, 0x04).length > before, "越过死区后应该开始发移动包");
    });

    await t.test("死区是圆的：横竖两个方向阈值一样", function () {
        const video = fakeVideo(1920, 1080);
        // 1920x1080 不是正方形，早先在 0..4095 空间里比较时，
        // 同样的像素位移在横竖方向会得出不同结论
        const horizontal = newChip();
        horizontal.ch.mouseButtonDown(video, 500, 500, 0x01);
        horizontal.ch.mouseMove(video, 500 + zone + 2, 500);
        const vertical = newChip();
        vertical.ch.mouseButtonDown(video, 500, 500, 0x01);
        vertical.ch.mouseMove(video, 500, 500 + zone + 2);

        assert.strictEqual(horizontal.ch._clickArmed, false, "横向越过死区应解除锁定");
        assert.strictEqual(vertical.ch._clickArmed, false, "纵向同样距离也应解除锁定");
    });

    await t.test("死区可以调，调小之后更灵敏", function () {
        const original = Ch9329.DRAG_DEAD_ZONE_PX;
        try {
            Ch9329.DRAG_DEAD_ZONE_PX = 2;
            const {ch} = newChip();
            const video = fakeVideo(1920, 1080);
            ch.mouseButtonDown(video, 500, 500, 0x01);
            // 这个位移在默认死区内，调小之后应该算拖拽了
            ch.mouseMove(video, 504, 500);
            assert.strictEqual(ch._clickArmed, false, "改小死区后同样的位移应触发拖拽");
        } finally {
            Ch9329.DRAG_DEAD_ZONE_PX = original;
        }
    });

    await t.test("没按键时移动不受死区影响", async function () {
        const {chip, ch} = newChip();
        const video = fakeVideo(1920, 1080);
        ch.mouseMove(video, 500, 500);
        ch.mouseMove(video, 501, 500);
        await new Promise(function (r) { setTimeout(r, 50); });
        assert.ok(framesOf(chip, 0x04).length > 0, "普通移动一像素也要跟手");
    });
});

test("移动包合并，按键包不被淹没", async function () {
    const {chip, ch} = newChip({replyDelayMs: 5});
    const video = fakeVideo(1920, 1080);

    for (let i = 1; i <= 30; i++) {
        ch.mouseMove(video, i * 10, i * 5);
    }
    ch.mouseButtonDown(video, 300, 150, 0x02);
    await ch.mouseButtonUp(2);
    await new Promise(function (resolve) {
        setTimeout(resolve, 200);
    });

    const frames = framesOf(chip, 0x04);
    assert.ok(frames.length < 12, "30 次移动应被合并，实际发出 " + frames.length + " 帧");
    const buttonFrames = frames.filter(function (bytes) {
        return bytes[6] === 0x02;
    });
    assert.strictEqual(buttonFrames.length, 1, "右键按下包必须原样送达");
    assert.strictEqual(hex(frames[frames.length - 1].slice(6, 7)), "00", "最后一帧应是释放包");
});

test("键盘状态机", async function (t) {
    await t.test("单键按下与释放", async function () {
        const {chip, ch} = newChip();
        ch.keydown(65);
        await new Promise(function (r) { setTimeout(r, 50); });
        assert.deepStrictEqual(chip.state.received[0].data, [0x00, 0x00, 0x04, 0, 0, 0, 0, 0]);
        ch.keyup(65);
        await new Promise(function (r) { setTimeout(r, 50); });
        assert.deepStrictEqual(chip.state.received[1].data, [0x00, 0x00, 0x00, 0, 0, 0, 0, 0]);
    });

    await t.test("修饰键位图按 USB HID 定义", function () {
        const {ch} = newChip();
        const cases = [
            ["ControlLeft", 0x01], ["ShiftLeft", 0x02], ["AltLeft", 0x04], ["MetaLeft", 0x08],
            ["ControlRight", 0x10], ["ShiftRight", 0x20], ["AltRight", 0x40], ["MetaRight", 0x80]
        ];
        for (const [key, expected] of cases) {
            ch.controlKeyDown[key] = true;
            assert.strictEqual(ch.getModifierByte(), expected, key + " 的位图应为 0x" + expected.toString(16));
            ch.controlKeyDown[key] = false;
        }
    });

    await t.test("修饰键走 keydown 也要认得出来", function () {
        // 上面那个用例直接改 controlKeyDown，绕过了查表；
        // 少一条映射时它照样通过，所以这里必须走真实入口
        const keys = [
            "ControlLeft", "ShiftLeft", "AltLeft", "MetaLeft",
            "ControlRight", "ShiftRight", "AltRight", "MetaRight"
        ];
        for (const key of keys) {
            const {ch} = newChip();
            ch.keydown(key);
            assert.notStrictEqual(ch.getModifierByte(), 0x00, key + " 按下后修饰位应该有值");
            assert.deepStrictEqual(ch.pressedKeys, [], key + " 是修饰键，不该占普通键位");
            ch.keyup(key);
            assert.strictEqual(ch.getModifierByte(), 0x00, key + " 松开后修饰位应清零");
        }
    });

    await t.test("全屏下被键盘锁定截获的系统键都能发出去", async function () {
        // 这些键平时被浏览器或系统吃掉，开了 Keyboard Lock 才会送到页面，
        // 查表里必须有对应条目，否则捕获了也是白捕获
        const cases = [
            ["Escape", 0x29], ["Tab", 0x2B], ["F11", 0x44],
            ["Delete", 0x4C], ["PrintScreen", 0x46], ["ContextMenu", 0x65]
        ];
        for (const [key, usage] of cases) {
            const {ch} = newChip();
            ch.keydown(key);
            assert.deepStrictEqual(ch.pressedKeys, [usage], key + " 应映射到 0x" + usage.toString(16));
        }
    });

    await t.test("组合键 Ctrl+Shift+A", async function () {
        const {chip, ch} = newChip();
        ch.keydown("ControlLeft");
        ch.keydown("ShiftLeft");
        ch.keydown("KeyA");
        await new Promise(function (r) { setTimeout(r, 80); });
        const last = chip.state.received[chip.state.received.length - 1];
        assert.strictEqual(last.data[0], 0x03, "左 Ctrl|左 Shift 应为 0x03");
        assert.strictEqual(last.data[2], 0x04);
    });

    await t.test("最多同时上报 6 个普通键", async function () {
        const {chip, ch} = newChip();
        const keys = ["KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG"];
        for (const key of keys) {
            ch.keydown(key);
        }
        await new Promise(function (r) { setTimeout(r, 120); });
        const last = chip.state.received[chip.state.received.length - 1];
        assert.strictEqual(last.data.slice(2).filter(Boolean).length, 6);
        assert.ok(!last.data.includes(0x04), "最早按下的 A 应被挤出");
        assert.ok(last.data.includes(0x0A), "最后按下的 G 应在列");
    });

    await t.test("releaseAllKeys 清空全部状态", async function () {
        const {chip, ch} = newChip();
        ch.keydown("ControlLeft");
        ch.keydown("KeyA");
        await ch.releaseAllKeys();
        await new Promise(function (r) { setTimeout(r, 50); });
        const last = chip.state.received[chip.state.received.length - 1];
        assert.deepStrictEqual(last.data, [0, 0, 0, 0, 0, 0, 0, 0]);
        assert.strictEqual(ch.getModifierByte(), 0x00);
        assert.deepStrictEqual(ch.pressedKeys, []);
    });
});

test("鼠标按键不会卡在被控端", async function (t) {
    await t.test("抬起时无条件发释放包", async function () {
        const {chip, ch} = newChip();
        // 本地状态认为没有按下，仍然要发释放包
        ch.clicked.command = 0x00;
        await ch.mouseButtonUp(2);
        await new Promise(function (r) { setTimeout(r, 50); });
        const frames = framesOf(chip, 0x04);
        assert.strictEqual(frames.length, 1);
        assert.strictEqual(frames[0][6], 0x00);
    });

    await t.test("按下前先清掉可能残留的按键", async function () {
        const {chip, ch} = newChip();
        ch.mouseButtonDown(fakeVideo(1920, 1080), 100, 100, 0x02);
        await new Promise(function (r) { setTimeout(r, 80); });
        const frames = framesOf(chip, 0x04);
        assert.strictEqual(frames[0][6], 0x00, "第一包应是强制释放");
        assert.strictEqual(frames[1][6], 0x02, "第二包才是右键按下");
    });

    await t.test("短按期间的微抖不改变落点", async function () {
        const {chip, ch} = newChip();
        const video = fakeVideo(1920, 1080);
        ch.mouseButtonDown(video, 500, 500, 0x02);
        ch.mouseMove(video, 503, 502);
        await ch.mouseButtonUp(2);
        await new Promise(function (r) { setTimeout(r, 80); });
        const frames = framesOf(chip, 0x04);
        const down = frames.find(function (f) { return f[6] === 0x02; });
        const up = frames[frames.length - 1];
        assert.deepStrictEqual(down.slice(7, 11), up.slice(7, 11), "释放坐标应回到按下点");
    });
});

test("参数配置与波特率", async function (t) {
    await t.test("读回 50 字节配置", async function () {
        const {ch} = newChip({baudRate: 9600});
        const cfg = await ch.getParaCfg();
        assert.strictEqual(cfg.length, 50);
        assert.strictEqual(ch.readParaBaudRate(cfg), 9600);
        assert.strictEqual(hex(cfg.slice(3, 7)), "00 00 25 80", "9600 的默认编码见文档");
    });

    await t.test("切到 115200 只改波特率字段", async function () {
        const {chip, ch} = newChip({baudRate: 9600});
        const before = chip.state.paraCfg.slice();
        const result = await ch.setBaudRate(115200);
        assert.deepStrictEqual(result, {ok: true});
        const after = chip.state.paraCfg;
        assert.strictEqual(hex(after.slice(3, 7)), "00 01 c2 00");
        assert.strictEqual(ch.readParaBaudRate(after), 115200);
        assert.deepStrictEqual(after.slice(7), before.slice(7), "其余字段必须原样保留");
    });

    await t.test("写回时抹掉硬件引脚位，避免芯片回 0xE5", async function () {
        const {chip, ch} = newChip({baudRate: 9600});
        assert.strictEqual(chip.state.paraCfg[0], 0x80, "读到的是引脚设置的工作模式");
        await ch.setBaudRate(115200);
        assert.strictEqual(chip.state.paraCfg[0], 0x00);
        assert.strictEqual(chip.state.paraCfg[1], 0x00);
        assert.deepStrictEqual(chip.state.rejected, [], "不应被芯片判为参数错误");
    });

    await t.test("波特率已经一致时不重复写入", async function () {
        const {chip, ch} = newChip({baudRate: 115200});
        const result = await ch.setBaudRate(115200);
        assert.deepStrictEqual(result, {ok: true, unchanged: true});
        assert.strictEqual(chip.state.received.filter(function (f) { return f.cmd === 0x09; }).length, 0);
    });

    await t.test("芯片无应答时如实报错", async function () {
        const {ch} = newChip({silent: true});
        const warn = console.warn;
        console.warn = function () {
        };
        try {
            const result = await ch.setBaudRate(115200);
            assert.strictEqual(result.ok, false);
            assert.match(result.reason, /读取芯片参数配置失败/);
        } finally {
            console.warn = warn;
        }
    });
});

test("波特率白名单", async function (t) {
    // BAUD_RATES 同时是探测列表和设置页下拉框的来源。写进一个不在列表里的值，
    // 下次连接就探测不到，而恢复出厂配置又要求能通信——等于没有软件退路。
    await t.test("列表本身是升序且不重复", function () {
        const list = Ch9329.BAUD_RATES;
        assert.ok(list.length >= 2);
        const sorted = list.slice().sort(function (a, b) { return a - b; });
        assert.deepStrictEqual(list, sorted, "顺序即探测顺序，升序便于阅读");
        assert.strictEqual(new Set(list).size, list.length, "不能有重复，否则会白探一次");
    });

    await t.test("保留出厂默认的 9600", function () {
        assert.ok(Ch9329.BAUD_RATES.indexOf(9600) !== -1,
            "芯片出厂就是 9600，列表里没有它就连不上新芯片");
    });

    await t.test("拒绝列表之外的波特率，一个包都不发", async function () {
        const {chip, ch} = newChip({baudRate: 9600});
        const result = await ch.setBaudRate(57600);
        assert.strictEqual(result.ok, false);
        assert.match(result.reason, /探测不到/);
        assert.strictEqual(chip.state.received.length, 0, "连读配置都不该发");
    });

    await t.test("列表里的每个值都能写进去", async function () {
        for (const baud of Ch9329.BAUD_RATES) {
            const {chip, ch} = newChip({baudRate: 9600});
            const result = await ch.setBaudRate(baud);
            assert.strictEqual(result.ok, true, baud + " 应该可写");
            assert.strictEqual(ch.readParaBaudRate(chip.state.paraCfg), baud);
            assert.deepStrictEqual(chip.state.rejected, [], baud + " 不该被芯片判错");
        }
    });
});

test("超过 ±127 的移动拆成多包连发", async function (t) {
    function relativeChip() {
        const chip = createFakeChip();
        return {chip: chip, ch: new Ch9329(chip.writer, false, chip.reader)};
    }
    // 把已发出的相对包还原成带符号的位移，用来核对总量
    function movedBy(chip) {
        let x = 0;
        let y = 0;
        framesOf(chip, 0x05).forEach(function (f) {
            x += (f[7] << 24) >> 24;
            y += (f[8] << 24) >> 24;
        });
        return {x: x, y: y};
    }

    await t.test("小位移仍然只发一个包，不引入多余流量", async function () {
        const {chip, ch} = relativeChip();
        ch.mouseMoveBy(30, -20);
        await drain(ch);
        assert.strictEqual(framesOf(chip, 0x05).length, 1);
        assert.deepStrictEqual(movedBy(chip), {x: 30, y: -20});
    });

    await t.test("正好 127 是边界，不该被拆", async function () {
        const {chip, ch} = relativeChip();
        ch.mouseMoveBy(127, -127);
        await drain(ch);
        assert.strictEqual(framesOf(chip, 0x05).length, 1, "127 还在单包能力内");
        assert.deepStrictEqual(movedBy(chip), {x: 127, y: -127});
    });

    await t.test("128 就要拆成两包，总位移一个单位都不能少", async function () {
        const {chip, ch} = relativeChip();
        ch.mouseMoveBy(128, 0);
        await drain(ch);
        assert.strictEqual(framesOf(chip, 0x05).length, 2);
        assert.deepStrictEqual(movedBy(chip), {x: 128, y: 0});
    });

    await t.test("实测到的峰值 1062 要完整送达（原本会丢掉 88%）", async function () {
        const {chip, ch} = relativeChip();
        ch.mouseMoveBy(1062, -1062);
        await drain(ch);
        const frames = framesOf(chip, 0x05);
        assert.strictEqual(frames.length, Math.ceil(1062 / 127), "9 个包");
        assert.deepStrictEqual(movedBy(chip), {x: 1062, y: -1062}, "总位移必须精确相等");
        frames.forEach(function (f) {
            const dx = (f[7] << 24) >> 24;
            assert.ok(dx >= -127 && dx <= 127, "每个包都不能越界");
        });
    });

    await t.test("两轴步数不同也要各自走完", async function () {
        const {chip, ch} = relativeChip();
        ch.mouseMoveBy(300, -50);
        await drain(ch);
        assert.deepStrictEqual(movedBy(chip), {x: 300, y: -50});
    });

    await t.test("超过连发上限的部分留给下一帧，不丢失", async function () {
        const {chip, ch} = relativeChip();
        const huge = 127 * Ch9329.MAX_MOVE_BURST + 500;
        ch.mouseMoveBy(huge, 0);
        await drain(ch);
        const first = movedBy(chip).x;
        assert.strictEqual(first, 127 * Ch9329.MAX_MOVE_BURST, "这一帧发满上限为止");
        assert.strictEqual(ch.reportMoveStats()["余量推迟次数"], 1);
        // 下一帧即使一动不动，欠下的也要补上
        ch.mouseMoveBy(0, 0);
        await drain(ch);
        assert.strictEqual(movedBy(chip).x, huge, "欠的位移要补齐");
    });

    await t.test("解锁指针会丢掉欠账，避免补发一段莫名其妙的位移", async function () {
        const {chip, ch} = relativeChip();
        ch.mouseMoveBy(127 * Ch9329.MAX_MOVE_BURST + 500, 0);
        await drain(ch);
        const before = movedBy(chip).x;
        ch.resetRelativeOrigin();
        ch.mouseMoveBy(0, 0);
        await drain(ch);
        assert.strictEqual(movedBy(chip).x, before, "解锁后不该再补发");
    });

    await t.test("拆出来的包不会被合并吞掉", async function () {
        const {chip, ch} = relativeChip();
        // 连着提交两次大位移，第二次不能把第一次没发完的挤掉
        ch.mouseMoveBy(500, 0);
        ch.mouseMoveBy(500, 0);
        await drain(ch);
        assert.strictEqual(movedBy(chip).x, 1000, "两次的总量都要送到");
    });

    await t.test("绝对模式不受影响", async function () {
        const {chip, ch} = newChip();
        ch.mouseMoveBy(1000, 1000);
        await drain(ch);
        assert.strictEqual(framesOf(chip, 0x05).length, 0, "绝对模式不该发相对包");
    });
});

test("相对模式灵敏度倍数", async function (t) {
    function relativeChip() {
        const chip = createFakeChip();
        return {chip: chip, ch: new Ch9329(chip.writer, false, chip.reader)};
    }
    function movedBy(chip) {
        let x = 0;
        let y = 0;
        framesOf(chip, 0x05).forEach(function (f) {
            x += (f[7] << 24) >> 24;
            y += (f[8] << 24) >> 24;
        });
        return {x: x, y: y};
    }
    async function withSpeed(speed, body) {
        const saved = Ch9329.RELATIVE_SPEED;
        try {
            Ch9329.RELATIVE_SPEED = speed;
            await body();
        } finally {
            Ch9329.RELATIVE_SPEED = saved;
        }
    }

    await t.test("默认是 1，不改变任何行为", function () {
        assert.strictEqual(Ch9329.RELATIVE_SPEED, 1);
    });

    await t.test("整数倍直接放大位移", async function () {
        await withSpeed(2, async function () {
            const {chip, ch} = relativeChip();
            ch.mouseMoveBy(50, -30);
            await drain(ch);
            assert.deepStrictEqual(movedBy(chip), {x: 100, y: -60});
        });
    });

    await t.test("放大后超过 127 会拆包，不会又被截断", async function () {
        await withSpeed(3, async function () {
            const {chip, ch} = relativeChip();
            ch.mouseMoveBy(100, 0);
            await drain(ch);
            assert.strictEqual(framesOf(chip, 0x05).length, 3, "300 要拆成 3 包");
            assert.deepStrictEqual(movedBy(chip), {x: 300, y: 0}, "放大的量要全部送到");
        });
    });

    await t.test("小数零头跨帧攒起来，慢速移动不发涩", async function () {
        await withSpeed(1.5, async function () {
            const {chip, ch} = relativeChip();
            // 每次 1，乘 1.5 得 1.5。逐帧取整会永远只发 1，累计丢掉三分之一
            for (let i = 0; i < 10; i++) {
                ch.mouseMoveBy(1, 0);
                await drain(ch);
            }
            assert.strictEqual(movedBy(chip).x, 15, "10 次 ×1.5 应该正好是 15");
        });
    });

    await t.test("负方向的零头同样不丢", async function () {
        await withSpeed(1.5, async function () {
            const {chip, ch} = relativeChip();
            for (let i = 0; i < 10; i++) {
                ch.mouseMoveBy(-1, 0);
                await drain(ch);
            }
            assert.strictEqual(movedBy(chip).x, -15);
        });
    });

    await t.test("缩小也能工作，不会把小位移全吃掉", async function () {
        await withSpeed(0.5, async function () {
            const {chip, ch} = relativeChip();
            for (let i = 0; i < 10; i++) {
                ch.mouseMoveBy(1, 0);
                await drain(ch);
            }
            assert.strictEqual(movedBy(chip).x, 5, "10 次 ×0.5 应该是 5，而不是 0");
        });
    });

    await t.test("解锁指针会清掉小数余量", async function () {
        await withSpeed(1.5, async function () {
            const {chip, ch} = relativeChip();
            ch.mouseMoveBy(1, 0);
            await drain(ch);
            assert.strictEqual(movedBy(chip).x, 1, "1.5 先发 1，欠 0.5");
            ch.resetRelativeOrigin();
            ch.mouseMoveBy(1, 0);
            await drain(ch);
            assert.strictEqual(movedBy(chip).x, 2, "重新取基准后不该把上一段的 0.5 补进来");
        });
    });

    await t.test("绝对模式不受倍数影响", async function () {
        await withSpeed(5, async function () {
            const {chip, ch} = newChip();
            ch.mouseMoveBy(100, 100);
            await drain(ch);
            assert.strictEqual(framesOf(chip, 0x05).length, 0);
        });
    });
});

test("移动包统计", async function (t) {
    // mouseMoveBy 在绝对模式下直接 return，用 newChip() 测截断会假通过
    function relativeChip() {
        const chip = createFakeChip();
        return {chip: chip, ch: new Ch9329(chip.writer, false, chip.reader)};
    }
    await t.test("合并丢弃的包被算进去", async function () {
        const {ch} = newChip();
        ch.resetMoveStats();
        // 不 await：让后面几个在前一个还在路上时提交，正好触发合并
        ch.sendAbsolutePacket(0x00, 0x00, true);
        ch.sendAbsolutePacket(0x00, 0x00, true);
        ch.sendAbsolutePacket(0x00, 0x00, true);
        await ch.sendAbsolutePacket(0x00, 0x00, true);
        const report = ch.reportMoveStats();
        assert.strictEqual(report["提交包数"], 4);
        assert.ok(report["实际发出包数"] > 0, "至少要发出去一个");
        assert.ok(report["实际发出包数"] < 4, "有包被合并掉才说明统计点对了");
        assert.strictEqual(report["被合并丢弃"], 4 - report["实际发出包数"]);
    });

    await t.test("小位移不算拆包", async function () {
        const {chip, ch} = relativeChip();
        ch.resetMoveStats();
        ch.mouseMoveBy(10, -20);
        await drain(ch);
        assert.strictEqual(framesOf(chip, 0x05).length, 1, "包得真发出去，否则是假通过");
        const report = ch.reportMoveStats();
        assert.strictEqual(report["拆包连发次数"], 0);
        assert.strictEqual(report["单轴最大请求位移"], 20);
    });

    await t.test("拆包次数按「移动」记，不按包记", async function () {
        const {ch} = relativeChip();
        ch.resetMoveStats();
        ch.mouseMoveBy(200, -300);
        await drain(ch);
        const report = ch.reportMoveStats();
        assert.strictEqual(report["拆包连发次数"], 1, "一次移动拆成多包，只算一次");
        assert.strictEqual(report["实际发出包数"], 3, "300/127 向上取整是 3");
        assert.strictEqual(report["单轴最大请求位移"], 300, "峰值取两轴绝对值的较大者");
    });

    await t.test("峰值不受拆包影响，记的是请求量", async function () {
        const {ch} = relativeChip();
        ch.resetMoveStats();
        ch.mouseMoveBy(40, -90);
        await drain(ch);
        const report = ch.reportMoveStats();
        assert.strictEqual(report["拆包连发次数"], 0, "没到 127，不该拆");
        assert.strictEqual(report["单轴最大请求位移"], 90);
    });

    await t.test("平均耗时的分母是发出去的包，不是上层调用次数", async function () {
        const {ch} = relativeChip();
        ch.resetMoveStats();
        // 连发四次，中间几次会被合并掉；被合并的包从没上过线，不该摊薄平均值
        ch.mouseMoveBy(5, 5);
        ch.mouseMoveBy(5, 5);
        ch.mouseMoveBy(5, 5);
        ch.mouseMoveBy(5, 5);
        await drain(ch);
        const report = ch.reportMoveStats();
        const sent = report["实际发出包数"];
        assert.ok(sent > 0 && sent < 4, "要真的发生合并，这个测试才有意义");
        assert.strictEqual(report["单包平均耗时(ms)"],
            Math.round(ch.moveStats.totalWaitMs / sent * 100) / 100,
            "分母必须是 sent");
    });

    await t.test("清零后重新计数", async function () {
        const {ch} = relativeChip();
        ch.mouseMoveBy(500, 0);
        await drain(ch);
        assert.ok(ch.reportMoveStats()["拆包连发次数"] > 0, "先要真的攒下数据");
        ch.resetMoveStats();
        const report = ch.reportMoveStats();
        assert.strictEqual(report["提交包数"], 0);
        assert.strictEqual(report["实际发出包数"], 0);
        assert.strictEqual(report["拆包连发次数"], 0);
        assert.strictEqual(report["单轴最大请求位移"], 0);
    });
});

test("工作模式", async function (t) {
    // 模式 0 是键盘+鼠标+自定义HID 的三功能复合设备，macOS 绑不上里面的相对
    // 鼠标；厂商对 macOS/Linux/Android 建议模式 2（键盘+鼠标）。
    await t.test("切到模式 2 只改工作模式字段", async function () {
        const {chip, ch} = newChip({baudRate: 9600});
        const before = chip.state.paraCfg.slice();
        const result = await ch.setWorkingMode(2);
        assert.deepStrictEqual(result, {ok: true});
        assert.strictEqual(chip.state.paraCfg[0], 0x02);
        assert.deepStrictEqual(chip.state.paraCfg.slice(2), before.slice(2),
            "波特率等其余字段必须原样保留");
    });

    await t.test("写回时抹掉串口模式的硬件引脚位，避免芯片判错", async function () {
        const {chip, ch} = newChip({baudRate: 9600});
        assert.strictEqual(chip.state.paraCfg[1], 0x80, "读到的是引脚设置的协议模式");
        await ch.setWorkingMode(2);
        assert.strictEqual(chip.state.paraCfg[1], 0x00);
        assert.deepStrictEqual(chip.state.rejected, [], "不应被芯片判为参数错误");
    });

    await t.test("读工作模式时要去掉硬件引脚位", async function () {
        const {chip, ch} = newChip({baudRate: 9600});
        assert.strictEqual(ch.readParaWorkingMode(chip.state.paraCfg), 0,
            "0x80 是引脚设置的模式 0，模式号仍然是 0");
    });

    await t.test("已经是目标模式时不重复写入", async function () {
        // 0x80 是引脚设置的模式 0，模式号就是 0，不该再写一遍
        const {chip, ch} = newChip({baudRate: 9600});
        const result = await ch.setWorkingMode(0);
        assert.deepStrictEqual(result, {ok: true, unchanged: true});
        assert.strictEqual(chip.state.received.filter(function (f) { return f.cmd === 0x09; }).length, 0);
    });

    await t.test("超出 0-3 的模式直接拒绝，不去碰芯片", async function () {
        const {chip, ch} = newChip({baudRate: 9600});
        for (const bad of [-1, 4, 0x80, null, undefined]) {
            const result = await ch.setWorkingMode(bad);
            assert.strictEqual(result.ok, false, "模式 " + bad + " 应被拒绝");
            assert.match(result.reason, /只能是 0-3/);
        }
        assert.strictEqual(chip.state.received.length, 0, "一个包都不该发出去");
    });

    await t.test("芯片无应答时如实报错", async function () {
        const {ch} = newChip({silent: true});
        const warn = console.warn;
        console.warn = function () {
        };
        try {
            const result = await ch.setWorkingMode(2);
            assert.strictEqual(result.ok, false);
            assert.match(result.reason, /读取芯片参数配置失败/);
        } finally {
            console.warn = warn;
        }
    });
});

test("恢复出厂配置", async function (t) {
    // 配置写坏时的退路，所以它必须是不依赖当前配置的独立命令
    await t.test("发出 CMD_SET_DEFAULT_CFG 且不带参数", async function () {
        const {chip, ch} = newChip({baudRate: 115200});
        const result = await ch.restoreDefaultCfg();
        assert.deepStrictEqual(result, {ok: true, status: 0x00});
        const sent = chip.state.received.filter(function (f) { return f.cmd === 0x0C; });
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].data.length, 0, "该命令不带任何参数");
    });

    await t.test("执行后芯片配置回到出厂值", async function () {
        const {chip, ch} = newChip({baudRate: 115200});
        await ch.setWorkingMode(2);
        assert.strictEqual(chip.state.paraCfg[0], 0x02);
        await ch.restoreDefaultCfg();
        assert.strictEqual(chip.state.paraCfg[0], 0x80, "工作模式回到出厂默认");
        assert.strictEqual(ch.readParaBaudRate(chip.state.paraCfg), 9600, "波特率回到 9600");
    });

    await t.test("芯片无应答时返回失败而不是假装成功", async function () {
        const {ch} = newChip({silent: true});
        const warn = console.warn;
        console.warn = function () {
        };
        try {
            const result = await ch.restoreDefaultCfg();
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, null);
        } finally {
            console.warn = warn;
        }
    });
});

test("连接时探测波特率", async function (t) {
    await t.test("设置里的首选值不对时自动找到芯片实际波特率", async function () {
        const fake = createFakePort({chipBaudRate: 115200});
        const warn = console.warn;
        console.warn = function () {
        };
        let connection;
        try {
            connection = await Ch9329.connect(fake.port, [9600, 115200], true);
        } finally {
            console.warn = warn;
        }
        assert.strictEqual(connection.baudRate, 115200);
        assert.strictEqual(connection.probed, true);
        assert.ok(connection.info);
        assert.deepStrictEqual(fake.log, ["open@9600", "close", "open@115200"]);
        await connection.ch.dispose();
    });

    await t.test("首选值正确时一次命中", async function () {
        const fake = createFakePort({chipBaudRate: 115200});
        const connection = await Ch9329.connect(fake.port, [115200, 9600], true);
        assert.strictEqual(connection.baudRate, 115200);
        assert.deepStrictEqual(fake.log, ["open@115200"]);
        await connection.ch.dispose();
    });

    await t.test("完全不应答时退回首选波特率且仍可用", async function () {
        const fake = createFakePort({chipBaudRate: 9600, silent: true});
        const warn = console.warn;
        console.warn = function () {
        };
        let connection;
        try {
            connection = await Ch9329.connect(fake.port, [9600, 115200], true);
        } finally {
            console.warn = warn;
        }
        assert.strictEqual(connection.info, null);
        assert.strictEqual(connection.probed, false);
        assert.strictEqual(connection.baudRate, 9600);
        assert.ok(connection.ch, "仍应返回可用实例，退化成只发不等");
        await connection.ch.dispose();
    });
});

test("接收方向的帧解析", async function (t) {
    const {ch} = newChip();

    await t.test("半截帧先留在缓冲区", function () {
        ch._rxBuffer = new Uint8Array([0x57, 0xAB, 0x00, 0x82, 0x01]);
        assert.strictEqual(ch._shiftFrame(), null);
    });

    await t.test("校验和不符的帧被丢弃，后面的好帧照常解析", function () {
        ch._rxBuffer = new Uint8Array([
            0xFF, 0x00,                                // 垃圾前缀
            0x57, 0xAB, 0x00, 0x82, 0x01, 0x00, 0xFF,  // 坏校验和
            0x57, 0xAB, 0x00, 0x84, 0x01, 0x00, 0x87   // 好帧
        ]);
        const frame = ch._shiftFrame();
        assert.strictEqual(frame.cmd, 0x84);
        assert.deepStrictEqual(Array.from(frame.data), [0x00]);
        assert.strictEqual(ch._shiftFrame(), null, "不应有残留");
    });

    // 下面这串是从真实 CH9329F 的 COM5 上抓的 GET_PARA_CFG 回包原样。
    // 注意 LEN 字段写的是 0x32(50)，但数据区实际有 65 字节，校验和 0x25 落在
    // 第 71 个字节上。按 6+LEN 死算帧尾会取到 0x00，整帧被误判成坏帧丢掉。
    const CH9329F_PARA_REPLY = [
        0x57, 0xAB, 0x00, 0x88, 0x32,
        0x80, 0x80, 0x00, 0x00, 0x00, 0x25, 0x80, 0x08, 0x00, 0x00, 0x03, 0x86,
        0x1A, 0x2A, 0xE1, 0x00, 0x00, 0x00, 0x01, 0x00, 0x0D,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x25
    ];

    await t.test("LEN 少报时按真正的校验和定帧尾（CH9329F 实测回包）", function () {
        assert.strictEqual(CH9329F_PARA_REPLY.length, 71, "抓包就是 71 字节，不是 6+50");
        ch._rxBuffer = new Uint8Array(CH9329F_PARA_REPLY);
        const frame = ch._shiftFrame();
        assert.ok(frame, "这一帧必须能解析出来，否则就是当前的报错现场");
        assert.strictEqual(frame.cmd, 0x88);
        assert.strictEqual(frame.data.length, 65, "数据区是实际收到的 65 字节");
        assert.strictEqual(ch._shiftFrame(), null, "不应有残留");
    });

    await t.test("这种回包分两次到达也能拼起来", function () {
        ch._rxBuffer = new Uint8Array(0);
        // 第一块正好停在「按 LEN 算的帧尾」处，最容易被误判成坏帧
        ch._appendRx(new Uint8Array(CH9329F_PARA_REPLY.slice(0, 56)));
        assert.strictEqual(ch._shiftFrame(), null, "还没收全，得留着等后续");
        ch._appendRx(new Uint8Array(CH9329F_PARA_REPLY.slice(56)));
        const frame = ch._shiftFrame();
        assert.ok(frame, "补齐后要能解析出来");
        assert.strictEqual(frame.cmd, 0x88);
        assert.strictEqual(frame.data.length, 65);
    });

    await t.test("多回的补零不会混进配置里", async function () {
        const {ch: fresh} = newChip({baudRate: 9600});
        fresh._rxBuffer = new Uint8Array(0);
        fresh._appendRx(new Uint8Array(CH9329F_PARA_REPLY));
        const frame = fresh._shiftFrame();
        // getParaCfg 只取前 50 字节，写回芯片时才不会超出协议规定的长度
        assert.strictEqual(frame.data.slice(0, 50).length, 50);
        assert.strictEqual(fresh.readParaBaudRate(frame.data.slice(0, 50)), 9600,
            "前 50 字节里的波特率仍要能正确读出");
    });

    await t.test("分两次到达的帧能拼起来", function () {
        ch._rxBuffer = new Uint8Array(0);
        ch._appendRx(new Uint8Array([0x57, 0xAB, 0x00]));
        assert.strictEqual(ch._shiftFrame(), null);
        ch._appendRx(new Uint8Array([0x82, 0x01, 0x00, 0x85]));
        const frame = ch._shiftFrame();
        assert.strictEqual(frame.cmd, 0x82);
    });
});

test("文本输入", async function (t) {
    await t.test("逐字符发送按下与释放", async function () {
        const {chip, ch} = newChip();
        const result = await ch.typeText("Ab");
        assert.deepStrictEqual(result, {typed: 2, skipped: 0, capsToggled: false});
        const keyFrames = chip.state.received.filter(function (f) { return f.cmd === 0x02; });
        assert.strictEqual(keyFrames.length, 4, "两个字符对应 4 个键盘包");
        assert.strictEqual(keyFrames[0].data[0], 0x02, "大写 A 需要按住 Shift");
        assert.strictEqual(keyFrames[0].data[2], 0x04);
        assert.deepStrictEqual(keyFrames[1].data, [0, 0, 0, 0, 0, 0, 0, 0]);
        assert.strictEqual(keyFrames[2].data[0], 0x00, "小写 b 不带 Shift");
        assert.strictEqual(keyFrames[2].data[2], 0x05);
    });

    await t.test("键码表达不了的字符被跳过", async function () {
        const {ch} = newChip();
        const result = await ch.typeText("a中文b");
        assert.strictEqual(result.typed, 2);
        assert.strictEqual(result.skipped, 2);
    });

    await t.test("目标机 Caps Lock 亮着时先关掉再输入", async function () {
        const {chip, ch} = newChip({info: {led: 0x02}});
        const result = await ch.typeText("a");
        assert.strictEqual(result.capsToggled, true);
        const keyFrames = chip.state.received.filter(function (f) { return f.cmd === 0x02; });
        assert.strictEqual(keyFrames[0].data[2], 0x39, "第一个按键应是 Caps Lock");
    });

    await t.test("Caps Lock 已关时不多按", async function () {
        const {chip, ch} = newChip({info: {led: 0x00}});
        const result = await ch.typeText("a");
        assert.strictEqual(result.capsToggled, false);
        const keyFrames = chip.state.received.filter(function (f) { return f.cmd === 0x02; });
        assert.strictEqual(keyFrames[0].data[2], 0x04);
    });
});

test("滚轮按齿数编码", async function (t) {
    async function wheelByteOf(notches) {
        const {chip, ch} = newChip();
        await ch.mouseScroll(notches);
        await new Promise(function (r) { setTimeout(r, 30); });
        const frames = framesOf(chip, 0x04);
        return frames.length ? frames[0][11] : null;
    }

    await t.test("正数向上、负数向下，用补码表示", async function () {
        assert.strictEqual(await wheelByteOf(1), 0x01, "向上 1 格");
        assert.strictEqual(await wheelByteOf(-1), 0xFF, "向下 1 格");
        assert.strictEqual(await wheelByteOf(3), 0x03);
        assert.strictEqual(await wheelByteOf(-3), 0xFD);
    });

    await t.test("夹在协议允许的 ±127 齿内", async function () {
        assert.strictEqual(await wheelByteOf(127), 0x7F);
        assert.strictEqual(await wheelByteOf(-127), 0x81);
        assert.strictEqual(await wheelByteOf(9999), 0x7F);
        assert.strictEqual(await wheelByteOf(-9999), 0x81);
    });

    await t.test("零齿数不发包", async function () {
        assert.strictEqual(await wheelByteOf(0), null);
        assert.strictEqual(await wheelByteOf(0.4), null, "不足一格不应发包");
    });

    await t.test("滚动时保留当前按住的键", async function () {
        const {chip, ch} = newChip();
        ch.clicked.command = 0x01;
        await ch.mouseScroll(-2);
        await new Promise(function (r) { setTimeout(r, 30); });
        const frame = framesOf(chip, 0x04)[0];
        assert.strictEqual(frame[6], 0x01, "左键仍按着");
        assert.strictEqual(frame[11], 0xFE, "向下 2 格");
    });

    await t.test("相对模式下走 0x05 命令", async function () {
        const chip = createFakeChip();
        const ch = new Ch9329(chip.writer, false, chip.reader);
        await ch.mouseScroll(-1);
        await new Promise(function (r) { setTimeout(r, 30); });
        const frame = framesOf(chip, 0x05)[0];
        assert.strictEqual(hex(frame), "57 ab 00 05 05 01 00 00 00 ff 0c");
    });
});

test("串口断开", async function (t) {
    function brokenWriter() {
        return {
            write: async function () {
                throw new Error("The device has been lost.");
            }
        };
    }

    await t.test("写失败时标记断开并回调一次", async function () {
        const ch = new Ch9329(brokenWriter(), true, null);
        let calls = 0;
        ch.onTransportError = function () {
            calls++;
        };
        assert.strictEqual(ch.isConnected(), true);
        await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert.strictEqual(ch.isConnected(), false);
        assert.strictEqual(calls, 1);

        await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert.strictEqual(calls, 1, "断开后不应反复回调");
    });

    await t.test("断开后命令直接丢弃，不再写串口", async function () {
        const {chip, ch} = newChip();
        ch.markDisconnected();
        await ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
        ch.mouseMove(fakeVideo(1920, 1080), 100, 100);
        await new Promise(function (r) { setTimeout(r, 50); });
        assert.deepStrictEqual(chip.state.raw, [], "不应再有任何字节发出");
    });

    await t.test("断开时排队中的命令被结束掉，不会卡住调用方", async function () {
        const {ch} = newChip({silent: true, replyDelayMs: 0});
        const warn = console.warn;
        console.warn = function () {
        };
        try {
            const pending = ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
            const queued = ch.write(ch.toUnit8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]));
            ch.markDisconnected();
            assert.strictEqual(await queued, null, "排队未发的命令应立即以 null 结束");
            await pending;
        } finally {
            console.warn = warn;
        }
    });
});

test("GET_INFO 解析", async function (t) {
    await t.test("版本、USB 枚举、指示灯、休眠位", async function () {
        const {ch} = newChip({info: {version: 0x31, usbConnected: 0x01, led: 0x07, sleep: 0x03}});
        const info = await ch.getInfo();
        assert.deepStrictEqual(info, {
            version: "V3.1",
            usbConnected: true,
            numLock: true,
            capsLock: true,
            scrollLock: true,
            asleep: true
        });
    });

    await t.test("USB 未枚举、未睡眠", async function () {
        const {ch} = newChip({info: {version: 0x30, usbConnected: 0x00, led: 0x00, sleep: 0x00}});
        const info = await ch.getInfo();
        assert.strictEqual(info.usbConnected, false);
        assert.strictEqual(info.asleep, false);
    });
});
