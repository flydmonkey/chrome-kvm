// 控制页的页面逻辑：视频流、串口连接、键鼠事件转发、工具栏状态。
// 协议细节在 ch9329.js，配置读写在 settings-store.js，可单测的判断在 page-logic.js。
let videoElement = document.getElementById("video");
let containerElement = document.getElementById("container");
let ch;

function start(devices) {
    let settings = SettingsStore.read();
    if (!settings) {
        window.location.href = "settings.html";
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
    setVideoStatus("warn", ["正在打开视频…"]);
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
                showNotice("采集卡已恢复，画面重新接上了。", {key: "video"});
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
            videoErrorLines = ["打开视频失败", message, "点击重试"];
            renderVideoStatus();
            if (!quiet) {
                showNotice("打开视频失败：" + message, {level: "error", key: "video"});
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
                showNotice("采集卡已断开，插回后会自动恢复画面。", {level: "warn", key: "video", timeout: 0});
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
    showNotice("还没有选择视频采集卡，所以没有画面。键鼠不受影响。", {
        level: "warn",
        key: "video",
        timeout: 0,
        link: {text: "去设置", href: "settings.html"}
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

let currentBaudRate = null;
// 探测失败时上面那个值只是兜底选的，界面要如实标出来
let currentBaudProbed = true;
// 浏览器可能直接拒绝指针锁定（最常见的是页面没有焦点）。不记下来的话界面
// 看起来只是「还没锁」，用户会一直点画面却等不到任何反应。
let pointerLockRejected = false;
let activePort = null;
let lastSerialArgs = null;
let serialLost = false;
// 每次发起连接加一。连接要花时间（探测波特率），期间设置再变就会有两次连接
// 同时在跑，晚到的旧连接靠它认出自己已经过时
let serialGeneration = 0;

// 顶部提示条，用来代替 alert。alert 会抢焦点触发 blur，把被控端上正按着的键
// 全部松开；启动时视频、串口各弹一个还会一个接一个挡住画面。
// options: {level: "info"|"warn"|"error", key, timeout, closable,
//           link: {text, href}, action: {text, onClick}}
// 同一个 key 只保留最新一条，重连之类反复出现的提示不会越堆越多。
// error 默认不自动消失：里面常带排错用的详细信息，看一半没了等于白给。
// 返回 {setMessage, remove}，进度类的提示靠它原地改字，不用反复重建。
function showNotice(message, options) {
    options = options || {};
    let level = options.level || "info";
    let stack = document.getElementById("noticeStack");
    if (!stack) {
        console.warn(message);
        return {setMessage: function () {}, remove: function () {}};
    }
    if (options.key) {
        dismissNotice(options.key);
    }

    let notice = document.createElement("div");
    notice.className = "notice notice-" + level;
    if (options.key) {
        notice.dataset.key = options.key;
    }

    let body = document.createElement("div");
    body.className = "notice-body";
    let text = document.createElement("span");
    text.textContent = message;
    body.appendChild(text);
    if (options.link) {
        let link = document.createElement("a");
        link.href = options.link.href;
        link.textContent = options.link.text;
        body.appendChild(link);
    }
    if (options.action) {
        let action = document.createElement("button");
        action.className = "notice-action";
        action.type = "button";
        action.textContent = options.action.text;
        action.addEventListener("click", options.action.onClick);
        body.appendChild(action);
    }
    notice.appendChild(body);

    if (options.closable !== false) {
        let close = document.createElement("button");
        close.className = "notice-close";
        close.type = "button";
        close.setAttribute("aria-label", "关闭提示");
        close.textContent = "×";
        close.addEventListener("click", function () {
            notice.remove();
        });
        notice.appendChild(close);
    }

    stack.appendChild(notice);

    let timeout = PageLogic.noticeTimeout(level, options.timeout);
    if (timeout > 0) {
        setTimeout(function () {
            notice.remove();
        }, timeout);
    }
    return {
        setMessage: function (next) {
            text.textContent = next;
        },
        remove: function () {
            notice.remove();
        }
    };
}

function dismissNotice(key) {
    let stack = document.getElementById("noticeStack");
    if (!stack) {
        return;
    }
    stack.querySelectorAll(".notice").forEach(function (notice) {
        if (notice.dataset.key === key) {
            notice.remove();
        }
    });
}

// 在提示里滚动查看详细信息时，别让 document 上的滚轮监听把它当成被控端滚轮发出去
(function guardNoticeWheel() {
    let stack = document.getElementById("noticeStack");
    if (stack) {
        stack.addEventListener("wheel", function (event) {
            event.stopPropagation();
        }, {passive: true});
    }
})();

function applyStatus(buttonId, tooltipId, level, lines) {
    let button = document.querySelector(buttonId);
    let tooltip = document.querySelector(tooltipId);
    if (!button || !tooltip) {
        return;
    }
    // 用 classList 而不是覆盖 className，否则会把按钮上其他的类一起抹掉
    button.classList.remove("status-idle", "status-ok", "status-warn", "status-error");
    button.classList.add("status-" + level);
    tooltip.innerHTML = lines.join("<br>");
}

function setStatus(level, lines) {
    applyStatus("#inputStatusButton", "#inputStatusTooltip", level, lines);
}

function setVideoStatus(level, lines) {
    applyStatus("#videoStatusButton", "#videoStatusTooltip", level, lines);
}

function renderVideoStatus() {
    let status = StatusText.describeVideo({
        unconfigured: videoUnconfigured,
        errorLines: videoErrorLines,
        track: videoTrack,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight
    });
    setVideoStatus(status.level, status.lines);
}

function refreshVideoStatus() {
    if (videoUnconfigured) {
        noticeVideoUnconfigured();
        return;
    }
    // 已经断了就直接重开，正常的话只是刷新读数
    if (videoBroken()) {
        startVideo(null, true);
        return;
    }
    renderVideoStatus();
}

let lastInfo = null;

function renderStatus(info) {
    lastInfo = info;
    let status = StatusText.describeSerial({
        connected: !!ch,
        serialLost: serialLost,
        info: info,
        ackEnabled: !!ch && ch.isAckEnabled(),
        baudRate: currentBaudRate,
        baudProbed: currentBaudProbed,
        mouseRelative: !!ch && !ch.isMouseAbsolute(),
        pointerLocked: document.pointerLockElement === videoElement,
        pointerLockRejected: pointerLockRejected
    });
    setStatus(status.level, status.lines);
}

async function refreshStatus() {
    if (!ch) {
        renderStatus(null);
        return;
    }
    if (serialLost) {
        reconnectSerial();
        return;
    }
    renderStatus(await ch.getInfo());
}

function handleSerialLost() {
    if (serialLost) {
        return;
    }
    serialLost = true;
    if (ch) {
        ch.markDisconnected();
    }
    console.warn("CH9329 串口已断开");
    renderStatus(null);
}

function reconnectSerial() {
    if (!lastSerialArgs) {
        return;
    }
    setStatus("warn", ["正在重连…"]);
    openSerial(lastSerialArgs.deviceId, lastSerialArgs.mouseClickMode);
}

// 拔掉 CH9329 时串口写入只会静默失败，必须靠 disconnect 事件才能让界面知道
function bindSerialLifecycle() {
    if (!navigator.serial || window.__chromeKvmSerialBound) {
        return;
    }
    window.__chromeKvmSerialBound = true;
    navigator.serial.addEventListener("disconnect", function (event) {
        if (activePort && event.target !== activePort) {
            return;
        }
        handleSerialLost();
    });
    navigator.serial.addEventListener("connect", function () {
        if (serialLost) {
            reconnectSerial();
        }
    });
}

function candidateBaudRates() {
    return SettingsStore.baudRateOrder(SettingsStore.readOrEmpty().baudRate, Ch9329.BAUD_RATES);
}

// 放弃某个备选时必须把端口还回去：串口是独占的，留着不关会把自己挡在门外
async function releaseConnection(candidate) {
    try {
        await candidate.connection.ch.dispose();
        await candidate.port.close();
    } catch (e) {
        console.warn("释放备选串口失败", e);
    }
}

function connectFirstWorking(candidates, mouseAbsolute) {
    return PageLogic.connectFirstWorking(candidates, function (port) {
        return Ch9329.connect(port, candidateBaudRates(), mouseAbsolute);
    }, releaseConnection);
}

function openSerial(deviceId, mouseClickMode) {
    lastSerialArgs = {deviceId: deviceId, mouseClickMode: mouseClickMode};
    if (!navigator.serial) {
        showNotice("当前浏览器不支持 Web Serial，键鼠无法使用。请用桌面版 Chrome 或 Edge 打开。", {
            level: "error",
            key: "serial"
        });
        return;
    }
    bindSerialLifecycle();
    let generation = ++serialGeneration;
    navigator.serial.getPorts()
        .then(async function (ports) {
            let candidates = SettingsStore.pickSerialPorts(ports, deviceId);
            if (candidates.length === 0) {
                // 重连途中设备还没回来是正常的，别拿弹窗打断用户
                if (serialLost) {
                    renderStatus(null);
                    return;
                }
                showNotice("未检测到所选串口设备。请到设置页重新授权并选择正确的 CH9329 端口。", {
                    level: "error",
                    key: "serial",
                    link: {text: "去设置", href: "settings.html"}
                });
                return;
            }
            let mouseAbsolute = !mouseClickMode || mouseClickMode === "absolute";
            // 芯片实际波特率以探测结果为准，设置里的值只作为首选，避免配置不同步就连不上
            let candidate = await connectFirstWorking(candidates, mouseAbsolute);
            if (generation !== serialGeneration) {
                // 连接期间设置又变了，已经有更新的一次在连。串口是独占的，赶紧让出来
                await releaseConnection(candidate);
                return;
            }
            let connection = candidate.connection;
            ch = connection.ch;
            ch.onTransportError = handleSerialLost;
            activePort = candidate.port;
            serialLost = false;
            currentBaudRate = connection.baudRate;
            currentBaudProbed = connection.probed !== false;
            open();
            dismissNotice("serial");
            let info = connection.info;
            renderStatus(info);
            if (!info) {
                console.warn("CH9329 未应答 GET_INFO，命令将退化为不等应答发送");
                return;
            }
            console.log("CH9329", info, "baudRate=" + connection.baudRate);
            SettingsStore.patch({baudRate: connection.baudRate});
            if (!info.usbConnected) {
                showNotice("CH9329 的 USB 未被被控端枚举，请检查接到被控机的 USB 线。", {
                    level: "warn",
                    key: "serial"
                });
            }
        })
        .catch(function (e) {
            if (serialLost) {
                console.warn("重连失败", e);
                renderStatus(null);
                return;
            }
            showNotice(e && e.message ? e.message : String(e), {level: "error", key: "serial"});
        });
}

// 换了串口设备或鼠标模式时要重连：鼠标模式是建连接时定下的，中途改不了
async function restartSerial(settings) {
    let oldCh = ch;
    let oldPort = activePort;
    ch = null;
    activePort = null;
    serialLost = false;
    pasteCancelled = true;
    keyRepeatStop = true;
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    if (oldCh) {
        // 旧连接关掉时写入会失败，别让它把新连接的状态标成「已断开」
        oldCh.onTransportError = null;
        try {
            // 释放包排在队列里，等它们发完再关；芯片不应答时也最多等 300ms
            oldCh.releaseAllKeys();
            await Promise.race([
                oldCh.forceReleaseAllMouse(),
                new Promise(function (resolve) {
                    setTimeout(resolve, 300);
                })
            ]);
            await oldCh.dispose();
        } catch (e) {
            console.warn("关闭旧的键鼠连接失败", e);
        }
    }
    if (oldPort) {
        try {
            await oldPort.close();
        } catch (e) {
            console.warn("关闭旧串口失败", e);
        }
    }
    if (settings.usb && settings.usb.deviceId) {
        openSerial(settings.usb.deviceId, settings.mouseClickMode);
    } else {
        lastSerialArgs = null;
        serialGeneration++;
        renderStatus(null);
    }
}

// 在设置页点保存后，控制页不用再手动刷新。storage 事件只在别的标签页改了
// localStorage 时触发，正好对应设置页保存；本页自己 patch 波特率不会触发
let appliedSettings = null;

// 返回改了哪几项的名字，调用方自己决定怎么提示
function applySettingsUpdate(next) {
    let previous = appliedSettings || {};
    appliedSettings = next;
    let changes = PageLogic.settingsChanges(previous, next, Ch9329.RELATIVE_SPEED, SettingsStore);
    if (changes.relativeSpeed !== null) {
        Ch9329.RELATIVE_SPEED = changes.relativeSpeed;
    }
    if (changes.media) {
        applyMediaSettings(changes.mediaArgs, null, false);
    }
    if (changes.serial) {
        restartSerial(next);
    }
    return changes.labels;
}

function bindSettingsSync(initial) {
    appliedSettings = initial;
    window.addEventListener('storage', function (event) {
        if (event.key === Profiles.STORAGE_KEY) {
            renderProfilePanel();
            return;
        }
        if (event.key !== SettingsStore.KEY) {
            return;
        }
        let next = SettingsStore.read();
        if (!next) {
            return;
        }
        let labels = applySettingsUpdate(next);
        renderProfilePanel();
        if (labels.length) {
            showNotice("设置已更新：" + labels.join("、"), {key: "settings", timeout: 3000});
        }
    });
}

function open() {
    if (window.__chromeKvmInputBound) {
        return;
    }
    window.__chromeKvmInputBound = true;

    videoElement.style.cursor = "none";
    document.addEventListener('keydown', (event) => {
        // 快捷键面板里填自定义快捷键时，按键是给输入框的，不能发给被控端
        if (isEditableTarget(event.target)) {
            return;
        }
        event.preventDefault()
        // 按住不放时本机会连发 keydown，但被控端只要收到「按下」就会自己按
        // 它的设置重复。再转发一遍只是重发同一份报告，低波特率下白白占串口。
        // 粘贴和连按期间用户的按键会和模拟敲键的报告互相覆盖，也先不转发
        if (!ch || event.repeat || pasting || keyRepeating) {
            return;
        }
        ch.keydown(event.code);
    })

    document.addEventListener('keyup', (event) => {
        if (isEditableTarget(event.target)) {
            return;
        }
        event.preventDefault();
        if (!ch || pasting || keyRepeating) {
            return;
        }
        ch.keyup(event.code);
    });

    // 累积滚动量再按齿数下发，保留滚动快慢；一格滚轮在 Chrome 里约 100px
    const WHEEL_PIXELS_PER_NOTCH = 100;
    let wheelPixels = 0;
    document.addEventListener('wheel', function (event) {
        if (!ch) {
            return;
        }
        let delta = event.deltaY;
        if (event.deltaMode === 1) {
            delta *= 16;   // 行
        } else if (event.deltaMode === 2) {
            delta *= 400;  // 页
        }
        wheelPixels += delta;
        let notches = Math.trunc(wheelPixels / WHEEL_PIXELS_PER_NOTCH);
        if (notches === 0) {
            return;
        }
        wheelPixels -= notches * WHEEL_PIXELS_PER_NOTCH;
        // 浏览器 deltaY 向下为正，协议齿数向上为正
        ch.mouseScroll(-notches);
    }, {passive: true});

    // 相对模式下位移靠光标位置差分算，本机光标一顶到屏幕边缘就不再变化，
    // 被控端光标也跟着走不动了。指针锁定把光标从边界里解放出来，并直接给
    // movementX/movementY。绝对模式要的是真实坐标，锁上反而没法用。
    function pointerLocked() {
        return document.pointerLockElement === videoElement;
    }

    function lockPointer() {
        if (!ch || ch.isMouseAbsolute() || pointerLocked()) {
            return;
        }
        // unadjustedMovement 关掉本机的指针加速：被控端自己还会再加一层，
        // 两层叠加会让鼠标很难控
        let pending;
        try {
            pending = videoElement.requestPointerLock({unadjustedMovement: true});
        } catch (e) {
            pending = null;
        }
        if (!pending || !pending.catch) {
            return;  // 老浏览器不返回 Promise，当作已经发起
        }
        pending.catch(function (first) {
            // 有的平台不支持免加速，退回普通锁定也比不锁强
            let retry;
            try {
                retry = videoElement.requestPointerLock();
            } catch (e) {
                pointerLockRejected = true;
                console.warn("指针锁定失败，相对模式下光标到屏幕边缘会走不动", e);
                renderStatus(lastInfo);
                return;
            }
            if (retry && retry.catch) {
                retry.catch(function (e) {
                    pointerLockRejected = true;
                    console.warn("指针锁定失败，相对模式下光标到屏幕边缘会走不动",
                        e || first);
                    renderStatus(lastInfo);
                });
            }
        });
    }

    // 锁定失败会走这里而不是抛异常，requestPointerLock 的 Promise 也可能
    // 早于它 reject，两条路都要收口
    document.addEventListener('pointerlockerror', function () {
        pointerLockRejected = true;
        renderStatus(lastInfo);
    });

    document.addEventListener('pointerlockchange', function () {
        if (pointerLocked()) {
            pointerLockRejected = false;
        } else if (ch) {
            // 解锁多半是按了 Esc，这时鼠标键的抬起事件收不到，先清干净。
            // 只在解锁时做：上锁时清会把用户刚按下的那个键也松掉，拖拽就断了
            ch.forceReleaseAllMouse();
            // 光标重新出现的位置和锁定前不连续，下次移动要重新取差分基准
            ch.resetRelativeOrigin();
        }
        renderStatus(lastInfo);
    });

    // mousemove 被浏览器对齐到画面刷新，一帧最多一次（实测间隔约 29ms），
    // 手已经动了，位移还要等到下一帧才发出去。pointerrawupdate 按鼠标硬件的
    // 回报率触发，能把这段等待省掉。事件密了也不怕：绝对坐标排队时只留最新
    // 的，相对位移排队时累加，都不会淹没串口。只在安全上下文里有，没有就退回
    const moveEvent = ('onpointerrawupdate' in window) ? 'pointerrawupdate' : 'mousemove';
    videoElement.addEventListener(moveEvent, (event) => {
        // 触摸有自己的一套手势，见 bindTouch
        if (event.pointerType === "touch") {
            return;
        }
        if (!pointerLocked()) {
            // 放大时先按指针把画面摆好，再换算坐标，两边才对得上
            panView(event.clientX, event.clientY);
        }
        if (!ch) {
            return;
        }
        if (pointerLocked()) {
            ch.mouseMoveBy(event.movementX, event.movementY);
            return;
        }
        ch.mouseMove(videoElement, event.clientX, event.clientY);
    });


    videoElement.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (!ch) {
            return;
        }
        let buttons = 0x00;
        if (event.button === 0) {
            buttons = 0x01;
        } else if (event.button === 1) {
            buttons = 0x04;
        } else if (event.button === 2) {
            buttons = 0x02;
        }
        if (buttons) {
            ch.mouseButtonDown(videoElement, event.clientX, event.clientY, buttons);
        }
        lockPointer();
    });
    videoElement.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    // 用 document 捕获，避免移出 video 时丢右键抬起；按 button 位释放
    document.addEventListener('mouseup', (event) => {
        if (!ch) {
            return;
        }
        ch.mouseButtonUp(event.button);
    });

    bindTouch();

    // 失焦/切走页面时强制松开所有键，防止被控端卡住
    window.addEventListener('blur', () => {
        if (ch) {
            ch.forceReleaseAllInput();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && ch) {
            ch.forceReleaseAllInput();
        }
    });

}

document.addEventListener('DOMContentLoaded', () => {
    start()
});

// 切换工具栏的显示和隐藏
function toggleToolbar() {
    const toolbar = document.querySelector('.floating-toolbar');
    toolbar.classList.toggle('hidden');
    // 箭头方向交给 CSS 旋转，这里只更新文案
    const collapsed = toolbar.classList.contains('hidden');
    if (collapsed) {
        toggleShortcutPanel(false);
        toggleViewPanel(false);
        toggleProfilePanel(false);
        toggleOcrPanel(false);
    }
    document.querySelector('#toggleTooltip').innerText = collapsed ? '展开' : '收起';
    document.querySelector('#toggleButton').setAttribute('aria-label', collapsed ? '展开工具栏' : '收起工具栏');
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        // 进入全屏
        document.documentElement.requestFullscreen();
    } else {
        // 退出全屏
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// 画面尺寸要等元数据到了才有，所以拿到流之后还得再刷一次状态
['loadedmetadata', 'resize', 'playing', 'emptied'].forEach(function (name) {
    videoElement.addEventListener(name, renderVideoStatus);
    // 1:1 和放大要按画面的真实尺寸算，被控端换分辨率时也会触发 resize
    videoElement.addEventListener(name, applyViewLayout);
});

let viewMode = ViewModes.load(localStorage);
let viewPointer = null;
let viewBox = null;

function viewportSize() {
    return {width: window.innerWidth, height: window.innerHeight};
}

function applyViewLayout() {
    let viewport = viewportSize();
    viewBox = ViewModes.layout(viewMode, viewport, {
        width: videoElement.videoWidth,
        height: videoElement.videoHeight
    }, window.devicePixelRatio || 1);
    let offset = ViewModes.panOffset(viewBox, viewport, viewPointer);
    let style = videoElement.style;
    style.objectFit = viewBox.objectFit;
    style.width = viewBox.width + "px";
    style.height = viewBox.height + "px";
    style.left = offset.left + "px";
    style.top = offset.top + "px";
}

function panView(clientX, clientY) {
    viewPointer = {x: clientX, y: clientY};
    if (viewBox && ViewModes.pans(viewBox, viewportSize())) {
        applyViewLayout();
    }
}

function setViewMode(mode) {
    viewMode = ViewModes.save(localStorage, mode);
    applyViewLayout();
    renderViewPanel();
}

function renderViewPanel() {
    let label = ViewModes.label(viewMode);
    document.getElementById("viewTooltip").textContent = "画面：" + label;
    document.getElementById("viewButton").setAttribute("aria-label", "画面显示：" + label);
    let options = document.getElementById("viewOptions");
    options.textContent = "";
    ViewModes.MODES.forEach(function (mode) {
        let button = document.createElement("button");
        button.type = "button";
        button.className = "view-option";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(mode.id === viewMode));
        let name = document.createElement("span");
        name.textContent = mode.label;
        let hint = document.createElement("span");
        hint.className = "view-option-hint";
        hint.textContent = mode.hint;
        button.appendChild(name);
        button.appendChild(hint);
        button.addEventListener("click", function () {
            setViewMode(mode.id);
        });
        options.appendChild(button);
    });
}

function toggleViewPanel(force) {
    let panel = document.getElementById("viewPanel");
    let open = typeof force === "boolean" ? force : panel.hidden;
    if (open) {
        toggleShortcutPanel(false);
        toggleProfilePanel(false);
        toggleOcrPanel(false);
        renderViewPanel();
    }
    panel.hidden = !open;
    document.getElementById("viewButton").setAttribute("aria-expanded", String(open));
}

window.addEventListener("resize", applyViewLayout);
// 别的标签页改了显示方式（比如同时开着两个控制页），这边跟着换
window.addEventListener("storage", function (event) {
    if (event.key === ViewModes.STORAGE_KEY) {
        viewMode = ViewModes.load(localStorage);
        applyViewLayout();
        renderViewPanel();
    }
});
applyViewLayout();
renderViewPanel();
document.getElementById("viewPanel").addEventListener("wheel", function (event) {
    event.stopPropagation();
}, {passive: true});

// 被控机配置的快速切换。只有一份配置时没什么可切的，按钮藏起来
function renderProfilePanel() {
    let state = Profiles.load(localStorage);
    let button = document.getElementById("profileButton");
    button.hidden = state.profiles.length < 2;
    if (button.hidden) {
        toggleProfilePanel(false);
    }
    let label = state.active || "未选择配置";
    document.getElementById("profileTooltip").textContent = "被控机：" + label;
    button.setAttribute("aria-label", "切换被控机，当前：" + label);
    let options = document.getElementById("profileOptions");
    options.textContent = "";
    state.profiles.forEach(function (profile) {
        let option = document.createElement("button");
        option.type = "button";
        option.className = "view-option";
        option.setAttribute("role", "radio");
        option.setAttribute("aria-checked", String(profile.name === state.active));
        let name = document.createElement("span");
        name.textContent = profile.name;
        let hint = document.createElement("span");
        hint.className = "view-option-hint";
        hint.textContent = Profiles.summary(profile.settings);
        option.appendChild(name);
        option.appendChild(hint);
        option.addEventListener("click", function () {
            switchProfile(profile.name);
        });
        options.appendChild(option);
    });
}

function switchProfile(name) {
    let state = Profiles.load(localStorage);
    toggleProfilePanel(false);
    if (state.active === name) {
        return;
    }
    let result = Profiles.apply(state, name, SettingsStore.readOrEmpty());
    if (result.error) {
        showNotice(result.error, {level: "error", key: "settings", timeout: 4000});
        renderProfilePanel();
        return;
    }
    if (!SettingsStore.write(result.settings)) {
        showNotice("切换失败，浏览器可能禁用了本地存储", {level: "error", key: "settings", timeout: 4000});
        return;
    }
    Profiles.save(localStorage, result.state);
    // 本页自己写 localStorage 不会收到 storage 事件，得自己把新设置应用上
    applySettingsUpdate(result.settings);
    renderProfilePanel();
    showNotice("已切换到「" + name + "」", {key: "settings", timeout: 3000});
}

function toggleProfilePanel(force) {
    let panel = document.getElementById("profilePanel");
    let open = typeof force === "boolean" ? force : panel.hidden;
    if (open) {
        toggleShortcutPanel(false);
        toggleViewPanel(false);
        toggleOcrPanel(false);
        renderProfilePanel();
    }
    panel.hidden = !open;
    document.getElementById("profileButton").setAttribute("aria-expanded", String(open));
}

renderProfilePanel();
document.getElementById("profilePanel").addEventListener("wheel", function (event) {
    event.stopPropagation();
}, {passive: true});

// Win、Alt+Tab、Esc、Ctrl+W 这些键默认被本机的浏览器和系统吃掉，光靠
// preventDefault 拦不住，根本到不了被控端。Keyboard Lock 能把它们截下来，
// 但只对 JS 发起的全屏生效（按 F11 进的全屏不算）。
let keyboardLocked = false;

function keyboardLockSupported() {
    return !!(navigator.keyboard && navigator.keyboard.lock);
}

function lockKeyboard() {
    if (!keyboardLockSupported()) {
        return Promise.resolve(false);
    }
    // 不传参数就是锁全部按键；Chrome 保留「长按 Esc 两秒」作为逃生口，
    // 所以短按 Esc 会照常发给被控端，正好是 BIOS 里要用的
    return navigator.keyboard.lock()
        .then(function () {
            return true;
        })
        .catch(function (e) {
            console.warn("键盘锁定失败，系统快捷键仍会被本机拦截", e);
            return false;
        });
}

function renderFullscreenStatus() {
    let status = StatusText.describeFullscreen({
        fullscreen: !!document.fullscreenElement,
        keyboardLocked: keyboardLocked,
        lockSupported: keyboardLockSupported()
    });
    document.querySelector('#fullscreenTooltip').innerHTML = status.lines.join("<br>");
    document.querySelector('#fullscreenButton').setAttribute('aria-label', status.label);
}

// 退出全屏可能是点按钮、按 Esc、或者被浏览器强制退出，所以统一监听事件，
// 而不是在点击里切状态（F11 的全屏不走 Fullscreen API，不会触发这里）
document.addEventListener('fullscreenchange', function () {
    let full = !!document.fullscreenElement;
    document.body.classList.toggle('is-fullscreen', full);

    if (!full) {
        if (keyboardLockSupported()) {
            navigator.keyboard.unlock();
        }
        keyboardLocked = false;
        renderFullscreenStatus();
        return;
    }

    // 先按「还没锁上」渲染一次，锁定是异步的，成了再刷新
    renderFullscreenStatus();
    lockKeyboard().then(function (locked) {
        keyboardLocked = locked;
        renderFullscreenStatus();
    });
});

renderFullscreenStatus();

let mediaRecorder = null;

function setRecordingUi(recording) {
    document.querySelector("#startRecordStatus").style.display = recording ? "none" : "flex";
    document.querySelector("#stopRecordStatus").style.display = recording ? "flex" : "none";
}

function startRecord() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        return;
    }
    if (typeof MediaRecorder === "undefined") {
        showNotice("当前浏览器不支持录制", {level: "error", key: "record"});
        return;
    }
    const stream = videoElement.srcObject;
    let live = stream && stream.getVideoTracks().some(function (track) {
        return track.readyState === "live";
    });
    // 没有画面时 new MediaRecorder 会抛错，而按钮之前已经切成了「停止」，
    // 界面就卡在一个其实没在录的状态
    if (!live) {
        showNotice("没有画面可录，请先确认视频已经打开", {level: "warn", key: "record"});
        return;
    }

    let mimeType = PageLogic.pickRecordMimeType(
        MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported.bind(MediaRecorder));
    let recorder;
    try {
        recorder = new MediaRecorder(stream, mimeType ? {mimeType: mimeType} : undefined);
    } catch (e) {
        showNotice("无法开始录制：" + (e && e.message ? e.message : String(e)), {level: "error", key: "record"});
        return;
    }
    const chunks = [];

    recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
            chunks.push(event.data);
        }
    };

    recorder.onerror = event => {
        let error = event && event.error;
        showNotice("录制出错：" + (error && error.message ? error.message : "未知错误"), {
            level: "error",
            key: "record"
        });
    };

    // 不只是点了停止才会走到这里：采集卡被拔掉、轨道全部结束时浏览器也会
    // 自己停掉录制。所以按钮状态和下载都在这里收尾，而不是在 stopRecord 里
    recorder.onstop = () => {
        let interrupted = !recorder.manualStop;
        if (mediaRecorder === recorder) {
            mediaRecorder = null;
        }
        setRecordingUi(false);
        if (chunks.length === 0) {
            showNotice("录制没有收到任何画面，未生成文件", {level: "warn", key: "record"});
            return;
        }
        const blob = new Blob(chunks, {type: recorder.mimeType || "video/webm"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = StatusText.recordFileName();
        a.click();
        // 马上 revoke 的话，大文件的下载可能还没来得及读完这个 URL
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 60000);
        if (interrupted) {
            showNotice("采集中断，录制已自动停止，已录下的部分已经下载", {level: "warn", key: "record"});
        }
    };

    try {
        // 每秒切一块：中途出问题时至少已经录下的部分还在
        recorder.start(1000);
    } catch (e) {
        showNotice("无法开始录制：" + (e && e.message ? e.message : String(e)), {level: "error", key: "record"});
        return;
    }
    mediaRecorder = recorder;
    setRecordingUi(true);
}

function stopRecord() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.manualStop = true;
        mediaRecorder.stop();
        return;
    }
    setRecordingUi(false);
}

// 录像只存在内存里，刷新或关掉页面就全没了
window.addEventListener('beforeunload', function (event) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        event.preventDefault();
        event.returnValue = "";
    }
});

// 粘贴是一个字一个字敲出去的，9600 波特率下一个字符约 40ms，长文本要敲好一阵。
// 期间再点一次粘贴，两段文字会交错着敲出去，所以同一时间只允许一个。
let pasting = false;
let pasteCancelled = false;

async function pasteText() {
    if (pasting) {
        pasteCancelled = true;
        return;
    }
    if (!ch) {
        showNotice("键鼠设备未连接", {level: "warn", key: "paste"});
        return;
    }
    let text;
    try {
        text = await navigator.clipboard.readText();
    } catch (e) {
        showNotice("读取剪贴板失败：请先允许剪贴板权限，或确认页面在安全上下文中打开", {
            level: "error",
            key: "paste"
        });
        return;
    }
    if (!text) {
        showNotice("剪贴板为空", {key: "paste"});
        return;
    }

    pasting = true;
    pasteCancelled = false;
    // 用户手上按着的键要先松开，否则会和敲出去的字符混在一起
    ch.forceReleaseAllInput();
    let progress = showNotice("正在粘贴 0 / " + text.length, {
        key: "paste",
        timeout: 0,
        closable: false,
        action: {
            text: "取消",
            onClick: function () {
                pasteCancelled = true;
            }
        }
    });
    let result;
    try {
        result = await ch.typeText(text, {
            onProgress: function (done, total) {
                progress.setMessage("正在粘贴 " + done + " / " + total);
            },
            isCancelled: function () {
                return pasteCancelled;
            }
        });
    } catch (e) {
        showNotice("粘贴中断：" + (e && e.message ? e.message : String(e)), {level: "error", key: "paste"});
        return;
    } finally {
        pasting = false;
    }

    let summary = PageLogic.pasteSummary(result);
    showNotice(summary.message, {level: summary.level, key: "paste", timeout: summary.timeout});
}

function paste() {
    pasteText();
}

function ctrlAltDel() {
    if (!ch) {
        return;
    }
    ch.sendCtrlAltDelete();
}

function releaseAllInput() {
    if (!ch) {
        return;
    }
    ch.forceReleaseAllInput();
}

function isEditableTarget(target) {
    if (!target || !target.tagName) {
        return false;
    }
    let tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!target.isContentEditable;
}

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

// 按采集卡的原始分辨率截，而不是按页面上缩放后的尺寸，小字才看得清
async function takeScreenshot() {
    let width = videoElement.videoWidth;
    let height = videoElement.videoHeight;
    if (!width || !height || videoBroken()) {
        showNotice("没有画面可截，请先确认视频已经打开", {level: "warn", key: "screenshot"});
        return;
    }
    let canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(videoElement, 0, 0, width, height);
    let blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, "image/png");
    });
    if (!blob) {
        showNotice("截图失败：浏览器没能生成图片", {level: "error", key: "screenshot"});
        return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = StatusText.screenshotFileName();
    a.click();
    setTimeout(function () {
        URL.revokeObjectURL(url);
    }, 60000);

    // 顺手放进剪贴板，贴进聊天或工单比找下载的文件快。不支持或没给权限就算了，文件已经存下了
    let copied = false;
    try {
        if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
            await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
            copied = true;
        }
    } catch (e) {
        console.warn("截图复制到剪贴板失败", e);
    }
    showNotice("截图已保存（" + width + "×" + height + "）" + (copied ? "，并已复制到剪贴板" : ""), {
        key: "screenshot",
        timeout: 3000
    });
}

// 开机连按期间为 true：和粘贴一样，用户的按键会和连按的报告互相覆盖
let keyRepeating = false;
let keyRepeatStop = false;
let shortcutRepeatOn = false;

async function runShortcut(item, repeatable) {
    if (keyRepeating) {
        // 连按中再点任何快捷键都当作「停」，免得找不到提示条上的按钮
        keyRepeatStop = true;
        return;
    }
    if (!ch) {
        showNotice("键鼠设备未连接", {level: "warn", key: "shortcut"});
        return;
    }
    if (pasting) {
        showNotice("正在粘贴，等粘贴结束或取消后再按快捷键", {level: "warn", key: "shortcut"});
        return;
    }
    let parsed = Shortcuts.parseSequence(item.combo);
    if (parsed.error) {
        showNotice("快捷键无效：" + parsed.error, {level: "error", key: "shortcut"});
        return;
    }
    if (repeatable && shortcutRepeatOn) {
        repeatShortcut(parsed);
        return;
    }
    let chip = ch;
    for (let i = 0; i < parsed.steps.length; i++) {
        if (i > 0) {
            // 多步之间留点空，被控端弹出的菜单、对话框要时间画出来才接得住下一步
            await sleep(150);
        }
        if (ch !== chip || !await chip.tapCombo(parsed.steps[i])) {
            showNotice("快捷键没有发完：" + parsed.text, {level: "error", key: "shortcut"});
            return;
        }
    }
    showNotice("已发送 " + parsed.text, {key: "shortcut", timeout: 1500});
}

async function repeatShortcut(parsed) {
    let chip = ch;
    keyRepeating = true;
    keyRepeatStop = false;
    chip.forceReleaseAllInput();
    let count = 0;
    let started = Date.now();
    let notice = showNotice("正在连按 " + parsed.text, {
        key: "shortcut",
        timeout: 0,
        closable: false,
        action: {
            text: "停止",
            onClick: function () {
                keyRepeatStop = true;
            }
        }
    });
    try {
        while (!keyRepeatStop && ch === chip && Date.now() - started < Shortcuts.REPEAT_MAX_MS) {
            for (let i = 0; i < parsed.steps.length; i++) {
                await chip.tapCombo(parsed.steps[i]);
            }
            count++;
            notice.setMessage("正在连按 " + parsed.text + "（已按 " + count + " 次），被控端开机自检时会认到");
            await sleep(Shortcuts.REPEAT_INTERVAL_MS);
        }
    } finally {
        keyRepeating = false;
    }
    let timedOut = !keyRepeatStop && ch === chip;
    showNotice((timedOut ? "连按已到 " + Shortcuts.REPEAT_MAX_MS / 1000 + " 秒上限，自动停止" : "已停止连按")
        + "，共按了 " + count + " 次 " + parsed.text, {key: "shortcut", timeout: 3000});
}

function toggleShortcutPanel(force) {
    let panel = document.getElementById("shortcutPanel");
    let open = typeof force === "boolean" ? force : panel.hidden;
    if (open) {
        toggleViewPanel(false);
        toggleProfilePanel(false);
        toggleOcrPanel(false);
        renderShortcutPanel();
    }
    panel.hidden = !open;
    document.getElementById("shortcutButton").setAttribute("aria-expanded", String(open));
}

function renderShortcutPanel() {
    let groups = document.getElementById("shortcutGroups");
    groups.textContent = "";
    let custom = Shortcuts.loadCustom(localStorage);
    if (custom.length) {
        groups.appendChild(buildShortcutGroup({title: "自定义", items: custom}, true));
    }
    Shortcuts.PRESETS.forEach(function (group) {
        groups.appendChild(buildShortcutGroup(group, false));
    });
}

function buildShortcutGroup(group, removable) {
    let section = document.createElement("section");
    section.className = "shortcut-group";
    let header = document.createElement("div");
    header.className = "shortcut-group-title";
    let title = document.createElement("span");
    title.textContent = group.title;
    header.appendChild(title);
    if (group.repeatable) {
        let toggle = document.createElement("label");
        toggle.className = "shortcut-repeat";
        toggle.title = "打开后点按键会每 " + Shortcuts.REPEAT_INTERVAL_MS / 1000 + " 秒按一次，最长 "
            + Shortcuts.REPEAT_MAX_MS / 1000 + " 秒。先打开连按再给被控端开机，就不会错过 BIOS 热键";
        let checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = shortcutRepeatOn;
        checkbox.addEventListener("change", function () {
            shortcutRepeatOn = checkbox.checked;
        });
        toggle.appendChild(checkbox);
        toggle.appendChild(document.createTextNode("开机连按"));
        header.appendChild(toggle);
    }
    section.appendChild(header);

    let list = document.createElement("div");
    list.className = "shortcut-list";
    group.items.forEach(function (item, index) {
        let cell = document.createElement("div");
        cell.className = "shortcut-cell";
        let button = document.createElement("button");
        button.type = "button";
        button.className = "shortcut-item";
        let combo = document.createElement("span");
        combo.className = "shortcut-combo";
        combo.textContent = item.combo;
        let label = document.createElement("span");
        label.className = "shortcut-label";
        label.textContent = item.label;
        button.appendChild(combo);
        button.appendChild(label);
        button.addEventListener("click", function () {
            runShortcut(item, !!group.repeatable);
        });
        cell.appendChild(button);
        if (removable) {
            let remove = document.createElement("button");
            remove.type = "button";
            remove.className = "shortcut-remove";
            remove.textContent = "×";
            remove.setAttribute("aria-label", "删除 " + item.label);
            remove.addEventListener("click", function () {
                let next = Shortcuts.loadCustom(localStorage);
                next.splice(index, 1);
                Shortcuts.saveCustom(localStorage, next);
                renderShortcutPanel();
            });
            cell.appendChild(remove);
        }
        list.appendChild(cell);
    });
    section.appendChild(list);
    return section;
}

function addCustomShortcut() {
    let labelInput = document.getElementById("shortcutLabel");
    let comboInput = document.getElementById("shortcutCombo");
    let error = document.getElementById("shortcutError");
    let list = Shortcuts.loadCustom(localStorage);
    if (list.length >= Shortcuts.MAX_CUSTOM) {
        error.textContent = "最多保存 " + Shortcuts.MAX_CUSTOM + " 个自定义快捷键";
        return;
    }
    let custom = Shortcuts.makeCustom(labelInput.value, comboInput.value);
    if (custom.error) {
        error.textContent = custom.error;
        return;
    }
    list.push(custom);
    Shortcuts.saveCustom(localStorage, list);
    error.textContent = "";
    labelInput.value = "";
    comboInput.value = "";
    renderShortcutPanel();
}

(function bindShortcutPanel() {
    let panel = document.getElementById("shortcutPanel");
    if (!panel) {
        return;
    }
    // 面板内容多时要能滚动，滚轮不能漏到 document 上变成被控端的滚动
    panel.addEventListener("wheel", function (event) {
        event.stopPropagation();
    }, {passive: true});
    ["shortcutLabel", "shortcutCombo"].forEach(function (id) {
        document.getElementById(id).addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                addCustomShortcut();
            }
        });
    });
    // 别的标签页改了自定义快捷键，这边打开着的面板跟着刷新
    window.addEventListener("storage", function (event) {
        if (event.key === Shortcuts.STORAGE_KEY && !panel.hidden) {
            renderShortcutPanel();
        }
    });
})();

// OCR：框选画面上的一块，用 vendor/tesseract 在本机识别成文字。区域换算、预处理、
// 结果整理在 ocr.js，这里只管框选交互、截图和调引擎
let ocrSelecting = false;
let ocrStart = null;
let ocrPanelWasOpen = false;
let ocrBusy = false;
let ocrWorker = null;
let ocrWorkerLangs = null;
let ocrProgress = null;
let ocrIdleTimer = null;
let ocrLastRegion = null;
let ocrLangs = Ocr.loadLangs(localStorage);
// 引擎连同中文语言包要占一两百 MB 内存，闲置一阵就放掉；下次再用重新加载也不到一秒
const OCR_IDLE_MS = 3 * 60 * 1000;

function hasLivePicture() {
    return !!videoElement.videoWidth && !!videoElement.videoHeight && !videoBroken();
}

function loadScript(src) {
    return new Promise(function (resolve, reject) {
        let script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = function () {
            reject(new Error("加载 " + src + " 失败"));
        };
        document.head.appendChild(script);
    });
}

// 引擎第一次用到才加载，平时打开控制页不多下载一个字节
async function ensureOcrWorker(key) {
    if (typeof Tesseract === "undefined") {
        await loadScript(Ocr.VENDOR_DIR + "tesseract.min.js");
    }
    if (!ocrWorker) {
        let options = Ocr.workerOptions(new URL(Ocr.VENDOR_DIR, location.href).href,
            Ocr.simdSupported(window.WebAssembly));
        options.logger = function (message) {
            if (ocrProgress) {
                ocrProgress(message);
            }
        };
        ocrWorker = await Tesseract.createWorker(key, 1, options);
        ocrWorkerLangs = key;
    } else if (ocrWorkerLangs !== key) {
        // 已加载的语言包不会重新下载，只补新勾上的；换顺序只是重新初始化
        await ocrWorker.reinitialize(key);
        ocrWorkerLangs = key;
    }
    return ocrWorker;
}

function disposeOcrWorker() {
    let worker = ocrWorker;
    ocrWorker = null;
    ocrWorkerLangs = null;
    if (worker) {
        worker.terminate().catch(function () {});
    }
}

function scheduleOcrIdle() {
    clearTimeout(ocrIdleTimer);
    ocrIdleTimer = setTimeout(function () {
        if (!ocrBusy) {
            disposeOcrWorker();
        }
    }, OCR_IDLE_MS);
}

function startOcrSelection() {
    if (ocrBusy) {
        showNotice("上一次识别还没完成，请稍等", {key: "ocr", timeout: 3000});
        return;
    }
    if (!hasLivePicture()) {
        showNotice("没有画面可识别，请先确认视频已经打开", {level: "warn", key: "ocr"});
        return;
    }
    ocrPanelWasOpen = !document.getElementById("ocrPanel").hidden;
    toggleShortcutPanel(false);
    toggleViewPanel(false);
    toggleProfilePanel(false);
    toggleOcrPanel(false);
    // 相对模式锁着指针时看不到光标，没法框选
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    ocrSelecting = true;
    ocrStart = null;
    document.getElementById("ocrBox").hidden = true;
    document.getElementById("ocrOverlay").hidden = false;
}

function endOcrSelection() {
    ocrSelecting = false;
    ocrStart = null;
    document.getElementById("ocrOverlay").hidden = true;
    document.getElementById("ocrBox").hidden = true;
}

function cancelOcrSelection() {
    endOcrSelection();
    if (ocrPanelWasOpen) {
        toggleOcrPanel(true);
    }
}

function drawOcrBox(start, end) {
    let box = document.getElementById("ocrBox");
    box.style.left = Math.min(start.x, end.x) + "px";
    box.style.top = Math.min(start.y, end.y) + "px";
    box.style.width = Math.abs(end.x - start.x) + "px";
    box.style.height = Math.abs(end.y - start.y) + "px";
    box.hidden = false;
}

// 画面模式（适应、1:1、放大平移）都体现在视频元素的位置尺寸和 object-fit 上，
// 照着它们换算，屏幕上框到哪儿截的就是哪儿
function ocrRegionFromSelection(start, end) {
    let video = {width: videoElement.videoWidth, height: videoElement.videoHeight};
    let content = Ocr.contentRect(videoElement.getBoundingClientRect(), video,
        window.getComputedStyle(videoElement).objectFit);
    return Ocr.selectionToVideo(start, end, content, video);
}

// 框选那一刻就把画面截下来：等引擎加载完再截，画面可能已经变了
function cropForOcr(region) {
    let scale = Ocr.scaleFor(region.width, region.height);
    let canvas = document.createElement("canvas");
    canvas.width = region.width * scale;
    canvas.height = region.height * scale;
    let context = canvas.getContext("2d", {willReadFrequently: true});
    context.imageSmoothingQuality = "high";
    context.drawImage(videoElement, region.x, region.y, region.width, region.height,
        0, 0, canvas.width, canvas.height);
    let image = context.getImageData(0, 0, canvas.width, canvas.height);
    Ocr.preprocess(image.data);
    context.putImageData(image, 0, 0);
    return canvas;
}

async function copyPlainText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        return false;
    }
}

function setOcrControlsDisabled(disabled) {
    ["ocrSelectAgain", "ocrWhole"].forEach(function (id) {
        document.getElementById(id).disabled = disabled;
    });
    document.querySelectorAll("#ocrLangs input").forEach(function (input) {
        input.disabled = disabled;
    });
}

async function recognizeRegion(region) {
    if (ocrBusy) {
        return;
    }
    if (!hasLivePicture()) {
        showNotice("没有画面可识别，请先确认视频已经打开", {level: "warn", key: "ocr"});
        return;
    }
    ocrBusy = true;
    ocrLastRegion = region;
    setOcrControlsDisabled(true);
    let canvas = cropForOcr(region);
    let notice = showNotice(Ocr.progressText(), {key: "ocr", timeout: 0, closable: false});
    ocrProgress = function (message) {
        notice.setMessage(Ocr.progressText(message.status, message.progress));
    };
    try {
        let plan = Ocr.recognitionPlan(ocrLangs);
        let raw = (await (await ensureOcrWorker(plan.first)).recognize(canvas)).data.text;
        if (plan.second && Ocr.hasHan(raw)) {
            raw = (await (await ensureOcrWorker(plan.second)).recognize(canvas)).data.text;
        }
        let text = Ocr.cleanText(raw);
        notice.remove();
        document.getElementById("ocrText").value = text;
        toggleOcrPanel(true);
        if (!text) {
            showNotice("没有识别到文字。只框住文字部分、框小一点再试试", {level: "warn", key: "ocr", timeout: 5000});
            return;
        }
        let copied = await copyPlainText(text);
        showNotice("识别出 " + Ocr.charCount(text) + " 个字" + (copied ? "，已复制到剪贴板" : ""),
            {key: "ocr", timeout: 3000});
    } catch (e) {
        notice.remove();
        console.warn("文字识别失败", e);
        showNotice("文字识别失败：" + (e && e.message ? e.message : String(e)), {level: "error", key: "ocr"});
        // 引擎出过错就不再信它，下次重新建
        disposeOcrWorker();
    } finally {
        ocrBusy = false;
        ocrProgress = null;
        setOcrControlsDisabled(false);
        scheduleOcrIdle();
    }
}

function recognizeWholeFrame() {
    recognizeRegion({x: 0, y: 0, width: videoElement.videoWidth, height: videoElement.videoHeight});
}

async function copyOcrText() {
    let area = document.getElementById("ocrText");
    if (!area.value) {
        showNotice("还没有可复制的文字", {key: "ocr", timeout: 3000});
        return;
    }
    if (await copyPlainText(area.value)) {
        showNotice("已复制到剪贴板", {key: "ocr", timeout: 2000});
        return;
    }
    // 浏览器不让写剪贴板时，选中文字让用户自己按 Ctrl+C
    area.focus();
    area.select();
    showNotice("浏览器不允许写入剪贴板，文字已选中，请按 Ctrl+C 复制", {level: "warn", key: "ocr"});
}

function renderOcrLangs() {
    let group = document.getElementById("ocrLangs");
    group.textContent = "";
    Ocr.LANGUAGES.forEach(function (lang) {
        let label = document.createElement("label");
        label.className = "shortcut-repeat";
        let input = document.createElement("input");
        input.type = "checkbox";
        input.value = lang.id;
        input.checked = ocrLangs.indexOf(lang.id) !== -1;
        input.disabled = ocrBusy;
        input.addEventListener("change", function () {
            let picked = Array.from(group.querySelectorAll("input:checked")).map(function (box) {
                return box.value;
            });
            // 至少留一种语言，全取消掉的那一下不算
            if (!picked.length) {
                input.checked = true;
                return;
            }
            ocrLangs = Ocr.saveLangs(localStorage, picked);
            if (ocrLastRegion) {
                recognizeRegion(ocrLastRegion);
            }
        });
        label.appendChild(input);
        label.appendChild(document.createTextNode(lang.label));
        group.appendChild(label);
    });
}

function toggleOcrPanel(force) {
    let panel = document.getElementById("ocrPanel");
    let open = typeof force === "boolean" ? force : panel.hidden;
    if (open) {
        toggleShortcutPanel(false);
        toggleViewPanel(false);
        toggleProfilePanel(false);
        renderOcrLangs();
    }
    panel.hidden = !open;
}

(function bindOcr() {
    let overlay = document.getElementById("ocrOverlay");
    let panel = document.getElementById("ocrPanel");
    if (!overlay || !panel) {
        return;
    }
    function point(event) {
        return {x: event.clientX, y: event.clientY};
    }
    overlay.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        if (event.pointerType === "mouse" && event.button !== 0) {
            // 右键取消，和多数截图工具一样
            if (event.button === 2) {
                cancelOcrSelection();
            }
            return;
        }
        ocrStart = point(event);
        try {
            overlay.setPointerCapture(event.pointerId);
        } catch (e) {
            // 拿不到捕获只是拖出窗口后收不到移动，不影响框选
        }
        drawOcrBox(ocrStart, ocrStart);
    });
    overlay.addEventListener("pointermove", function (event) {
        if (ocrStart) {
            drawOcrBox(ocrStart, point(event));
        }
    });
    overlay.addEventListener("pointerup", function (event) {
        if (!ocrStart) {
            return;
        }
        let start = ocrStart;
        ocrStart = null;
        let region = ocrRegionFromSelection(start, point(event));
        if (!region) {
            document.getElementById("ocrBox").hidden = true;
            showNotice("框得太小或没框到画面，请重新拖动框选", {key: "ocr", timeout: 3000});
            return;
        }
        endOcrSelection();
        recognizeRegion(region);
    });
    overlay.addEventListener("pointercancel", function () {
        ocrStart = null;
        document.getElementById("ocrBox").hidden = true;
    });
    // 鼠标抬起、滚轮监听都挂在 document 上，框选时不能冒泡过去发给被控端
    ["mousedown", "mouseup", "click", "contextmenu"].forEach(function (type) {
        overlay.addEventListener(type, function (event) {
            event.stopPropagation();
            if (type === "contextmenu") {
                event.preventDefault();
            }
        });
    });
    overlay.addEventListener("wheel", function (event) {
        event.stopPropagation();
    }, {passive: true});
    // 键盘转发挂在 document 上；在 window 的捕获阶段先截住，框选期间按键一律不发
    ["keydown", "keyup"].forEach(function (type) {
        window.addEventListener(type, function (event) {
            if (!ocrSelecting) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (type === "keydown" && event.key === "Escape") {
                cancelOcrSelection();
            }
        }, true);
    });
    panel.addEventListener("wheel", function (event) {
        event.stopPropagation();
    }, {passive: true});
    window.addEventListener("storage", function (event) {
        if (event.key === Ocr.STORAGE_KEY) {
            ocrLangs = Ocr.loadLangs(localStorage);
            if (!panel.hidden) {
                renderOcrLangs();
            }
        }
    });
})();

// 触屏：手势规则在 touch-input.js，这里只负责把动作落到 Ch9329 上
function bindTouch() {
    let gestures = null;
    let longPressTimer = null;
    const BUTTONS = {left: {bits: 0x01, index: 0}, right: {bits: 0x02, index: 2}};

    function pressButton(action, button) {
        if (action.x != null) {
            panView(action.x, action.y);
            ch.mouseButtonDown(videoElement, action.x, action.y, button.bits);
            return;
        }
        // 相对模式的按键不带坐标；mouseButtonDown 会把传入的坐标记成差分基准，
        // 随便给个值会让之后的鼠标移动跳一大段，所以按完把基准清掉
        ch.mouseButtonDown(videoElement, 0, 0, button.bits);
        ch.resetRelativeOrigin();
    }

    function perform(actions) {
        if (!ch) {
            return;
        }
        actions.forEach(function (action) {
            let button = BUTTONS[action.button];
            if (action.type === "move") {
                panView(action.x, action.y);
                ch.mouseMove(videoElement, action.x, action.y);
            } else if (action.type === "moveBy") {
                ch.mouseMoveBy(action.dx, action.dy);
            } else if (action.type === "down") {
                pressButton(action, button);
            } else if (action.type === "up") {
                ch.mouseButtonUp(button.index);
            } else if (action.type === "click") {
                pressButton(action, button);
                ch.mouseButtonUp(button.index);
            } else if (action.type === "scroll") {
                ch.mouseScroll(action.notches);
            }
        });
    }

    videoElement.addEventListener("pointerdown", function (event) {
        if (event.pointerType !== "touch") {
            return;
        }
        // 不拦的话浏览器还会补发一套 mousedown/mouseup，同一下点击就发了两遍
        event.preventDefault();
        if (!ch) {
            return;
        }
        let absolute = ch.isMouseAbsolute();
        // 串口重连后鼠标模式可能变了，空闲时按当前模式重建
        if (!gestures || (!gestures.active() && gestures.absolute !== absolute)) {
            gestures = TouchInput.createGestures(absolute);
        }
        try {
            videoElement.setPointerCapture(event.pointerId);
        } catch (e) {
            // 拿不到捕获也能用，只是手指滑出画面后就收不到移动了
        }
        perform(gestures.down(event.pointerId, event.clientX, event.clientY, event.timeStamp));
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(function () {
            if (gestures) {
                perform(gestures.tick(performance.now()));
            }
        }, TouchInput.LONG_PRESS_MS + 20);
    });

    videoElement.addEventListener("pointermove", function (event) {
        if (event.pointerType !== "touch" || !gestures) {
            return;
        }
        perform(gestures.move(event.pointerId, event.clientX, event.clientY));
    });

    videoElement.addEventListener("pointerup", function (event) {
        if (event.pointerType !== "touch" || !gestures) {
            return;
        }
        perform(gestures.up(event.pointerId, event.clientX, event.clientY, event.timeStamp));
    });

    videoElement.addEventListener("pointercancel", function (event) {
        if (event.pointerType !== "touch" || !gestures) {
            return;
        }
        perform(gestures.cancel(event.pointerId));
    });
}

// 屏幕键盘：聚焦一个看不见的输入框把系统软键盘叫出来，打进去的字逐个敲给被控端。
// 只能打 US 键盘能直接打出的字符，和粘贴一样
let softKeyboardQueue = Promise.resolve();

function sendSoftKeys(task) {
    softKeyboardQueue = softKeyboardQueue.then(task).catch(function (e) {
        console.warn("屏幕键盘发送失败", e);
    });
}

function softTypeText(text) {
    sendSoftKeys(async function () {
        if (!ch || pasting || keyRepeating) {
            return;
        }
        for (const char of text) {
            let info = ch.resolveTypeChar(char);
            if (info && info.code != null) {
                await ch.tapKey(info.code, info.shift);
            }
        }
    });
}

function softTapKey(code) {
    sendSoftKeys(async function () {
        if (!ch || pasting || keyRepeating) {
            return;
        }
        await ch.tapCombo([code]);
    });
}

function toggleSoftKeyboard() {
    let input = document.getElementById("softKeyboard");
    if (document.activeElement === input) {
        input.blur();
    } else {
        input.focus();
    }
    // 窗口本身没有焦点时 focus/blur 事件不会派发，按钮状态按实际焦点定
    document.getElementById("softKeyboardButton").setAttribute("aria-pressed",
        String(document.activeElement === input));
}

(function bindSoftKeyboard() {
    let input = document.getElementById("softKeyboard");
    let button = document.getElementById("softKeyboardButton");
    if (!input || !button) {
        return;
    }
    // 只在有触摸屏的设备上露出按钮，桌面上有实体键盘用不着
    if (navigator.maxTouchPoints > 0) {
        button.hidden = false;
    }
    input.addEventListener("focus", function () {
        button.setAttribute("aria-pressed", "true");
    });
    input.addEventListener("blur", function () {
        button.setAttribute("aria-pressed", "false");
        input.value = "";
    });
    input.addEventListener("keydown", function (event) {
        let code = TouchInput.softKeyCode(event.key);
        if (code) {
            event.preventDefault();
            softTapKey(code);
        }
    });
    input.addEventListener("beforeinput", function (event) {
        let code = TouchInput.inputTypeKey(event.inputType);
        if (code && event.cancelable) {
            event.preventDefault();
            softTapKey(code);
        }
    });
    // 软键盘的联想输入会先「组字」，组完才是最终的字；组字期间框里的内容随时会变，
    // 所以只在不组字的时候把框里的字发出去再清空
    input.addEventListener("input", function (event) {
        if (event.isComposing) {
            return;
        }
        let text = input.value;
        input.value = "";
        if (text) {
            softTypeText(text);
        }
    });
    input.addEventListener("compositionend", function () {
        let text = input.value;
        input.value = "";
        if (text) {
            softTypeText(text);
        }
    });
})();

// 卸载 Service Worker 并清空 Cache Storage，不再使用 SW 缓存
(function clearServiceWorkerAndCaches() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations()
            .then(function (registrations) {
                return Promise.all(registrations.map(function (registration) {
                    return registration.unregister();
                }));
            })
            .catch(function () {});
    }
    if (typeof caches !== 'undefined' && caches.keys) {
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys.map(function (key) {
                    return caches.delete(key);
                }));
            })
            .catch(function () {});
    }
})();
