// 串口终端（terminal.html）的纯逻辑：参数校验与存取、换行转换、挑串口、接收日志。
// 终端页是独立工具，不读写控制页和设置页的设置，只用自己的存储键。
// 叫 SerialTerminal 而不是 Terminal：xterm.js 在浏览器里占用了全局的 Terminal
var SerialTerminal = (function () {
    var STORAGE_KEY = "chrome-kvm-terminal";
    var BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000];
    var DATA_BITS = [7, 8];
    var PARITIES = ["none", "even", "odd"];
    var STOP_BITS = [1, 2];
    var FLOW_CONTROLS = ["none", "hardware"];
    // 列表只是下拉框里的常用值，波特率可以手填（74880、250000 这类）
    var MIN_BAUD = 50;
    var MAX_BAUD = 16000000;
    var NEWLINES = {cr: "\r", lf: "\n", crlf: "\r\n"};
    // text 按终端显示收到的字符；hex 把收发的字节都按十六进制列出来，调继电器这类二进制协议用
    var MODES = ["text", "hex"];
    var ENCODINGS = ["utf-8", "gbk"];
    var SEND_FORMATS = ["text", "hex"];
    var CHECKSUMS = ["none", "sum8", "xor8", "lrc", "crc8", "crc16", "crc16ccitt", "crc32"];
    var MIN_FRAME_GAP = 1;
    var MAX_FRAME_GAP = 5000;
    var MAX_PROFILES = 30;
    var MAX_NAME = 40;
    var MAX_SCRIPTS = 20;
    var MAX_SCRIPT_TEXT = 20000;
    // 设备配置里存这些：换一台设备要跟着变的；常用指令、字号这类和设备无关的不存
    var PROFILE_FIELDS = ["deviceId", "label", "baudRate", "dataBits", "parity", "stopBits", "flowControl",
        "newline", "mode", "encoding", "timestamp", "localEcho", "sendFormat", "checksum", "frameGap",
        "charDelay", "lineDelay", "triggersEnabled", "triggers"];
    var EXPORT_APP = "chrome-kvm-terminal";
    var MIN_LOOP_MS = 10;
    var MAX_LOOP_MS = 3600000;
    var MAX_PRESETS = 50;
    var MAX_PRESET_NAME = 40;
    var MAX_PRESET_DATA = 2000;
    var MIN_FONT_SIZE = 8;
    var MAX_FONT_SIZE = 32;
    var MIN_SCROLLBACK = 1000;
    var MAX_SCROLLBACK = 100000;
    var MAX_CHAR_DELAY = 1000;
    var MAX_LINE_DELAY = 10000;
    var MAX_HISTORY = 50;
    var MAX_TRIGGERS = 20;
    var MAX_TRIGGER_MATCH = 200;
    var MAX_TRIGGER_REPLY = 500;
    // raw 是把文件原样写出去，不走任何协议
    var TRANSFER_PROTOCOLS = ["ymodem", "xmodem", "xmodem1k", "raw"];
    var DEFAULTS = {
        baudRate: 115200,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flowControl: "none",
        newline: "cr",
        mode: "text",
        encoding: "utf-8",
        timestamp: false,
        localEcho: false,
        sendFormat: "text",
        checksum: "none",
        loopMs: 1000,
        panel: true,
        fontSize: 14,
        scrollback: 10000,
        highlight: true,
        charDelay: 0,
        lineDelay: 0,
        triggersEnabled: false,
        transferProtocol: "ymodem",
        frameGap: 100,
        plot: false
    };
    var LOG_LIMIT = 5 * 1024 * 1024;

    function pick(list, value, fallback) {
        var n = typeof value === "string" && typeof fallback === "number" ? parseInt(value, 10) : value;
        return list.indexOf(n) === -1 ? fallback : n;
    }

    // 只认纯数字（"9600" 或 9600），"96k"、1.5 这种一律当坏值
    function intInRange(value, min, max, fallback) {
        var n = typeof value === "string" && /^\s*\d+\s*$/.test(value) ? parseInt(value, 10) : value;
        return typeof n === "number" && Math.floor(n) === n && n >= min && n <= max ? n : fallback;
    }

    function normalizePresets(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        var out = [];
        for (var i = 0; i < list.length && out.length < MAX_PRESETS; i++) {
            var item = list[i];
            if (!item || typeof item !== "object" || typeof item.data !== "string" || !item.data) {
                continue;
            }
            var data = item.data.slice(0, MAX_PRESET_DATA);
            var name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : data;
            out.push({
                name: name.slice(0, MAX_PRESET_NAME),
                format: pick(SEND_FORMATS, item.format, "text"),
                data: data,
                checksum: pick(CHECKSUMS, item.checksum, "none")
            });
        }
        return out;
    }

    function normalizeHistory(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        return list.filter(function (item) {
            return item && typeof item === "object" && typeof item.data === "string" && item.data;
        }).slice(-MAX_HISTORY).map(function (item) {
            return {format: pick(SEND_FORMATS, item.format, "text"), data: item.data.slice(0, MAX_PRESET_DATA)};
        });
    }

    // 同一条再发一次就挪到最后，不重复占位
    function pushHistory(list, item) {
        var out = list.filter(function (old) {
            return old.format !== item.format || old.data !== item.data;
        });
        out.push({format: item.format, data: item.data});
        return out.slice(-MAX_HISTORY);
    }

    function normalizeTriggers(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        var out = [];
        for (var i = 0; i < list.length && out.length < MAX_TRIGGERS; i++) {
            var item = list[i];
            if (!item || typeof item !== "object" || typeof item.match !== "string" || typeof item.reply !== "string"
                || !item.match || !item.reply) {
                continue;
            }
            out.push({match: item.match.slice(0, MAX_TRIGGER_MATCH), reply: item.reply.slice(0, MAX_TRIGGER_REPLY)});
        }
        return out;
    }

    function normalizeDeviceId(deviceId) {
        if (!deviceId || typeof deviceId !== "object") {
            return null;
        }
        var vendor = deviceId.usbVendorId;
        var product = deviceId.usbProductId;
        if (typeof vendor !== "number" || typeof product !== "number") {
            return null;
        }
        return {usbVendorId: vendor, usbProductId: product};
    }

    // localStorage 是用户能手改的，读出来的每个字段都要过一遍，坏值退回默认
    function normalize(raw) {
        raw = raw && typeof raw === "object" ? raw : {};
        var deviceId = normalizeDeviceId(raw.deviceId);
        return {
            deviceId: deviceId,
            label: deviceId && typeof raw.label === "string" ? raw.label : "",
            baudRate: intInRange(raw.baudRate, MIN_BAUD, MAX_BAUD, DEFAULTS.baudRate),
            dataBits: pick(DATA_BITS, raw.dataBits, DEFAULTS.dataBits),
            parity: pick(PARITIES, raw.parity, DEFAULTS.parity),
            stopBits: pick(STOP_BITS, raw.stopBits, DEFAULTS.stopBits),
            flowControl: pick(FLOW_CONTROLS, raw.flowControl, DEFAULTS.flowControl),
            newline: Object.prototype.hasOwnProperty.call(NEWLINES, raw.newline) ? raw.newline : DEFAULTS.newline,
            mode: pick(MODES, raw.mode, DEFAULTS.mode),
            encoding: pick(ENCODINGS, raw.encoding, DEFAULTS.encoding),
            timestamp: raw.timestamp === true,
            localEcho: raw.localEcho === true,
            sendFormat: pick(SEND_FORMATS, raw.sendFormat, DEFAULTS.sendFormat),
            checksum: pick(CHECKSUMS, raw.checksum, DEFAULTS.checksum),
            loopMs: intInRange(raw.loopMs, MIN_LOOP_MS, MAX_LOOP_MS, DEFAULTS.loopMs),
            panel: raw.panel !== false,
            fontSize: intInRange(raw.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULTS.fontSize),
            scrollback: intInRange(raw.scrollback, MIN_SCROLLBACK, MAX_SCROLLBACK, DEFAULTS.scrollback),
            highlight: raw.highlight !== false,
            charDelay: intInRange(raw.charDelay, 0, MAX_CHAR_DELAY, DEFAULTS.charDelay),
            lineDelay: intInRange(raw.lineDelay, 0, MAX_LINE_DELAY, DEFAULTS.lineDelay),
            triggersEnabled: raw.triggersEnabled === true,
            transferProtocol: pick(TRANSFER_PROTOCOLS, raw.transferProtocol, DEFAULTS.transferProtocol),
            frameGap: intInRange(raw.frameGap, MIN_FRAME_GAP, MAX_FRAME_GAP, DEFAULTS.frameGap),
            plot: raw.plot === true,
            profile: typeof raw.profile === "string" ? raw.profile.slice(0, MAX_NAME) : "",
            presets: normalizePresets(raw.presets),
            history: normalizeHistory(raw.history),
            triggers: normalizeTriggers(raw.triggers),
            profiles: normalizeProfiles(raw.profiles),
            scripts: normalizeScripts(raw.scripts)
        };
    }

    function cleanName(name) {
        return typeof name === "string" ? name.trim().slice(0, MAX_NAME) : "";
    }

    function snapshotProfile(config) {
        var settings = {};
        PROFILE_FIELDS.forEach(function (field) {
            settings[field] = config[field];
        });
        return settings;
    }

    // 套用设备配置：只换 PROFILE_FIELDS 里的，配置里缺的字段保持当前值
    function applyProfile(config, settings) {
        var next = Object.assign({}, config);
        PROFILE_FIELDS.forEach(function (field) {
            if (settings && Object.prototype.hasOwnProperty.call(settings, field)) {
                next[field] = settings[field];
            }
        });
        return normalize(next);
    }

    function normalizeProfiles(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        var out = [];
        var names = {};
        for (var i = 0; i < list.length && out.length < MAX_PROFILES; i++) {
            var item = list[i];
            var name = item && cleanName(item.name);
            if (!name || names[name] || !item.settings || typeof item.settings !== "object") {
                continue;
            }
            names[name] = true;
            out.push({name: name, settings: snapshotProfile(applyProfile(normalize(null), item.settings))});
        }
        return out;
    }

    // 同名的覆盖，新名字加在最后
    function upsertProfile(list, name, settings) {
        var out = list.filter(function (item) {
            return item.name !== name;
        });
        var at = list.findIndex(function (item) {
            return item.name === name;
        });
        var entry = {name: name, settings: settings};
        if (at === -1) {
            out.push(entry);
        } else {
            out.splice(at, 0, entry);
        }
        return out.slice(0, MAX_PROFILES);
    }

    function normalizeScripts(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        var out = [];
        for (var i = 0; i < list.length && out.length < MAX_SCRIPTS; i++) {
            var item = list[i];
            var name = item && cleanName(item.name);
            if (!name || typeof item.text !== "string") {
                continue;
            }
            out.push({name: name, text: item.text.slice(0, MAX_SCRIPT_TEXT)});
        }
        return out;
    }

    function exportConfig(config, date) {
        return JSON.stringify({app: EXPORT_APP, version: 1, exportedAt: date.toISOString(), config: normalize(config)}, null, 2);
    }

    // 导入的文件也是用户能手改的，照样整个过一遍 normalize
    function importConfig(text) {
        var data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return {error: "json"};
        }
        if (!data || data.app !== EXPORT_APP || !data.config || typeof data.config !== "object") {
            return {error: "format"};
        }
        return {config: normalize(data.config)};
    }

    function configFileName(date) {
        return "serial-terminal-" + date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) + ".json";
    }

    // ---------- 脚本 ----------
    // 一行一条：send / sendraw / hex / wait / delay / timeout / loop … end，# 开头是注释。
    // 文字参数里可以用 \r \n \t \e \xHH \\ 转义
    function parseScript(text) {
        var root = [];
        var stack = [root];
        var lines = String(text || "").split(/\r\n|\r|\n/);
        for (var i = 0; i < lines.length; i++) {
            var lineNo = i + 1;
            var line = lines[i].replace(/^\s+/, "");
            if (!line || line.charAt(0) === "#") {
                continue;
            }
            var m = /^(\S+)(?:\s(.*))?$/.exec(line);
            var op = m[1].toLowerCase();
            var arg = m[2] === undefined ? "" : m[2];
            var current = stack[stack.length - 1];
            var number = /^\s*\d+\s*$/.test(arg) ? parseInt(arg, 10) : NaN;
            var fail = function (code) {
                return {error: code, line: lineNo};
            };
            if (op === "send") {
                current.push({op: "send", text: unescapeText(arg), line: lineNo});
            } else if (op === "sendraw") {
                if (!arg) {
                    return fail("arg");
                }
                current.push({op: "raw", text: unescapeText(arg), line: lineNo});
            } else if (op === "hex") {
                var tail = /\s\+(\w+)\s*$/.exec(arg);
                var kind = tail ? tail[1].toLowerCase() : "none";
                var body = tail ? arg.slice(0, tail.index) : arg;
                if (CHECKSUMS.indexOf(kind) === -1) {
                    return fail("checksum");
                }
                var parsed = parseHex(body);
                if (parsed.error) {
                    return fail("hex");
                }
                current.push({op: "hex", data: body.trim(), checksum: kind, line: lineNo});
            } else if (op === "wait") {
                if (!arg) {
                    return fail("arg");
                }
                current.push({op: "wait", text: unescapeText(arg), line: lineNo});
            } else if (op === "delay" || op === "timeout") {
                if (isNaN(number)) {
                    return fail("number");
                }
                current.push({op: op, value: number, line: lineNo});
            } else if (op === "loop") {
                if (isNaN(number)) {
                    return fail("number");
                }
                var loop = {op: "loop", count: number, body: [], line: lineNo};
                current.push(loop);
                stack.push(loop.body);
            } else if (op === "end") {
                if (stack.length === 1) {
                    return fail("end");
                }
                stack.pop();
            } else {
                return fail("unknown");
            }
        }
        if (stack.length > 1) {
            return {error: "loop", line: lines.length};
        }
        return {steps: root};
    }

    // io.send(text, withNewline)、io.sendHex(item)、io.waitFor(text, ms) → 是否等到、io.delay(ms)
    // 都返回 Promise；io.onStep(step) 报告进度；io.signal.aborted 置真就停。
    // loop 0 表示一直循环到手动停止
    async function runScript(steps, io) {
        var timeoutMs = 10000;
        var signal = io.signal || {};
        function check() {
            if (signal.aborted) {
                throw transferError("aborted");
            }
        }
        async function run(list) {
            for (var i = 0; i < list.length; i++) {
                check();
                var step = list[i];
                if (io.onStep) {
                    io.onStep(step);
                }
                if (step.op === "send" || step.op === "raw") {
                    await io.send(step.text, step.op === "send");
                } else if (step.op === "hex") {
                    await io.sendHex({format: "hex", data: step.data, checksum: step.checksum});
                } else if (step.op === "wait") {
                    if (!(await io.waitFor(step.text, timeoutMs))) {
                        check();
                        var e = transferError("wait");
                        e.line = step.line;
                        e.text = step.text;
                        throw e;
                    }
                } else if (step.op === "delay") {
                    await io.delay(step.value);
                } else if (step.op === "timeout") {
                    timeoutMs = step.value * 1000;
                } else if (step.op === "loop") {
                    for (var n = 0; step.count === 0 || n < step.count; n++) {
                        await run(step.body);
                        check();
                    }
                }
                check();
            }
        }
        await run(steps);
    }

    // ---------- 数据曲线 ----------
    var NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
    var NAMED_VALUE = new RegExp("([A-Za-z_\\u4e00-\\u9fa5][\\w.\\u4e00-\\u9fa5-]*)\\s*[:=]\\s*(" + NUMBER + ")", "g");
    var BARE_VALUES = new RegExp("^\\s*" + NUMBER + "(?:\\s*[,;\\s]\\s*" + NUMBER + ")*\\s*$");

    // 一行里的数值：有 temp=25.3、hum:40 这样带名字的就按名字取；
    // 整行只有数字（Arduino 串口绘图器的格式，空格/逗号分隔）就按第几列叫 1、2、3
    function parsePlotLine(line) {
        var text = String(line).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
        var out = [];
        var m;
        NAMED_VALUE.lastIndex = 0;
        while ((m = NAMED_VALUE.exec(text)) !== null) {
            out.push({name: m[1], value: parseFloat(m[2])});
        }
        if (out.length) {
            return out;
        }
        if (BARE_VALUES.test(text)) {
            return text.trim().split(/\s*[,;\s]\s*/).map(function (value, i) {
                return {name: String(i + 1), value: parseFloat(value)};
            });
        }
        return [];
    }

    function load(storage) {
        try {
            var raw = storage && storage.getItem(STORAGE_KEY);
            return normalize(raw ? JSON.parse(raw) : null);
        } catch (e) {
            return normalize(null);
        }
    }

    function save(storage, config) {
        var clean = normalize(config);
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(clean));
        } catch (e) {
            // 存不进去只是下次要重新选，不影响这次用
        }
        return clean;
    }

    function openOptions(config) {
        return {
            baudRate: config.baudRate,
            dataBits: config.dataBits,
            parity: config.parity,
            stopBits: config.stopBits,
            flowControl: config.flowControl
        };
    }

    // xterm 把回车键报成 \r，按设置换成被控端要的换行
    function convertInput(data, newline) {
        return data.replace(/\r/g, NEWLINES[newline] || NEWLINES.cr);
    }

    // 剪贴板里的换行来自哪个系统都有可能，先统一再换
    function convertPaste(text, newline) {
        return text.replace(/\r\n|\r|\n/g, NEWLINES[newline] || NEWLINES.cr);
    }

    // 末尾的换行不算多出一行：复制一整行时常常连换行一起带上
    function lineCount(text) {
        if (!text) {
            return 0;
        }
        return text.replace(/(\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).length;
    }

    // 各家说明书的写法都照收：A0 01 01 A2、A00101A2、0xA0,0x01。单独一位的当一个字节
    function parseHex(text) {
        var tokens = String(text || "").split(/[\s,;:\-]+/).filter(Boolean);
        if (tokens.length === 0) {
            return {error: "empty"};
        }
        var digits = "";
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i].replace(/^0x/i, "");
            if (!/^[0-9a-fA-F]+$/.test(token)) {
                return {error: "invalid"};
            }
            digits += token.length === 1 ? "0" + token : token;
        }
        if (digits.length % 2 !== 0) {
            return {error: "odd"};
        }
        var bytes = new Uint8Array(digits.length / 2);
        for (var j = 0; j < bytes.length; j++) {
            bytes[j] = parseInt(digits.substr(j * 2, 2), 16);
        }
        return {bytes: bytes};
    }

    function formatHex(bytes) {
        return Array.from(bytes, function (b) {
            return (b < 16 ? "0" : "") + b.toString(16).toUpperCase();
        }).join(" ");
    }

    // 每行 perLine 个字节，十六进制列补齐宽度，后面的 ASCII 对照列才能对齐
    function hexRows(bytes, perLine) {
        var width = perLine * 3 - 1;
        var rows = [];
        for (var i = 0; i < bytes.length; i += perLine) {
            var slice = Array.prototype.slice.call(bytes, i, i + perLine);
            var hex = formatHex(slice);
            while (hex.length < width) {
                hex += " ";
            }
            var ascii = slice.map(function (b) {
                return b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : ".";
            }).join("");
            rows.push({hex: hex, ascii: ascii});
        }
        return rows;
    }

    // SUM8：LCUS 继电器、CH9329 的帧尾；XOR8：不少私有协议；LRC：Modbus ASCII（累加和取补）；
    // CRC8：多项式 0x07、初值 0；CRC16：Modbus RTU，低字节在前；
    // CRC16-CCITT：初值 FFFF（CCITT-FALSE），高字节在前；CRC32：以太网/ZIP 那个，低字节在前
    function checksum(bytes, kind) {
        var i;
        var bit;
        if (kind === "lrc") {
            var total = 0;
            for (i = 0; i < bytes.length; i++) {
                total = (total + bytes[i]) & 0xFF;
            }
            return [(0x100 - total) & 0xFF];
        }
        if (kind === "crc8") {
            var c8 = 0;
            for (i = 0; i < bytes.length; i++) {
                c8 ^= bytes[i];
                for (bit = 0; bit < 8; bit++) {
                    c8 = c8 & 0x80 ? ((c8 << 1) ^ 0x07) & 0xFF : (c8 << 1) & 0xFF;
                }
            }
            return [c8];
        }
        if (kind === "crc16ccitt") {
            var c16 = 0xFFFF;
            for (i = 0; i < bytes.length; i++) {
                c16 ^= bytes[i] << 8;
                for (bit = 0; bit < 8; bit++) {
                    c16 = c16 & 0x8000 ? ((c16 << 1) ^ 0x1021) & 0xFFFF : (c16 << 1) & 0xFFFF;
                }
            }
            return [c16 >> 8, c16 & 0xFF];
        }
        if (kind === "crc32") {
            var c32 = 0xFFFFFFFF;
            for (i = 0; i < bytes.length; i++) {
                c32 ^= bytes[i];
                for (bit = 0; bit < 8; bit++) {
                    c32 = c32 & 1 ? (c32 >>> 1) ^ 0xEDB88320 : c32 >>> 1;
                }
            }
            c32 = (c32 ^ 0xFFFFFFFF) >>> 0;
            return [c32 & 0xFF, (c32 >>> 8) & 0xFF, (c32 >>> 16) & 0xFF, c32 >>> 24];
        }
        if (kind === "sum8") {
            var sum = 0;
            for (i = 0; i < bytes.length; i++) {
                sum = (sum + bytes[i]) & 0xFF;
            }
            return [sum];
        }
        if (kind === "xor8") {
            var x = 0;
            for (i = 0; i < bytes.length; i++) {
                x ^= bytes[i];
            }
            return [x];
        }
        if (kind === "crc16") {
            var crc = 0xFFFF;
            for (i = 0; i < bytes.length; i++) {
                crc ^= bytes[i];
                for (var bit = 0; bit < 8; bit++) {
                    crc = crc & 1 ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
                }
            }
            return [crc & 0xFF, crc >>> 8];
        }
        return [];
    }

    // 发送框和常用指令共用：文本按编码转字节并补上回车发送的换行；HEX 解析后按需补校验
    function buildPayload(item, newline, encode) {
        if (item.format === "hex") {
            var parsed = parseHex(item.data);
            if (parsed.error) {
                return parsed;
            }
            var tail = checksum(parsed.bytes, item.checksum);
            var bytes = new Uint8Array(parsed.bytes.length + tail.length);
            bytes.set(parsed.bytes);
            bytes.set(tail, parsed.bytes.length);
            return {bytes: bytes};
        }
        if (!item.data) {
            return {error: "empty"};
        }
        return {bytes: encode(item.data + (NEWLINES[newline] || NEWLINES.cr))};
    }

    function pad3(n) {
        return n < 10 ? "00" + n : n < 100 ? "0" + n : String(n);
    }

    function formatTime(date) {
        return pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds())
            + "." + pad3(date.getMilliseconds());
    }

    // 在每一行开头插时间戳。行尾的 \n 之后先不插：下一行的第一个字到了才知道它是什么时候来的
    function stampLines(text, atLineStart, stamp) {
        var out = "";
        for (var i = 0; i < text.length; i++) {
            if (atLineStart) {
                out += stamp;
                atLineStart = false;
            }
            out += text[i];
            if (text[i] === "\n") {
                atLineStart = true;
            }
        }
        return {text: out, atLineStart: atLineStart};
    }

    // 浏览器只有 UTF-8 的 TextEncoder。GBK 编码表靠 TextDecoder 把所有双字节码解一遍反推出来，
    // 第一次用到时才建（两万多项，几十毫秒）
    function createGbkEncoder(Decoder) {
        var table = null;
        function build() {
            table = new Map();
            var decoder = new Decoder("gbk");
            var pair = new Uint8Array(2);
            for (var lead = 0x81; lead <= 0xFE; lead++) {
                for (var trail = 0x40; trail <= 0xFE; trail++) {
                    if (trail === 0x7F) {
                        continue;
                    }
                    pair[0] = lead;
                    pair[1] = trail;
                    var ch = decoder.decode(pair);
                    if (ch.length === 1 && ch !== "\uFFFD" && !table.has(ch)) {
                        table.set(ch, (lead << 8) | trail);
                    }
                }
            }
        }
        return function encode(text) {
            var out = [];
            for (var i = 0; i < text.length; i++) {
                var code = text.charCodeAt(i);
                if (code < 0x80) {
                    out.push(code);
                    continue;
                }
                if (!table) {
                    build();
                }
                var gbk = table.get(text[i]);
                if (gbk === undefined) {
                    out.push(0x3F);
                    // 四字节的 UTF-16 代理对整个算一个问号
                    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
                        i++;
                    }
                } else {
                    out.push(gbk >> 8, gbk & 0xFF);
                }
            }
            return new Uint8Array(out);
        };
    }

    // 粘贴限速：U-Boot、单片机的接收缓冲只有几十字节，整块写进去会丢字。
    // 设了字符间隔就逐字发（换行后等两者中较长的那个），只设了行间隔就逐行发
    function pacedChunks(text, charDelay, lineDelay) {
        if (!text) {
            return [];
        }
        if (charDelay > 0) {
            var chars = Array.from(text);
            return chars.map(function (ch, i) {
                var lineEnd = ch === "\n" || (ch === "\r" && chars[i + 1] !== "\n");
                return {text: ch, delay: lineEnd ? Math.max(charDelay, lineDelay) : charDelay};
            });
        }
        if (lineDelay > 0) {
            return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g).map(function (line) {
                return {text: line, delay: lineDelay};
            });
        }
        return [{text: text, delay: 0}];
    }

    var HIGHLIGHT_RULES = [
        {level: "error", pattern: /\b(?:errors?|fail(?:s|ed|ure)?|fatal|panic|oops|segfault|critical|denied)\b|错误|錯誤|失败|失敗|异常|異常/gi},
        {level: "warn", pattern: /\b(?:warn(?:s|ing|ings)?)\b|警告/gi}
    ];

    // 一行里要标色的关键字位置，按出现顺序
    function findHighlights(text) {
        var out = [];
        HIGHLIGHT_RULES.forEach(function (rule) {
            rule.pattern.lastIndex = 0;
            var m;
            while ((m = rule.pattern.exec(text)) !== null) {
                out.push({start: m.index, end: m.index + m[0].length, level: rule.level});
            }
        });
        return out.sort(function (a, b) {
            return a.start - b.start;
        });
    }

    // 自动应答的回复里用转义写控制字符：\r 回车、\n 换行、\t、\e (ESC)、\x03 (Ctrl+C)、\\
    function unescapeText(text) {
        return String(text).replace(/\\(x[0-9a-fA-F]{2}|[rnte\\])/g, function (all, code) {
            if (code.charAt(0) === "x") {
                return String.fromCharCode(parseInt(code.slice(1), 16));
            }
            return {r: "\r", n: "\n", t: "\t", e: "\x1b", "\\": "\\"}[code];
        });
    }

    // 收到的文字是一块块到的，关键字可能被切在两块之间，所以留着上一块的尾巴一起找。
    // 匹配过的部分丢掉，同一处不会触发两次
    function createTriggerMatcher(triggers) {
        var keep = 0;
        triggers.forEach(function (trigger) {
            keep = Math.max(keep, trigger.match.length - 1);
        });
        var buffer = "";
        return function feed(text) {
            buffer += text;
            var fired = [];
            var from = 0;
            for (;;) {
                var best = -1;
                var at = -1;
                for (var i = 0; i < triggers.length; i++) {
                    var pos = buffer.indexOf(triggers[i].match, from);
                    if (pos !== -1 && (at === -1 || pos < at)) {
                        at = pos;
                        best = i;
                    }
                }
                if (best === -1) {
                    break;
                }
                fired.push(best);
                from = at + triggers[best].match.length;
            }
            buffer = buffer.slice(from);
            if (buffer.length > keep) {
                buffer = buffer.slice(buffer.length - keep);
            }
            return fired;
        };
    }

    var SOH = 0x01;
    var STX = 0x02;
    var EOT = 0x04;
    var ACK = 0x06;
    var NAK = 0x15;
    var CAN = 0x18;
    var CRC_START = 0x43;
    var XMODEM_PAD = 0x1A;

    function crc16Ccitt(bytes) {
        var crc = 0;
        for (var i = 0; i < bytes.length; i++) {
            crc ^= bytes[i] << 8;
            for (var bit = 0; bit < 8; bit++) {
                crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
            }
        }
        return crc;
    }

    // 一个 XMODEM 块：头 + 块号 + 块号反码 + 数据（不满补 pad）+ CRC16 或 8 位累加和
    function xmodemBlock(number, payload, size, useCrc, pad) {
        var block = new Uint8Array(3 + size + (useCrc ? 2 : 1));
        block[0] = size === 1024 ? STX : SOH;
        block[1] = number & 0xFF;
        block[2] = 0xFF - (number & 0xFF);
        var data = block.subarray(3, 3 + size);
        data.fill(pad);
        data.set(payload.subarray(0, size));
        if (useCrc) {
            var crc = crc16Ccitt(data);
            block[3 + size] = crc >> 8;
            block[4 + size] = crc & 0xFF;
        } else {
            block[3 + size] = checksum(data, "sum8")[0];
        }
        return block;
    }

    // YMODEM 第 0 块：文件名\0 文件大小，其余补 0；文件名太长才用 1K 块
    function ymodemHeader(name, size) {
        var head = new TextEncoder().encode(name + "\0" + size + "\0");
        var length = head.length <= 128 ? 128 : 1024;
        var payload = new Uint8Array(length);
        payload.set(head.subarray(0, length));
        return payload;
    }

    function transferError(code) {
        var e = new Error(code);
        e.code = code;
        return e;
    }

    // 往被控端推文件（U-Boot 的 loadx/loady、Linux 的 rx/rb）。
    // io.write(bytes) 返回 Promise；io.read(ms) 返回下一个字节，超时给 null。
    // 出错抛带 code 的 Error：timeout 等不到对方、cancelled 对方取消、aborted 自己取消、retries 重试太多次
    async function sendXmodem(io, data, options) {
        var protocol = options.protocol;
        var signal = options.signal || {};
        var timeoutMs = options.timeoutMs || 10000;
        var startTimeoutMs = options.startTimeoutMs || 60000;
        var maxRetries = options.maxRetries || 10;
        var onProgress = options.onProgress || function () {};
        var useCrc = true;

        async function read(ms) {
            if (signal.aborted) {
                throw transferError("aborted");
            }
            var b = await io.read(ms);
            if (signal.aborted) {
                throw transferError("aborted");
            }
            return b;
        }

        // 接收端没开始前会打印提示文字，中间夹的杂字节都跳过，只认 C / NAK
        async function waitStart(allowNak) {
            var deadline = Date.now() + startTimeoutMs;
            var cans = 0;
            for (;;) {
                var left = deadline - Date.now();
                var b = left > 0 ? await read(left) : null;
                if (b === null) {
                    throw transferError("timeout");
                }
                if (b === CRC_START) {
                    useCrc = true;
                    return;
                }
                if (b === NAK && allowNak) {
                    useCrc = false;
                    return;
                }
                cans = b === CAN ? cans + 1 : 0;
                if (cans >= 2) {
                    throw transferError("cancelled");
                }
            }
        }

        async function waitReply() {
            var deadline = Date.now() + timeoutMs;
            var cans = 0;
            for (;;) {
                var left = deadline - Date.now();
                var b = left > 0 ? await read(left) : null;
                if (b === null || b === NAK) {
                    return false;
                }
                if (b === ACK) {
                    return true;
                }
                cans = b === CAN ? cans + 1 : 0;
                if (cans >= 2) {
                    throw transferError("cancelled");
                }
            }
        }

        async function sendReliably(bytes) {
            for (var attempt = 0; attempt < maxRetries; attempt++) {
                await io.write(bytes);
                if (await waitReply()) {
                    return;
                }
            }
            throw transferError("retries");
        }

        async function sendData(blockSize, firstNumber) {
            var number = firstNumber;
            var sent = 0;
            onProgress(0, data.length);
            while (sent < data.length) {
                var left = data.length - sent;
                var size = blockSize === 1024 && left <= 128 ? 128 : blockSize;
                await sendReliably(xmodemBlock(number, data.subarray(sent, sent + size), size, useCrc, XMODEM_PAD));
                sent = Math.min(sent + size, data.length);
                number++;
                onProgress(sent, data.length);
            }
            await sendReliably(new Uint8Array([EOT]));
        }

        try {
            if (protocol === "ymodem") {
                await waitStart(false);
                var header = ymodemHeader(options.fileName || "file", data.length);
                await sendReliably(xmodemBlock(0, header, header.length, true, 0));
                await waitStart(false);
                await sendData(1024, 1);
                // 收完一个文件对方再要下一个，回一个空的第 0 块表示没有了
                await waitStart(false);
                await sendReliably(xmodemBlock(0, new Uint8Array(0), 128, true, 0));
            } else {
                await waitStart(true);
                await sendData(protocol === "xmodem1k" ? 1024 : 128, 1);
            }
        } catch (e) {
            if (e.code === "aborted" || e.code === "retries" || e.code === "timeout") {
                await io.write(new Uint8Array([CAN, CAN, CAN])).catch(function () {});
            }
            throw e;
        }
    }

    function matches(info, filter) {
        return !!info && !!filter
            && info.usbVendorId === filter.usbVendorId
            && info.usbProductId === filter.usbProductId;
    }

    // 本页里用户在浏览器选择框里明确选过的串口排最前，重连时先试它
    function candidatePorts(ports, filter, preferred) {
        if (!ports || !filter) {
            return [];
        }
        var hits = ports.filter(function (port) {
            return matches(port.getInfo(), filter);
        });
        var at = preferred ? hits.indexOf(preferred) : -1;
        if (at > 0) {
            hits.splice(at, 1);
            hits.unshift(preferred);
        }
        return hits;
    }

    // 逐个试着打开，绝不写入：另一头是被控机的 console，任何探测字节都会被当成输入。
    // 打不开的是不在位的旧授权或被别的页面占着（比如控制页正把它当键鼠用）。
    // 能打开的不止一个时全部还回去，交给用户在浏览器选择框里挑
    async function openFirstUnambiguous(candidates, options) {
        if (!candidates || candidates.length === 0) {
            return {error: "notFound"};
        }
        var opened = [];
        for (var i = 0; i < candidates.length; i++) {
            try {
                await candidates[i].open(options);
                opened.push(candidates[i]);
            } catch (e) {
                // 打不开就跳过
            }
        }
        if (opened.length === 1) {
            return {port: opened[0]};
        }
        await Promise.all(opened.map(function (port) {
            return port.close().catch(function () {});
        }));
        if (opened.length === 0) {
            return {error: "busy"};
        }
        return {error: "ambiguous", count: opened.length};
    }

    var VENDORS = {
        0x1A86: "WCH",
        0x0403: "FTDI",
        0x10C4: "Silicon Labs",
        0x067B: "Prolific"
    };
    var CHIPS = {
        "1A86:7523": "CH340",
        "1A86:7522": "CH340K",
        "1A86:5523": "CH341",
        "1A86:55D2": "CH342",
        "1A86:55D3": "CH343",
        "1A86:55D4": "CH9102",
        "0403:6001": "FT232R",
        "0403:6010": "FT2232",
        "0403:6014": "FT232H",
        "0403:6015": "FT231X",
        "10C4:EA60": "CP210x",
        "067B:2303": "PL2303"
    };

    function hex4(value) {
        return ("0000" + value.toString(16).toUpperCase()).slice(-4);
    }

    // 没有 USB 信息（蓝牙串口、主板自带的 COM 口）返回 null，由页面给出文案
    function portLabel(info) {
        if (!info || info.usbVendorId == null) {
            return null;
        }
        var id = hex4(info.usbVendorId) + ":" + (info.usbProductId == null ? "????" : hex4(info.usbProductId));
        var chip = CHIPS[id];
        var vendor = VENDORS[info.usbVendorId];
        var name = chip ? (vendor ? vendor + " " : "") + chip : vendor;
        return name ? name + " (" + id + ")" : id;
    }

    // 只留最近 LOG_LIMIT 字节。存的是原始字节，保存出来的日志和串口收到的一模一样
    function createLog(limit) {
        var max = limit || LOG_LIMIT;
        var chunks = [];
        var total = 0;
        return {
            append: function (chunk) {
                if (!chunk || chunk.length === 0) {
                    return;
                }
                if (chunk.length >= max) {
                    chunks = [chunk.slice(chunk.length - max)];
                    total = max;
                    return;
                }
                chunks.push(chunk);
                total += chunk.length;
                while (total > max) {
                    var over = total - max;
                    if (chunks[0].length <= over) {
                        total -= chunks.shift().length;
                    } else {
                        chunks[0] = chunks[0].slice(over);
                        total -= over;
                    }
                }
            },
            size: function () {
                return total;
            },
            chunks: function () {
                return chunks.slice();
            },
            clear: function () {
                chunks = [];
                total = 0;
            }
        };
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function logFileName(date) {
        return "serial-" + date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate())
            + "-" + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds()) + ".log";
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        BAUD_RATES: BAUD_RATES,
        DATA_BITS: DATA_BITS,
        PARITIES: PARITIES,
        STOP_BITS: STOP_BITS,
        FLOW_CONTROLS: FLOW_CONTROLS,
        MIN_BAUD: MIN_BAUD,
        MAX_BAUD: MAX_BAUD,
        NEWLINES: NEWLINES,
        MODES: MODES,
        ENCODINGS: ENCODINGS,
        SEND_FORMATS: SEND_FORMATS,
        CHECKSUMS: CHECKSUMS,
        MIN_LOOP_MS: MIN_LOOP_MS,
        MAX_LOOP_MS: MAX_LOOP_MS,
        MAX_PRESETS: MAX_PRESETS,
        MIN_FONT_SIZE: MIN_FONT_SIZE,
        MAX_FONT_SIZE: MAX_FONT_SIZE,
        MIN_SCROLLBACK: MIN_SCROLLBACK,
        MAX_SCROLLBACK: MAX_SCROLLBACK,
        MAX_CHAR_DELAY: MAX_CHAR_DELAY,
        MAX_LINE_DELAY: MAX_LINE_DELAY,
        MAX_HISTORY: MAX_HISTORY,
        MAX_TRIGGERS: MAX_TRIGGERS,
        TRANSFER_PROTOCOLS: TRANSFER_PROTOCOLS,
        MIN_FRAME_GAP: MIN_FRAME_GAP,
        MAX_FRAME_GAP: MAX_FRAME_GAP,
        MAX_PROFILES: MAX_PROFILES,
        MAX_SCRIPTS: MAX_SCRIPTS,
        PROFILE_FIELDS: PROFILE_FIELDS,
        DEFAULTS: DEFAULTS,
        LOG_LIMIT: LOG_LIMIT,
        normalize: normalize,
        load: load,
        save: save,
        openOptions: openOptions,
        convertInput: convertInput,
        convertPaste: convertPaste,
        lineCount: lineCount,
        parseHex: parseHex,
        formatHex: formatHex,
        hexRows: hexRows,
        checksum: checksum,
        buildPayload: buildPayload,
        formatTime: formatTime,
        stampLines: stampLines,
        createGbkEncoder: createGbkEncoder,
        normalizePresets: normalizePresets,
        normalizeTriggers: normalizeTriggers,
        pushHistory: pushHistory,
        pacedChunks: pacedChunks,
        findHighlights: findHighlights,
        unescapeText: unescapeText,
        createTriggerMatcher: createTriggerMatcher,
        crc16Ccitt: crc16Ccitt,
        xmodemBlock: xmodemBlock,
        ymodemHeader: ymodemHeader,
        sendXmodem: sendXmodem,
        snapshotProfile: snapshotProfile,
        applyProfile: applyProfile,
        upsertProfile: upsertProfile,
        exportConfig: exportConfig,
        importConfig: importConfig,
        configFileName: configFileName,
        parseScript: parseScript,
        runScript: runScript,
        parsePlotLine: parsePlotLine,
        matches: matches,
        candidatePorts: candidatePorts,
        openFirstUnambiguous: openFirstUnambiguous,
        portLabel: portLabel,
        createLog: createLog,
        logFileName: logFileName
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SerialTerminal;
}
