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
function bindSettingsSync(initial) {
    let applied = initial;
    window.addEventListener('storage', function (event) {
        if (event.key !== SettingsStore.KEY) {
            return;
        }
        let next = SettingsStore.read();
        if (!next) {
            return;
        }
        let previous = applied;
        applied = next;
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
        if (changes.labels.length) {
            showNotice("设置已更新：" + changes.labels.join("、"), {key: "settings", timeout: 3000});
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
        event.preventDefault()
        // 按住不放时本机会连发 keydown，但被控端只要收到「按下」就会自己按
        // 它的设置重复。再转发一遍只是重发同一份报告，低波特率下白白占串口。
        // 粘贴期间用户的按键会和模拟敲键的报告互相覆盖，打出乱码，也先不转发
        if (!ch || event.repeat || pasting) {
            return;
        }
        ch.keydown(event.code);
    })

    document.addEventListener('keyup', (event) => {
        event.preventDefault();
        if (!ch || pasting) {
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
});

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
