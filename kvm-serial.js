// 控制页：工具栏状态图标、键盘指示灯、CH9329 串口连接与重连、设置页保存后的同步

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

function showNotice(message, options) {
    return Notices.show(message, options);
}

function dismissNotice(key) {
    Notices.dismiss(key);
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
    renderLockLights(info);
}

// 键盘指示灯。芯片只在被问到时才报灯的状态，所以定时问一下：被控端开机自检、
// 登录界面会自己改 Num Lock，光凭本机按过什么键推算不准
const LOCK_POLL_MS = 2000;
// 查询和键鼠包排同一个队列，芯片漏一次应答就会让鼠标顿一下，所以最近有操作
// 就跳过这一轮。按锁定键、点小灯之后的那次补查不受限
const LOCK_POLL_IDLE_MS = 500;
let lockPollBusy = false;
// 偶尔漏一次应答很常见，连着两次都没回才把状态改成无应答，免得图标闪黄
let lockPollMisses = 0;

function renderLockLights(info) {
    let group = document.getElementById("lockLights");
    let lights = StatusText.lockLights(info);
    group.hidden = !lights;
    if (!lights) {
        return;
    }
    // 只建一次，之后只改状态：每次重建的话鼠标停在灯上时提示会一闪一闪
    if (!group.children.length) {
        StatusText.LOCK_LIGHTS.forEach(function (light) {
            let button = document.createElement("button");
            button.type = "button";
            button.className = "lock-light";
            button.dataset.key = light.key;
            button.textContent = light.glyph;
            let tooltip = document.createElement("span");
            tooltip.className = "tooltip";
            button.appendChild(tooltip);
            button.addEventListener("click", function () {
                toggleLock(light.key);
            });
            group.appendChild(button);
        });
    }
    lights.forEach(function (light, index) {
        let button = group.children[index];
        button.setAttribute("aria-pressed", String(light.on));
        button.setAttribute("aria-label", light.label);
        button.querySelector(".tooltip").textContent = light.label;
    });
}

async function pollLockLights(force) {
    // 芯片降级成只发不等时问了也没有回音，别让每次轮询都白等一个超时
    if (lockPollBusy || !ch || serialLost || document.hidden || !ch.isAckEnabled()) {
        return;
    }
    if (force !== true && Date.now() - ch.lastInputAt < LOCK_POLL_IDLE_MS) {
        return;
    }
    lockPollBusy = true;
    let chip = ch;
    try {
        let info = await chip.getInfo({quick: true});
        // 等回应期间串口可能被换掉了，旧芯片的状态不能画到新连接上
        if (chip !== ch || serialLost) {
            return;
        }
        if (info) {
            lockPollMisses = 0;
            renderStatus(info);
        } else if (++lockPollMisses >= 2) {
            renderStatus(null);
        }
    } catch (e) {
        console.warn("查询键盘指示灯失败", e);
    } finally {
        lockPollBusy = false;
    }
}

// 被控端收到按键后才改灯，稍等一下再问
function pollLockLightsSoon() {
    setTimeout(function () {
        pollLockLights(true);
    }, 150);
}

async function toggleLock(key) {
    if (!ch || pasting || keyRepeating) {
        return;
    }
    await ch.tapCombo([key]);
    pollLockLightsSoon();
}

setInterval(pollLockLights, LOCK_POLL_MS);
document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
        pollLockLights();
    }
});
document.addEventListener("keyup", function (event) {
    if (StatusText.LOCK_LIGHTS.some(function (light) {
        return light.key === event.code;
    }) && !isEditableTarget(event.target)) {
        pollLockLightsSoon();
    }
});

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
    setStatus("warn", [I18n.t("serial.reconnecting")]);
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
        showNotice(I18n.t("serial.unsupported"), {
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
                showNotice(I18n.t("serial.notFound"), {
                    level: "error",
                    key: "serial",
                    link: {text: I18n.t("common.goSettings"), href: "settings.html#input"}
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
                showNotice(I18n.t("serial.usbNotEnumerated"), {
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
    renderPowerPanel();
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
            showNotice(I18n.t("settings.updated", {items: labels.join(I18n.t("common.listSeparator"))}), {key: "settings", timeout: 3000});
        }
    });
}
