// 控制页里不碰 DOM、不碰硬件的那部分判断：设置怎么换算成采集参数、设置变了
// 要重做什么、端口怎么挑、提示怎么措辞。和 status-text.js 一样抽出来是为了能单测，
// 页面里只剩「把结果落到界面和设备上」。
var I18n = typeof I18n !== "undefined" ? I18n : require("./i18n.js");

var PageLogic = (function () {
    var t = I18n.t;
    var DEFAULT_WIDTH = 1920;
    var DEFAULT_HEIGHT = 1080;

    // 设置里和视频有关的部分，没选采集卡时返回 null。settingsStore 传进来是为了
    // 复用它的帧率校验，node 下测试也不用摆全局变量
    function mediaArgsFrom(settings, settingsStore) {
        if (!settings || !settings.video || !settings.video.deviceId) {
            return null;
        }
        var audio = undefined;
        if (settings.audio && settings.audio.deviceId) {
            audio = {
                deviceId: {exact: settings.audio.deviceId},
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            };
        }
        var screen = settings.resolution;
        var width = DEFAULT_WIDTH;
        var height = DEFAULT_HEIGHT;
        if (screen && screen.width && screen.height) {
            width = screen.width;
            height = screen.height;
        }
        return {
            videoDeviceId: settings.video.deviceId,
            audio: audio,
            width: width,
            height: height,
            frameRate: settingsStore.normalizeFrameRate(settings.frameRate)
        };
    }

    // 决定要不要重连串口的那几个字段。鼠标模式是建连接时定下的，中途改不了
    function serialKey(settings) {
        settings = settings || {};
        return JSON.stringify({
            usb: (settings.usb && settings.usb.deviceId) || null,
            mode: settings.mouseClickMode === "relative" ? "relative" : "absolute"
        });
    }

    // 设置页保存后，控制页要重做哪些事。波特率、工作模式是设置页写芯片时顺手
    // 存的，不影响当前连接，不在这里面
    function settingsChanges(previous, next, currentSpeed, settingsStore) {
        var speed = settingsStore.normalizeRelativeSpeed(next.relativeSpeed);
        var media = mediaArgsFrom(next, settingsStore);
        var changes = {
            relativeSpeed: speed !== currentSpeed ? speed : null,
            media: JSON.stringify(mediaArgsFrom(previous, settingsStore)) !== JSON.stringify(media),
            mediaArgs: media,
            serial: serialKey(previous) !== serialKey(next),
            labels: []
        };
        if (changes.relativeSpeed !== null) {
            changes.labels.push(t("change.relativeSpeed"));
        }
        if (changes.media) {
            changes.labels.push(t("change.video"));
        }
        if (changes.serial) {
            changes.labels.push(t("change.serial"));
        }
        return changes;
    }

    // 逐个试匹配到的端口：优先用能打开又能应答的，都不应答时退回仅能打开的那个
    // （那时状态栏会照实显示「芯片无应答」）。全都打不开才把错误抛出去。
    // 没选中的备选必须交给 release 还回去：串口是独占的，留着不关会把自己挡在门外
    async function connectFirstWorking(candidates, connect, release) {
        var fallback = null;
        var lastError = null;
        for (var i = 0; i < candidates.length; i++) {
            var candidate;
            try {
                candidate = {port: candidates[i], connection: await connect(candidates[i])};
            } catch (e) {
                lastError = e;
                continue;
            }
            if (candidate.connection.info) {
                if (fallback) {
                    await release(fallback);
                }
                return candidate;
            }
            if (fallback) {
                await release(candidate);
            } else {
                fallback = candidate;
            }
        }
        if (fallback) {
            return fallback;
        }
        if (lastError) {
            throw lastError;
        }
        return null;
    }

    function describeMediaOpenError(e) {
        // deviceId 用的是 exact，设备不在时报的是这个，原文只有一个错误名，看不懂
        if (e && e.name === "OverconstrainedError") {
            return t("video.error.deviceMissing");
        }
        return e && e.message ? e.message : String(e);
    }

    // 按偏好从高到低挑浏览器支持的编码；都不支持就返回空串，交给浏览器用默认的
    var RECORD_MIME_TYPES = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
    ];

    function pickRecordMimeType(isTypeSupported) {
        if (typeof isTypeSupported !== "function") {
            return "";
        }
        for (var i = 0; i < RECORD_MIME_TYPES.length; i++) {
            if (isTypeSupported(RECORD_MIME_TYPES[i])) {
                return RECORD_MIME_TYPES[i];
            }
        }
        return "";
    }

    // 粘贴结束后的提示。只有一切顺利时才几秒后自动消失，取消和跳过都要留着让人看到
    function pasteSummary(result) {
        var message = result.skipped > 0
            ? t("paste.doneSkipped", {typed: result.typed, skipped: result.skipped})
            : t("paste.done", {typed: result.typed});
        if (result.cancelled) {
            return {message: t("paste.cancelled", {summary: message}), level: "warn"};
        }
        if (result.skipped > 0) {
            return {message: message, level: "warn"};
        }
        return {message: message, level: "info", timeout: 3000};
    }

    // error 默认不自动消失：里面常带排错用的详细信息，看一半没了等于白给
    function noticeTimeout(level, timeout) {
        if (timeout != null) {
            return timeout;
        }
        return level === "error" ? 0 : 6000;
    }

    return {
        mediaArgsFrom: mediaArgsFrom,
        serialKey: serialKey,
        settingsChanges: settingsChanges,
        connectFirstWorking: connectFirstWorking,
        describeMediaOpenError: describeMediaOpenError,
        RECORD_MIME_TYPES: RECORD_MIME_TYPES,
        pickRecordMimeType: pickRecordMimeType,
        pasteSummary: pasteSummary,
        noticeTimeout: noticeTimeout
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = PageLogic;
}
