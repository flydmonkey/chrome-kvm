// ATX 电源控制：USB 串口继电器（LCUS 系列）并在主板前面板的电源键跳线上，
// 继电器吸合就等于按下电源键。短按开机或让系统正常关机，长按强制断电。
var I18n = typeof I18n !== "undefined" ? I18n : require("./i18n.js");

var AtxRelay = (function () {
    var t = I18n.t;
    var BAUD_RATE = 9600;
    var CHANNELS = [1, 2, 3, 4];
    var SHORT_PRESS_MS = 500;
    // ATX 规范是按住 4 秒强制关机，多按一会儿给慢的主板留余量
    var LONG_PRESS_MS = 6000;

    var PRESSES = {
        short: {ms: SHORT_PRESS_MS, label: t("atx.press.short")},
        long: {ms: LONG_PRESS_MS, label: t("atx.press.long")},
        reset: {ms: SHORT_PRESS_MS, label: t("atx.press.reset"), resetChannel: true}
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

    // 没选继电器就返回 null，页面据此隐藏电源按钮。复位键可以不接，接了也
    // 不能和电源键同一路，否则点重启按的却是电源键
    function normalize(atx) {
        if (!atx || typeof atx !== "object" || !atx.deviceId) {
            return null;
        }
        var channel = normalizeChannel(atx.channel);
        var reset = typeof atx.resetChannel === "number" ? atx.resetChannel : parseInt(atx.resetChannel, 10);
        return {
            deviceId: atx.deviceId,
            label: atx.label || "",
            channel: channel,
            resetChannel: CHANNELS.indexOf(reset) !== -1 && reset !== channel ? reset : null
        };
    }

    function channelFor(atx, kind) {
        var press = PRESSES[kind];
        if (!atx || !press) {
            return null;
        }
        return press.resetChannel ? atx.resetChannel : atx.channel;
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
            return {error: t("atx.error.notFound")};
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
            return {error: t("atx.error.busy")};
        }
        return {error: t("atx.error.ambiguous", {count: opened.length})};
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
        channelFor: channelFor,
        candidatePorts: candidatePorts,
        openRelayPort: openRelayPort,
        press: press
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = AtxRelay;
}
