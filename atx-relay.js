// ATX 电源控制：USB 串口继电器（LCUS 系列）并在主板前面板的电源键跳线上，
// 继电器吸合就等于按下电源键。短按开机或让系统正常关机，长按强制断电。
var AtxRelay = (function () {
    var BAUD_RATE = 9600;
    var CHANNELS = [1, 2, 3, 4];
    var SHORT_PRESS_MS = 500;
    // ATX 规范是按住 4 秒强制关机，多按一会儿给慢的主板留余量
    var LONG_PRESS_MS = 6000;

    var PRESSES = {
        short: {ms: SHORT_PRESS_MS, label: "按一下电源键"},
        long: {ms: LONG_PRESS_MS, label: "长按电源键强制关机"}
    };

    // LCUS 协议：A0 通道 开关 校验和（前三字节相加取低 8 位）
    function command(channel, on) {
        var state = on ? 1 : 0;
        return [0xA0, channel, state, (0xA0 + channel + state) & 0xFF];
    }

    function normalizeChannel(value) {
        var n = typeof value === "number" ? value : parseInt(value, 10);
        return CHANNELS.indexOf(n) === -1 ? 1 : n;
    }

    // 没选继电器就返回 null，页面据此隐藏电源按钮
    function normalize(atx) {
        if (!atx || typeof atx !== "object" || !atx.deviceId) {
            return null;
        }
        return {
            deviceId: atx.deviceId,
            label: atx.label || "",
            channel: normalizeChannel(atx.channel)
        };
    }

    function matches(port, filter) {
        var info = port.getInfo();
        return (filter.usbVendorId == null || info.usbVendorId === filter.usbVendorId)
            && (filter.usbProductId == null || info.usbProductId === filter.usbProductId);
    }

    // 继电器和 CH9329 多半都是 CH340，VID/PID 一模一样，只能先把键鼠正在用的
    // 那个排除掉
    function candidatePorts(ports, filter, chipPort) {
        if (!ports || !filter || (filter.usbVendorId == null && filter.usbProductId == null)) {
            return [];
        }
        return ports.filter(function (port) {
            return port !== chipPort && matches(port, filter);
        });
    }

    // 剩下的逐个试着打开：打不开的是不在位的旧授权。能打开的不止一个时宁可
    // 报错，按错了就是给另一台机器断电
    async function openRelayPort(ports, filter, chipPort) {
        var candidates = candidatePorts(ports, filter, chipPort);
        if (candidates.length === 0) {
            return {error: "没有找到继电器串口。请确认继电器已插好，并在设置页授权、选中它。"};
        }
        var opened = [];
        for (var i = 0; i < candidates.length; i++) {
            try {
                await candidates[i].open({baudRate: BAUD_RATE});
                opened.push(candidates[i]);
            } catch (e) {
                // 打不开就跳过
            }
        }
        if (opened.length === 1) {
            return {port: opened[0]};
        }
        await Promise.all(opened.map(function (port) {
            return port.close().catch(function () {});
        }));
        if (opened.length === 0) {
            return {error: "继电器串口打不开，可能被别的标签页或程序占用了。"};
        }
        return {error: "有 " + opened.length + " 个同型号串口都能打开，分不清哪个是继电器。"
            + "先让键鼠连上（它会占掉 CH9329 那个），或拔掉多余的串口设备再试。"};
    }

    // 吸合、等待、断开。断开放在 finally 里：中途出错也要尽量松开，否则电源键
    // 一直按着，机器会被强制关机。cancel 用来提前松开长按
    async function press(port, channel, ms, cancel) {
        var writer = port.writable.getWriter();
        try {
            await writer.write(new Uint8Array(command(channel, true)));
            await new Promise(function (resolve) {
                var timer = setTimeout(resolve, ms);
                if (cancel) {
                    cancel.release = function () {
                        clearTimeout(timer);
                        resolve();
                    };
                }
            });
        } finally {
            try {
                await writer.write(new Uint8Array(command(channel, false)));
            } finally {
                writer.releaseLock();
            }
        }
    }

    return {
        BAUD_RATE: BAUD_RATE,
        CHANNELS: CHANNELS,
        SHORT_PRESS_MS: SHORT_PRESS_MS,
        LONG_PRESS_MS: LONG_PRESS_MS,
        PRESSES: PRESSES,
        command: command,
        normalizeChannel: normalizeChannel,
        normalize: normalize,
        candidatePorts: candidatePorts,
        openRelayPort: openRelayPort,
        press: press
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = AtxRelay;
}
