// 工具栏上两个状态图标的文案和颜色。只做「硬件状态 -> 说什么」的判断，
// 不碰 DOM，这样能单测——之前这段逻辑埋在页面里，改一次只能靠手点验证。
var I18n = typeof I18n !== "undefined" ? I18n : require("./i18n.js");

var StatusText = (function () {
    var t = I18n.t;

    // 采集卡的 label 就是设备名，但 canvas 合成流会给一串随机 id，太长的不显示
    var MAX_LABEL_LENGTH = 40;

    // state: {unconfigured, errorLines, track, videoWidth, videoHeight}
    function describeVideo(state) {
        // 没选设备时点「重试」毫无意义，得把人指到设置页去
        if (state.unconfigured) {
            return {level: "idle", lines: [t("status.video.unconfigured"), t("status.video.goSettings")]};
        }
        if (state.errorLines) {
            return {level: "error", lines: state.errorLines};
        }
        var track = state.track;
        if (!track) {
            return {level: "idle", lines: [t("status.video.notOpen"), t("status.clickRetry")]};
        }
        // 采集卡被拔掉时轨道会 ended，光看 srcObject 是看不出来的
        if (track.readyState === "ended") {
            return {level: "error", lines: [t("status.video.ended"), t("status.video.unplugged"), t("status.video.autoRecover"), t("status.retryNow")]};
        }

        var level = "ok";
        var lines = [];
        var label = (track.label || "").trim();
        lines.push(label && label.length <= MAX_LABEL_LENGTH ? label : t("status.video.capture"));

        if (track.muted) {
            // 轨道活着但没有帧进来，一般是采集卡那头没信号
            level = "warn";
            lines.push(t("status.video.noSignal"));
        } else if (!state.videoWidth) {
            // videoWidth 要等 loadedmetadata 才有值
            level = "warn";
            lines.push(t("status.video.waiting"));
        } else {
            lines.push(state.videoWidth + "×" + state.videoHeight);
            var settings = track.getSettings();
            if (settings.frameRate) {
                lines.push(Math.round(settings.frameRate) + " fps");
            }
        }

        lines.push(t("status.video.clickReopen"));
        return {level: level, lines: lines};
    }

    // state: {connected, serialLost, info, ackEnabled, baudRate, mouseRelative, pointerLocked}
    function describeSerial(state) {
        if (!state.connected) {
            return {level: "idle", lines: [t("status.serial.notConnected")]};
        }
        if (state.serialLost) {
            return {level: "error", lines: [t("status.serial.lost"), t("status.serial.autoReconnect"), t("status.retryNow")]};
        }

        var level = "ok";
        var lines = [];
        var info = state.info;
        if (!info) {
            level = "error";
            lines.push(t("status.serial.noReply"));
            // 端口能打开却没人应答，最常见的是芯片没供电（到被控端那根 USB
            // 没插好）或者选错了串口设备，光说「无应答」用户无从下手
            lines.push(t("status.serial.checkPower"));
        } else {
            lines.push(t("status.serial.firmware", {version: info.version}));
            lines.push(t(info.usbConnected ? "status.serial.usbOn" : "status.serial.usbOff"));
            if (!info.usbConnected) {
                level = "warn";
            }
            if (info.asleep) {
                lines.push(t("status.serial.asleep"));
                level = "warn";
            }
            lines.push(t(info.capsLock ? "status.serial.capsOn" : "status.serial.capsOff"));
        }

        if (!state.ackEnabled) {
            lines.push(t("status.serial.noAck"));
            // 别把已有的 error 降级成 warn
            level = level === "ok" ? "warn" : level;
        }
        if (state.baudRate) {
            // 没探测成功时这个值只是兜底用的，不能显示得像已经确认过——
            // 否则看上去是「连上了 115200 但芯片哑巴」，实际是两个波特率都没人应
            lines.push(state.baudProbed === false
                ? t("status.serial.baudUnconfirmed", {baud: state.baudRate})
                : t("status.serial.baud", {baud: state.baudRate}));
        }
        // 相对模式没锁指针时，光标顶到屏幕边缘就走不动了，得让用户知道怎么解决
        if (state.mouseRelative) {
            if (state.pointerLocked) {
                lines.push(t("status.serial.pointerLocked"));
            } else if (state.pointerLockRejected) {
                // 被拒时不能还显示「点击画面锁定指针」，那等于让用户白点
                lines.push(t("status.serial.pointerRejected"));
                lines.push(t("status.serial.focusFirst"));
                level = level === "ok" ? "warn" : level;
            } else {
                lines.push(t("status.serial.clickToLock"));
            }
        }

        lines.push(t("status.serial.clickRefresh"));
        return {level: level, lines: lines};
    }

    // 工具栏上常驻的三个键盘指示灯。灯是被控端系统发给「键盘」的，USB 没枚举时
    // 芯片拿不到，显示出来也是假的，干脆不显示
    var LOCK_LIGHTS = [
        {key: "NumLock", field: "numLock", glyph: "1", name: "Num Lock"},
        {key: "CapsLock", field: "capsLock", glyph: "A", name: "Caps Lock"},
        {key: "ScrollLock", field: "scrollLock", glyph: "⇩", name: "Scroll Lock"}
    ];

    function lockLights(info) {
        if (!info || !info.usbConnected) {
            return null;
        }
        return LOCK_LIGHTS.map(function (light) {
            var on = !!info[light.field];
            return {
                key: light.key,
                glyph: light.glyph,
                on: on,
                label: t(on ? "lockLight.on" : "lockLight.off", {name: light.name})
            };
        });
    }

    // state: {fullscreen, keyboardLocked, lockSupported}
    function describeFullscreen(state) {
        if (!state.fullscreen) {
            var lines = [t("fullscreen.enter")];
            if (state.lockSupported) {
                // 进全屏之前就告诉用户有这个好处，不然没人会想到
                lines.push(t("fullscreen.canCapture"));
            }
            return {label: t("fullscreen.enter"), lines: lines};
        }

        var full = [t("fullscreen.exit")];
        if (state.keyboardLocked) {
            full.push(t("fullscreen.captured"));
            // Chrome 留的逃生口，不说清楚用户会以为退不出去
            full.push(t("fullscreen.holdEsc"));
        } else if (state.lockSupported) {
            // 多半是 F11 进的全屏：键盘锁定只认 JS 发起的全屏
            full.push(t("fullscreen.notCaptured"));
        }
        return {label: t("fullscreen.exit"), lines: full};
    }

    // 录像和截图的文件名用本地时间，方便对着操作时间找文件
    function recordFileName(date, extension) {
        var at = date || new Date();
        var pad = function (value) {
            return String(value).padStart(2, "0");
        };
        // getMonth 从 0 开始，getDate 才是几号（原来误用了 getDay，拿到的是星期几）
        return at.getFullYear()
            + pad(at.getMonth() + 1)
            + pad(at.getDate())
            + "-"
            + pad(at.getHours())
            + pad(at.getMinutes())
            + pad(at.getSeconds())
            + (extension || ".webm");
    }

    function screenshotFileName(date) {
        return recordFileName(date, ".png");
    }

    return {
        MAX_LABEL_LENGTH: MAX_LABEL_LENGTH,
        describeVideo: describeVideo,
        describeSerial: describeSerial,
        describeFullscreen: describeFullscreen,
        LOCK_LIGHTS: LOCK_LIGHTS,
        lockLights: lockLights,
        recordFileName: recordFileName,
        screenshotFileName: screenshotFileName
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = StatusText;
}
