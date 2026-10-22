// 控制页：显示方式、被控机配置切换、ATX 电源三个工具栏面板

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
    document.getElementById("viewTooltip").textContent = I18n.t("view.tooltip", {mode: label});
    document.getElementById("viewButton").setAttribute("aria-label", I18n.t("view.buttonLabel", {mode: label}));
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
        togglePowerPanel(false);
        toggleOcrPanel(false);
        renderViewPanel();
    }
    panel.hidden = !open;
    document.getElementById("viewButton").setAttribute("aria-expanded", String(open));
}

window.addEventListener("resize", applyViewLayout);
// 1:1 和放大要按画面的真实尺寸算，被控端换分辨率时也会触发 resize
['loadedmetadata', 'resize', 'playing', 'emptied'].forEach(function (name) {
    videoElement.addEventListener(name, applyViewLayout);
});
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
    let label = state.active || I18n.t("profile.none");
    document.getElementById("profileTooltip").textContent = I18n.t("profile.tooltip", {name: label});
    button.setAttribute("aria-label", I18n.t("profile.buttonLabel", {name: label}));
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
        showNotice(I18n.t("profile.switchFailed"), {level: "error", key: "settings", timeout: 4000});
        return;
    }
    Profiles.save(localStorage, result.state);
    // 本页自己写 localStorage 不会收到 storage 事件，得自己把新设置应用上
    applySettingsUpdate(result.settings);
    renderProfilePanel();
    showNotice(I18n.t("profile.switched", {name: name}), {key: "settings", timeout: 3000});
}

function toggleProfilePanel(force) {
    let panel = document.getElementById("profilePanel");
    let open = typeof force === "boolean" ? force : panel.hidden;
    if (open) {
        toggleShortcutPanel(false);
        toggleViewPanel(false);
        togglePowerPanel(false);
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

// ATX 电源：设置里选了继电器才出现按钮。继电器只在按的那一下打开，平时不占串口
const POWER_ARM_MS = 4000;
// 会丢数据的操作要连点两下，手滑点一下就让被控端断电或重启，代价太大
const POWER_CONFIRM = {
    long: {
        button: "powerLong",
        hint: "powerLongHint",
        idle: I18n.t("power.long.hint"),
        armed: I18n.t("power.long.armed")
    },
    reset: {
        button: "powerReset",
        hint: "powerResetHint",
        idle: I18n.t("power.reset.hint"),
        armed: I18n.t("power.reset.armed")
    }
};
let powerBusy = null;
let powerArmed = null;
let powerArmTimer = null;

function currentAtx() {
    return AtxRelay.normalize(SettingsStore.readOrEmpty().atx);
}

function renderPowerPanel() {
    let atx = currentAtx();
    let button = document.getElementById("powerButton");
    button.hidden = !atx;
    if (button.hidden) {
        togglePowerPanel(false);
    }
    document.getElementById("powerReset").hidden = !(atx && atx.resetChannel);
    ["powerShort", "powerLong", "powerReset"].forEach(function (id) {
        document.getElementById(id).disabled = !!powerBusy;
    });
}

function togglePowerPanel(force) {
    let panel = document.getElementById("powerPanel");
    let open = typeof force === "boolean" ? force : panel.hidden;
    if (open) {
        toggleShortcutPanel(false);
        toggleViewPanel(false);
        toggleProfilePanel(false);
        toggleOcrPanel(false);
        renderPowerPanel();
    } else {
        disarmPower();
    }
    panel.hidden = !open;
    document.getElementById("powerButton").setAttribute("aria-expanded", String(open));
}

function disarmPower() {
    clearTimeout(powerArmTimer);
    powerArmTimer = null;
    powerArmed = null;
    Object.keys(POWER_CONFIRM).forEach(function (kind) {
        let confirm = POWER_CONFIRM[kind];
        document.getElementById(confirm.button).dataset.armed = "false";
        document.getElementById(confirm.hint).textContent = confirm.idle;
    });
}

function armPower(kind) {
    disarmPower();
    let confirm = POWER_CONFIRM[kind];
    powerArmed = kind;
    document.getElementById(confirm.button).dataset.armed = "true";
    document.getElementById(confirm.hint).textContent = confirm.armed;
    powerArmTimer = setTimeout(disarmPower, POWER_ARM_MS);
}

async function pressPower(kind) {
    let atx = currentAtx();
    let channel = AtxRelay.channelFor(atx, kind);
    if (powerBusy || !channel) {
        return;
    }
    if (POWER_CONFIRM[kind] && powerArmed !== kind) {
        armPower(kind);
        return;
    }
    disarmPower();
    if (!navigator.serial) {
        showNotice(I18n.t("power.unsupported"), {level: "error", key: "power"});
        return;
    }
    let press = AtxRelay.PRESSES[kind];
    let cancel = {};
    powerBusy = cancel;
    renderPowerPanel();
    let port = null;
    try {
        let opened = await AtxRelay.openRelayPort(await navigator.serial.getPorts(),
            SettingsStore.parseUsbFilter(atx.deviceId), activePort);
        if (opened.error) {
            showNotice(opened.error, {level: "error", key: "power", link: {text: I18n.t("common.goSettings"), href: "settings.html#power"}});
            return;
        }
        port = opened.port;
        showNotice(I18n.t("power.pressing", {action: press.label}), {
            key: "power",
            timeout: press.ms + 2000,
            action: kind === "long" ? {
                text: I18n.t("power.release"),
                onClick: function () {
                    cancel.cancelled = true;
                    if (cancel.release) {
                        cancel.release();
                    }
                }
            } : undefined
        });
        await AtxRelay.press(port, channel, press.ms, cancel);
        showNotice(cancel.cancelled ? I18n.t("power.releasedEarly") : I18n.t("power.done", {action: press.label}), {key: "power", timeout: 3000});
    } catch (e) {
        // 继电器靠 USB 供电，拔掉就一定松开
        showNotice(I18n.t("power.failed", {message: e && e.message ? e.message : String(e)}), {level: "error", key: "power"});
    } finally {
        if (port) {
            await port.close().catch(function (e) {
                console.warn("关闭继电器串口失败", e);
            });
        }
        powerBusy = null;
        renderPowerPanel();
    }
}

renderPowerPanel();
