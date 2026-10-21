const test = require("node:test");
const assert = require("node:assert");

const DeviceFilter = require("../device-filter.js");

// enumerateDevices() 返回的形状
function device(kind, deviceId, label) {
    return {kind: kind, deviceId: deviceId, label: label};
}

const CAPTURE_CARD = device("videoinput", "cap1", "USB Video");
const BUILTIN_CAM = device("videoinput", "cam1", "FaceTime HD Camera");
const CAPTURE_AUDIO = device("audioinput", "aud1", "数字音频接口 (USB Digital Audio)");
const BUILTIN_MIC = device("audioinput", "mic1", "麦克风 (Realtek High Definition Audio)");

test("内置设备识别", async (t) => {
    await t.test("按关键词认出内置摄像头和麦克风", () => {
        assert.strictEqual(DeviceFilter.looksBuiltIn(BUILTIN_CAM), true);
        assert.strictEqual(DeviceFilter.looksBuiltIn(BUILTIN_MIC), true);
    });

    await t.test("采集卡不该被认成内置", () => {
        assert.strictEqual(DeviceFilter.looksBuiltIn(CAPTURE_CARD), false);
        assert.strictEqual(DeviceFilter.looksBuiltIn(CAPTURE_AUDIO), false);
    });

    await t.test("关键词不分大小写", () => {
        assert.strictEqual(DeviceFilter.looksBuiltIn(device("videoinput", "x", "FACETIME HD")), true);
    });

    await t.test("label 缺失时不当成内置，宁可多列也别漏掉设备", () => {
        assert.strictEqual(DeviceFilter.looksBuiltIn(device("videoinput", "x", "")), false);
        assert.strictEqual(DeviceFilter.looksBuiltIn(device("videoinput", "x", undefined)), false);
    });

    await t.test("没有关键词表的设备类型一律不过滤", () => {
        assert.strictEqual(DeviceFilter.looksBuiltIn(device("audiooutput", "spk", "麦克风")), false);
    });
});

test("下拉框设备列表", async (t) => {
    await t.test("只取指定类型的设备", () => {
        let list = DeviceFilter.forKind([CAPTURE_CARD, CAPTURE_AUDIO], "videoinput", null);
        assert.deepStrictEqual(list, [CAPTURE_CARD]);
    });

    await t.test("有采集卡时把内置设备收起来", () => {
        let list = DeviceFilter.forKind([BUILTIN_CAM, CAPTURE_CARD], "videoinput", null);
        assert.deepStrictEqual(list, [CAPTURE_CARD]);
    });

    await t.test("已保存的设备一定保留，哪怕看着像内置的", () => {
        let list = DeviceFilter.forKind([BUILTIN_CAM, CAPTURE_CARD], "videoinput", "cam1");
        assert.deepStrictEqual(list, [BUILTIN_CAM, CAPTURE_CARD]);
    });

    await t.test("全被过滤光时退回完整列表，否则一个都选不了", () => {
        let list = DeviceFilter.forKind([BUILTIN_CAM], "videoinput", null);
        assert.deepStrictEqual(list, [BUILTIN_CAM]);
    });

    await t.test("中文 Windows 把采集卡音频叫「麦克风 (…)」时也不会被过滤光", () => {
        let cardAudio = device("audioinput", "aud2", "麦克风 (USB Audio Device)");
        let list = DeviceFilter.forKind([cardAudio], "audioinput", null);
        assert.deepStrictEqual(list, [cardAudio], "唯一的音频设备必须还能选到");
    });

    await t.test("没有该类型设备时返回空列表", () => {
        assert.deepStrictEqual(DeviceFilter.forKind([CAPTURE_CARD], "audioinput", null), []);
    });

    await t.test("设备列表为空或缺失都不炸", () => {
        assert.deepStrictEqual(DeviceFilter.forKind([], "videoinput", null), []);
        assert.deepStrictEqual(DeviceFilter.forKind(null, "videoinput", null), []);
    });

    await t.test("不修改传进来的数组", () => {
        let devices = [BUILTIN_CAM, CAPTURE_CARD];
        DeviceFilter.forKind(devices, "videoinput", null);
        assert.deepStrictEqual(devices, [BUILTIN_CAM, CAPTURE_CARD]);
    });
});

test("串口下拉框文案", async (t) => {
    await t.test("认识的芯片显示厂商、型号和十六进制 VID:PID", () => {
        // getInfo() 给的是十进制数：6790 = 0x1A86，29987 = 0x7523
        assert.strictEqual(DeviceFilter.serialPortLabel({usbVendorId: 6790, usbProductId: 29987}),
            "WCH CH340（1A86:7523）");
    });

    await t.test("厂商认识但型号不认识时只说厂商", () => {
        assert.strictEqual(DeviceFilter.serialPortLabel({usbVendorId: 0x1A86, usbProductId: 0x1234}),
            "WCH 串口（1A86:1234）");
    });

    await t.test("都不认识也照样给出 VID:PID，方便查", () => {
        assert.strictEqual(DeviceFilter.serialPortLabel({usbVendorId: 0x2E8A, usbProductId: 0x000A}),
            "未知串口（2E8A:000A）");
    });

    await t.test("十六进制补足四位", () => {
        assert.strictEqual(DeviceFilter.serialPortLabel({usbVendorId: 0x0403, usbProductId: 0x6001}),
            "FTDI FT232R（0403:6001）");
    });

    await t.test("没有 USB 信息的串口不炸", () => {
        assert.strictEqual(DeviceFilter.serialPortLabel({}), "串口（无 USB 信息）");
        assert.strictEqual(DeviceFilter.serialPortLabel(null), "串口（无 USB 信息）");
    });

    await t.test("缺 PID 时用问号占位", () => {
        assert.strictEqual(DeviceFilter.serialPortLabel({usbVendorId: 0x1A86}), "WCH 串口（1A86:????）");
    });
});
