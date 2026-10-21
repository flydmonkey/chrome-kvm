// 工具栏上两个状态图标的文案和颜色。只做「硬件状态 -> 说什么」的判断，
// 不碰 DOM，这样能单测——之前这段逻辑埋在页面里，改一次只能靠手点验证。
var StatusText = (function () {
    // 采集卡的 label 就是设备名，但 canvas 合成流会给一串随机 id，太长的不显示
    var MAX_LABEL_LENGTH = 40;

    // state: {unconfigured, errorLines, track, videoWidth, videoHeight}
    function describeVideo(state) {
        // 没选设备时点「重试」毫无意义，得把人指到设置页去
        if (state.unconfigured) {
            return {level: "idle", lines: ["未选择视频设备", "到设置页选择采集卡"]};
        }
        if (state.errorLines) {
            return {level: "error", lines: state.errorLines};
        }
        var track = state.track;
        if (!track) {
            return {level: "idle", lines: ["未打开视频", "点击重试"]};
        }
        // 采集卡被拔掉时轨道会 ended，光看 srcObject 是看不出来的
        if (track.readyState === "ended") {
            return {level: "error", lines: ["采集已中断", "采集卡可能被拔掉了", "插回后会自动恢复", "或点此立即重试"]};
        }

        var level = "ok";
        var lines = [];
        var label = (track.label || "").trim();
        lines.push(label && label.length <= MAX_LABEL_LENGTH ? label : "视频采集");

        if (track.muted) {
            // 轨道活着但没有帧进来，一般是采集卡那头没信号
            level = "warn";
            lines.push("采集卡没有画面输入");
        } else if (!state.videoWidth) {
            // videoWidth 要等 loadedmetadata 才有值
            level = "warn";
            lines.push("尚未收到画面");
        } else {
            lines.push(state.videoWidth + "×" + state.videoHeight);
            var settings = track.getSettings();
            if (settings.frameRate) {
                lines.push(Math.round(settings.frameRate) + " fps");
            }
        }

        lines.push("点击重开");
        return {level: level, lines: lines};
    }

    // state: {connected, serialLost, info, ackEnabled, baudRate, mouseRelative, pointerLocked}
    function describeSerial(state) {
        if (!state.connected) {
            return {level: "idle", lines: ["未连接串口"]};
        }
        if (state.serialLost) {
            return {level: "error", lines: ["串口已断开", "插回 CH9329 后会自动重连", "或点此立即重试"]};
        }

        var level = "ok";
        var lines = [];
        var info = state.info;
        if (!info) {
            level = "error";
            lines.push("芯片无应答");
            // 端口能打开却没人应答，最常见的是芯片没供电（到被控端那根 USB
            // 没插好）或者选错了串口设备，光说「无应答」用户无从下手
            lines.push("查 CH9329 供电和选中的端口");
        } else {
            lines.push("固件 " + info.version);
            lines.push(info.usbConnected ? "USB 已枚举" : "USB 未枚举");
            if (!info.usbConnected) {
                level = "warn";
            }
            if (info.asleep) {
                lines.push("被控端已休眠");
                level = "warn";
            }
            lines.push(info.capsLock ? "Caps Lock 开" : "Caps Lock 关");
        }

        if (!state.ackEnabled) {
            lines.push("已降级为只发不等");
            // 别把已有的 error 降级成 warn
            level = level === "ok" ? "warn" : level;
        }
        if (state.baudRate) {
            // 没探测成功时这个值只是兜底用的，不能显示得像已经确认过——
            // 否则看上去是「连上了 115200 但芯片哑巴」，实际是两个波特率都没人应
            lines.push(state.baudProbed === false
                ? state.baudRate + " bps（未确认）"
                : state.baudRate + " bps");
        }
        // 相对模式没锁指针时，光标顶到屏幕边缘就走不动了，得让用户知道怎么解决
        if (state.mouseRelative) {
            if (state.pointerLocked) {
                lines.push("指针已锁定（Esc 释放）");
            } else if (state.pointerLockRejected) {
                // 被拒时不能还显示「点击画面锁定指针」，那等于让用户白点
                lines.push("指针锁定被拒绝");
                lines.push("先点一下页面取得焦点再试");
                level = level === "ok" ? "warn" : level;
            } else {
                lines.push("相对模式：点击画面锁定指针");
            }
        }

        lines.push("点击刷新");
        return {level: level, lines: lines};
    }

    // state: {fullscreen, keyboardLocked, lockSupported}
    function describeFullscreen(state) {
        if (!state.fullscreen) {
            var lines = ["全屏"];
            if (state.lockSupported) {
                // 进全屏之前就告诉用户有这个好处，不然没人会想到
                lines.push("可捕获 Win、Alt+Tab 等系统键");
            }
            return {label: "全屏", lines: lines};
        }

        var full = ["退出全屏"];
        if (state.keyboardLocked) {
            full.push("系统快捷键已捕获");
            // Chrome 留的逃生口，不说清楚用户会以为退不出去
            full.push("长按 Esc 两秒退出");
        } else if (state.lockSupported) {
            // 多半是 F11 进的全屏：键盘锁定只认 JS 发起的全屏
            full.push("系统快捷键未捕获");
        }
        return {label: "退出全屏", lines: full};
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
        recordFileName: recordFileName,
        screenshotFileName: screenshotFileName
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = StatusText;
}
