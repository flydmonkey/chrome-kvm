// 控制页入口：共享的页面元素、启动入口 start()、采集卡视频流。
// 其余功能按模块拆在 kvm-*.js，都是普通 <script>，共用全局作用域，按 index.html 里的顺序加载：
// kvm-serial.js 状态图标与串口，kvm-input.js 键鼠转发与工具栏，kvm-panels.js 显示方式、配置、电源，
// kvm-tools.js 录像、粘贴、截图、快捷键，kvm-ocr.js 文字识别，kvm-touch.js 触屏与屏幕键盘。
// 加载时就执行的代码只能用到本文件和前面文件里的东西。
// 协议细节在 ch9329.js，配置读写在 settings-store.js，可单测的判断在 page-logic.js。
I18n.apply();

let videoElement = document.getElementById("video");
let containerElement = document.getElementById("container");
let ch;

function start(devices) {
    let settings = SettingsStore.read();
    if (!settings) {
        window.location.href = "settings.html#video";
        return;
    }

    // 相对模式的位移倍数。绝对模式用不到，设了也不起作用
    Ch9329.RELATIVE_SPEED = SettingsStore.normalizeRelativeSpeed(settings.relativeSpeed);

    // 没选采集卡不该连键鼠一起放弃：只靠键鼠盲操（比如进 BIOS 按几个键）也是正经用法
    applyMediaSettings(PageLogic.mediaArgsFrom(settings, SettingsStore), devices, false);

    if (settings.usb && settings.usb.deviceId) {
        openSerial(settings.usb.deviceId, settings.mouseClickMode);
    }
    bindSettingsSync(settings);
}

function applyMediaSettings(args, onFirstStream, quiet) {
    if (!args) {
        lastMediaArgs = null;
        stopStream(videoElement.srcObject);
        videoElement.srcObject = null;
        videoTrack = null;
        videoErrorLines = null;
        videoUnconfigured = true;
        renderVideoStatus();
        noticeVideoUnconfigured();
        return;
    }
    videoUnconfigured = false;
    lastMediaArgs = args;
    bindVideoLifecycle();
    if (videoOpening) {
        // 正在开的那一路用的是旧参数，等它结束再按新参数重开
        videoRestartPending = true;
        return;
    }
    startVideo(onFirstStream, quiet);
}

let lastMediaArgs = null;
let videoTrack = null;
let videoErrorLines = null;
let videoUnconfigured = false;
// 插拔时 devicechange 和用户点图标可能撞在一起，同时开两次会互相抢设备
let videoOpening = false;
let videoRestartPending = false;
// 记下是不是从「被拔掉」恢复的，恢复后要告诉用户一声
let videoDropped = false;

function startVideo(onFirstStream, quiet) {
    if (!lastMediaArgs || videoOpening) {
        return;
    }
    videoOpening = true;
    let args = lastMediaArgs;
    videoErrorLines = null;
    // 走到这里旧流已经死了，不停掉的话音频轨道还会占着设备
    stopStream(videoElement.srcObject);
    setVideoStatus("warn", [I18n.t("video.opening")]);
    openMedia(args)
        .then(stream => {
            videoOpening = false;
            if (videoRestartPending || lastMediaArgs !== args) {
                // 打开期间设置变了：这一路已经过时，停掉按新参数重开
                videoRestartPending = false;
                stopStream(stream);
                if (lastMediaArgs) {
                    startVideo(null, true);
                }
                return;
            }
            videoElement.srcObject = stream;
            bindVideoTrack(stream);
            if (videoDropped) {
                videoDropped = false;
                showNotice(I18n.t("video.recovered"), {key: "video"});
            } else {
                dismissNotice("video");
            }
            if (typeof onFirstStream === "function") {
                onFirstStream();
            }
        })
        .catch(function (e) {
            videoOpening = false;
            if (videoRestartPending || lastMediaArgs !== args) {
                videoRestartPending = false;
                if (lastMediaArgs) {
                    startVideo(null, quiet);
                }
                return;
            }
            let message = PageLogic.describeMediaOpenError(e);
            videoTrack = null;
            videoErrorLines = [I18n.t("video.openFailed"), message, I18n.t("status.clickRetry")];
            renderVideoStatus();
            if (!quiet) {
                showNotice(I18n.t("video.openFailedWith", {message: message}), {level: "error", key: "video"});
            }
        });
}

function stopStream(stream) {
    if (!stream || !stream.getTracks) {
        return;
    }
    stream.getTracks().forEach(function (track) {
        track.stop();
    });
}

// 采集卡被拔掉或没信号时轨道会 ended/muted，光看 srcObject 是看不出来的
function bindVideoTrack(stream) {
    let tracks = stream.getVideoTracks();
    let track = tracks.length ? tracks[0] : null;
    videoTrack = track;
    // 拿到轨道就说明上一次的失败已经过去了，否则错误会一直盖住正常状态
    videoErrorLines = null;
    if (track) {
        track.addEventListener("ended", function () {
            // 重开之后旧轨道的事件可能才姗姗来迟，那时它已经不是当前轨道了
            if (track === videoTrack) {
                videoDropped = true;
                showNotice(I18n.t("video.unplugged"), {level: "warn", key: "video", timeout: 0});
            }
            renderVideoStatus();
        });
        track.addEventListener("mute", renderVideoStatus);
        track.addEventListener("unmute", renderVideoStatus);
    }
    renderVideoStatus();
}

function videoBroken() {
    return !!videoErrorLines || !videoTrack || videoTrack.readyState === "ended";
}

// 轨道一旦 ended 就不会自己复活，采集卡插回来也得重新 getUserMedia。
// 串口那边靠 navigator.serial 的 connect 事件，视频对应的是 devicechange。
let deviceChangeTimer = null;

function bindVideoLifecycle() {
    let media = navigator.mediaDevices;
    if (!media || !media.addEventListener || window.__chromeKvmVideoBound) {
        return;
    }
    window.__chromeKvmVideoBound = true;
    media.addEventListener("devicechange", function () {
        // 一次插拔会连着触发好几次（视频、音频各算一个设备），等列表稳定了再看
        clearTimeout(deviceChangeTimer);
        deviceChangeTimer = setTimeout(reopenVideoIfBack, 800);
    });
}

function reopenVideoIfBack() {
    if (!lastMediaArgs || videoOpening || !videoBroken()) {
        return;
    }
    let wanted = lastMediaArgs.videoDeviceId;
    navigator.mediaDevices.enumerateDevices()
        .then(function (devices) {
            let back = devices.some(function (device) {
                return device.kind === "videoinput" && device.deviceId === wanted;
            });
            // 别的设备插拔也会触发 devicechange，采集卡不在就别去碰它，免得刷出一串失败
            if (back) {
                startVideo(null, true);
            }
        })
        .catch(function (e) {
            console.warn("枚举媒体设备失败", e);
        });
}

function noticeVideoUnconfigured() {
    showNotice(I18n.t("video.unconfigured"), {
        level: "warn",
        key: "video",
        timeout: 0,
        link: {text: I18n.t("common.goSettings"), href: "settings.html#video"}
    });
}

function openMedia(args) {
    let videoDeviceId = args.videoDeviceId;
    let audio = args.audio;
    // 不写帧率时 Chrome 按 30fps 要，支持 60 的采集卡也被压在 30。用 ideal
    // 而不是 exact：采集卡在这个分辨率下没有 60 时，浏览器会优先保住分辨率
    let frameRate = args.frameRate ? {ideal: args.frameRate} : undefined;
    // exact 分辨率极易 Overconstrained；按 ideal → 放宽 → 仅设备 回退
    let attempts = [
        {
            audio: audio,
            video: {
                deviceId: {exact: videoDeviceId},
                width: {ideal: args.width},
                height: {ideal: args.height},
                frameRate: frameRate
            }
        },
        {
            audio: audio,
            video: {
                deviceId: {exact: videoDeviceId},
                width: {ideal: args.width},
                frameRate: frameRate
            }
        },
        {
            audio: audio,
            video: {
                deviceId: {exact: videoDeviceId}
            }
        }
    ];
    let chain = Promise.reject(new Error("init"));
    for (let i = 0; i < attempts.length; i++) {
        (function (constraints) {
            chain = chain.catch(function () {
                return navigator.mediaDevices.getUserMedia(constraints);
            });
        })(attempts[i]);
    }
    return chain;
}
