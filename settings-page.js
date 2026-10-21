// 设置页的页面逻辑：枚举设备、填下拉框、写波特率、存配置。
I18n.apply();

const NO_WEB_SERIAL = I18n.t("settings.noWebSerial");
const CONFIRM_MS = 4000;

// 提示统一走顶部提示条，不用 alert：同一时间只留一条，错误不自动消失
function notify(message, level) {
    return Notices.show(message, {level: level || "info", key: "settings"});
}

// 写进芯片后要断电重插才生效，这一步漏了等于白写，所以提示留着等用户关
function notifyReplug(message) {
    return Notices.show(message, {level: "warn", key: "settings", timeout: 0});
}

// 危险操作点两下才执行：第一下把按钮变成确认状态，4 秒内再点才返回 true
function confirmByClickingTwice(button, armedText) {
    if (button.dataset.armed === "true") {
        clearTimeout(Number(button.dataset.armTimer));
        button.textContent = button.dataset.idleText;
        button.dataset.armed = "false";
        return true;
    }
    button.dataset.idleText = button.textContent;
    button.dataset.armed = "true";
    button.textContent = armedText;
    button.dataset.armTimer = String(setTimeout(function () {
        button.textContent = button.dataset.idleText;
        button.dataset.armed = "false";
    }, CONFIRM_MS));
    return false;
}

async function authUsb() {
    if (!navigator.serial) {
        notify(NO_WEB_SERIAL, "error");
        return;
    }
    try {
        await navigator.serial.requestPort();
    } catch (e) {
        // 用户在选择框里点了取消就是 NotFoundError，那是有意为之，不用吵他
        if (e && e.name === "NotFoundError") {
            return;
        }
        notify(I18n.t("settings.authSerialFailed", {message: e && e.message ? e.message : String(e)}), "error");
        return;
    }
    Notices.flash(I18n.t("settings.authSerialDone"));
    window.location.reload();
}

function describeMediaError(e) {
    let name = e && e.name;
    if (name === "NotAllowedError") {
        return I18n.t("settings.media.denied");
    }
    if (name === "NotFoundError") {
        return I18n.t("settings.media.notFound");
    }
    if (name === "NotReadableError") {
        return I18n.t("settings.media.busy");
    }
    if (name === "SecurityError" || !navigator.mediaDevices) {
        return I18n.t("settings.media.insecure");
    }
    return I18n.t("settings.media.failed", {message: e && e.message ? e.message : String(e)});
}

async function authMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        notify(describeMediaError(null), "error");
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    } catch (e) {
        // 没有任何音频输入时，连带视频一起失败；视频才是必需的，退一步只要视频
        if (!(e && e.name === "NotFoundError")) {
            notify(describeMediaError(e), "error");
            return;
        }
        try {
            stream = await navigator.mediaDevices.getUserMedia({video: true});
        } catch (videoError) {
            notify(describeMediaError(videoError), "error");
            return;
        }
    }
    // 授权拿到就够了，不停掉的话刷新前这一下会一直占着采集卡
    stream.getTracks().forEach(function (track) {
        track.stop();
    });
    Notices.flash(I18n.t("settings.authMediaDone"));
    window.location.reload();
}

function fillDeviceOptions(selector, list, savedDeviceId) {
    for (let i = 0; i < list.length; i++) {
        let device = list[i];
        let option = document.createElement("option");
        option.setAttribute("value", device.deviceId);
        option.innerText = device.label || I18n.t("settings.unnamedDevice", {id: String(device.deviceId).slice(0, 8)});
        if (savedDeviceId && device.deviceId === savedDeviceId) {
            option.setAttribute("selected", "selected");
        }
        selector.appendChild(option);
    }
}

function renderMedia() {
    navigator.mediaDevices.enumerateDevices().then(devices => {
        let videoSelector = document.querySelector("#choice1");
        let audioSelector = document.querySelector("#choice3");
        let settings = SettingsStore.readOrEmpty();

        let savedVideo = settings.video && settings.video.deviceId;
        let savedAudio = settings.audio && settings.audio.deviceId;
            fillDeviceOptions(videoSelector, DeviceFilter.forKind(devices, "videoinput", savedVideo), savedVideo);
            fillDeviceOptions(audioSelector, DeviceFilter.forKind(devices, "audioinput", savedAudio), savedAudio);

        document.querySelector("#frameRate").value =
            String(SettingsStore.normalizeFrameRate(settings.frameRate));

        let resolutionElement = document.querySelector("#choice4");
        if (settings.resolution && settings.resolution.width && settings.resolution.height) {
            for (let i = 0; i < resolutionElement.options.length; i++) {
                let option = resolutionElement.options[i];
                if (option.value === settings.resolution.width + "x" + settings.resolution.height) {
                    option.setAttribute("selected", "selected");
                }
            }
        }

    })
}

function renderUsb() {
    let settings = SettingsStore.readOrEmpty();
    // 没有 Web Serial 时直接调 getPorts 会同步抛错，后面的鼠标模式、波特率
    // 这些下拉框也跟着不初始化了
    let listPorts = navigator.serial
        ? navigator.serial.getPorts()
        : Promise.reject(new Error(NO_WEB_SERIAL));
    listPorts
        .then((ports) => {
            let selector = document.querySelector("#choice2");
            let saved = SettingsStore.savedUsbFilter(settings);
            for (let i = 0; i < ports.length; i++) {
                let port = ports[i];
                let info = port.getInfo();
                let htmlOptionElement = document.createElement("option");
                htmlOptionElement.setAttribute("value", JSON.stringify(info));
                htmlOptionElement.innerText = DeviceFilter.serialPortLabel(info);
                if (saved
                    && saved.usbVendorId === info.usbVendorId
                    && saved.usbProductId === info.usbProductId) {
                    htmlOptionElement.setAttribute("selected", "selected");
                }
                selector.appendChild(htmlOptionElement);
            }
        })
        .catch(e => {
            Notices.show(e.message, {level: "error", key: "serial"});
        })

    if (settings.mouseClickMode) {
        let selector = document.querySelector("#choice5");
        for (let i = 0; i < selector.options.length; i++) {
            let option = selector.options[i];
            if (option.value === settings.mouseClickMode) {
                option.setAttribute("selected", "selected");
            }
        }
    }

    fillBaudOptions(settings.baudRate || 9600);

    document.querySelector("#relativeSpeed").value =
        SettingsStore.normalizeRelativeSpeed(settings.relativeSpeed);
    // 绝对模式发的是坐标，没有倍数一说，这一项摆在那儿只会让人以为它有用
    syncRelativeSpeedVisibility();
    document.querySelector("#choice5").addEventListener("change", syncRelativeSpeedVisibility);

    // 记住上次写进芯片的工作模式。不还原的话下拉框每次都回到模式 0，
    // 看起来就像刚才那次写入没生效
    let modeSelector = document.querySelector("#choice7");
    let savedMode = settings.workingMode == null ? 0 : settings.workingMode;
    for (let i = 0; i < modeSelector.options.length; i++) {
        let option = modeSelector.options[i];
        if (parseInt(option.value) === savedMode) {
            option.setAttribute("selected", "selected");
        }
    }
}

function renderAtx() {
    let atx = AtxRelay.normalize(SettingsStore.readOrEmpty().atx);
    let saved = atx && SettingsStore.parseUsbFilter(atx.deviceId);
    let portSelector = document.querySelector("#atxPort");
    let none = document.createElement("option");
    none.value = "";
    none.textContent = I18n.t("settings.atx.none");
    portSelector.replaceChildren(none);
    if (navigator.serial) {
        navigator.serial.getPorts().then(function (ports) {
            ports.forEach(function (port) {
                let info = port.getInfo();
                let option = document.createElement("option");
                option.value = JSON.stringify(info);
                option.textContent = DeviceFilter.serialPortLabel(info);
                if (saved && saved.usbVendorId === info.usbVendorId
                    && saved.usbProductId === info.usbProductId) {
                    option.selected = true;
                }
                portSelector.appendChild(option);
            });
        });
    }

    let channelSelector = document.querySelector("#atxChannel");
    let resetSelector = document.querySelector("#atxResetChannel");
    let noReset = document.createElement("option");
    noReset.value = "";
    noReset.textContent = I18n.t("settings.atx.noReset");
    resetSelector.appendChild(noReset);
    AtxRelay.CHANNELS.forEach(function (channel) {
        let option = document.createElement("option");
        option.value = String(channel);
        option.textContent = I18n.t("settings.atx.channel", {channel: channel});
        option.selected = channel === (atx ? atx.channel : 1);
        channelSelector.appendChild(option);
        let resetOption = option.cloneNode(true);
        resetOption.selected = !!atx && channel === atx.resetChannel;
        resetSelector.appendChild(resetOption);
    });
    syncResetChannelOptions();
    channelSelector.addEventListener("change", syncResetChannelOptions);
}

// 复位键不能和电源键同一路：把那一路禁掉，已经选中的退回「不接」
function syncResetChannelOptions() {
    let power = document.querySelector("#atxChannel").value;
    let resetSelector = document.querySelector("#atxResetChannel");
    Array.from(resetSelector.options).forEach(function (option) {
        option.disabled = option.value === power;
    });
    if (resetSelector.value === power) {
        resetSelector.value = "";
    }
}

function collectAtx() {
    let option = document.querySelector("#atxPort").selectedOptions[0];
    if (!option || !option.value) {
        return null;
    }
    return AtxRelay.normalize({
        deviceId: option.value,
        label: option.textContent,
        channel: document.querySelector("#atxChannel").value,
        resetChannel: document.querySelector("#atxResetChannel").value
    });
}

// 灵敏度只对相对模式有意义，选绝对模式时整块收起来。注意只是藏起来，输入框
// 里的值还在，save() 照常存，切回相对模式不会丢。
function syncRelativeSpeedVisibility() {
    let relative = document.querySelector("#choice5").value === "relative";
    document.querySelector("#relativeSpeedField").style.display = relative ? "" : "none";
}

// 下拉框里当前选中的端口优先：用户可能刚选好还没点保存
function selectedSerialFilter() {
    let element = document.querySelector("#choice2");
    if (!element || element.selectedOptions.length === 0) {
        return null;
    }
    return SettingsStore.parseUsbFilter(element.selectedOptions[0].value);
}

// 写波特率要自己开一次串口，用完必须关掉：端口是独占的，没释放的话这个
// 标签页会一直占着它，控制页就打不开了。关不掉至少要吼一声，别静静地咽下去。
async function releasePort(port) {
    try {
        await port.close();
    } catch (e) {
        console.warn("关闭串口失败。请刷新本页释放端口，否则控制页会连不上", e);
    }
}

function baudNote(baud) {
    if (baud === 9600) {
        return I18n.t("settings.baud.factory");
    }
    if (baud === 115200) {
        return I18n.t("settings.baud.recommended");
    }
    return I18n.t("settings.baud.fast");
}

// 下拉框直接由探测列表生成。硬编码成两份的话迟早会对不上，而一旦写进一个
// 探测不到的波特率，芯片就再也连不上了，所以这里必须是同一份数据。
function fillBaudOptions(selected) {
    let selector = document.querySelector("#choice6");
    selector.replaceChildren();
    Ch9329.BAUD_RATES.forEach(function (baud) {
        let option = document.createElement("option");
        option.value = String(baud);
        option.textContent = baud + baudNote(baud);
        if (baud === selected) {
            option.selected = true;
        }
        selector.appendChild(option);
    });
}

// 几个写芯片配置的动作外壳完全一样：挑对端口 → 连上 → 确认芯片真在应答 →
// 用完把端口还回去。只有中间那一步不同，所以把外壳抽出来。
// 中止时返回 null（提示已经弹过了），成功则返回 action 的结果。
async function withChip(action) {
    if (!navigator.serial) {
        notify(NO_WEB_SERIAL, "error");
        return null;
    }
    let settings = SettingsStore.readOrEmpty();
    let ports = await navigator.serial.getPorts();
    if (ports.length === 0) {
        notify(I18n.t("settings.chip.noPorts"), "error");
        return null;
    }

    let filter = selectedSerialFilter() || SettingsStore.savedUsbFilter(settings);
    let port = SettingsStore.matchPort(ports, filter);
    if (!port) {
        if (ports.length === 1) {
            port = ports[0];
        } else {
            notify(I18n.t("settings.chip.pickPort"), "error");
            return null;
        }
    }
    console.log("写入芯片配置使用的串口：", port.getInfo());

    let connection = await Ch9329.connect(port, Ch9329.BAUD_RATES, true);
    if (!connection.info) {
        await connection.ch.dispose();
        await releasePort(port);
        let detail = Ch9329.describeAttempts(connection.attempts);
        console.warn("CH9329 探测失败：", connection.attempts);
        notify(I18n.t("settings.chip.noReply", {detail: detail}), "error");
        return null;
    }
    try {
        return await action(connection.ch);
    } finally {
        // 写入成功与否都要归还端口，否则这个标签页会一直占着它
        await connection.ch.dispose();
        await releasePort(port);
    }
}

async function applyBaudRate() {
    let target = parseInt(document.querySelector("#choice6").value);
    let result = await withChip(function (ch) {
        return ch.setBaudRate(target);
    });
    if (!result) {
        return;
    }
    if (!result.ok) {
        notify(I18n.t("settings.chip.writeFailed", {reason: result.reason}), "error");
        return;
    }

    SettingsStore.patch({baudRate: target});
    if (result.unchanged) {
        notify(I18n.t("settings.baud.unchanged", {baud: target}));
        return;
    }
    notifyReplug(I18n.t("settings.baud.written", {baud: target}));
}

async function applyWorkingMode() {
    let target = parseInt(document.querySelector("#choice7").value);
    let result = await withChip(function (ch) {
        return ch.setWorkingMode(target);
    });
    if (!result) {
        return;
    }
    if (!result.ok) {
        notify(I18n.t("settings.chip.writeFailed", {reason: result.reason}), "error");
        return;
    }
    // 只有真正写进芯片才记下来，否则下拉框会显示一个芯片上并不存在的模式
    SettingsStore.patch({workingMode: target});
    if (result.unchanged) {
        notify(I18n.t("settings.mode.unchanged", {mode: target}));
        return;
    }
    notifyReplug(I18n.t("settings.mode.written", {mode: target}));
}

async function restoreDefaults(button) {
    if (!confirmByClickingTwice(button, I18n.t("settings.restore.armed"))) {
        Notices.show(I18n.t("settings.restore.warning"), {level: "warn", key: "settings", timeout: CONFIRM_MS});
        return;
    }
    Notices.dismiss("settings");
    let result = await withChip(function (ch) {
        return ch.restoreDefaultCfg();
    });
    if (!result) {
        return;
    }
    if (!result.ok) {
        let status = result.status == null ? I18n.t("chip.noReply") : "0x" + result.status.toString(16);
        notify(I18n.t("settings.restore.failed", {status: status}), "error");
        return;
    }
    SettingsStore.patch({baudRate: 9600, workingMode: 0});
    notifyReplug(I18n.t("settings.restore.done"));
}

function collectConfig() {
    let choice1 = document.querySelector("#choice1");
    let video = {}
    if (choice1.selectedOptions.length > 0) {
        let videoSelector = choice1.selectedOptions[0];
        let videoLabel = videoSelector.innerText;
        let videoDeviceId = videoSelector.value;
        video.label = videoLabel;
        video.deviceId = videoDeviceId;
    }

    let choice3 = document.querySelector("#choice3");
    let audio = {};
    if (choice3.selectedOptions.length > 0) {
        let option = choice3.selectedOptions[0];
        let audioLabel = option.innerText;
        let audioDeviceId = option.value;
        audio.label = audioLabel;
        audio.deviceId = audioDeviceId;
    }

    let usb = {}
    let usbElement = document.querySelector("#choice2");
    if (usbElement.selectedOptions.length > 0) {
        let option = usbElement.selectedOptions[0];
        let usbLabel = option.innerText;
        let usbDeviceId = option.value;
        usb.label = usbLabel;
        usb.deviceId = usbDeviceId;
    }
    let resolution = {width: 1920, height: 1080};
    let resolutionElement = document.querySelector("#choice4");
    if (resolutionElement.selectedOptions.length > 0) {
        let option = resolutionElement.selectedOptions[0];
        let split = option.value.split("x");
        resolution.width = parseInt(split[0]);
        resolution.height = parseInt(split[1]);
    }

    let config = {
        video: video,
        audio: audio,
        usb: usb,
        resolution: resolution,
        frameRate: SettingsStore.normalizeFrameRate(document.querySelector("#frameRate").value),
        mouseClickMode: "absolute",
        mouseModeVersion: 1,
        baudRate: parseInt(document.querySelector("#choice6").value) || 9600,
        // 输入框能填任何东西，夹一下再存；坏值会让鼠标直接不可用
        relativeSpeed: SettingsStore.normalizeRelativeSpeed(
            document.querySelector("#relativeSpeed").value),
        atx: collectAtx(),
        // 工作模式是芯片里的状态，只有「写入工作模式」才会真正改它。这里带上
        // 已存的值，否则整体覆盖式的 write() 会把它抹掉，下拉框就回到模式 0 了
        workingMode: SettingsStore.readOrEmpty().workingMode
    };
    let mouseClickMode = document.querySelector("#choice5");
    if (mouseClickMode.value === "absolute" || mouseClickMode.value === "relative") {
        config.mouseClickMode = mouseClickMode.value;
    }
    return config;
}

function save() {
    let config = collectConfig();
    if (!SettingsStore.write(config)) {
        notify(I18n.t("settings.storageFailed"), "error");
        return;
    }
    let profiles = Profiles.load(localStorage);
    if (profiles.active) {
        Profiles.save(localStorage, Profiles.updateActive(profiles, config));
        Notices.flash(I18n.t("settings.savedToProfile", {name: profiles.active}));
    } else {
        Notices.flash(I18n.t("settings.saved"));
    }
    window.location.reload();
}

function renderProfiles() {
    let state = Profiles.load(localStorage);
    let selector = document.querySelector("#profileSelect");
    let none = document.createElement("option");
    none.value = "";
    none.textContent = I18n.t(state.profiles.length ? "settings.profile.none" : "settings.profile.empty");
    selector.replaceChildren(none);
    state.profiles.forEach(function (profile) {
        let option = document.createElement("option");
        option.value = profile.name;
        option.textContent = profile.name;
        selector.appendChild(option);
    });
    selector.value = state.active || "";
    document.querySelector("#profileDelete").disabled = !state.active;
}

// 选中一份配置就把它写成当前设置，再刷新让下拉框按新设置重新填
function switchProfile() {
    let name = document.querySelector("#profileSelect").value;
    let state = Profiles.load(localStorage);
    if (!name) {
        Profiles.save(localStorage, Object.assign({}, state, {active: null}));
        renderProfiles();
        return;
    }
    let result = Profiles.apply(state, name, SettingsStore.readOrEmpty());
    if (result.error) {
        notify(result.error, "error");
        renderProfiles();
        return;
    }
    if (!SettingsStore.write(result.settings)) {
        notify(I18n.t("profile.switchFailed"), "error");
        return;
    }
    Profiles.save(localStorage, result.state);
    Notices.flash(I18n.t("settings.profile.switched", {name: name}));
    window.location.reload();
}

// 起名用页内的输入框，不用 prompt：prompt 会挡住整页，也没法提示重名
function saveProfileAs() {
    let row = document.querySelector("#profileNameRow");
    let input = document.querySelector("#profileName");
    row.hidden = false;
    input.value = Profiles.load(localStorage).active || "";
    input.focus();
    input.select();
}

function cancelProfileName() {
    document.querySelector("#profileNameRow").hidden = true;
}

// 按表单上现在的样子存一份，同时也写成当前设置
function confirmProfileName() {
    let state = Profiles.load(localStorage);
    let name = document.querySelector("#profileName").value;
    let config = collectConfig();
    let result = Profiles.saveAs(state, name, config);
    if (result.error) {
        notify(result.error, "error");
        document.querySelector("#profileName").focus();
        return;
    }
    if (!SettingsStore.write(config)) {
        notify(I18n.t("settings.storageFailed"), "error");
        return;
    }
    let existed = state.profiles.some(function (profile) {
        return profile.name === result.state.active;
    });
    Profiles.save(localStorage, result.state);
    Notices.flash(I18n.t(existed ? "settings.profile.updated" : "settings.profile.saved", {name: result.state.active}));
    window.location.reload();
}

function deleteProfile(button) {
    let state = Profiles.load(localStorage);
    if (!state.active || !confirmByClickingTwice(button, I18n.t("settings.profile.deleteArmed"))) {
        return;
    }
    Profiles.save(localStorage, Profiles.remove(state, state.active));
    notify(I18n.t("settings.profile.deleted", {name: state.active}));
    renderProfiles();
}

document.querySelector("#profileName").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        confirmProfileName();
    } else if (event.key === "Escape") {
        cancelProfileName();
    }
});

function renderUsed() {
    let settings = SettingsStore.read();
    if (!settings) {
        return;
    }
    // 下拉框列的是「能选什么」，这里列的是「实际存了什么」，两者不一定一致
    let shown = 0;
    shown += showSavedLine("#usedVideo", I18n.t("settings.used.video"), settings.video);
    shown += showSavedLine("#usedAudio", I18n.t("settings.used.audio"), settings.audio);
    shown += showSavedLine("#usedUsb", I18n.t("settings.used.usb"), settings.usb);
    shown += showSavedLine("#usedAtx", I18n.t("settings.used.atx"), settings.atx);
    if (shown > 0) {
        document.querySelector("#savedSection").style.display = "block";
    }
}

function showSavedLine(selector, name, device) {
    if (!device || !device.label) {
        return 0;
    }
    let element = document.querySelector(selector);
    element.textContent = I18n.t("settings.used.line", {name: name});
    let label = document.createElement("span");
    label.innerText = device.label;
    element.appendChild(label);
    element.style.display = "block";
    return 1;
}

function renderLanguages() {
    let select = document.querySelector("#languageSelect");
    I18n.LANGUAGES.forEach(function (language) {
        let option = document.createElement("option");
        option.value = language.code;
        option.textContent = language.name;
        select.appendChild(option);
    });
    select.value = I18n.current();
}

// 页面上的文字有一半是脚本生成的，逐个重画容易漏，刷新最稳。刷新会丢掉表单里
// 没保存的改动，所以语言选择放在最上面，先选语言再填别的
function changeLanguage() {
    let code = document.querySelector("#languageSelect").value;
    if (I18n.setLanguage(code)) {
        window.location.reload();
    }
}

renderLanguages();
renderMedia();
renderUsb();
renderAtx();
renderUsed();
renderProfiles();
Notices.showFlash();

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
