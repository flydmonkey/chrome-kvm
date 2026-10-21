const test = require("node:test");
const assert = require("node:assert");

const PageLogic = require("../page-logic.js");
const SettingsStore = require("../settings-store.js");

const CARD = {deviceId: "cap1", label: "USB Video"};
const CARD_AUDIO = {deviceId: "aud1", label: "USB Audio"};
const CH340 = JSON.stringify({usbVendorId: 6790, usbProductId: 29987});

test("设置换算成采集参数", async (t) => {
    await t.test("没选采集卡返回 null，键鼠照常连", () => {
        assert.strictEqual(PageLogic.mediaArgsFrom({}, SettingsStore), null);
        assert.strictEqual(PageLogic.mediaArgsFrom({video: {}}, SettingsStore), null);
        assert.strictEqual(PageLogic.mediaArgsFrom(null, SettingsStore), null);
    });

    await t.test("没存分辨率时按 1920×1080 要", () => {
        let args = PageLogic.mediaArgsFrom({video: CARD}, SettingsStore);
        assert.strictEqual(args.width, 1920);
        assert.strictEqual(args.height, 1080);
        assert.strictEqual(args.videoDeviceId, "cap1");
    });

    await t.test("用存下的分辨率和帧率", () => {
        let args = PageLogic.mediaArgsFrom({
            video: CARD,
            resolution: {width: 2560, height: 1440},
            frameRate: 60
        }, SettingsStore);
        assert.strictEqual(args.width, 2560);
        assert.strictEqual(args.height, 1440);
        assert.strictEqual(args.frameRate, 60);
    });

    await t.test("帧率怪值退回不指定", () => {
        let args = PageLogic.mediaArgsFrom({video: CARD, frameRate: 144}, SettingsStore);
        assert.strictEqual(args.frameRate, 0);
    });

    await t.test("采集卡音频关掉回声消除这类处理，否则被控端的声音会被当成噪音削掉", () => {
        let args = PageLogic.mediaArgsFrom({video: CARD, audio: CARD_AUDIO}, SettingsStore);
        assert.deepStrictEqual(args.audio, {
            deviceId: {exact: "aud1"},
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        });
    });

    await t.test("没选音频就不要音频", () => {
        let args = PageLogic.mediaArgsFrom({video: CARD, audio: {}}, SettingsStore);
        assert.strictEqual(args.audio, undefined);
    });
});

test("设置变了要重做什么", async (t) => {
    function changes(previous, next, speed) {
        return PageLogic.settingsChanges(previous, next, speed == null ? 1 : speed, SettingsStore);
    }

    await t.test("什么都没变就什么都不做", () => {
        let s = {video: CARD, usb: {deviceId: CH340}, relativeSpeed: 1};
        let c = changes(s, JSON.parse(JSON.stringify(s)));
        assert.strictEqual(c.relativeSpeed, null);
        assert.strictEqual(c.media, false);
        assert.strictEqual(c.serial, false);
        assert.deepStrictEqual(c.labels, []);
    });

    await t.test("只改灵敏度：即时生效，不重开视频也不重连", () => {
        let c = changes({video: CARD, relativeSpeed: 1}, {video: CARD, relativeSpeed: 2.5});
        assert.strictEqual(c.relativeSpeed, 2.5);
        assert.strictEqual(c.media, false);
        assert.strictEqual(c.serial, false);
        assert.deepStrictEqual(c.labels, ["相对模式灵敏度"]);
    });

    await t.test("灵敏度和当前值比，不和上次存的比：控制台里手调过的值也会被设置覆盖回来", () => {
        let c = changes({relativeSpeed: 2}, {relativeSpeed: 2}, 1.8);
        assert.strictEqual(c.relativeSpeed, 2);
    });

    await t.test("换分辨率、帧率或采集卡都要重开视频", () => {
        assert.strictEqual(changes({video: CARD}, {video: CARD, resolution: {width: 1280, height: 720}}).media, true);
        assert.strictEqual(changes({video: CARD}, {video: CARD, frameRate: 60}).media, true);
        assert.strictEqual(changes({video: CARD}, {video: {deviceId: "cap2"}}).media, true);
    });

    await t.test("视频重开时带上新参数；去掉采集卡时参数是 null", () => {
        let c = changes({video: CARD}, {});
        assert.strictEqual(c.media, true);
        assert.strictEqual(c.mediaArgs, null);
        assert.deepStrictEqual(c.labels, ["视频"]);
    });

    await t.test("换串口或鼠标模式要重连", () => {
        assert.strictEqual(changes({usb: {deviceId: CH340}}, {usb: {deviceId: "other"}}).serial, true);
        assert.strictEqual(changes({usb: {deviceId: CH340}}, {usb: {deviceId: CH340}, mouseClickMode: "relative"}).serial, true);
    });

    await t.test("波特率、工作模式是写芯片时顺手存的，不该触发重连", () => {
        let c = changes({usb: {deviceId: CH340}, baudRate: 9600, workingMode: 0},
            {usb: {deviceId: CH340}, baudRate: 115200, workingMode: 2});
        assert.strictEqual(c.serial, false);
        assert.deepStrictEqual(c.labels, []);
    });

    await t.test("没写鼠标模式就是绝对模式，和显式写 absolute 一样", () => {
        assert.strictEqual(PageLogic.serialKey({}), PageLogic.serialKey({mouseClickMode: "absolute"}));
        assert.notStrictEqual(PageLogic.serialKey({}), PageLogic.serialKey({mouseClickMode: "relative"}));
    });

    await t.test("几样一起变时提示里都列出来", () => {
        let c = changes({video: CARD, relativeSpeed: 1}, {relativeSpeed: 3, usb: {deviceId: CH340}});
        assert.deepStrictEqual(c.labels, ["相对模式灵敏度", "视频", "键鼠"]);
    });
});

test("从匹配的端口里挑一个能用的", async (t) => {
    function port(name, behavior) {
        return {name: name, behavior: behavior};
    }

    function harness() {
        let released = [];
        return {
            released: released,
            connect: async function (p) {
                if (p.behavior === "throw") {
                    throw new Error(p.name + " 打不开串口");
                }
                return {info: p.behavior === "ok" ? {version: "V1.0"} : null};
            },
            release: async function (candidate) {
                released.push(candidate.port.name);
            }
        };
    }

    await t.test("有能应答的就用它", async () => {
        let h = harness();
        let picked = await PageLogic.connectFirstWorking([port("a", "ok")], h.connect, h.release);
        assert.strictEqual(picked.port.name, "a");
        assert.deepStrictEqual(h.released, []);
    });

    await t.test("前面那个只能打开不应答时，后面能应答的优先，并把前面的还回去", async () => {
        let h = harness();
        let picked = await PageLogic.connectFirstWorking(
            [port("mute", "mute"), port("good", "ok")], h.connect, h.release);
        assert.strictEqual(picked.port.name, "good");
        assert.deepStrictEqual(h.released, ["mute"], "串口是独占的，不还回去就把自己挡在门外");
    });

    await t.test("都不应答时退回第一个能打开的，多余的还回去", async () => {
        let h = harness();
        let picked = await PageLogic.connectFirstWorking(
            [port("m1", "mute"), port("m2", "mute")], h.connect, h.release);
        assert.strictEqual(picked.port.name, "m1");
        assert.strictEqual(picked.connection.info, null, "状态栏要照实显示芯片无应答");
        assert.deepStrictEqual(h.released, ["m2"]);
    });

    await t.test("打不开的跳过，不影响后面的", async () => {
        let h = harness();
        let picked = await PageLogic.connectFirstWorking(
            [port("busy", "throw"), port("good", "ok")], h.connect, h.release);
        assert.strictEqual(picked.port.name, "good");
    });

    await t.test("全都打不开才抛错，抛的是最后一个错误", async () => {
        let h = harness();
        await assert.rejects(
            () => PageLogic.connectFirstWorking([port("x", "throw"), port("y", "throw")], h.connect, h.release),
            /y 打不开串口/
        );
    });

    await t.test("没有候选时返回 null", async () => {
        let h = harness();
        assert.strictEqual(await PageLogic.connectFirstWorking([], h.connect, h.release), null);
    });
});

test("打开视频失败的提示", async (t) => {
    await t.test("设备不在时把 OverconstrainedError 翻译成能照着做的话", () => {
        let message = PageLogic.describeMediaOpenError({name: "OverconstrainedError", message: ""});
        assert.match(message, /找不到设置里选的采集卡/);
    });

    await t.test("其它错误原样显示", () => {
        assert.strictEqual(PageLogic.describeMediaOpenError({name: "NotReadableError", message: "设备被占用"}),
            "设备被占用");
        assert.strictEqual(PageLogic.describeMediaOpenError("怪错误"), "怪错误");
    });
});

test("录制编码", async (t) => {
    await t.test("挑第一个支持的", () => {
        let picked = PageLogic.pickRecordMimeType(function (type) {
            return type.indexOf("vp8") !== -1;
        });
        assert.strictEqual(picked, "video/webm;codecs=vp8,opus");
    });

    await t.test("VP9 支持时优先 VP9", () => {
        assert.strictEqual(PageLogic.pickRecordMimeType(function () { return true; }),
            PageLogic.RECORD_MIME_TYPES[0]);
    });

    await t.test("都不支持或者没有检测函数时返回空串，交给浏览器默认", () => {
        assert.strictEqual(PageLogic.pickRecordMimeType(function () { return false; }), "");
        assert.strictEqual(PageLogic.pickRecordMimeType(undefined), "");
    });
});

test("粘贴结束的提示", async (t) => {
    await t.test("全部敲完是普通提示，几秒后自己消失", () => {
        let s = PageLogic.pasteSummary({typed: 12, skipped: 0, cancelled: false});
        assert.strictEqual(s.message, "已粘贴 12 个字符");
        assert.strictEqual(s.level, "info");
        assert.strictEqual(s.timeout, 3000);
    });

    await t.test("有跳过的字符是警告，不自动收起前就得让人看到", () => {
        let s = PageLogic.pasteSummary({typed: 2, skipped: 3, cancelled: false});
        assert.strictEqual(s.level, "warn");
        assert.match(s.message, /跳过 3 个/);
        assert.strictEqual(s.timeout, undefined, "交给默认的警告时长");
    });

    await t.test("取消了要说清楚已经敲了多少", () => {
        let s = PageLogic.pasteSummary({typed: 7, skipped: 0, cancelled: true});
        assert.strictEqual(s.level, "warn");
        assert.strictEqual(s.message, "已取消粘贴。已粘贴 7 个字符");
    });
});

test("提示条多久自动消失", async (t) => {
    await t.test("错误默认不消失，里面常有排错用的详细信息", () => {
        assert.strictEqual(PageLogic.noticeTimeout("error"), 0);
    });

    await t.test("普通和警告默认 6 秒", () => {
        assert.strictEqual(PageLogic.noticeTimeout("info"), 6000);
        assert.strictEqual(PageLogic.noticeTimeout("warn"), 6000);
    });

    await t.test("显式给了就按给的来，包括 0", () => {
        assert.strictEqual(PageLogic.noticeTimeout("info", 3000), 3000);
        assert.strictEqual(PageLogic.noticeTimeout("warn", 0), 0);
    });
});
