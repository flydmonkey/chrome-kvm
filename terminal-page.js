// 串口终端页：xterm.js 显示，Web Serial 收发。参数校验、挑串口、校验和、编码这些
// 可单测的逻辑在 terminal.js。这是个独立工具，不碰控制页和设置页的设置
I18n.apply();

const t = I18n.t;
const utf8Encoder = new TextEncoder();
const gbkEncode = SerialTerminal.createGbkEncoder(TextDecoder);
const SELECT_FIELDS = ["dataBits", "parity", "stopBits", "flowControl", "newline", "mode", "encoding"];
// 这几项只影响以后怎么收发、怎么显示，改了不用重开串口
const LIVE_FIELDS = ["newline", "mode", "encoding"];
const NEWLINE_LABELS = {cr: "CR", lf: "LF", crlf: "CR+LF"};
const ENCODING_LABELS = {"utf-8": "UTF-8", gbk: "GBK"};
const CHECKSUM_LABELS = {
    none: null,
    sum8: "SUM8",
    xor8: "XOR8",
    lrc: "LRC",
    crc8: "CRC8",
    crc16: "CRC16 (Modbus)",
    crc16ccitt: "CRC16-CCITT",
    crc32: "CRC32"
};
const BREAK_MS = 250;
const MESSAGE_MS = 4000;
const HEX_PER_LINE = 16;
const SIGNAL_POLL_MS = 250;
const BAUD_CUSTOM = "custom";
// 写日志文件要关掉 writable 才算落盘，所以攒一会儿写一次；页面崩了最多丢这么久的数据
const RECORD_FLUSH_MS = 2000;
const RAW_CHUNK = 4096;
// 同一条自动应答两次触发至少隔这么久：回复的内容被回显后又命中自己就会死循环
const TRIGGER_COOLDOWN_MS = 1000;
const TRANSFER_LABELS = {ymodem: "YMODEM", xmodem: "XMODEM", xmodem1k: "XMODEM-1K", raw: null};
const NUMBER_FIELDS = {
    fontSize: {min: SerialTerminal.MIN_FONT_SIZE, max: SerialTerminal.MAX_FONT_SIZE},
    scrollback: {min: SerialTerminal.MIN_SCROLLBACK, max: SerialTerminal.MAX_SCROLLBACK},
    charDelay: {min: 0, max: SerialTerminal.MAX_CHAR_DELAY},
    lineDelay: {min: 0, max: SerialTerminal.MAX_LINE_DELAY},
    frameGap: {min: SerialTerminal.MIN_FRAME_GAP, max: SerialTerminal.MAX_FRAME_GAP}
};
// 改了要按新参数重开串口的字段
const OPEN_FIELDS = ["baudRate", "dataBits", "parity", "stopBits", "flowControl"];
// 脚本等待时只看最近这么多收到的文字
const SCRIPT_BUFFER = 65536;
const PLOT_POINTS = 500;
const PLOT_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c"];
const HIGHLIGHT_COLORS = {
    dark: {error: ["#fca5a5", "#450a0a"], warn: ["#fde68a", "#422006"]},
    light: {error: ["#b91c1c", "#fee2e2"], warn: ["#92400e", "#fef3c7"]}
};

let config = SerialTerminal.load(localStorage);
let term = null;
let fitAddon = null;
let searchAddon = null;
// 当前打开的串口和它的读写端
let port = null;
let reader = null;
let writer = null;
let writeChain = Promise.resolve();
let pendingWrites = 0;
let readLoopDone = Promise.resolve();
// 主动关闭（点断开、改参数）时读循环会结束，这个标记让它别当成被拔掉
let closing = false;
let connecting = false;
// 用户想保持连接：被拔掉后插回来要自动重连，点过「断开」就不再重连
let wantConnected = false;
let lost = false;
// 用户在浏览器选择框里明确选过的那个串口，同型号的有好几个时靠它区分
let chosenPort = null;
let pendingPaste = null;
let messageTimer = null;
let decoder = null;
// 文本模式下光标是否在行首，时间戳靠它判断要不要插
let atLineStart = true;
// HEX 模式下还没凑满一行的接收字节，以及这一帧是否已经显示过第一行
let rxPending = [];
let rxContinued = false;
let rxTimer = null;
let rxBytes = 0;
let txBytes = 0;
let countersQueued = false;
// 打开串口后 DTR、RTS 由页面显式设为有效，按钮显示的就是真实状态
let dtr = true;
let rts = true;
let signalTimer = null;
let loopTimer = null;
// 正在限速粘贴的任务，stopped 置真就停
let pacing = null;
// 正在传的文件：收到的字节交给协议，不上屏
let transfer = null;
// 持续写入的日志文件
let recorder = null;
// 发送栏历史里正翻到第几条，-1 表示没在翻；draft 是开始翻之前输入框里的内容
let historyIndex = -1;
let historyDraft = "";
// 关键字高亮扫到哪一行了：用 marker 记，回滚区满了往上挤时行号会跟着变
let scanMarker = null;
let scanQueued = false;
let highlightMarkers = [];
let triggerMatcher = null;
let triggerDecoder = null;
let triggerFiredAt = [];
// 正在跑的脚本
let scriptJob = null;
// 数据曲线：每条曲线最近 PLOT_POINTS 个点；plotLine 是还没收完的半行
let plotSeries = new Map();
let plotLine = "";
let plotDecoder = null;
let plotPaused = false;
let plotQueued = false;
// ZMODEM：Sentry 盯着收到的数据，发现对方运行了 sz / rz 就接管
let zsentry = null;
let zsession = null;
const receivedLog = SerialTerminal.createLog();

function themeColors() {
    if (document.documentElement.getAttribute("data-theme") === "light") {
        // 默认调色板是给深底配的，白底上黄色、白色几乎看不见，换深一档
        return {
            background: "#ffffff",
            foreground: "#27272a",
            cursor: "#27272a",
            cursorAccent: "#ffffff",
            selectionBackground: "rgba(37, 99, 235, 0.25)",
            white: "#52525b",
            brightWhite: "#18181b",
            yellow: "#a16207",
            brightYellow: "#ca8a04",
            cyan: "#0e7490",
            brightBlack: "#71717a"
        };
    }
    return {
        background: "#0c0c0e",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
        cursorAccent: "#0c0c0e",
        selectionBackground: "rgba(96, 165, 250, 0.35)"
    };
}

function createTerminal() {
    term = new Terminal({
        fontFamily: "Consolas, \"Cascadia Mono\", Menlo, \"DejaVu Sans Mono\", monospace",
        fontSize: config.fontSize,
        scrollback: config.scrollback,
        cursorBlink: true,
        // 关键字高亮要用 registerDecoration
        allowProposedApi: true,
        theme: themeColors()
    });
    fitAddon = new FitAddon.FitAddon();
    searchAddon = new SearchAddon.SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    let container = document.getElementById("terminal");
    term.open(container);
    fitAddon.fit();
    new ResizeObserver(function () {
        fitAddon.fit();
    }).observe(container);
    new MutationObserver(function () {
        term.options.theme = themeColors();
    }).observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});

    term.onData(function (data) {
        if (port) {
            let out = SerialTerminal.convertInput(data, config.newline);
            sendBytes(encodeText(out), out);
        } else if (!connecting && !lost) {
            showMessage(t("term.notConnected"));
        }
    });
    term.onResize(renderSize);
    term.onWriteParsed(queueScan);
    // Ctrl+C、Ctrl+F 要原样发给被控端（中断程序、shell 里光标右移），复制和搜索另加 Shift
    term.attachCustomKeyEventHandler(function (event) {
        if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyC") {
            copySelection();
            return false;
        }
        if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyF") {
            openSearch();
            return false;
        }
        // Ctrl+加减号、Ctrl+0 调字号，拦下来免得浏览器把整页缩放了
        let zoom = {Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1, Digit0: 0, Numpad0: 0}[event.code];
        if (event.ctrlKey && !event.altKey && zoom !== undefined) {
            event.preventDefault();
            if (event.type === "keydown") {
                setFontSize(zoom === 0 ? SerialTerminal.DEFAULTS.fontSize : config.fontSize + zoom);
            }
            return false;
        }
        return true;
    });
    container.addEventListener("wheel", function (event) {
        if (event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            setFontSize(config.fontSize + (event.deltaY < 0 ? 1 : -1));
        }
    }, {passive: false, capture: true});
    // 捕获阶段先拦下来：xterm 自己的粘贴处理会把多行文本一口气发出去，不经确认
    container.addEventListener("paste", function (event) {
        event.preventDefault();
        event.stopPropagation();
        requestPaste(event.clipboardData ? event.clipboardData.getData("text/plain") : "");
    }, true);
}

function encodeText(text) {
    return config.encoding === "gbk" ? gbkEncode(text) : utf8Encoder.encode(text);
}

function resetDecoder() {
    decoder = new TextDecoder(config.encoding);
    triggerDecoder = new TextDecoder(config.encoding);
    plotDecoder = new TextDecoder(config.encoding);
    if (scriptJob) {
        scriptJob.decoder = new TextDecoder(config.encoding);
    }
}

function stampText() {
    return "\x1b[90m[" + SerialTerminal.formatTime(new Date()) + "]\x1b[0m ";
}

function stampWidth() {
    return config.timestamp ? "[00:00:00.000] ".length : 0;
}

// 光标不在行首时先换行，免得下一段（提示、HEX 行）接在半行后面
function newLineIfNeeded() {
    if (term.buffer.active.cursorX !== 0) {
        term.write("\r\n");
    }
    atLineStart = true;
}

function writeNote(text) {
    flushRx();
    newLineIfNeeded();
    term.write("\x1b[90m" + text + "\x1b[0m\r\n");
}

function writeText(text) {
    if (config.timestamp) {
        let result = SerialTerminal.stampLines(text, atLineStart, stampText());
        atLineStart = result.atLineStart;
        term.write(result.text);
    } else {
        atLineStart = /\n$/.test(text) || (atLineStart && text === "");
        term.write(text);
    }
}

// 一个 RX 或 TX 块：第一行带时间戳和标签，后续行用空格对齐；每行后面是 ASCII 对照列
function writeHexBlock(label, color, bytes, continued) {
    let indent = " ".repeat(stampWidth() + label.length);
    let out = "";
    SerialTerminal.hexRows(bytes, HEX_PER_LINE).forEach(function (row, i) {
        let head = i === 0 && !continued
            ? (config.timestamp ? stampText() : "") + "\x1b[" + color + "m" + label + "\x1b[0m"
            : indent;
        out += head + " " + row.hex + "  \x1b[90m" + row.ascii + "\x1b[0m\r\n";
    });
    term.write(out);
    atLineStart = true;
}

function flushRx() {
    clearTimeout(rxTimer);
    if (rxPending.length) {
        writeHexBlock("RX", "33", rxPending, rxContinued);
    }
    rxPending = [];
    rxContinued = false;
}

function showReceived(bytes) {
    rxBytes += bytes.length;
    queueCounters();
    checkTriggers(bytes);
    feedScript(bytes);
    feedPlot(bytes);
    if (config.mode !== "hex") {
        writeText(decoder.decode(bytes, {stream: true}));
        return;
    }
    if (!rxContinued && rxPending.length === 0) {
        newLineIfNeeded();
    }
    for (let i = 0; i < bytes.length; i++) {
        rxPending.push(bytes[i]);
    }
    // 满一行就先显示，剩下的等停顿后一起显示，ASCII 列才是完整的一行
    let full = rxPending.length - rxPending.length % HEX_PER_LINE;
    if (full > 0) {
        writeHexBlock("RX", "33", rxPending.slice(0, full), rxContinued);
        rxPending = rxPending.slice(full);
        rxContinued = true;
    }
    clearTimeout(rxTimer);
    rxTimer = setTimeout(flushRx, config.frameGap);
}

// HEX 模式下每次发送都显示一行 TX：继电器这类设备不回数据，得让人看到发了什么。
// 文本模式下只有开了本地回显才显示，回显由被控端负责是终端的默认约定
function showSent(bytes, text) {
    if (config.mode === "hex") {
        flushRx();
        newLineIfNeeded();
        writeHexBlock("TX", "36", bytes, false);
    } else if (config.localEcho && text) {
        writeText(text.replace(/\r\n|\r|\n/g, "\r\n"));
    }
}

function queueCounters() {
    if (countersQueued) {
        return;
    }
    countersQueued = true;
    requestAnimationFrame(function () {
        countersQueued = false;
        renderCounters();
    });
}

function renderCounters() {
    document.getElementById("counters").textContent = t("term.counters", {
        rx: rxBytes.toLocaleString(),
        tx: txBytes.toLocaleString()
    });
}

function resetCounters() {
    rxBytes = 0;
    txBytes = 0;
    renderCounters();
}

function describeParams() {
    let text = config.baudRate + " " + config.dataBits + config.parity.charAt(0).toUpperCase() + config.stopBits;
    return config.flowControl === "hardware" ? text + " RTS/CTS" : text;
}

function currentPortLabel() {
    return config.label || (config.deviceId ? SerialTerminal.portLabel(config.deviceId) : "");
}

function errorMessage(e) {
    return e && e.message ? e.message : String(e);
}

function showMessage(text, level) {
    clearTimeout(messageTimer);
    let message = document.getElementById("message");
    message.textContent = text;
    message.dataset.level = level || "info";
    // 错误一直留着，直到下一次操作把它换掉
    if (level !== "error") {
        messageTimer = setTimeout(clearMessage, MESSAGE_MS);
    }
}

function clearMessage() {
    clearTimeout(messageTimer);
    let message = document.getElementById("message");
    message.textContent = "";
    message.dataset.level = "";
}

function render() {
    let status = document.getElementById("status");
    let state = connecting ? "connecting" : port ? "connected" : lost ? "lost" : "idle";
    status.dataset.state = state;
    let text = {
        idle: t("term.status.idle"),
        connecting: t("term.status.connecting"),
        connected: t("term.status.connected", {port: [currentPortLabel(), describeParams()].filter(Boolean).join(" · ")}),
        lost: t("term.status.lost")
    }[state];
    document.getElementById("statusText").textContent = text;

    let supported = !!navigator.serial;
    let active = !!port || (lost && wantConnected);
    let connectButton = document.getElementById("connectButton");
    connectButton.textContent = t(active ? "term.disconnect" : "term.connect");
    connectButton.classList.toggle("primary", !active);
    connectButton.disabled = !supported || connecting;
    document.getElementById("authorizeButton").disabled = !supported;
    document.getElementById("port").disabled = !supported;
    document.getElementById("breakButton").disabled = !port;
    document.getElementById("pasteButton").disabled = !port;
    document.getElementById("sendFileButton").disabled = !port || !!transfer;
    renderSignals();
    renderSendBar();
}

function renderSignals() {
    let dtrButton = document.getElementById("dtrButton");
    let rtsButton = document.getElementById("rtsButton");
    dtrButton.disabled = !port;
    // 硬件流控时 RTS 归驱动管，手动改会和流控打架
    rtsButton.disabled = !port || config.flowControl === "hardware";
    dtrButton.setAttribute("aria-pressed", String(!!port && dtr));
    rtsButton.setAttribute("aria-pressed", String(!!port && rts));
    if (!port) {
        renderLeds(null);
    }
}

function renderLeds(signals) {
    let map = {ctsLed: "clearToSend", dsrLed: "dataSetReady", dcdLed: "dataCarrierDetect", riLed: "ringIndicator"};
    Object.keys(map).forEach(function (id) {
        document.getElementById(id).classList.toggle("on", !!signals && !!signals[map[id]]);
    });
}

function renderSendBar() {
    let hex = config.sendFormat === "hex";
    document.getElementById("checksumField").hidden = !hex;
    document.getElementById("sendInput").placeholder = t(hex ? "term.sendPlaceholder.hex" : "term.sendPlaceholder.text");
    document.getElementById("sendButton").textContent = t(loopTimer ? "term.stop" : "term.send");
}

function portKey(id) {
    return id.usbVendorId + ":" + id.usbProductId;
}

// 同型号的串口在下拉框里只列一项：存下来的只有 VID/PID，列两个一模一样的名字只会让人困惑。
// 存过但现在没插的也留着，免得一刷新选择就丢了
async function renderPorts() {
    let ports = navigator.serial ? await navigator.serial.getPorts() : [];
    let ids = new Map();
    ports.forEach(function (item) {
        let info = item.getInfo();
        if (info.usbVendorId != null && info.usbProductId != null) {
            ids.set(portKey(info), {usbVendorId: info.usbVendorId, usbProductId: info.usbProductId});
        }
    });
    if (config.deviceId && !ids.has(portKey(config.deviceId))) {
        ids.set(portKey(config.deviceId), config.deviceId);
    }
    let select = document.getElementById("port");
    let none = document.createElement("option");
    none.value = "";
    none.textContent = t("term.port.none");
    select.replaceChildren(none);
    ids.forEach(function (id, key) {
        let option = document.createElement("option");
        option.value = key;
        option.textContent = SerialTerminal.portLabel(id) || t("term.port.noUsbInfo");
        select.appendChild(option);
    });
    select.value = config.deviceId ? portKey(config.deviceId) : "";
}

function fillSelect(id, values, labelOf, current) {
    let select = document.getElementById(id);
    select.replaceChildren();
    values.forEach(function (value) {
        let option = document.createElement("option");
        option.value = String(value);
        option.textContent = labelOf ? labelOf(value) : String(value);
        select.appendChild(option);
    });
    select.value = String(current === undefined ? config[id] : current);
}

function renderBaud() {
    let rates = SerialTerminal.BAUD_RATES.slice();
    if (rates.indexOf(config.baudRate) === -1) {
        rates.push(config.baudRate);
        rates.sort(function (a, b) {
            return a - b;
        });
    }
    fillSelect("baudSelect", rates.concat([BAUD_CUSTOM]), function (value) {
        return value === BAUD_CUSTOM ? t("term.baudCustom") : String(value);
    }, config.baudRate);
    let input = document.getElementById("baudRate");
    input.value = String(config.baudRate);
    input.hidden = true;
    document.getElementById("baudSelect").hidden = false;
}

function changeBaudSelect() {
    let select = document.getElementById("baudSelect");
    if (select.value !== BAUD_CUSTOM) {
        document.getElementById("baudRate").value = select.value;
        changeBaudRate();
        return;
    }
    let input = document.getElementById("baudRate");
    select.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
}

function renderParams() {
    renderBaud();
    fillSelect("dataBits", SerialTerminal.DATA_BITS);
    fillSelect("parity", SerialTerminal.PARITIES, function (value) {
        return t("term.parity." + value);
    });
    fillSelect("stopBits", SerialTerminal.STOP_BITS);
    fillSelect("flowControl", SerialTerminal.FLOW_CONTROLS, function (value) {
        return t("term.flow." + value);
    });
    fillSelect("newline", Object.keys(SerialTerminal.NEWLINES), function (value) {
        return NEWLINE_LABELS[value];
    });
    fillSelect("mode", SerialTerminal.MODES, function (value) {
        return t("term.mode." + value);
    });
    fillSelect("encoding", SerialTerminal.ENCODINGS, function (value) {
        return ENCODING_LABELS[value];
    });
    fillSelect("sendFormat", SerialTerminal.SEND_FORMATS, function (value) {
        return t("term.mode." + value);
    });
    fillSelect("checksum", SerialTerminal.CHECKSUMS, function (value) {
        return CHECKSUM_LABELS[value] || t("term.checksum.none");
    });
    document.getElementById("timestamp").checked = config.timestamp;
    document.getElementById("localEcho").checked = config.localEcho;
    document.getElementById("loopMs").value = String(config.loopMs);
    Object.keys(NUMBER_FIELDS).forEach(function (field) {
        document.getElementById(field).value = String(config[field]);
    });
    document.getElementById("highlight").checked = config.highlight;
    fillSelect("transferProtocol", SerialTerminal.TRANSFER_PROTOCOLS, function (value) {
        return TRANSFER_LABELS[value] || t("term.transfer.raw");
    });
}

function saveConfig(changes) {
    config = SerialTerminal.save(localStorage, Object.assign({}, config, changes));
}

async function changePort() {
    let value = document.getElementById("port").value;
    let next = null;
    if (value) {
        let parts = value.split(":");
        next = {usbVendorId: parseInt(parts[0], 10), usbProductId: parseInt(parts[1], 10)};
    }
    let changed = !next || !config.deviceId || portKey(next) !== portKey(config.deviceId);
    saveConfig({deviceId: next, label: next ? SerialTerminal.portLabel(next) : ""});
    if (changed) {
        chosenPort = null;
        document.getElementById("chooseButton").hidden = true;
        if (port || lost) {
            await disconnect();
        }
    }
    clearMessage();
    render();
}

async function changeParam(field) {
    let raw = document.getElementById(field).value;
    let changes = {};
    changes[field] = typeof SerialTerminal.DEFAULTS[field] === "number" ? parseInt(raw, 10) : raw;
    let previousMode = config.mode;
    saveConfig(changes);
    if (field === "mode" && config.mode !== previousMode) {
        // 切走 HEX 前把半行显示完；切回文本时解码器从头开始，免得接上切换前半个汉字
        flushRx();
        newLineIfNeeded();
        resetDecoder();
    }
    if (field === "encoding") {
        resetDecoder();
    }
    if (port && LIVE_FIELDS.indexOf(field) === -1) {
        await reopen();
    }
    render();
}

async function changeBaudRate() {
    let input = document.getElementById("baudRate");
    let raw = input.value.trim();
    let normalized = SerialTerminal.normalize({baudRate: raw}).baudRate;
    if (String(normalized) !== raw.replace(/^0+(?=\d)/, "")) {
        showMessage(t("term.error.baud", {min: SerialTerminal.MIN_BAUD, max: SerialTerminal.MAX_BAUD}), "error");
        renderBaud();
        return;
    }
    if (normalized === config.baudRate) {
        renderBaud();
        return;
    }
    clearMessage();
    saveConfig({baudRate: normalized});
    renderBaud();
    if (port) {
        await reopen();
    }
    render();
}

async function authorizePort() {
    let picked;
    try {
        picked = await navigator.serial.requestPort();
    } catch (e) {
        // 在选择框里点了取消
        if (e && e.name === "NotFoundError") {
            return;
        }
        showMessage(t("term.error.authorizeFailed", {message: errorMessage(e)}), "error");
        return;
    }
    let info = picked.getInfo();
    if (info.usbVendorId == null || info.usbProductId == null) {
        showMessage(t("term.port.noUsbInfo"), "error");
        return;
    }
    let id = {usbVendorId: info.usbVendorId, usbProductId: info.usbProductId};
    if (port || lost) {
        await disconnect();
    }
    saveConfig({deviceId: id, label: SerialTerminal.portLabel(id)});
    // 用户刚在选择框里点的就是这一个，同型号再多也不用猜了
    chosenPort = picked;
    document.getElementById("chooseButton").hidden = true;
    await renderPorts();
    clearMessage();
    render();
}

async function choosePort() {
    let picked;
    try {
        picked = await navigator.serial.requestPort({filters: [config.deviceId]});
    } catch (e) {
        if (e && e.name !== "NotFoundError") {
            showMessage(t("term.error.authorizeFailed", {message: errorMessage(e)}), "error");
        }
        return;
    }
    chosenPort = picked;
    document.getElementById("chooseButton").hidden = true;
    await connect(false);
}

function errorText(result) {
    if (result.error === "ambiguous") {
        return t("term.error.ambiguous", {count: result.count});
    }
    return t(result.error === "busy" ? "term.error.busy" : "term.error.notFound");
}

async function connect(reconnecting) {
    if (!navigator.serial || connecting || port) {
        return;
    }
    if (!config.deviceId) {
        showMessage(t("term.error.noPort"), "error");
        return;
    }
    connecting = true;
    if (!reconnecting) {
        clearMessage();
    }
    render();
    try {
        let candidates = SerialTerminal.candidatePorts(await navigator.serial.getPorts(), config.deviceId, chosenPort);
        if (chosenPort && candidates[0] === chosenPort) {
            candidates = [chosenPort];
        }
        let result = await SerialTerminal.openFirstUnambiguous(candidates, SerialTerminal.openOptions(config));
        if (result.error) {
            // 自动重连时设备可能还没完全回来，等下一次 connect 事件，别报错打扰。
            // 分不清是哪个例外：等多久都还是分不清，得让用户来选
            if (!reconnecting || result.error === "ambiguous") {
                document.getElementById("chooseButton").hidden = result.error !== "ambiguous";
                showMessage(errorText(result), "error");
            }
            return;
        }
        document.getElementById("chooseButton").hidden = true;
        startSession(result.port);
        wantConnected = true;
        lost = false;
        writeNote(reconnecting ? t("term.line.reconnected")
            : t("term.line.connected", {port: currentPortLabel(), params: describeParams()}));
        term.focus();
    } catch (e) {
        if (!reconnecting) {
            showMessage(t("term.error.openFailed", {message: errorMessage(e)}), "error");
        }
    } finally {
        connecting = false;
        render();
    }
}

function startSession(opened) {
    port = opened;
    closing = false;
    writer = opened.writable.getWriter();
    writeChain = Promise.resolve();
    pendingWrites = 0;
    resetDecoder();
    createSentry();
    readLoopDone = readLoop(opened);
    dtr = true;
    rts = true;
    applySignals();
    startSignalPolling(opened);
}

// 校验错、帧错、Break 这类错误不致命：readable 会换一个新的，接着读就行。
// 设备被拔掉时 readable 变成 null，循环结束，交给 handleLost
async function readLoop(opened) {
    while (opened.readable && port === opened) {
        reader = opened.readable.getReader();
        try {
            for (;;) {
                let chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
                if (chunk.value && chunk.value.length) {
                    receivedLog.append(chunk.value);
                    recordChunk(chunk.value);
                    if (transfer) {
                        rxBytes += chunk.value.length;
                        queueCounters();
                        feedTransfer(chunk.value);
                    } else if (zsentry && (zsession || config.mode === "text")) {
                        consumeZmodem(chunk.value);
                    } else {
                        showReceived(chunk.value);
                    }
                }
            }
        } catch (e) {
            // 见上，不致命的错误换个 reader 接着读
        } finally {
            reader.releaseLock();
            reader = null;
        }
        if (closing) {
            return;
        }
    }
    if (port === opened && !closing) {
        handleLost();
    }
}

function endSession() {
    stopLoop();
    stopPacing();
    abortTransfer();
    abortScript();
    abortZmodem();
    stopSignalPolling();
    flushRx();
}

async function closePort() {
    let opened = port;
    if (!opened) {
        return;
    }
    endSession();
    closing = true;
    try {
        if (reader) {
            await reader.cancel().catch(function () {});
        }
        await readLoopDone;
        await writeChain;
        if (writer) {
            writer.releaseLock();
            writer = null;
        }
        await opened.close().catch(function (e) {
            console.warn("关闭串口失败", e);
        });
    } finally {
        port = null;
        closing = false;
    }
}

function handleLost() {
    let opened = port;
    endSession();
    port = null;
    if (writer) {
        writer.releaseLock();
        writer = null;
    }
    opened.close().catch(function () {});
    lost = true;
    cancelPaste();
    writeNote(t("term.line.lost"));
    render();
}

async function disconnect() {
    let wasOpen = !!port;
    wantConnected = false;
    lost = false;
    cancelPaste();
    await closePort();
    if (wasOpen) {
        writeNote(t("term.line.disconnected"));
    }
    render();
}

// 改了波特率这类参数：同一个串口按新参数重开，屏幕上的输出留着
async function reopen() {
    let opened = port;
    await closePort();
    try {
        await opened.open(SerialTerminal.openOptions(config));
    } catch (e) {
        wantConnected = false;
        showMessage(t("term.error.openFailed", {message: errorMessage(e)}), "error");
        render();
        return;
    }
    startSession(opened);
    writeNote(t("term.line.reopened", {params: describeParams()}));
}

function applySignals() {
    let opened = port;
    if (!opened) {
        return;
    }
    let signals = {dataTerminalReady: dtr};
    if (config.flowControl !== "hardware") {
        signals.requestToSend = rts;
    }
    opened.setSignals(signals).catch(function (e) {
        if (port === opened) {
            showMessage(t("term.error.signals", {message: errorMessage(e)}), "error");
        }
    });
    renderSignals();
}

function toggleSignal(name) {
    if (!port) {
        return;
    }
    if (name === "dtr") {
        dtr = !dtr;
    } else {
        rts = !rts;
    }
    applySignals();
}

function startSignalPolling(opened) {
    stopSignalPolling();
    let busy = false;
    signalTimer = setInterval(function () {
        if (busy || port !== opened) {
            return;
        }
        busy = true;
        opened.getSignals().then(function (signals) {
            if (port === opened) {
                renderLeds(signals);
            }
        }, function () {
            // 读不到就保持上一次的显示
        }).finally(function () {
            busy = false;
        });
    }, SIGNAL_POLL_MS);
}

function stopSignalPolling() {
    clearInterval(signalTimer);
    signalTimer = null;
    renderLeds(null);
}

function send(text) {
    if (text) {
        sendBytes(encodeText(text), text);
    }
}

// 所有写入排成一队：同一时间只能有一个 write 在跑，多行粘贴的顺序也不会乱。
// text 是这批字节对应的文字，本地回显用；HEX 发送时没有
function sendBytes(bytes, text) {
    if (!writer || !bytes.length) {
        return;
    }
    if (transfer || zsession) {
        showMessage(t("term.transfer.busy"));
        return;
    }
    let target = writer;
    txBytes += bytes.length;
    queueCounters();
    showSent(bytes, text);
    pendingWrites++;
    writeChain = writeChain.then(function () {
        return target.write(bytes);
    }).catch(function (e) {
        if (writer === target) {
            stopLoop();
            showMessage(t("term.error.writeFailed", {message: errorMessage(e)}), "error");
        }
    }).finally(function () {
        pendingWrites--;
    });
}

// 发送框和常用指令共用。返回 false 表示没发出去（未连接、格式不对）
function sendItem(item) {
    if (!port) {
        showMessage(t("term.notConnected"));
        return false;
    }
    let payload = SerialTerminal.buildPayload(item, config.newline, encodeText);
    if (payload.error) {
        showMessage(t(payload.error === "empty" ? "term.error.empty" : "term.error.hex"), "error");
        return false;
    }
    let text = item.format === "text" ? item.data + SerialTerminal.NEWLINES[config.newline] : null;
    sendBytes(payload.bytes, text);
    return true;
}

function currentItem() {
    return {
        format: config.sendFormat,
        data: document.getElementById("sendInput").value,
        checksum: config.checksum
    };
}

// 发完不清空输入框：调继电器、AT 指令常常是同一条反复发
function submitSend(event) {
    event.preventDefault();
    if (loopTimer) {
        stopLoop();
        return;
    }
    let item = currentItem();
    if (!sendItem(item)) {
        return;
    }
    saveConfig({history: SerialTerminal.pushHistory(config.history, item)});
    historyIndex = -1;
    clearMessage();
    if (document.getElementById("loop").checked) {
        startLoop(item);
    }
    document.getElementById("sendInput").select();
}

// 上一次还没写完就跳过这一拍：低波特率下间隔又短，队列会越堆越长
function startLoop(item) {
    stopLoop();
    loopTimer = setInterval(function () {
        if (!port) {
            stopLoop();
            return;
        }
        if (pendingWrites === 0) {
            sendItem(item);
        }
    }, config.loopMs);
    renderSendBar();
}

function stopLoop() {
    if (!loopTimer) {
        return;
    }
    clearInterval(loopTimer);
    loopTimer = null;
    renderSendBar();
}

function changeLoopMs() {
    let input = document.getElementById("loopMs");
    let value = SerialTerminal.normalize({loopMs: input.value.trim()}).loopMs;
    if (String(value) !== input.value.trim()) {
        showMessage(t("term.error.loopMs", {min: SerialTerminal.MIN_LOOP_MS, max: SerialTerminal.MAX_LOOP_MS}), "error");
        input.value = String(config.loopMs);
        return;
    }
    saveConfig({loopMs: value});
    // 正在循环的话按新间隔重新计时
    if (loopTimer) {
        startLoop(currentItem());
    }
}

function renderPanel() {
    document.getElementById("panel").hidden = !config.panel;
    document.getElementById("panelButton").setAttribute("aria-pressed", String(config.panel));
}

function renderPresets() {
    let box = document.getElementById("presets");
    box.replaceChildren();
    config.presets.forEach(function (preset, index) {
        let row = document.createElement("div");
        row.className = "preset";
        let detail = (preset.format === "hex" ? "HEX " : "") + preset.data
            + (preset.format === "hex" && preset.checksum !== "none" ? " + " + CHECKSUM_LABELS[preset.checksum] : "");
        let sendButton = document.createElement("button");
        sendButton.type = "button";
        sendButton.className = "preset-send";
        sendButton.title = detail;
        let name = document.createElement("span");
        name.textContent = preset.name;
        sendButton.appendChild(name);
        // 名字就是内容本身时不用再显示一遍
        if (preset.name !== preset.data) {
            let data = document.createElement("span");
            data.className = "preset-data";
            data.textContent = detail;
            sendButton.appendChild(data);
        }
        sendButton.addEventListener("click", function () {
            sendItem(preset);
        });
        let removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "preset-remove";
        removeButton.textContent = "×";
        removeButton.title = t("term.removePreset");
        removeButton.setAttribute("aria-label", t("term.removePreset") + " " + preset.name);
        removeButton.addEventListener("click", function () {
            let presets = config.presets.slice();
            presets.splice(index, 1);
            saveConfig({presets: presets});
            renderPresets();
        });
        row.append(sendButton, removeButton);
        box.appendChild(row);
    });
    document.getElementById("presetsEmpty").hidden = config.presets.length > 0;
}

function savePreset() {
    let item = currentItem();
    if (!item.data.trim()) {
        showMessage(t("term.error.empty"), "error");
        return;
    }
    if (item.format === "hex" && SerialTerminal.parseHex(item.data).error) {
        showMessage(t("term.error.hex"), "error");
        return;
    }
    if (config.presets.length >= SerialTerminal.MAX_PRESETS) {
        showMessage(t("term.error.presetsFull", {max: SerialTerminal.MAX_PRESETS}), "error");
        return;
    }
    let name = window.prompt(t("term.presetName"), item.data);
    if (name === null) {
        return;
    }
    item.name = name;
    saveConfig({presets: config.presets.concat([item])});
    renderPresets();
}

function requestPaste(text) {
    if (!port || !text) {
        return;
    }
    let lines = SerialTerminal.lineCount(text);
    let data = SerialTerminal.convertPaste(text, config.newline);
    if (lines <= 1) {
        sendPaced(data);
        return;
    }
    // 多行粘贴到交换机的配置模式里就是一条条执行的命令，先让人看一眼
    pendingPaste = data;
    showMessage(t("term.pasteConfirm", {count: lines}));
    clearTimeout(messageTimer);
    document.getElementById("confirmButton").hidden = false;
    document.getElementById("cancelButton").hidden = false;
}

function cancelPaste() {
    if (pendingPaste === null) {
        return;
    }
    pendingPaste = null;
    document.getElementById("confirmButton").hidden = true;
    document.getElementById("cancelButton").hidden = true;
    clearMessage();
}

function confirmPaste() {
    let data = pendingPaste;
    cancelPaste();
    sendPaced(data);
    term.focus();
}

// 状态栏里一直留着的进度提示，带一个「取消」按钮
function showBusy(text) {
    showMessage(text);
    clearTimeout(messageTimer);
    document.getElementById("confirmButton").hidden = true;
    document.getElementById("cancelButton").hidden = false;
}

function hideBusy() {
    document.getElementById("cancelButton").hidden = true;
    document.getElementById("zmodemPickButton").hidden = true;
    clearMessage();
}

async function sendPaced(text) {
    let chunks = SerialTerminal.pacedChunks(text, config.charDelay, config.lineDelay);
    if (chunks.length <= 1) {
        send(text);
        return;
    }
    stopPacing();
    let job = {stopped: false};
    pacing = job;
    let opened = port;
    for (let i = 0; i < chunks.length && !job.stopped && port === opened; i++) {
        send(chunks[i].text);
        showBusy(t("term.pasting", {done: i + 1, total: chunks.length}));
        await writeChain;
        if (i < chunks.length - 1 && chunks[i].delay > 0) {
            await sleep(chunks[i].delay);
        }
    }
    if (pacing === job) {
        pacing = null;
        hideBusy();
    }
}

function stopPacing() {
    if (!pacing) {
        return;
    }
    pacing.stopped = true;
    pacing = null;
    hideBusy();
}

function cancelBusy() {
    if (zsession) {
        abortZmodem();
    } else if (transfer) {
        abortTransfer();
    } else if (scriptJob) {
        abortScript();
    } else if (pacing) {
        stopPacing();
    } else {
        cancelPaste();
    }
}

async function pasteFromClipboard() {
    let text;
    try {
        text = await navigator.clipboard.readText();
    } catch (e) {
        showMessage(t("term.error.clipboard", {message: errorMessage(e)}), "error");
        return;
    }
    requestPaste(text);
    term.focus();
}

function copySelection() {
    let text = term.getSelection();
    if (!text) {
        showMessage(t("term.nothingSelected"));
        return;
    }
    navigator.clipboard.writeText(text).then(function () {
        showMessage(t("term.copied"));
    }, function (e) {
        showMessage(t("term.error.clipboard", {message: errorMessage(e)}), "error");
    });
}

function openSearch() {
    let box = document.getElementById("searchBox");
    let input = document.getElementById("searchInput");
    box.hidden = false;
    let selection = term.getSelection();
    if (selection && selection.indexOf("\n") === -1) {
        input.value = selection;
    }
    input.focus();
    input.select();
}

function closeSearch() {
    document.getElementById("searchBox").hidden = true;
    searchAddon.clearDecorations();
    term.clearSelection();
    term.focus();
}

function findText(backward, incremental) {
    let text = document.getElementById("searchInput").value;
    if (!text) {
        term.clearSelection();
        return;
    }
    let found = backward
        ? searchAddon.findPrevious(text)
        : searchAddon.findNext(text, {incremental: !!incremental});
    if (found) {
        clearMessage();
    } else {
        showMessage(t("term.search.notFound", {text: text}));
    }
}

function formatSize(bytes) {
    if (bytes < 1024) {
        return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

// ---------- 字号、回滚行数、限速这几个数字设置 ----------

function setFontSize(size) {
    let next = Math.min(SerialTerminal.MAX_FONT_SIZE, Math.max(SerialTerminal.MIN_FONT_SIZE, size));
    if (next !== config.fontSize) {
        saveConfig({fontSize: next});
        term.options.fontSize = next;
        fitAddon.fit();
    }
    document.getElementById("fontSize").value = String(config.fontSize);
}

function changeNumber(field) {
    let input = document.getElementById(field);
    let raw = input.value.trim();
    let changes = {};
    changes[field] = raw;
    let value = SerialTerminal.normalize(changes)[field];
    if (String(value) !== raw) {
        let range = NUMBER_FIELDS[field];
        showMessage(t("term.error.range", {min: range.min, max: range.max}), "error");
        input.value = String(config[field]);
        return;
    }
    if (field === "fontSize") {
        setFontSize(value);
        return;
    }
    changes[field] = value;
    saveConfig(changes);
    if (field === "scrollback") {
        term.options.scrollback = value;
    }
}

// ---------- 窗口尺寸 ----------

// 串口没有窗口大小的协商，被控端默认按 80×24 排版，得用 stty 告诉它
function renderSize() {
    document.getElementById("termSize").textContent = t("term.size", {cols: term.cols, rows: term.rows});
}

function sendSize() {
    if (sendItem({format: "text", data: "stty cols " + term.cols + " rows " + term.rows, checksum: "none"})) {
        term.focus();
    }
}

// ---------- 关键字高亮 ----------

function queueScan() {
    if (scanQueued || !config.highlight) {
        return;
    }
    scanQueued = true;
    requestAnimationFrame(function () {
        scanQueued = false;
        scanHighlights();
    });
}

// 只扫已经换过行的行：光标所在的这一行可能还没收完，下次再扫
function scanHighlights() {
    let buffer = term.buffer.active;
    // vi、top 这类全屏程序用的是备用屏，不扫
    if (!config.highlight || buffer.type !== "normal") {
        return;
    }
    let end = buffer.baseY + buffer.cursorY;
    let start = scanMarker && !scanMarker.isDisposed ? scanMarker.line : 0;
    for (let y = start; y < end; y++) {
        decorateLine(buffer, y);
    }
    if (scanMarker) {
        scanMarker.dispose();
    }
    scanMarker = term.registerMarker(0);
    if (highlightMarkers.length > 2000) {
        highlightMarkers = highlightMarkers.filter(function (marker) {
            return !marker.isDisposed;
        });
    }
}

function decorateLine(buffer, y) {
    let line = buffer.getLine(y);
    if (!line) {
        return;
    }
    // 中文占两列，字符串下标要换算回列号
    let text = "";
    let columns = [];
    for (let x = 0; x < term.cols; x++) {
        let cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) {
            continue;
        }
        let chars = cell.getChars() || " ";
        for (let i = 0; i < chars.length; i++) {
            columns.push(x);
        }
        text += chars;
    }
    let found = SerialTerminal.findHighlights(text);
    if (found.length === 0) {
        return;
    }
    let marker = term.registerMarker(y - (buffer.baseY + buffer.cursorY));
    if (!marker) {
        return;
    }
    highlightMarkers.push(marker);
    let palette = HIGHLIGHT_COLORS[document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"];
    found.forEach(function (hit) {
        let x = columns[hit.start];
        let lastCell = line.getCell(columns[hit.end - 1]);
        let width = columns[hit.end - 1] + (lastCell ? lastCell.getWidth() : 1) - x;
        term.registerDecoration({
            marker: marker,
            x: x,
            width: width,
            foregroundColor: palette[hit.level][0],
            backgroundColor: palette[hit.level][1],
            layer: "top"
        });
    });
}

function clearHighlights() {
    highlightMarkers.forEach(function (marker) {
        marker.dispose();
    });
    highlightMarkers = [];
}

function changeHighlight(enabled) {
    saveConfig({highlight: enabled});
    if (enabled) {
        // 从头补扫一遍，关掉期间收到的也标上
        if (scanMarker) {
            scanMarker.dispose();
            scanMarker = null;
        }
        queueScan();
    } else {
        clearHighlights();
    }
}

// ---------- 持续记录到文件 ----------

// 文件句柄只能靠 showSaveFilePicker 拿到，Chrome、Edge 才有
async function startRecording() {
    let handle;
    try {
        handle = await window.showSaveFilePicker({suggestedName: SerialTerminal.logFileName(new Date())});
        let writable = await handle.createWritable();
        await writable.close();
    } catch (e) {
        if (!e || e.name !== "AbortError") {
            showMessage(t("term.error.record", {message: errorMessage(e)}), "error");
        }
        return;
    }
    recorder = {handle: handle, name: handle.name, size: 0, pending: [], chain: Promise.resolve(), timer: null};
    let rec = recorder;
    rec.timer = setInterval(function () {
        flushRecorder(rec);
    }, RECORD_FLUSH_MS);
    renderRecorder();
}

function recordChunk(bytes) {
    if (recorder) {
        recorder.pending.push(bytes);
    }
}

function flushRecorder(rec) {
    if (rec.pending.length === 0) {
        return rec.chain;
    }
    let chunks = rec.pending;
    rec.pending = [];
    rec.chain = rec.chain.then(async function () {
        let blob = new Blob(chunks);
        let writable = await rec.handle.createWritable({keepExistingData: true});
        await writable.write({type: "write", position: rec.size, data: blob});
        await writable.close();
        rec.size += blob.size;
        if (recorder === rec) {
            renderRecorder();
        }
    }).catch(function (e) {
        if (recorder === rec) {
            clearInterval(rec.timer);
            recorder = null;
            renderRecorder();
            showMessage(t("term.error.record", {message: errorMessage(e)}), "error");
        }
    });
    return rec.chain;
}

async function stopRecording() {
    let rec = recorder;
    if (!rec) {
        return;
    }
    clearInterval(rec.timer);
    recorder = null;
    renderRecorder();
    await flushRecorder(rec);
    showMessage(t("term.record.stopped", {name: rec.name, size: formatSize(rec.size)}));
}

function renderRecorder() {
    let button = document.getElementById("recordButton");
    button.hidden = !window.showSaveFilePicker;
    button.setAttribute("aria-pressed", String(!!recorder));
    button.textContent = t(recorder ? "term.recordStop" : "term.record");
    let status = document.getElementById("recordStatus");
    status.hidden = !recorder;
    if (recorder) {
        status.textContent = t("term.record.active", {name: recorder.name, size: formatSize(recorder.size)});
    }
}

// ---------- 发送栏历史 ----------

function browseHistory(step) {
    let list = config.history;
    let input = document.getElementById("sendInput");
    let current = historyIndex === -1 ? list.length : historyIndex;
    let next = current + step;
    if (list.length === 0 || next < 0 || next > list.length) {
        return;
    }
    if (historyIndex === -1) {
        historyDraft = input.value;
    }
    stopLoop();
    if (next === list.length) {
        historyIndex = -1;
        input.value = historyDraft;
    } else {
        historyIndex = next;
        let item = list[next];
        input.value = item.data;
        if (item.format !== config.sendFormat) {
            saveConfig({sendFormat: item.format});
            document.getElementById("sendFormat").value = item.format;
            renderSendBar();
        }
    }
    input.setSelectionRange(input.value.length, input.value.length);
}

// ---------- 自动应答 ----------

function rebuildTriggers() {
    triggerMatcher = SerialTerminal.createTriggerMatcher(config.triggers);
    triggerFiredAt = config.triggers.map(function () {
        return 0;
    });
}

function checkTriggers(bytes) {
    if (!config.triggersEnabled || config.triggers.length === 0) {
        return;
    }
    let now = Date.now();
    triggerMatcher(triggerDecoder.decode(bytes, {stream: true})).forEach(function (index) {
        if (now - triggerFiredAt[index] < TRIGGER_COOLDOWN_MS) {
            return;
        }
        triggerFiredAt[index] = now;
        let trigger = config.triggers[index];
        let reply = SerialTerminal.unescapeText(trigger.reply);
        sendBytes(encodeText(reply), reply);
        showMessage(t("term.trigger.fired", {match: trigger.match}));
    });
}

function renderTriggers() {
    let box = document.getElementById("triggers");
    box.replaceChildren();
    config.triggers.forEach(function (trigger, index) {
        let row = document.createElement("div");
        row.className = "preset";
        let body = document.createElement("div");
        body.className = "preset-send trigger";
        let match = document.createElement("span");
        match.textContent = trigger.match;
        let reply = document.createElement("span");
        reply.className = "preset-data";
        reply.textContent = "→ " + trigger.reply;
        body.title = trigger.match + " → " + trigger.reply;
        body.append(match, reply);
        let removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "preset-remove";
        removeButton.textContent = "×";
        removeButton.title = t("term.removeTrigger");
        removeButton.setAttribute("aria-label", t("term.removeTrigger") + " " + trigger.match);
        removeButton.addEventListener("click", function () {
            let triggers = config.triggers.slice();
            triggers.splice(index, 1);
            saveConfig({triggers: triggers});
            rebuildTriggers();
            renderTriggers();
        });
        row.append(body, removeButton);
        box.appendChild(row);
    });
    document.getElementById("triggersEmpty").hidden = config.triggers.length > 0;
    document.getElementById("triggersEnabled").checked = config.triggersEnabled;
}

function addTrigger() {
    if (config.triggers.length >= SerialTerminal.MAX_TRIGGERS) {
        showMessage(t("term.error.triggersFull", {max: SerialTerminal.MAX_TRIGGERS}), "error");
        return;
    }
    let match = window.prompt(t("term.triggerMatch"), "");
    if (!match) {
        return;
    }
    let reply = window.prompt(t("term.triggerReply"), "\\r");
    if (!reply) {
        return;
    }
    saveConfig({triggers: config.triggers.concat([{match: match, reply: reply}]), triggersEnabled: true});
    rebuildTriggers();
    renderTriggers();
}

// ---------- 文件传输 ----------

// 传输期间写入不走 sendBytes：不回显、不显示 TX，失败要让协议知道
function writeRaw(bytes) {
    if (!writer) {
        return Promise.reject(new Error("closed"));
    }
    let target = writer;
    txBytes += bytes.length;
    queueCounters();
    pendingWrites++;
    let done = writeChain.then(function () {
        return target.write(bytes);
    }).finally(function () {
        pendingWrites--;
    });
    writeChain = done.catch(function () {});
    return done;
}

function feedTransfer(bytes) {
    let job = transfer;
    for (let i = 0; i < bytes.length; i++) {
        job.queue.push(bytes[i]);
    }
    wakeTransfer(job);
}

function wakeTransfer(job) {
    if (job.waiter && (job.queue.length || job.signal.aborted)) {
        let waiter = job.waiter;
        job.waiter = null;
        clearTimeout(waiter.timer);
        waiter.resolve(job.queue.length ? job.queue.shift() : null);
    }
}

function readTransfer(job, ms) {
    if (job.queue.length) {
        return Promise.resolve(job.queue.shift());
    }
    return new Promise(function (resolve) {
        job.waiter = {
            resolve: resolve,
            timer: setTimeout(function () {
                job.waiter = null;
                resolve(null);
            }, ms)
        };
    });
}

function abortTransfer() {
    if (!transfer) {
        return;
    }
    transfer.signal.aborted = true;
    wakeTransfer(transfer);
}

async function sendRaw(job, data, onProgress) {
    for (let sent = 0; sent < data.length; sent += RAW_CHUNK) {
        if (job.signal.aborted) {
            let e = new Error("aborted");
            e.code = "aborted";
            throw e;
        }
        await writeRaw(data.subarray(sent, sent + RAW_CHUNK));
        onProgress(Math.min(sent + RAW_CHUNK, data.length), data.length);
    }
}

async function sendFile(file) {
    if (!port) {
        showMessage(t("term.notConnected"));
        return;
    }
    if (transfer || zsession || scriptJob) {
        showMessage(t("term.script.busy"));
        return;
    }
    let data = new Uint8Array(await file.arrayBuffer());
    let protocol = config.transferProtocol;
    let label = TRANSFER_LABELS[protocol] || t("term.transfer.raw");
    stopLoop();
    stopPacing();
    cancelPaste();
    let job = {queue: [], waiter: null, signal: {aborted: false}};
    transfer = job;
    render();
    writeNote(t("term.line.transferStarted", {name: file.name, protocol: label, size: formatSize(data.length)}));
    showBusy(t("term.transfer.waiting", {name: file.name}));
    let onProgress = function (done, total) {
        showBusy(t("term.transfer.progress", {
            name: file.name,
            done: formatSize(done),
            total: formatSize(total),
            percent: total ? Math.floor(done * 100 / total) : 100
        }));
    };
    try {
        if (protocol === "raw") {
            await sendRaw(job, data, onProgress);
        } else {
            await SerialTerminal.sendXmodem({
                write: writeRaw,
                read: function (ms) {
                    return readTransfer(job, ms);
                }
            }, data, {protocol: protocol, fileName: file.name, signal: job.signal, onProgress: onProgress});
        }
        writeNote(t("term.line.transferDone", {name: file.name}));
    } catch (e) {
        let reason = e && e.code ? t("term.transfer.error." + e.code) : errorMessage(e);
        writeNote(t("term.line.transferFailed", {name: file.name, reason: reason}));
    } finally {
        // 传输中途收到、协议没读走的字节照常显示，里面常有接收端的结果提示
        let rest = job.queue;
        transfer = null;
        hideBusy();
        if (rest.length && port) {
            showReceived(new Uint8Array(rest));
        }
        render();
        term.focus();
    }
}

// ---------- 设备配置、导入导出 ----------

function downloadBlob(blob, name) {
    let url = URL.createObjectURL(blob);
    let link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
        URL.revokeObjectURL(url);
    }, 1000);
}

// 整套设置一起换（选设备配置、导入）：界面全部重画，串口按需重开
async function applyConfig(next) {
    let previous = config;
    config = SerialTerminal.save(localStorage, next);
    let deviceChanged = JSON.stringify(previous.deviceId) !== JSON.stringify(config.deviceId);
    let openChanged = OPEN_FIELDS.some(function (field) {
        return previous[field] !== config[field];
    });
    if (deviceChanged) {
        chosenPort = null;
        document.getElementById("chooseButton").hidden = true;
    }
    stopLoop();
    flushRx();
    resetDecoder();
    rebuildTriggers();
    renderParams();
    renderPanel();
    renderPresets();
    renderTriggers();
    renderScripts();
    renderProfiles();
    renderPlot();
    term.options.fontSize = config.fontSize;
    term.options.scrollback = config.scrollback;
    fitAddon.fit();
    if (navigator.serial) {
        await renderPorts();
    }
    if (port && deviceChanged) {
        await disconnect();
    } else if (port && openChanged) {
        await reopen();
    }
    render();
}

function renderProfiles() {
    let names = config.profiles.map(function (profile) {
        return profile.name;
    });
    let current = names.indexOf(config.profile) === -1 ? "" : config.profile;
    fillSelect("profile", [""].concat(names), function (name) {
        return name || t("term.profile.none");
    }, current);
    document.getElementById("deleteProfileButton").disabled = !current;
}

function changeProfile() {
    let name = document.getElementById("profile").value;
    let profile = config.profiles.find(function (item) {
        return item.name === name;
    });
    if (!profile) {
        saveConfig({profile: ""});
        renderProfiles();
        return;
    }
    let next = SerialTerminal.applyProfile(config, profile.settings);
    next.profile = name;
    applyConfig(next);
    showMessage(t("term.profile.applied", {name: name}));
}

function saveProfile() {
    let name = window.prompt(t("term.profile.name"), config.profile || currentPortLabel() || "");
    name = name ? name.trim().slice(0, 40) : "";
    if (!name) {
        return;
    }
    let exists = config.profiles.some(function (item) {
        return item.name === name;
    });
    if (!exists && config.profiles.length >= SerialTerminal.MAX_PROFILES) {
        showMessage(t("term.error.profilesFull", {max: SerialTerminal.MAX_PROFILES}), "error");
        return;
    }
    saveConfig({
        profiles: SerialTerminal.upsertProfile(config.profiles, name, SerialTerminal.snapshotProfile(config)),
        profile: name
    });
    renderProfiles();
    showMessage(t("term.profile.saved", {name: name}));
}

function deleteProfile() {
    let name = config.profile;
    if (!name || !window.confirm(t("term.profile.confirmDelete", {name: name}))) {
        return;
    }
    saveConfig({
        profiles: config.profiles.filter(function (item) {
            return item.name !== name;
        }),
        profile: ""
    });
    renderProfiles();
}

function exportSettings() {
    let now = new Date();
    downloadBlob(new Blob([SerialTerminal.exportConfig(config, now)], {type: "application/json"}),
        SerialTerminal.configFileName(now));
}

async function importSettings(file) {
    let result = SerialTerminal.importConfig(await file.text());
    if (result.error) {
        showMessage(t("term.error.import"), "error");
        return;
    }
    if (!window.confirm(t("term.importConfirm"))) {
        return;
    }
    await applyConfig(result.config);
    showMessage(t("term.imported"));
}

// ---------- 脚本 ----------

function renderScripts() {
    let box = document.getElementById("scripts");
    box.replaceChildren();
    config.scripts.forEach(function (script, index) {
        let row = document.createElement("div");
        row.className = "preset";
        let runButton = document.createElement("button");
        runButton.type = "button";
        runButton.className = "preset-send";
        runButton.title = t("term.script.run");
        let name = document.createElement("span");
        name.textContent = scriptJob && scriptJob.index === index ? "▶ " + script.name : script.name;
        runButton.appendChild(name);
        runButton.addEventListener("click", function () {
            runScriptAt(index);
        });
        let editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "preset-edit";
        editButton.textContent = "✎";
        editButton.title = t("term.script.edit");
        editButton.setAttribute("aria-label", t("term.script.edit") + " " + script.name);
        editButton.addEventListener("click", function () {
            openScriptDialog(index);
        });
        let removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "preset-remove";
        removeButton.textContent = "×";
        removeButton.title = t("term.script.remove");
        removeButton.setAttribute("aria-label", t("term.script.remove") + " " + script.name);
        removeButton.addEventListener("click", function () {
            if (!window.confirm(t("term.script.confirmRemove", {name: script.name}))) {
                return;
            }
            let scripts = config.scripts.slice();
            scripts.splice(index, 1);
            saveConfig({scripts: scripts});
            renderScripts();
        });
        row.append(runButton, editButton, removeButton);
        box.appendChild(row);
    });
    document.getElementById("scriptsEmpty").hidden = config.scripts.length > 0;
}

let editingScript = -1;

function openScriptDialog(index) {
    editingScript = index;
    let script = index >= 0 ? config.scripts[index] : {name: "", text: ""};
    document.getElementById("scriptName").value = script.name;
    document.getElementById("scriptText").value = script.text;
    document.getElementById("scriptError").textContent = "";
    document.getElementById("scriptDialog").showModal();
    document.getElementById(index >= 0 ? "scriptText" : "scriptName").focus();
}

function scriptErrorText(result) {
    return t("term.script.error", {line: result.line, reason: t("term.script.error." + result.error)});
}

function saveScript(event) {
    event.preventDefault();
    let name = document.getElementById("scriptName").value.trim();
    let text = document.getElementById("scriptText").value;
    let error = document.getElementById("scriptError");
    if (!name) {
        error.textContent = t("term.script.needName");
        return;
    }
    let parsed = SerialTerminal.parseScript(text);
    if (parsed.error) {
        error.textContent = scriptErrorText(parsed);
        return;
    }
    let scripts = config.scripts.slice();
    if (editingScript >= 0) {
        scripts[editingScript] = {name: name, text: text};
    } else if (scripts.length >= SerialTerminal.MAX_SCRIPTS) {
        error.textContent = t("term.error.scriptsFull", {max: SerialTerminal.MAX_SCRIPTS});
        return;
    } else {
        scripts.push({name: name, text: text});
    }
    saveConfig({scripts: scripts});
    renderScripts();
    document.getElementById("scriptDialog").close();
}

// 每发一条就清空缓冲：wait 等的是这条发出去之后的回应，之前的输出不算
function feedScript(bytes) {
    let job = scriptJob;
    if (!job) {
        return;
    }
    job.buffer += job.decoder.decode(bytes, {stream: true});
    if (job.buffer.length > SCRIPT_BUFFER) {
        job.buffer = job.buffer.slice(-SCRIPT_BUFFER);
    }
    checkScriptWait(job);
}

function checkScriptWait(job) {
    let waiter = job.waiter;
    if (!waiter) {
        return;
    }
    let at = job.buffer.indexOf(waiter.text);
    if (at === -1) {
        return;
    }
    job.buffer = job.buffer.slice(at + waiter.text.length);
    job.waiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(true);
}

function abortScript() {
    let job = scriptJob;
    if (!job) {
        return;
    }
    job.signal.aborted = true;
    if (job.waiter) {
        clearTimeout(job.waiter.timer);
        job.waiter.resolve(false);
        job.waiter = null;
    }
    if (job.wake) {
        job.wake();
    }
}

async function runScriptAt(index) {
    let script = config.scripts[index];
    if (!port) {
        showMessage(t("term.notConnected"));
        return;
    }
    if (scriptJob || transfer || zsession) {
        showMessage(t("term.script.busy"));
        return;
    }
    let parsed = SerialTerminal.parseScript(script.text);
    if (parsed.error) {
        showMessage(t("term.script.failedParse", {name: script.name}) + " " + scriptErrorText(parsed), "error");
        return;
    }
    let job = {index: index, signal: {aborted: false}, buffer: "", waiter: null, wake: null,
        decoder: new TextDecoder(config.encoding)};
    scriptJob = job;
    renderScripts();
    writeNote(t("term.line.scriptStarted", {name: script.name}));
    let opened = port;
    let ensureOpen = function () {
        if (port !== opened) {
            throw new Error(t("term.notConnected"));
        }
    };
    let io = {
        signal: job.signal,
        send: async function (text, withNewline) {
            ensureOpen();
            job.buffer = "";
            let data = withNewline ? text + SerialTerminal.NEWLINES[config.newline] : text;
            sendBytes(encodeText(data), data);
            await writeChain;
        },
        sendHex: async function (item) {
            ensureOpen();
            job.buffer = "";
            sendBytes(SerialTerminal.buildPayload(item, config.newline, encodeText).bytes, null);
            await writeChain;
        },
        waitFor: function (text, ms) {
            return new Promise(function (resolve) {
                job.waiter = {
                    text: text,
                    resolve: resolve,
                    timer: setTimeout(function () {
                        job.waiter = null;
                        resolve(false);
                    }, ms)
                };
                checkScriptWait(job);
            });
        },
        delay: function (ms) {
            return new Promise(function (resolve) {
                let timer = setTimeout(done, ms);
                function done() {
                    clearTimeout(timer);
                    job.wake = null;
                    resolve();
                }
                job.wake = done;
            });
        },
        onStep: function (step) {
            showBusy(t("term.script.running", {name: script.name, line: step.line}));
        }
    };
    try {
        await SerialTerminal.runScript(parsed.steps, io);
        writeNote(t("term.line.scriptDone", {name: script.name}));
    } catch (e) {
        if (e && e.code === "aborted") {
            writeNote(t("term.line.scriptStopped", {name: script.name}));
        } else if (e && e.code === "wait") {
            writeNote(t("term.line.scriptTimeout", {name: script.name, line: e.line, text: e.text}));
        } else {
            writeNote(t("term.line.scriptFailed", {name: script.name, reason: errorMessage(e)}));
        }
    } finally {
        scriptJob = null;
        hideBusy();
        renderScripts();
    }
}

// ---------- 数据曲线 ----------

function renderPlot() {
    document.getElementById("plotPanel").hidden = !config.plot;
    document.getElementById("plotButton").setAttribute("aria-pressed", String(config.plot));
    document.getElementById("plotPause").textContent = t(plotPaused ? "term.plot.resume" : "term.plot.pause");
    if (config.plot) {
        queuePlot();
    }
}

function togglePlot() {
    saveConfig({plot: !config.plot});
    plotLine = "";
    renderPlot();
}

function clearPlot() {
    plotSeries = new Map();
    plotLine = "";
    queuePlot();
}

function feedPlot(bytes) {
    if (!config.plot || plotPaused) {
        return;
    }
    plotLine += plotDecoder.decode(bytes, {stream: true});
    let lines = plotLine.split(/\r\n|\r|\n/);
    plotLine = lines.pop();
    // 一直不换行的数据不是曲线数据，别让它越攒越多
    if (plotLine.length > 4096) {
        plotLine = "";
    }
    let added = false;
    lines.forEach(function (line) {
        SerialTerminal.parsePlotLine(line).forEach(function (point) {
            if (!isFinite(point.value)) {
                return;
            }
            let series = plotSeries.get(point.name);
            if (!series) {
                series = {values: [], color: PLOT_COLORS[plotSeries.size % PLOT_COLORS.length]};
                plotSeries.set(point.name, series);
            }
            series.values.push(point.value);
            if (series.values.length > PLOT_POINTS) {
                series.values.shift();
            }
            added = true;
        });
    });
    if (added) {
        queuePlot();
    }
}

function queuePlot() {
    if (plotQueued) {
        return;
    }
    plotQueued = true;
    requestAnimationFrame(function () {
        plotQueued = false;
        drawPlot();
    });
}

function formatPlotValue(value) {
    let abs = Math.abs(value);
    return abs !== 0 && (abs >= 1e6 || abs < 1e-3) ? value.toExponential(2) : String(Math.round(value * 1000) / 1000);
}

function drawPlot() {
    if (!config.plot) {
        return;
    }
    let canvas = document.getElementById("plotCanvas");
    let ratio = window.devicePixelRatio || 1;
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
    }
    let ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    let legend = document.getElementById("plotLegend");
    legend.replaceChildren();
    document.getElementById("plotEmpty").hidden = plotSeries.size > 0;
    if (plotSeries.size === 0) {
        return;
    }
    let min = Infinity;
    let max = -Infinity;
    plotSeries.forEach(function (series, name) {
        series.values.forEach(function (value) {
            min = Math.min(min, value);
            max = Math.max(max, value);
        });
        let item = document.createElement("span");
        item.className = "plot-key";
        item.style.setProperty("--key-color", series.color);
        item.textContent = name + " " + formatPlotValue(series.values[series.values.length - 1]);
        legend.appendChild(item);
    });
    if (min === max) {
        min -= 1;
        max += 1;
    }
    let pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    let computed = getComputedStyle(document.documentElement);
    let styles = {
        getPropertyValue: function (name) {
            return computed.getPropertyValue(name).trim();
        }
    };
    let left = 56;
    let right = width - 8;
    let top = 8;
    let bottom = height - 8;
    let y = function (value) {
        return bottom - (value - min) / (max - min) * (bottom - top);
    };
    ctx.font = "11px " + styles.getPropertyValue("--mono");
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
        let value = min + (max - min) * i / 4;
        let py = Math.round(y(value)) + 0.5;
        ctx.strokeStyle = styles.getPropertyValue("--tint-08");
        ctx.beginPath();
        ctx.moveTo(left, py);
        ctx.lineTo(right, py);
        ctx.stroke();
        ctx.fillStyle = styles.getPropertyValue("--text-faint");
        ctx.fillText(formatPlotValue(value), left - 6, py);
    }
    let step = (right - left) / (PLOT_POINTS - 1);
    ctx.lineWidth = 1.5;
    plotSeries.forEach(function (series) {
        let start = PLOT_POINTS - series.values.length;
        ctx.strokeStyle = series.color;
        ctx.beginPath();
        series.values.forEach(function (value, i) {
            let px = left + (start + i) * step;
            if (i === 0) {
                ctx.moveTo(px, y(value));
            } else {
                ctx.lineTo(px, y(value));
            }
        });
        ctx.stroke();
    });
    ctx.lineWidth = 1;
}

// ---------- ZMODEM ----------

function createSentry() {
    if (!window.Zmodem) {
        return;
    }
    zsentry = new Zmodem.Sentry({
        to_terminal: function (octets) {
            if (octets.length) {
                showReceived(Uint8Array.from(octets));
            }
        },
        sender: function (octets) {
            writeRaw(Uint8Array.from(octets)).catch(function () {});
        },
        on_detect: startZmodem,
        on_retract: function () {}
    });
}

function consumeZmodem(bytes) {
    try {
        zsentry.consume(bytes);
    } catch (e) {
        // 协议出错就当这次传输结束了，后面的数据照常显示
        console.warn("ZMODEM", e);
        endZmodem(t("term.line.zmodemFailed", {reason: errorMessage(e)}));
    }
}

function startZmodem(detection) {
    if (scriptJob || transfer) {
        detection.deny();
        return;
    }
    let session = detection.confirm();
    zsession = session;
    stopLoop();
    stopPacing();
    cancelPaste();
    flushRx();
    render();
    if (session.type === "receive") {
        receiveZmodem(session);
    } else {
        writeNote(t("term.line.zmodemSendReady"));
        showBusy(t("term.zmodem.pick"));
        document.getElementById("zmodemPickButton").hidden = false;
    }
}

// 对方运行了 sz：收下每个文件，存到浏览器的下载目录
function receiveZmodem(session) {
    session.on("offer", function (offer) {
        let details = offer.get_details();
        let name = String(details.name || "file").split("/").pop();
        let chunks = [];
        let got = 0;
        offer.on("input", function (payload) {
            chunks.push(Uint8Array.from(payload));
            got += payload.length;
            showBusy(t("term.transfer.progress", {
                name: name,
                done: formatSize(got),
                total: formatSize(details.size || got),
                percent: details.size ? Math.floor(got * 100 / details.size) : 100
            }));
        });
        offer.accept().then(function () {
            downloadBlob(new Blob(chunks), name);
            writeNote(t("term.line.zmodemReceived", {name: name, size: formatSize(got)}));
        }, function () {});
    });
    session.on("session_end", function () {
        endZmodem();
    });
    writeNote(t("term.line.zmodemReceiving"));
    showBusy(t("term.zmodem.receiving"));
    session.start();
}

// 对方运行了 rz：用户点「选择文件」后发过去
async function sendZmodemFiles(files) {
    let session = zsession;
    if (!session || !files.length) {
        return;
    }
    document.getElementById("zmodemPickButton").hidden = true;
    try {
        await Zmodem.Browser.send_files(session, files, {
            on_progress: function (file, xfer) {
                let done = xfer.get_offset();
                showBusy(t("term.transfer.progress", {
                    name: file.name,
                    done: formatSize(done),
                    total: formatSize(file.size),
                    percent: file.size ? Math.floor(done * 100 / file.size) : 100
                }));
            },
            on_file_complete: function (file) {
                writeNote(t("term.line.transferDone", {name: file.name}));
            }
        });
        await session.close();
        endZmodem();
    } catch (e) {
        endZmodem(t("term.line.zmodemFailed", {reason: errorMessage(e)}));
    }
}

function abortZmodem() {
    let session = zsession;
    if (!session) {
        return;
    }
    try {
        session.abort();
    } catch (e) {
        // 已经结束的会话再取消会抛错，不用管
    }
    endZmodem(t("term.line.zmodemCancelled"));
}

function endZmodem(note) {
    if (!zsession) {
        return;
    }
    zsession = null;
    hideBusy();
    if (note) {
        writeNote(note);
    }
    render();
}

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

async function sendBreak() {
    let opened = port;
    if (!opened) {
        return;
    }
    try {
        await opened.setSignals({break: true});
        await sleep(BREAK_MS);
        showMessage(t("term.breakSent"));
    } catch (e) {
        showMessage(t("term.error.writeFailed", {message: errorMessage(e)}), "error");
    } finally {
        await opened.setSignals({break: false}).catch(function () {});
    }
    term.focus();
}

function saveLog() {
    if (receivedLog.size() === 0) {
        showMessage(t("term.nothingToSave"));
        return;
    }
    let url = URL.createObjectURL(new Blob(receivedLog.chunks(), {type: "application/octet-stream"}));
    let link = document.createElement("a");
    link.href = url;
    link.download = SerialTerminal.logFileName(new Date());
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
        URL.revokeObjectURL(url);
    }, 1000);
    showMessage(t("term.logSaved"));
}

function bindControls() {
    document.getElementById("port").addEventListener("change", changePort);
    SELECT_FIELDS.forEach(function (field) {
        document.getElementById(field).addEventListener("change", function () {
            changeParam(field);
        });
    });
    document.getElementById("baudSelect").addEventListener("change", changeBaudSelect);
    let baudInput = document.getElementById("baudRate");
    baudInput.addEventListener("change", changeBaudRate);
    baudInput.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            renderBaud();
        }
    });
    baudInput.addEventListener("blur", function () {
        if (!baudInput.hidden) {
            changeBaudRate();
        }
    });
    document.getElementById("timestamp").addEventListener("change", function (event) {
        saveConfig({timestamp: event.target.checked});
    });
    document.getElementById("localEcho").addEventListener("change", function (event) {
        saveConfig({localEcho: event.target.checked});
    });
    document.getElementById("authorizeButton").addEventListener("click", authorizePort);
    document.getElementById("connectButton").addEventListener("click", function () {
        if (port || (lost && wantConnected)) {
            disconnect();
        } else {
            connect(false);
        }
    });
    document.getElementById("chooseButton").addEventListener("click", choosePort);
    document.getElementById("breakButton").addEventListener("click", sendBreak);
    document.getElementById("clearButton").addEventListener("click", function () {
        term.clear();
        term.focus();
    });
    document.getElementById("copyButton").addEventListener("click", copySelection);
    document.getElementById("pasteButton").addEventListener("click", pasteFromClipboard);
    document.getElementById("searchButton").addEventListener("click", openSearch);
    document.getElementById("saveLogButton").addEventListener("click", saveLog);
    document.getElementById("confirmButton").addEventListener("click", confirmPaste);
    document.getElementById("cancelButton").addEventListener("click", cancelBusy);
    document.getElementById("recordButton").addEventListener("click", function () {
        if (recorder) {
            stopRecording();
        } else {
            startRecording();
        }
    });
    document.getElementById("termSize").addEventListener("click", sendSize);
    Object.keys(NUMBER_FIELDS).forEach(function (field) {
        document.getElementById(field).addEventListener("change", function () {
            changeNumber(field);
        });
    });
    document.getElementById("highlight").addEventListener("change", function (event) {
        changeHighlight(event.target.checked);
    });
    document.getElementById("triggersEnabled").addEventListener("change", function (event) {
        saveConfig({triggersEnabled: event.target.checked});
    });
    document.getElementById("addTriggerButton").addEventListener("click", addTrigger);
    document.getElementById("transferProtocol").addEventListener("change", function (event) {
        saveConfig({transferProtocol: event.target.value});
    });
    document.getElementById("profile").addEventListener("change", changeProfile);
    document.getElementById("saveProfileButton").addEventListener("click", saveProfile);
    document.getElementById("deleteProfileButton").addEventListener("click", deleteProfile);
    document.getElementById("exportButton").addEventListener("click", exportSettings);
    let importInput = document.getElementById("importInput");
    document.getElementById("importButton").addEventListener("click", function () {
        importInput.click();
    });
    importInput.addEventListener("change", function () {
        let file = importInput.files[0];
        importInput.value = "";
        if (file) {
            importSettings(file);
        }
    });
    document.getElementById("addScriptButton").addEventListener("click", function () {
        openScriptDialog(-1);
    });
    document.getElementById("scriptForm").addEventListener("submit", saveScript);
    document.getElementById("scriptCancel").addEventListener("click", function () {
        document.getElementById("scriptDialog").close();
    });
    document.getElementById("plotButton").addEventListener("click", togglePlot);
    document.getElementById("plotClose").addEventListener("click", togglePlot);
    document.getElementById("plotClear").addEventListener("click", clearPlot);
    document.getElementById("plotPause").addEventListener("click", function () {
        plotPaused = !plotPaused;
        plotLine = "";
        renderPlot();
    });
    new ResizeObserver(queuePlot).observe(document.getElementById("plotCanvas"));
    let zmodemInput = document.getElementById("zmodemInput");
    document.getElementById("zmodemPickButton").addEventListener("click", function () {
        zmodemInput.click();
    });
    zmodemInput.addEventListener("change", function () {
        let files = Array.from(zmodemInput.files);
        zmodemInput.value = "";
        sendZmodemFiles(files);
    });
    let fileInput = document.getElementById("fileInput");
    document.getElementById("sendFileButton").addEventListener("click", function () {
        fileInput.click();
    });
    fileInput.addEventListener("change", function () {
        let file = fileInput.files[0];
        // 清掉选择，同一个文件才能再选一次
        fileInput.value = "";
        if (file) {
            sendFile(file);
        }
    });
    document.getElementById("dtrButton").addEventListener("click", function () {
        toggleSignal("dtr");
    });
    document.getElementById("rtsButton").addEventListener("click", function () {
        toggleSignal("rts");
    });
    document.getElementById("counters").addEventListener("click", resetCounters);
    document.getElementById("panelButton").addEventListener("click", function () {
        saveConfig({panel: !config.panel});
        renderPanel();
    });

    document.getElementById("sendForm").addEventListener("submit", submitSend);
    document.getElementById("sendFormat").addEventListener("change", function (event) {
        stopLoop();
        saveConfig({sendFormat: event.target.value});
        renderSendBar();
    });
    document.getElementById("checksum").addEventListener("change", function (event) {
        stopLoop();
        saveConfig({checksum: event.target.value});
    });
    let sendInput = document.getElementById("sendInput");
    sendInput.addEventListener("input", function () {
        stopLoop();
        historyIndex = -1;
    });
    sendInput.addEventListener("keydown", function (event) {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            browseHistory(event.key === "ArrowUp" ? -1 : 1);
        }
    });
    document.getElementById("loop").addEventListener("change", function (event) {
        if (!event.target.checked) {
            stopLoop();
        }
    });
    document.getElementById("loopMs").addEventListener("change", changeLoopMs);
    document.getElementById("savePresetButton").addEventListener("click", savePreset);

    let searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", function () {
        findText(false, true);
    });
    searchInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            findText(event.shiftKey, false);
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeSearch();
        }
    });
    document.getElementById("searchPrev").addEventListener("click", function () {
        findText(true, false);
    });
    document.getElementById("searchNext").addEventListener("click", function () {
        findText(false, false);
    });
    document.getElementById("searchClose").addEventListener("click", closeSearch);
}

function bindSerialEvents() {
    navigator.serial.addEventListener("connect", function () {
        if (lost && wantConnected && !port) {
            connect(true);
        }
        renderPorts();
    });
    navigator.serial.addEventListener("disconnect", function () {
        renderPorts();
    });
    window.addEventListener("beforeunload", function (event) {
        if (port || recorder) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    window.addEventListener("pagehide", function () {
        if (port) {
            closePort();
        }
    });
}

createTerminal();
resetDecoder();
rebuildTriggers();
createSentry();
renderParams();
renderPanel();
renderProfiles();
renderPresets();
renderTriggers();
renderScripts();
renderPlot();
renderCounters();
renderSize();
renderRecorder();
bindControls();
if (navigator.serial) {
    bindSerialEvents();
    renderPorts();
} else {
    showMessage(t("term.unsupported"), "error");
}
render();
term.focus();
