const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const SerialTerminal = require("../terminal.js");

const ROOT = path.join(__dirname, "..");
const CH340 = {usbVendorId: 0x1a86, usbProductId: 0x7523};
const FT232 = {usbVendorId: 0x0403, usbProductId: 0x6001};

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: key => (key in data ? data[key] : null),
        setItem: (key, value) => {
            data[key] = String(value);
        },
        data: data
    };
}

function fakePort(info, options) {
    options = options || {};
    const port = {
        isOpen: false,
        written: [],
        getInfo: () => info,
        open: async (config) => {
            if (options.openFails) {
                throw new Error("busy");
            }
            port.config = config;
            port.isOpen = true;
        },
        close: async () => {
            port.isOpen = false;
        },
        writable: {
            getWriter: () => ({
                write: async (bytes) => {
                    port.written.push(Array.from(bytes));
                },
                releaseLock: () => {}
            })
        }
    };
    return port;
}

test("参数校验", async (t) => {
    await t.test("什么都没存时用默认值，串口为空", () => {
        assert.deepStrictEqual(SerialTerminal.normalize(null), {
            deviceId: null,
            label: "",
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
            plot: false,
            profile: "",
            presets: [],
            history: [],
            triggers: [],
            profiles: [],
            scripts: []
        });
    });
    await t.test("手改出来的坏值退回默认", () => {
        const config = SerialTerminal.normalize({baudRate: "96k", parity: "foo", dataBits: 6, stopBits: 3,
            flowControl: "software", newline: "\n", mode: "binary", encoding: "latin1", timestamp: "yes",
            localEcho: 1, sendFormat: "bin", checksum: "md5", loopMs: 5});
        assert.strictEqual(config.mode, "text");
        assert.strictEqual(config.encoding, "utf-8");
        assert.strictEqual(config.timestamp, false);
        assert.strictEqual(config.localEcho, false);
        assert.strictEqual(config.sendFormat, "text");
        assert.strictEqual(config.checksum, "none");
        assert.strictEqual(config.loopMs, 1000);
        assert.strictEqual(config.baudRate, 115200);
        assert.strictEqual(config.parity, "none");
        assert.strictEqual(config.dataBits, 8);
        assert.strictEqual(config.stopBits, 1);
        assert.strictEqual(config.flowControl, "none");
        assert.strictEqual(config.newline, "cr");
    });
    await t.test("波特率可以手填列表外的值，但要在范围内的整数", () => {
        assert.strictEqual(SerialTerminal.normalize({baudRate: 74880}).baudRate, 74880);
        assert.strictEqual(SerialTerminal.normalize({baudRate: " 250000 "}).baudRate, 250000);
        assert.strictEqual(SerialTerminal.normalize({baudRate: 9600.5}).baudRate, 115200);
        assert.strictEqual(SerialTerminal.normalize({baudRate: 0}).baudRate, 115200);
        assert.strictEqual(SerialTerminal.normalize({baudRate: SerialTerminal.MAX_BAUD + 1}).baudRate, 115200);
    });
    await t.test("常用指令：丢掉坏项，名字空了用内容，超长截断，最多 50 条", () => {
        const presets = SerialTerminal.normalize({presets: [
            {name: " 吸合 ", format: "hex", data: "A0 01 01", checksum: "sum8"},
            {name: "", format: "text", data: "AT+GMR"},
            {name: "坏", data: ""},
            null,
            {format: "weird", data: "x", checksum: "md5"}
        ]}).presets;
        assert.deepStrictEqual(presets, [
            {name: "吸合", format: "hex", data: "A0 01 01", checksum: "sum8"},
            {name: "AT+GMR", format: "text", data: "AT+GMR", checksum: "none"},
            {name: "x", format: "text", data: "x", checksum: "none"}
        ]);
        const many = Array.from({length: 60}, (_, i) => ({data: "c" + i}));
        assert.strictEqual(SerialTerminal.normalize({presets: many}).presets.length, SerialTerminal.MAX_PRESETS);
        assert.strictEqual(SerialTerminal.normalize({presets: [{name: "n".repeat(100), data: "d"}]}).presets[0].name.length, 40);
        assert.deepStrictEqual(SerialTerminal.normalize({presets: "nope"}).presets, []);
    });
    await t.test("下拉框给的字符串数字照样认", () => {
        const config = SerialTerminal.normalize({baudRate: "9600", dataBits: "7", stopBits: "2"});
        assert.strictEqual(config.baudRate, 9600);
        assert.strictEqual(config.dataBits, 7);
        assert.strictEqual(config.stopBits, 2);
    });
    await t.test("合法值原样保留", () => {
        const config = SerialTerminal.normalize({deviceId: FT232, label: "FTDI FT232R (0403:6001)", baudRate: 9600,
            dataBits: 7, parity: "even", stopBits: 2, flowControl: "hardware", newline: "crlf", mode: "hex",
            encoding: "gbk", timestamp: true, localEcho: true, sendFormat: "hex", checksum: "crc16", loopMs: 250,
            panel: false, fontSize: 18, scrollback: 50000, highlight: false, charDelay: 2, lineDelay: 100,
            triggersEnabled: true, transferProtocol: "xmodem1k", frameGap: 20, plot: true, profile: "relay",
            presets: [{name: "on", format: "hex", data: "A0 01 01", checksum: "sum8"}],
            history: [{format: "text", data: "ls"}], triggers: [{match: "login:", reply: "root\\r"}],
            scripts: [{name: "boot", text: "send ls"}]});
        assert.deepStrictEqual(config, {deviceId: FT232, label: "FTDI FT232R (0403:6001)", baudRate: 9600,
            dataBits: 7, parity: "even", stopBits: 2, flowControl: "hardware", newline: "crlf", mode: "hex",
            encoding: "gbk", timestamp: true, localEcho: true, sendFormat: "hex", checksum: "crc16", loopMs: 250,
            panel: false, fontSize: 18, scrollback: 50000, highlight: false, charDelay: 2, lineDelay: 100,
            triggersEnabled: true, transferProtocol: "xmodem1k", frameGap: 20, plot: true, profile: "relay",
            presets: [{name: "on", format: "hex", data: "A0 01 01", checksum: "sum8"}],
            history: [{format: "text", data: "ls"}], triggers: [{match: "login:", reply: "root\\r"}],
            profiles: [], scripts: [{name: "boot", text: "send ls"}]});
    });
    await t.test("缺 VID 或 PID 的串口当作没选，显示名一并清空", () => {
        const config = SerialTerminal.normalize({deviceId: {usbVendorId: 0x1a86}, label: "x"});
        assert.strictEqual(config.deviceId, null);
        assert.strictEqual(config.label, "");
    });
});

test("存取", async (t) => {
    await t.test("存进去再读出来一样", () => {
        const storage = memoryStorage();
        const saved = SerialTerminal.save(storage, {deviceId: CH340, baudRate: 9600});
        assert.deepStrictEqual(SerialTerminal.load(storage), saved);
        assert.ok(SerialTerminal.STORAGE_KEY in storage.data);
    });
    await t.test("存储内容损坏时按默认值处理", () => {
        const storage = memoryStorage({[SerialTerminal.STORAGE_KEY]: "{not json"});
        assert.deepStrictEqual(SerialTerminal.load(storage), SerialTerminal.normalize(null));
    });
    await t.test("没有存储时不抛错", () => {
        assert.deepStrictEqual(SerialTerminal.load(null), SerialTerminal.normalize(null));
    });
    await t.test("只用自己的键，不碰设置页的 settings", () => {
        const storage = memoryStorage({settings: "{\"usb\":1}"});
        SerialTerminal.save(storage, {baudRate: 9600});
        assert.strictEqual(storage.data.settings, "{\"usb\":1}");
        assert.deepStrictEqual(Object.keys(storage.data).sort(), ["chrome-kvm-terminal", "settings"]);
    });
    await t.test("打开串口的参数", () => {
        const config = SerialTerminal.normalize({baudRate: 9600, parity: "odd", flowControl: "hardware"});
        assert.deepStrictEqual(SerialTerminal.openOptions(config), {
            baudRate: 9600, dataBits: 8, parity: "odd", stopBits: 1, flowControl: "hardware"
        });
    });
});

test("十六进制", async (t) => {
    function bytes(result) {
        return result.bytes ? Array.from(result.bytes) : result;
    }
    await t.test("空格隔开、连着写、带 0x 和逗号都认", () => {
        assert.deepStrictEqual(bytes(SerialTerminal.parseHex("A0 01 01 A2")), [0xA0, 0x01, 0x01, 0xA2]);
        assert.deepStrictEqual(bytes(SerialTerminal.parseHex("a00101a2")), [0xA0, 0x01, 0x01, 0xA2]);
        assert.deepStrictEqual(bytes(SerialTerminal.parseHex("0xA0, 0x01,0x01 0XA2")), [0xA0, 0x01, 0x01, 0xA2]);
        assert.deepStrictEqual(bytes(SerialTerminal.parseHex("  A0:01-01\tA2\n")), [0xA0, 0x01, 0x01, 0xA2]);
    });
    await t.test("单独一位的按一个字节补零", () => {
        assert.deepStrictEqual(bytes(SerialTerminal.parseHex("A0 1 1 A2")), [0xA0, 0x01, 0x01, 0xA2]);
    });
    await t.test("空的、奇数位、非十六进制字符都报错", () => {
        assert.deepStrictEqual(SerialTerminal.parseHex("  "), {error: "empty"});
        assert.deepStrictEqual(SerialTerminal.parseHex("A00"), {error: "odd"});
        assert.deepStrictEqual(SerialTerminal.parseHex("A0 G1"), {error: "invalid"});
        assert.deepStrictEqual(SerialTerminal.parseHex("0x"), {error: "invalid"});
    });
    await t.test("格式化成两位大写、空格隔开", () => {
        assert.strictEqual(SerialTerminal.formatHex(new Uint8Array([0xA0, 0x01, 0x0F, 0xFF])), "A0 01 0F FF");
        assert.strictEqual(SerialTerminal.formatHex(new Uint8Array([])), "");
    });
    await t.test("分行带 ASCII 对照，不满一行的十六进制列补齐", () => {
        const bytes = new Uint8Array([0x41, 0x54, 0x0D, 0x0A, 0x7F, 0x20]);
        assert.deepStrictEqual(SerialTerminal.hexRows(bytes, 4), [
            {hex: "41 54 0D 0A", ascii: "AT.."},
            {hex: "7F 20      ", ascii: ". "}
        ]);
        assert.deepStrictEqual(SerialTerminal.hexRows(new Uint8Array([]), 16), []);
    });
});

test("校验与发送内容", async (t) => {
    const utf8 = text => new TextEncoder().encode(text);
    await t.test("SUM8 和 LCUS 继电器的帧尾一致", () => {
        assert.deepStrictEqual(SerialTerminal.checksum([0xA0, 0x01, 0x01], "sum8"), [0xA2]);
        assert.deepStrictEqual(SerialTerminal.checksum([0xFF, 0x02], "sum8"), [0x01]);
    });
    await t.test("XOR8", () => {
        assert.deepStrictEqual(SerialTerminal.checksum([0x01, 0x02, 0x04], "xor8"), [0x07]);
    });
    await t.test("CRC16 Modbus：01 03 00 00 00 01 的校验是 84 0A", () => {
        assert.deepStrictEqual(SerialTerminal.checksum([0x01, 0x03, 0x00, 0x00, 0x00, 0x01], "crc16"), [0x84, 0x0A]);
    });
    await t.test("不加校验", () => {
        assert.deepStrictEqual(SerialTerminal.checksum([1, 2], "none"), []);
    });
    await t.test("HEX 发送补校验", () => {
        const result = SerialTerminal.buildPayload({format: "hex", data: "A0 01 01", checksum: "sum8"}, "cr", utf8);
        assert.deepStrictEqual(Array.from(result.bytes), [0xA0, 0x01, 0x01, 0xA2]);
    });
    await t.test("HEX 格式错误原样报出来", () => {
        assert.deepStrictEqual(SerialTerminal.buildPayload({format: "hex", data: "A0 0G", checksum: "none"}, "cr", utf8),
            {error: "invalid"});
    });
    await t.test("文本发送按编码转字节并补上换行", () => {
        const result = SerialTerminal.buildPayload({format: "text", data: "AT", checksum: "sum8"}, "crlf", utf8);
        assert.deepStrictEqual(Array.from(result.bytes), [0x41, 0x54, 0x0D, 0x0A]);
        assert.deepStrictEqual(SerialTerminal.buildPayload({format: "text", data: ""}, "cr", utf8), {error: "empty"});
    });
});

test("时间戳", async (t) => {
    await t.test("格式是 时:分:秒.毫秒", () => {
        assert.strictEqual(SerialTerminal.formatTime(new Date(2026, 9, 23, 9, 5, 3, 7)), "09:05:03.007");
    });
    await t.test("每行开头插一次，行尾换行后等下一个字到了再插", () => {
        let r = SerialTerminal.stampLines("ab\r\ncd", true, "[T]");
        assert.deepStrictEqual(r, {text: "[T]ab\r\n[T]cd", atLineStart: false});
        r = SerialTerminal.stampLines("ef\n", r.atLineStart, "[U]");
        assert.deepStrictEqual(r, {text: "ef\n", atLineStart: true});
        r = SerialTerminal.stampLines("", r.atLineStart, "[V]");
        assert.deepStrictEqual(r, {text: "", atLineStart: true});
        r = SerialTerminal.stampLines("g", r.atLineStart, "[W]");
        assert.deepStrictEqual(r, {text: "[W]g", atLineStart: false});
    });
});

test("GBK 编码", async (t) => {
    const encode = SerialTerminal.createGbkEncoder(TextDecoder);
    await t.test("ASCII 原样，汉字两字节", () => {
        assert.deepStrictEqual(Array.from(encode("AT中文")), [0x41, 0x54, 0xD6, 0xD0, 0xCE, 0xC4]);
    });
    await t.test("和 TextDecoder 解回来一致", () => {
        const text = "串口终端，测试！";
        assert.strictEqual(new TextDecoder("gbk").decode(encode(text)), text);
    });
    await t.test("GBK 里没有的字符变成问号，代理对只算一个", () => {
        assert.deepStrictEqual(Array.from(encode("a😀b")), [0x61, 0x3F, 0x62]);
    });
});

test("换行转换", async (t) => {
    await t.test("回车键按设置转换", () => {
        assert.strictEqual(SerialTerminal.convertInput("ls\r", "cr"), "ls\r");
        assert.strictEqual(SerialTerminal.convertInput("ls\r", "lf"), "ls\n");
        assert.strictEqual(SerialTerminal.convertInput("ls\r", "crlf"), "ls\r\n");
    });
    await t.test("其它控制字符不动", () => {
        assert.strictEqual(SerialTerminal.convertInput("\x03\x1b[A", "crlf"), "\x03\x1b[A");
    });
    await t.test("粘贴的混合换行统一后再按设置转换", () => {
        const text = "a\r\nb\nc\rd";
        assert.strictEqual(SerialTerminal.convertPaste(text, "cr"), "a\rb\rc\rd");
        assert.strictEqual(SerialTerminal.convertPaste(text, "lf"), "a\nb\nc\nd");
        assert.strictEqual(SerialTerminal.convertPaste(text, "crlf"), "a\r\nb\r\nc\r\nd");
    });
    await t.test("行数：末尾的换行不算多一行", () => {
        assert.strictEqual(SerialTerminal.lineCount(""), 0);
        assert.strictEqual(SerialTerminal.lineCount("show version"), 1);
        assert.strictEqual(SerialTerminal.lineCount("show version\r\n"), 1);
        assert.strictEqual(SerialTerminal.lineCount("conf t\ninterface g0/1\nshutdown\n"), 3);
        assert.strictEqual(SerialTerminal.lineCount("a\r\rb"), 3);
    });
});

test("挑串口", async (t) => {
    await t.test("只留 VID/PID 匹配的", () => {
        const a = fakePort(CH340);
        const b = fakePort(FT232);
        const c = fakePort(CH340);
        assert.deepStrictEqual(SerialTerminal.candidatePorts([a, b, c], CH340, null), [a, c]);
        assert.deepStrictEqual(SerialTerminal.candidatePorts([a, b, c], {usbVendorId: 1, usbProductId: 2}, null), []);
        assert.deepStrictEqual(SerialTerminal.candidatePorts([a, b], null, null), []);
    });
    await t.test("用户选过的串口排最前", () => {
        const a = fakePort(CH340);
        const c = fakePort(CH340);
        assert.deepStrictEqual(SerialTerminal.candidatePorts([a, c], CH340, c), [c, a]);
    });
    await t.test("选过的串口不匹配时不硬塞进来", () => {
        const a = fakePort(CH340);
        const f = fakePort(FT232);
        assert.deepStrictEqual(SerialTerminal.candidatePorts([a, f], CH340, f), [a]);
    });
    await t.test("恰好一个能打开就用它，并且不写任何字节", async () => {
        const busy = fakePort(CH340, {openFails: true});
        const free = fakePort(CH340);
        const result = await SerialTerminal.openFirstUnambiguous([busy, free], {baudRate: 9600});
        assert.strictEqual(result.port, free);
        assert.strictEqual(free.config.baudRate, 9600);
        assert.deepStrictEqual(free.written, []);
    });
    await t.test("能打开的不止一个时全部关掉，报分不清", async () => {
        const a = fakePort(CH340);
        const b = fakePort(CH340);
        const result = await SerialTerminal.openFirstUnambiguous([a, b], {baudRate: 9600});
        assert.deepStrictEqual(result, {error: "ambiguous", count: 2});
        assert.strictEqual(a.isOpen, false);
        assert.strictEqual(b.isOpen, false);
        assert.deepStrictEqual(a.written.concat(b.written), []);
    });
    await t.test("一个都打不开报被占用，没有候选报找不到", async () => {
        const busy = fakePort(CH340, {openFails: true});
        assert.deepStrictEqual(await SerialTerminal.openFirstUnambiguous([busy], {}), {error: "busy"});
        assert.deepStrictEqual(await SerialTerminal.openFirstUnambiguous([], {}), {error: "notFound"});
    });
});

test("串口显示名", () => {
    assert.strictEqual(SerialTerminal.portLabel(CH340), "WCH CH340 (1A86:7523)");
    assert.strictEqual(SerialTerminal.portLabel(FT232), "FTDI FT232R (0403:6001)");
    assert.strictEqual(SerialTerminal.portLabel({usbVendorId: 0x1a86, usbProductId: 0x1234}), "WCH (1A86:1234)");
    assert.strictEqual(SerialTerminal.portLabel({usbVendorId: 0x1234, usbProductId: 0xabcd}), "1234:ABCD");
    assert.strictEqual(SerialTerminal.portLabel({}), null);
    assert.strictEqual(SerialTerminal.portLabel(null), null);
});

test("接收日志", async (t) => {
    function bytes(text) {
        return new Uint8Array(Buffer.from(text));
    }
    function joined(log) {
        return Buffer.concat(log.chunks().map(chunk => Buffer.from(chunk))).toString();
    }
    await t.test("没超上限时原样保留", () => {
        const log = SerialTerminal.createLog(10);
        log.append(bytes("abc"));
        log.append(bytes("def"));
        assert.strictEqual(log.size(), 6);
        assert.strictEqual(joined(log), "abcdef");
    });
    await t.test("刚好超限时丢最早的字节，最前面那块按需截断", () => {
        const log = SerialTerminal.createLog(10);
        log.append(bytes("abcd"));
        log.append(bytes("efgh"));
        log.append(bytes("ijk"));
        assert.strictEqual(log.size(), 10);
        assert.strictEqual(joined(log), "bcdefghijk");
    });
    await t.test("整块被挤掉时直接丢弃", () => {
        const log = SerialTerminal.createLog(5);
        log.append(bytes("ab"));
        log.append(bytes("cdefg"));
        assert.strictEqual(joined(log), "cdefg");
        assert.strictEqual(log.chunks().length, 1);
    });
    await t.test("单块超过上限时只留它的末尾", () => {
        const log = SerialTerminal.createLog(4);
        log.append(bytes("xy"));
        log.append(bytes("0123456789"));
        assert.strictEqual(joined(log), "6789");
        assert.strictEqual(log.size(), 4);
    });
    await t.test("空块不记，清空后从零开始", () => {
        const log = SerialTerminal.createLog(4);
        log.append(new Uint8Array(0));
        assert.strictEqual(log.chunks().length, 0);
        log.append(bytes("ab"));
        log.clear();
        assert.strictEqual(log.size(), 0);
    });
    await t.test("默认上限 5MB", () => {
        assert.strictEqual(SerialTerminal.LOG_LIMIT, 5 * 1024 * 1024);
    });
    await t.test("文件名带本地时间", () => {
        assert.strictEqual(SerialTerminal.logFileName(new Date(2026, 9, 3, 7, 5, 9)), "serial-2026-10-03-070509.log");
    });
});

test("终端词典", async (t) => {
    const dir = path.join(ROOT, "terminal-locales");
    const codes = ["zh-CN", "zh-TW", "en", "ja", "ko"];
    const dictionaries = {};
    codes.forEach(code => {
        dictionaries[code] = require(path.join(dir, code + ".js"));
    });
    const base = dictionaries["zh-CN"];
    function placeholders(text) {
        return (text.match(/\{\w+\}/g) || []).slice().sort().join();
    }
    await t.test("目录里正好是这五种语言", () => {
        assert.deepStrictEqual(fs.readdirSync(dir).sort(), codes.map(code => code + ".js").sort());
    });
    for (const code of codes) {
        await t.test(code + " 的键、占位符和简体中文一致，没有空词条", () => {
            const dictionary = dictionaries[code];
            assert.deepStrictEqual(Object.keys(dictionary).sort(), Object.keys(base).sort());
            assert.deepStrictEqual(Object.keys(base).filter(key => placeholders(dictionary[key]) !== placeholders(base[key])), []);
            assert.deepStrictEqual(Object.keys(dictionary).filter(key => !String(dictionary[key]).trim()), []);
        });
    }
    await t.test("终端页用到的键都在词典里，词典里没有用不到的键", () => {
        const sources = ["terminal.html", "terminal-page.js"].map(name => fs.readFileSync(path.join(ROOT, name), "utf8")).join("\n");
        const used = new Set(Array.from(sources.matchAll(/["'](term\.[a-zA-Z0-9.]+)["']/g), m => m[1]));
        // 按值拼出来的键：参数下拉框的选项
        SerialTerminal.PARITIES.forEach(value => used.add("term.parity." + value));
        SerialTerminal.FLOW_CONTROLS.forEach(value => used.add("term.flow." + value));
        SerialTerminal.MODES.forEach(value => used.add("term.mode." + value));
        ["timeout", "cancelled", "aborted", "retries"].forEach(code => used.add("term.transfer.error." + code));
        ["unknown", "arg", "number", "hex", "checksum", "end", "loop"].forEach(code => used.add("term.script.error." + code));
        used.delete("term.script.error.");
        used.delete("term.parity.");
        used.delete("term.flow.");
        used.delete("term.mode.");
        used.delete("term.transfer.error.");
        assert.deepStrictEqual([...used].filter(key => !(key in base)), []);
        assert.deepStrictEqual(Object.keys(base).filter(key => !used.has(key)), []);
    });
});

test("终端设置：字号、回滚、限速、历史、自动应答", async (t) => {
    await t.test("数字设置超范围退回默认", () => {
        const config = SerialTerminal.normalize({fontSize: 99, scrollback: 10, charDelay: -1, lineDelay: "20"});
        assert.strictEqual(config.fontSize, 14);
        assert.strictEqual(config.scrollback, 10000);
        assert.strictEqual(config.charDelay, 0);
        assert.strictEqual(config.lineDelay, 20);
    });
    await t.test("历史去掉坏项，只留最近的", () => {
        const many = Array.from({length: 60}, (_, i) => ({format: "text", data: "cmd" + i}));
        const config = SerialTerminal.normalize({history: [null, {data: ""}, ...many]});
        assert.strictEqual(config.history.length, SerialTerminal.MAX_HISTORY);
        assert.strictEqual(config.history[config.history.length - 1].data, "cmd59");
    });
    await t.test("同一条再发一次挪到最后", () => {
        const list = [{format: "text", data: "ls"}, {format: "hex", data: "A0"}];
        assert.deepStrictEqual(SerialTerminal.pushHistory(list, {format: "text", data: "ls", checksum: "none"}),
            [{format: "hex", data: "A0"}, {format: "text", data: "ls"}]);
    });
    await t.test("自动应答去掉缺字段的", () => {
        assert.deepStrictEqual(SerialTerminal.normalizeTriggers([{match: "login:", reply: "root\\r"}, {match: "x"}, {match: "", reply: "y"}]),
            [{match: "login:", reply: "root\\r"}]);
    });
});

test("粘贴限速分段", async (t) => {
    await t.test("不限速整块发", () => {
        assert.deepStrictEqual(SerialTerminal.pacedChunks("a\rb", 0, 0), [{text: "a\rb", delay: 0}]);
    });
    await t.test("只设行间隔：逐行，换行跟着上一行", () => {
        assert.deepStrictEqual(SerialTerminal.pacedChunks("ab\r\ncd\nef", 0, 50).map(c => c.text), ["ab\r\n", "cd\n", "ef"]);
    });
    await t.test("设了字符间隔：逐字，行尾等较长的那个，CRLF 只在 LF 后等", () => {
        assert.deepStrictEqual(SerialTerminal.pacedChunks("a\r\nb", 5, 100),
            [{text: "a", delay: 5}, {text: "\r", delay: 5}, {text: "\n", delay: 100}, {text: "b", delay: 5}]);
    });
    await t.test("中文和 emoji 按字切，不拆半个", () => {
        assert.deepStrictEqual(SerialTerminal.pacedChunks("中😀", 1, 0).map(c => c.text), ["中", "😀"]);
    });
});

test("关键字高亮", async (t) => {
    await t.test("按出现顺序给出位置和级别", () => {
        assert.deepStrictEqual(SerialTerminal.findHighlights("WARNING: disk error, mount failed"), [
            {start: 0, end: 7, level: "warn"},
            {start: 14, end: 19, level: "error"},
            {start: 27, end: 33, level: "error"}
        ]);
    });
    await t.test("只认整词：stderr、errorless 不算", () => {
        assert.deepStrictEqual(SerialTerminal.findHighlights("stderr errorless forewarned"), []);
    });
    await t.test("中文关键字", () => {
        assert.deepStrictEqual(SerialTerminal.findHighlights("挂载失败"), [{start: 2, end: 4, level: "error"}]);
    });
});

test("自动应答", async (t) => {
    await t.test("回复里的转义", () => {
        assert.strictEqual(SerialTerminal.unescapeText("root\\r\\x03\\\\n\\e"), "root\r\x03\\n\x1b");
    });
    await t.test("关键字被切在两块之间也能匹配，同一处只触发一次", () => {
        const feed = SerialTerminal.createTriggerMatcher([{match: "login:", reply: "root\\r"}]);
        assert.deepStrictEqual(feed("board log"), []);
        assert.deepStrictEqual(feed("in: "), [0]);
        assert.deepStrictEqual(feed("x"), []);
    });
    await t.test("一块里多个关键字按出现顺序触发", () => {
        const feed = SerialTerminal.createTriggerMatcher([{match: "B", reply: "2"}, {match: "A", reply: "1"}]);
        assert.deepStrictEqual(feed("A..B..A"), [1, 0, 1]);
    });
});

// 模拟接收端：每写一块就按协议回应；script 可以改某一步的回应来测重发
function fakeReceiver(protocol, options) {
    options = options || {};
    const queue = [options.checksumMode ? 0x15 : 0x43];
    const blocks = [];
    let eots = 0;
    const io = {
        written: [],
        write: async (bytes) => {
            io.written.push(Array.from(bytes));
            if (bytes[0] === 0x04) {
                eots++;
                if (eots === 1 && options.nakFirstEot) {
                    queue.push(0x15);
                    return;
                }
                queue.push(0x06);
                if (protocol === "ymodem") {
                    queue.push(0x43);
                }
                return;
            }
            if (bytes[0] === 0x18) {
                return;
            }
            const size = bytes[0] === 0x02 ? 1024 : 128;
            const data = Array.from(bytes.slice(3, 3 + size));
            if (options.checksumMode) {
                assert.strictEqual(bytes[3 + size], SerialTerminal.checksum(data, "sum8")[0]);
            } else {
                const crc = SerialTerminal.crc16Ccitt(data);
                assert.deepStrictEqual([bytes[3 + size], bytes[4 + size]], [crc >> 8, crc & 0xFF]);
            }
            assert.strictEqual(bytes[1] + bytes[2], 0xFF);
            if (options.nakBlock === blocks.length) {
                options.nakBlock = -1;
                queue.push(0x15);
                return;
            }
            blocks.push({number: bytes[1], data: data});
            queue.push(0x06);
            // YMODEM 收完第 0 块（文件头）还要再要一次
            if (protocol === "ymodem" && bytes[1] === 0 && blocks.length === 1) {
                queue.push(0x43);
            }
        },
        read: async () => (queue.length ? queue.shift() : null)
    };
    return {io: io, blocks: blocks};
}

function bytesOf(length) {
    return Uint8Array.from({length: length}, (_, i) => i & 0xFF);
}

test("XMODEM / YMODEM 发送", async (t) => {
    await t.test("CRC16-CCITT 标准校验值", () => {
        assert.strictEqual(SerialTerminal.crc16Ccitt(new TextEncoder().encode("123456789")), 0x31C3);
    });
    await t.test("XMODEM：128 字节一块，最后一块补 1A，块号从 1 开始", async () => {
        const {io, blocks} = fakeReceiver("xmodem");
        const progress = [];
        await SerialTerminal.sendXmodem(io, bytesOf(300), {protocol: "xmodem", onProgress: (done) => progress.push(done)});
        assert.deepStrictEqual(blocks.map(b => b.number), [1, 2, 3]);
        assert.deepStrictEqual(blocks[2].data.slice(0, 44), Array.from(bytesOf(300).slice(256)));
        assert.ok(blocks[2].data.slice(44).every(b => b === 0x1A));
        assert.deepStrictEqual(progress, [0, 128, 256, 300]);
        assert.deepStrictEqual(io.written[io.written.length - 1], [0x04]);
    });
    await t.test("对方开头回 NAK 就用 8 位累加和", async () => {
        const {blocks} = await (async () => {
            const r = fakeReceiver("xmodem", {checksumMode: true});
            await SerialTerminal.sendXmodem(r.io, bytesOf(10), {protocol: "xmodem"});
            return r;
        })();
        assert.strictEqual(blocks.length, 1);
    });
    await t.test("NAK 了就重发同一块；EOT 被 NAK 也重发", async () => {
        const {io, blocks} = fakeReceiver("xmodem", {nakBlock: 1, nakFirstEot: true});
        await SerialTerminal.sendXmodem(io, bytesOf(300), {protocol: "xmodem"});
        assert.deepStrictEqual(blocks.map(b => b.number), [1, 2, 3]);
        assert.strictEqual(io.written.filter(w => w[0] === 0x04).length, 2);
    });
    await t.test("XMODEM-1K：1K 块，剩下不到 128 的用小块", async () => {
        const {io} = fakeReceiver("xmodem");
        await SerialTerminal.sendXmodem(io, bytesOf(1100), {protocol: "xmodem1k"});
        assert.deepStrictEqual(io.written.map(w => w.length), [1029, 133, 1]);
    });
    await t.test("YMODEM：文件头、数据、结束用的空文件头", async () => {
        const {io, blocks} = fakeReceiver("ymodem", {nakFirstEot: true});
        await SerialTerminal.sendXmodem(io, bytesOf(300), {protocol: "ymodem", fileName: "fw.bin"});
        assert.deepStrictEqual(blocks.map(b => b.number), [0, 1, 0]);
        assert.strictEqual(Buffer.from(blocks[0].data.slice(0, 11)).toString("latin1"), "fw.bin\u0000300\u0000");
        assert.strictEqual(blocks[1].data.length, 1024);
        assert.ok(blocks[2].data.every(b => b === 0));
    });
    await t.test("对方一直不开始：超时并发 CAN", async () => {
        const io = {written: [], write: async (b) => io.written.push(Array.from(b)), read: async () => null};
        await assert.rejects(SerialTerminal.sendXmodem(io, bytesOf(10), {protocol: "xmodem"}), {code: "timeout"});
        assert.deepStrictEqual(io.written, [[0x18, 0x18, 0x18]]);
    });
    await t.test("对方发两个 CAN 就是取消", async () => {
        const queue = [0x41, 0x18, 0x18];
        const io = {write: async () => {}, read: async () => (queue.length ? queue.shift() : null)};
        await assert.rejects(SerialTerminal.sendXmodem(io, bytesOf(10), {protocol: "xmodem"}), {code: "cancelled"});
    });
    await t.test("自己取消", async () => {
        const {io} = fakeReceiver("xmodem");
        await assert.rejects(SerialTerminal.sendXmodem(io, bytesOf(10), {protocol: "xmodem", signal: {aborted: true}}), {code: "aborted"});
        assert.deepStrictEqual(io.written, [[0x18, 0x18, 0x18]]);
    });
});

test("更多校验", async (t) => {
    const check = new TextEncoder().encode("123456789");
    await t.test("各算法的标准校验值", () => {
        assert.deepStrictEqual(SerialTerminal.checksum(check, "crc8"), [0xF4]);
        assert.deepStrictEqual(SerialTerminal.checksum(check, "crc16ccitt"), [0x29, 0xB1]);
        assert.deepStrictEqual(SerialTerminal.checksum(check, "crc32"), [0x26, 0x39, 0xF4, 0xCB]);
    });
    await t.test("LRC 是累加和取补：Modbus ASCII 读寄存器", () => {
        assert.deepStrictEqual(SerialTerminal.checksum([0x01, 0x03, 0x00, 0x00, 0x00, 0x01], "lrc"), [0xFB]);
    });
    await t.test("分帧超时超范围退回默认", () => {
        assert.strictEqual(SerialTerminal.normalize({frameGap: 0}).frameGap, 100);
        assert.strictEqual(SerialTerminal.normalize({frameGap: "30"}).frameGap, 30);
    });
});

test("设备配置与导入导出", async (t) => {
    await t.test("保存时只存设备相关的字段", () => {
        const config = SerialTerminal.normalize({baudRate: 9600, mode: "hex", fontSize: 20, presets: [{data: "x"}]});
        const settings = SerialTerminal.snapshotProfile(config);
        assert.deepStrictEqual(Object.keys(settings), SerialTerminal.PROFILE_FIELDS);
        assert.strictEqual(settings.baudRate, 9600);
        assert.ok(!("fontSize" in settings) && !("presets" in settings));
    });
    await t.test("套用配置只换设备相关的字段，坏值退回默认", () => {
        const config = SerialTerminal.normalize({fontSize: 20, presets: [{data: "x"}]});
        const next = SerialTerminal.applyProfile(config, {baudRate: 9600, mode: "hex", parity: "bogus", fontSize: 30});
        assert.strictEqual(next.baudRate, 9600);
        assert.strictEqual(next.mode, "hex");
        assert.strictEqual(next.parity, "none");
        assert.strictEqual(next.fontSize, 20);
        assert.strictEqual(next.presets.length, 1);
    });
    await t.test("配置列表：去掉没名字和重名的，同名保存原位覆盖", () => {
        const profiles = SerialTerminal.normalize({profiles: [
            {name: " 继电器 ", settings: {baudRate: 9600}},
            {name: "继电器", settings: {baudRate: 4800}},
            {name: "", settings: {}},
            {name: "开发板", settings: {baudRate: 115200}}
        ]}).profiles;
        assert.deepStrictEqual(profiles.map(p => [p.name, p.settings.baudRate]), [["继电器", 9600], ["开发板", 115200]]);
        const updated = SerialTerminal.upsertProfile(profiles, "继电器", {baudRate: 19200});
        assert.deepStrictEqual(updated.map(p => p.name), ["继电器", "开发板"]);
        assert.strictEqual(updated[0].settings.baudRate, 19200);
    });
    await t.test("导出再导入得到同样的设置", () => {
        const config = SerialTerminal.normalize({baudRate: 9600, scripts: [{name: "s", text: "send x"}],
            profiles: [{name: "p", settings: {baudRate: 4800}}]});
        const text = SerialTerminal.exportConfig(config, new Date(2026, 0, 2));
        assert.deepStrictEqual(SerialTerminal.importConfig(text).config, config);
    });
    await t.test("不是导出文件的拒绝导入", () => {
        assert.deepStrictEqual(SerialTerminal.importConfig("not json"), {error: "json"});
        assert.deepStrictEqual(SerialTerminal.importConfig('{"baudRate":9600}'), {error: "format"});
    });
    await t.test("导出文件名带日期", () => {
        assert.strictEqual(SerialTerminal.configFileName(new Date(2026, 9, 3)), "serial-terminal-2026-10-03.json");
    });
});

test("脚本解析", async (t) => {
    await t.test("各条命令、注释、嵌套循环", () => {
        const result = SerialTerminal.parseScript([
            "# 登录后看版本",
            "send root",
            "WAIT #",
            "timeout 30",
            "loop 3",
            "  hex A0 01 01 +sum8",
            "  delay 500",
            "  sendraw \\x03",
            "end"
        ].join("\n"));
        assert.deepStrictEqual(result.steps, [
            {op: "send", text: "root", line: 2},
            {op: "wait", text: "#", line: 3},
            {op: "timeout", value: 30, line: 4},
            {op: "loop", count: 3, line: 5, body: [
                {op: "hex", data: "A0 01 01", checksum: "sum8", line: 6},
                {op: "delay", value: 500, line: 7},
                {op: "raw", text: "\x03", line: 8}
            ]}
        ]);
    });
    await t.test("send 不带内容就是只发回车", () => {
        assert.deepStrictEqual(SerialTerminal.parseScript("send").steps, [{op: "send", text: "", line: 1}]);
    });
    await t.test("出错时给出行号和原因", () => {
        assert.deepStrictEqual(SerialTerminal.parseScript("send a\nfoo"), {error: "unknown", line: 2});
        assert.deepStrictEqual(SerialTerminal.parseScript("wait"), {error: "arg", line: 1});
        assert.deepStrictEqual(SerialTerminal.parseScript("delay 1s"), {error: "number", line: 1});
        assert.deepStrictEqual(SerialTerminal.parseScript("hex A0 0G"), {error: "hex", line: 1});
        assert.deepStrictEqual(SerialTerminal.parseScript("hex A0 +md5"), {error: "checksum", line: 1});
        assert.deepStrictEqual(SerialTerminal.parseScript("end"), {error: "end", line: 1});
        assert.deepStrictEqual(SerialTerminal.parseScript("loop 2\nsend a"), {error: "loop", line: 2});
    });
});

function scriptIo(replies) {
    const log = [];
    return {
        log: log,
        send: async (text, newline) => log.push((newline ? "send " : "raw ") + text),
        sendHex: async (item) => log.push("hex " + item.data + " " + item.checksum),
        waitFor: async (text, ms) => {
            log.push("wait " + text + " " + ms);
            return replies.shift() !== false;
        },
        delay: async (ms) => log.push("delay " + ms)
    };
}

test("脚本执行", async (t) => {
    await t.test("按顺序执行，循环展开，timeout 影响之后的 wait", async () => {
        const io = scriptIo([]);
        await SerialTerminal.runScript(SerialTerminal.parseScript("wait login:\ntimeout 3\nloop 2\nsend ls\nwait #\nend").steps, io);
        assert.deepStrictEqual(io.log, ["wait login: 10000", "send ls", "wait # 3000", "send ls", "wait # 3000"]);
    });
    await t.test("等不到就停，报出是哪一行", async () => {
        const io = scriptIo([true, false]);
        await assert.rejects(SerialTerminal.runScript(SerialTerminal.parseScript("wait a\nsend b\nwait c\nsend d").steps, io),
            {code: "wait", line: 3, text: "c"});
        assert.deepStrictEqual(io.log, ["wait a 10000", "send b", "wait c 10000"]);
    });
    await t.test("loop 0 一直循环，直到被停止", async () => {
        const signal = {aborted: false};
        const io = Object.assign(scriptIo([]), {signal: signal});
        io.delay = async () => {
            io.log.push("tick");
            if (io.log.length === 5) {
                signal.aborted = true;
            }
        };
        await assert.rejects(SerialTerminal.runScript(SerialTerminal.parseScript("loop 0\ndelay 1\nend").steps, io), {code: "aborted"});
        assert.strictEqual(io.log.length, 5);
    });
});

test("曲线数据解析", async (t) => {
    await t.test("带名字的数值", () => {
        assert.deepStrictEqual(SerialTerminal.parsePlotLine("[12:00] temp=25.3, hum: 40 V_bat=-1.5e-1"), [
            {name: "temp", value: 25.3}, {name: "hum", value: 40}, {name: "V_bat", value: -0.15}
        ]);
    });
    await t.test("整行只有数字：按列编号", () => {
        assert.deepStrictEqual(SerialTerminal.parsePlotLine("1.5\t2,-3"), [
            {name: "1", value: 1.5}, {name: "2", value: 2}, {name: "3", value: -3}
        ]);
    });
    await t.test("普通文字和带颜色的提示符不算", () => {
        assert.deepStrictEqual(SerialTerminal.parsePlotLine("eth0 link up 1000Mbps"), []);
        assert.deepStrictEqual(SerialTerminal.parsePlotLine("\x1b[32mroot@pi\x1b[0m:~# "), []);
    });
    await t.test("颜色代码不影响取值", () => {
        assert.deepStrictEqual(SerialTerminal.parsePlotLine("\x1b[33mrpm=1200\x1b[0m"), [{name: "rpm", value: 1200}]);
    });
});
