// 设置页下拉框里该列哪些设备。enumerateDevices 会把内置摄像头、
// 各种虚拟麦克风一起报上来，全列出来反而不好找采集卡。
var I18n = typeof I18n !== "undefined" ? I18n : require("./i18n.js");

var DeviceFilter = (function () {
    var t = I18n.t;

    // 注意中文 Windows 会把音频输入命名成「麦克风 (设备名)」，采集卡也可能中招，
    // 所以过滤掉的设备必须能靠下面的兜底重新出现
    var BUILTIN_HINTS = {
        videoinput: ["facetime", "相机", "microsoft"],
        audioinput: ["麦克风", "microsoft"]
    };

    function looksBuiltIn(device) {
        var hints = BUILTIN_HINTS[device.kind] || [];
        var label = (device.label || "").toLowerCase();
        for (var i = 0; i < hints.length; i++) {
            if (label.indexOf(hints[i]) !== -1) {
                return true;
            }
        }
        return false;
    }

    // 过滤只是便利：已保存的设备一定保留，全被过滤光时退回完整列表，
    // 否则会出现「设置里引用的设备在下拉框里根本选不到」
    function forKind(devices, kind, savedDeviceId) {
        var all = (devices || []).filter(function (device) {
            return device.kind === kind;
        });
        var visible = all.filter(function (device) {
            return !looksBuiltIn(device) || device.deviceId === savedDeviceId;
        });
        return visible.length ? visible : all;
    }

    // Web Serial 只给 VID/PID，不给设备名。原来直接把两个十进制数字摆出来，
    // 用户得自己换算成十六进制再去查，才知道哪个是接 CH9329 的那颗 USB 转串口芯片
    var SERIAL_VENDORS = {
        0x1A86: "WCH",
        0x0403: "FTDI",
        0x10C4: "Silicon Labs",
        0x067B: "Prolific"
    };
    var SERIAL_CHIPS = {
        "1A86:7523": "CH340",
        "1A86:7522": "CH340K",
        "1A86:5523": "CH341",
        "1A86:55D2": "CH342",
        "1A86:55D3": "CH343",
        "1A86:55D4": "CH9102",
        "0403:6001": "FT232R",
        "0403:6015": "FT231X",
        "10C4:EA60": "CP210x",
        "067B:2303": "PL2303"
    };

    function hex4(value) {
        return ("0000" + value.toString(16).toUpperCase()).slice(-4);
    }

    // info 是 SerialPort.getInfo() 的返回值
    function serialPortLabel(info) {
        if (!info || info.usbVendorId == null) {
            // 蓝牙串口和主板自带的 COM 口没有 USB 信息
            return t("serialPort.noUsbInfo");
        }
        var vid = hex4(info.usbVendorId);
        var pid = info.usbProductId == null ? "????" : hex4(info.usbProductId);
        var id = vid + ":" + pid;
        var chip = SERIAL_CHIPS[id];
        var vendor = SERIAL_VENDORS[info.usbVendorId];
        var name;
        if (chip) {
            name = (vendor ? vendor + " " : "") + chip;
        } else if (vendor) {
            name = t("serialPort.vendor", {vendor: vendor});
        } else {
            name = t("serialPort.unknown");
        }
        return t("serialPort.withId", {name: name, id: id});
    }

    return {
        BUILTIN_HINTS: BUILTIN_HINTS,
        looksBuiltIn: looksBuiltIn,
        forKind: forKind,
        serialPortLabel: serialPortLabel
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = DeviceFilter;
}
