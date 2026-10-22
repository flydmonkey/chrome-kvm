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
            reject(new Error(I18n.t("common.loadFailed", {src: src})));
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
        showNotice(I18n.t("ocr.busy"), {key: "ocr", timeout: 3000});
        return;
    }
    if (!hasLivePicture()) {
        showNotice(I18n.t("ocr.noVideo"), {level: "warn", key: "ocr"});
        return;
    }
    ocrPanelWasOpen = !document.getElementById("ocrPanel").hidden;
    toggleShortcutPanel(false);
    toggleViewPanel(false);
    toggleProfilePanel(false);
    togglePowerPanel(false);
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
        showNotice(I18n.t("ocr.noVideo"), {level: "warn", key: "ocr"});
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
            showNotice(I18n.t("ocr.nothing"), {level: "warn", key: "ocr", timeout: 5000});
            return;
        }
        let copied = await copyPlainText(text);
        showNotice(I18n.t(copied ? "ocr.doneCopied" : "ocr.done", {count: Ocr.charCount(text)}),
            {key: "ocr", timeout: 3000});
    } catch (e) {
        notice.remove();
        console.warn("文字识别失败", e);
        showNotice(I18n.t("ocr.failed", {message: e && e.message ? e.message : String(e)}), {level: "error", key: "ocr"});
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
        showNotice(I18n.t("ocr.nothingToCopy"), {key: "ocr", timeout: 3000});
        return;
    }
    if (await copyPlainText(area.value)) {
        showNotice(I18n.t("ocr.copied"), {key: "ocr", timeout: 2000});
        return;
    }
    // 浏览器不让写剪贴板时，选中文字让用户自己按 Ctrl+C
    area.focus();
    area.select();
    showNotice(I18n.t("ocr.copyBlocked"), {level: "warn", key: "ocr"});
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
        togglePowerPanel(false);
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
            showNotice(I18n.t("ocr.selectionTooSmall"), {key: "ocr", timeout: 3000});
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
