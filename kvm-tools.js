// 控制页：全屏时锁定系统按键、录像、粘贴文字、截图、快捷键面板

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
        showNotice(I18n.t("record.unsupported"), {level: "error", key: "record"});
        return;
    }
    const stream = videoElement.srcObject;
    let live = stream && stream.getVideoTracks().some(function (track) {
        return track.readyState === "live";
    });
    // 没有画面时 new MediaRecorder 会抛错，而按钮之前已经切成了「停止」，
    // 界面就卡在一个其实没在录的状态
    if (!live) {
        showNotice(I18n.t("record.noVideo"), {level: "warn", key: "record"});
        return;
    }

    let mimeType = PageLogic.pickRecordMimeType(
        MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported.bind(MediaRecorder));
    let recorder;
    try {
        recorder = new MediaRecorder(stream, mimeType ? {mimeType: mimeType} : undefined);
    } catch (e) {
        showNotice(I18n.t("record.startFailed", {message: e && e.message ? e.message : String(e)}), {level: "error", key: "record"});
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
        showNotice(I18n.t("record.error", {message: error && error.message ? error.message : I18n.t("common.unknownError")}), {
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
            showNotice(I18n.t("record.empty"), {level: "warn", key: "record"});
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
            showNotice(I18n.t("record.interrupted"), {level: "warn", key: "record"});
        }
    };

    try {
        // 每秒切一块：中途出问题时至少已经录下的部分还在
        recorder.start(1000);
    } catch (e) {
        showNotice(I18n.t("record.startFailed", {message: e && e.message ? e.message : String(e)}), {level: "error", key: "record"});
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
        showNotice(I18n.t("serial.notReady"), {level: "warn", key: "paste"});
        return;
    }
    let text;
    try {
        text = await navigator.clipboard.readText();
    } catch (e) {
        showNotice(I18n.t("paste.readFailed"), {
            level: "error",
            key: "paste"
        });
        return;
    }
    if (!text) {
        showNotice(I18n.t("paste.empty"), {key: "paste"});
        return;
    }

    pasting = true;
    pasteCancelled = false;
    // 用户手上按着的键要先松开，否则会和敲出去的字符混在一起
    ch.forceReleaseAllInput();
    let progress = showNotice(I18n.t("paste.progress", {done: 0, total: text.length}), {
        key: "paste",
        timeout: 0,
        closable: false,
        action: {
            text: I18n.t("common.cancel"),
            onClick: function () {
                pasteCancelled = true;
            }
        }
    });
    let result;
    try {
        result = await ch.typeText(text, {
            onProgress: function (done, total) {
                progress.setMessage(I18n.t("paste.progress", {done: done, total: total}));
            },
            isCancelled: function () {
                return pasteCancelled;
            }
        });
    } catch (e) {
        showNotice(I18n.t("paste.failed", {message: e && e.message ? e.message : String(e)}), {level: "error", key: "paste"});
        return;
    } finally {
        pasting = false;
    }

    let summary = PageLogic.pasteSummary(result);
    showNotice(summary.message, {level: summary.level, key: "paste", timeout: summary.timeout});
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
        showNotice(I18n.t("screenshot.noVideo"), {level: "warn", key: "screenshot"});
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
        showNotice(I18n.t("screenshot.failed"), {level: "error", key: "screenshot"});
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
    showNotice(I18n.t(copied ? "screenshot.savedCopied" : "screenshot.saved", {width: width, height: height}), {
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
        showNotice(I18n.t("serial.notReady"), {level: "warn", key: "shortcut"});
        return;
    }
    if (pasting) {
        showNotice(I18n.t("shortcut.busyPasting"), {level: "warn", key: "shortcut"});
        return;
    }
    let parsed = Shortcuts.parseSequence(item.combo);
    if (parsed.error) {
        showNotice(I18n.t("shortcut.invalid", {message: parsed.error}), {level: "error", key: "shortcut"});
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
            showNotice(I18n.t("shortcut.incomplete", {combo: parsed.text}), {level: "error", key: "shortcut"});
            return;
        }
    }
    showNotice(I18n.t("shortcut.sent", {combo: parsed.text}), {key: "shortcut", timeout: 1500});
}

async function repeatShortcut(parsed) {
    let chip = ch;
    keyRepeating = true;
    keyRepeatStop = false;
    chip.forceReleaseAllInput();
    let count = 0;
    let started = Date.now();
    let notice = showNotice(I18n.t("shortcut.repeating", {combo: parsed.text}), {
        key: "shortcut",
        timeout: 0,
        closable: false,
        action: {
            text: I18n.t("common.stop"),
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
            notice.setMessage(I18n.t("shortcut.repeatingCount", {combo: parsed.text, count: count}));
            await sleep(Shortcuts.REPEAT_INTERVAL_MS);
        }
    } finally {
        keyRepeating = false;
    }
    let timedOut = !keyRepeatStop && ch === chip;
    showNotice(timedOut
        ? I18n.t("shortcut.repeatTimedOut", {seconds: Shortcuts.REPEAT_MAX_MS / 1000, count: count, combo: parsed.text})
        : I18n.t("shortcut.repeatStopped", {count: count, combo: parsed.text}), {key: "shortcut", timeout: 3000});
}

function toggleShortcutPanel(force) {
    let panel = document.getElementById("shortcutPanel");
    let open = typeof force === "boolean" ? force : panel.hidden;
    if (open) {
        toggleViewPanel(false);
        toggleProfilePanel(false);
        togglePowerPanel(false);
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
        groups.appendChild(buildShortcutGroup({title: I18n.t("shortcut.group.custom"), items: custom}, true));
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
        toggle.title = I18n.t("shortcut.repeatHint", {
            interval: Shortcuts.REPEAT_INTERVAL_MS / 1000,
            max: Shortcuts.REPEAT_MAX_MS / 1000
        });
        let checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = shortcutRepeatOn;
        checkbox.addEventListener("change", function () {
            shortcutRepeatOn = checkbox.checked;
        });
        toggle.appendChild(checkbox);
        toggle.appendChild(document.createTextNode(I18n.t("shortcut.repeatToggle")));
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
            remove.setAttribute("aria-label", I18n.t("shortcut.removeLabel", {name: item.label}));
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
        error.textContent = I18n.t("shortcut.error.tooManyCustom", {max: Shortcuts.MAX_CUSTOM});
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
