function Ch9329(writer, mouseAbsolute, reader) {
    // 协议 V1.3：主从式，每条命令都应等待芯片应答（原命令码 | 0x80 成功，| 0xC0 出错）
    this.ADDR = 0x00;
    this.ACK_TIMEOUT_MS = 500;
    this._rxBuffer = new Uint8Array(0);
    this._frameWaiters = [];
    this._queue = [];
    this._queueRunning = false;
    this._movePending = null;
    this._moveQueued = false;
    // 移动包的实测统计。位移会从两个地方丢：一是 writeMove 的合并（有包在路上时
    // 后来的移动只覆盖不排队），二是相对模式单包 ±127 的截断。两者各占多少只能
    // 实测，不能拍脑袋，所以分开记
    this.moveStats = {
        submitted: 0,    // 上层调了多少次移动
        sent: 0,         // 真正发到线上的包数
        clamped: 0,      // 其中被 ±127 截断的包数
        lostUnits: 0,    // 截断丢掉的位移总量
        maxWanted: 0,    // 单轴请求过的最大位移。只看截断次数不够：峰值离 127
                         // 越远，余量累加的收益越大
        totalWaitMs: 0,  // 发包并等应答的累计耗时
        maxWaitMs: 0,
        since: Date.now()
    };
    this._readLoopStarted = false;
    this._ackSupported = true;
    this._ackMisses = 0;
    this._transportBroken = false;
    // 串口写失败（通常是设备被拔掉）时回调，由页面决定怎么提示
    this.onTransportError = null;

    // 哪些修饰键正按着，是会变的实例状态，所以不能和查表常量一起提到外面
    this.controlKeyDown = {
        16: false,  // LShiftKey
        161: false,  // RShiftKey
        17: false,  // LControlKey
        163: false,  // RControlKey
        18: false,  // LAlt
        165: false,  // Ralt
        "ShiftLeft": false,  // LShiftKey
        "ShiftRight": false,  // RShiftKey
        "ControlLeft": false,  // LControlKey
        "ControlRight": false,  // RControlKey
        "AltLeft": false,  // LAlt
        "AltRight": false,  // Ralt
        "MetaLeft": false,  // LWin
        "MetaRight": false,  // RWin
    }


    this.pressedKeys = [];

    // SUM = HEAD + ADDR + CMD + LEN + DATA，取低 8 位
    this.toUnit8Array = function (data) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum = (sum + data[i]) & 0xff;
        }
        data.push(sum);
        return new Uint8Array(data);
    }

    this.getModifierByte = function () {
        let controlValue = 0;
        for (const controlKeyDownKey in this.controlKeyDown) {
            if (this.controlKeyDown[controlKeyDownKey]) {
                controlValue = controlValue | (Ch9329.CONTROL_KEY_BITS[controlKeyDownKey] || 0);
            }
        }
        return controlValue;
    }

    this.syncKeyboard = function () {
        let data = [0x57, 0xAB, this.ADDR, 0x02, 0x08, this.getModifierByte(), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        for (let i = 0; i < Math.min(6, this.pressedKeys.length); i++) {
            data[7 + i] = this.pressedKeys[i];
        }
        this.write(this.toUnit8Array(data));
    }

    this.keydown = function (key) {
        if (Ch9329.CONTROL_KEY_MAP[key]) {
            this.controlKeyDown[key] = true;
            this.syncKeyboard();
            return;
        }
        let keyCode = Ch9329.KEYBOARD_MAP[key];
        if (keyCode == null || keyCode === undefined) {
            return;
        }
        if (this.pressedKeys.indexOf(keyCode) === -1) {
            if (this.pressedKeys.length >= 6) {
                this.pressedKeys.shift();
            }
            this.pressedKeys.push(keyCode);
        }
        this.syncKeyboard();
    }

    this.keyboardReleasePacket = new Uint8Array([0x57, 0xAB, 0x00, 0x02, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0C]);

    this.keyup = function (key) {
        if (Ch9329.CONTROL_KEY_MAP[key]) {
            this.controlKeyDown[key] = false;
            this.syncKeyboard();
            return;
        }
        let keyCode = Ch9329.KEYBOARD_MAP[key];
        if (keyCode != null && keyCode !== undefined) {
            this.pressedKeys = this.pressedKeys.filter(function (code) {
                return code !== keyCode;
            });
        }
        this.syncKeyboard();
    }

    this.releaseAllKeys = function () {
        this.pressedKeys = [];
        for (const controlKeyDownKey in this.controlKeyDown) {
            this.controlKeyDown[controlKeyDownKey] = false;
        }
        this.write(this.keyboardReleasePacket);
    }

    this._appendRx = function (chunk) {
        if (!chunk || !chunk.length) {
            return;
        }
        let next = new Uint8Array(this._rxBuffer.length + chunk.length);
        next.set(this._rxBuffer, 0);
        next.set(chunk, this._rxBuffer.length);
        this._rxBuffer = next;
    }

    // 解析一帧：57 AB ADDR CMD LEN DATA SUM，校验和不符则丢弃该帧头继续找。
    //
    // LEN 只当作「至少这么长」：CH9329F 回 GET_PARA_CFG 时 LEN 仍写 50，实际却
    // 发 65 字节数据（实测整帧 71 字节而非 56），真正的累加和落在最末尾。按 LEN
    // 死算帧尾会取到一个 0x00 当校验和，整帧被误判损坏丢掉。所以校验和对不上时
    // 再往后顺延着找，直到累加和吻合的那个字节。
    this.FRAME_LENGTH_SLACK = 32;

    this._shiftFrame = function () {
        let buf = this._rxBuffer;
        for (let i = 0; i + 6 <= buf.length; i++) {
            if (buf[i] !== 0x57 || buf[i + 1] !== 0xAB) {
                continue;
            }
            let minTotal = 6 + buf[i + 4];
            if (i + minTotal > buf.length) {
                if (i > 0) {
                    this._rxBuffer = buf.slice(i);
                }
                return null;
            }

            // 本帧不可能越过下一个帧头。有它兜着，才能把「还没收全」和「真的坏了」
            // 分开：往后找不到校验和又没有后续帧头时，多半只是数据还没到齐
            let nextHeader = -1;
            for (let k = i + 2; k + 1 < buf.length; k++) {
                if (buf[k] === 0x57 && buf[k + 1] === 0xAB) {
                    nextHeader = k;
                    break;
                }
            }

            let limit = Math.min(minTotal + this.FRAME_LENGTH_SLACK, buf.length - i);
            if (nextHeader !== -1) {
                limit = Math.min(limit, nextHeader - i);
            }

            let running = 0;
            for (let k = i; k < i + minTotal - 1; k++) {
                running = (running + buf[k]) & 0xff;
            }
            let matched = -1;
            for (let total = minTotal; total <= limit; total++) {
                if (buf[i + total - 1] === running) {
                    matched = total;
                    break;
                }
                running = (running + buf[i + total - 1]) & 0xff;
            }

            if (matched === -1) {
                if (nextHeader === -1 && buf.length - i < minTotal + this.FRAME_LENGTH_SLACK) {
                    // 后面既没有新帧头，长度也还没到容忍上限：等下一块数据再说
                    if (i > 0) {
                        this._rxBuffer = buf.slice(i);
                    }
                    return null;
                }
                this._rxBuffer = buf.slice(i + 2);
                return this._shiftFrame();
            }

            let frame = {cmd: buf[i + 3], data: buf.slice(i + 5, i + matched - 1)};
            this._rxBuffer = buf.slice(i + matched);
            return frame;
        }
        if (buf.length > 512) {
            this._rxBuffer = buf.slice(buf.length - 512);
        }
        return null;
    }

    this._dispatchFrames = function () {
        let frame = this._shiftFrame();
        while (frame) {
            let waiter = this._frameWaiters.shift();
            if (waiter) {
                waiter(frame);
            }
            frame = this._shiftFrame();
        }
    }

    this._startReadLoop = async function () {
        if (!reader || this._readLoopStarted) {
            return;
        }
        this._readLoopStarted = true;
        try {
            while (true) {
                let result = await reader.read();
                if (result.done) {
                    break;
                }
                this._appendRx(result.value);
                this._dispatchFrames();
            }
        } catch (e) {
            // 串口关闭或读取中断，后续命令降级为「不等应答」
        }
        this._readLoopStarted = false;
    }

    this._waitFrame = function (timeoutMs) {
        let self = this;
        return new Promise(function (resolve) {
            let done = false;
            let timer = setTimeout(function () {
                if (done) {
                    return;
                }
                done = true;
                let index = self._frameWaiters.indexOf(waiter);
                if (index !== -1) {
                    self._frameWaiters.splice(index, 1);
                }
                resolve(null);
            }, timeoutMs);
            function waiter(frame) {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timer);
                resolve(frame);
            }
            self._frameWaiters.push(waiter);
        });
    }

    // 发一条命令并等待应答；连续拿不到应答就降级为「只发不等」，避免每包都空等 500ms
    this._sleep = function (ms) {
        return new Promise(function (done) {
            setTimeout(done, ms);
        });
    }

    this._transfer = async function (packet, retries) {
        let cmd = packet[3];
        let attempts = (retries == null ? 1 : retries) + 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (this._transportBroken) {
                return null;
            }
            try {
                await writer.write(packet);
            } catch (e) {
                this.markDisconnected();
                if (this.onTransportError) {
                    try {
                        this.onTransportError(e);
                    } catch (ignored) {
                    }
                }
                return null;
            }
            if (!reader || !this._ackSupported) {
                // 芯片靠 ≥3ms 的空闲间隔判断一包结束（协议里的「串口通信包间隔」，
                // 默认 3ms）。等应答时这个间隔天然存在；不等应答时必须自己留出来，
                // 否则连续的移动包会被粘成一包，芯片越解析越乱。
                if (Ch9329.PACKET_GAP_MS > 0) {
                    await this._sleep(Ch9329.PACKET_GAP_MS);
                }
                return null;
            }
            this._startReadLoop();
            let frame = await this._waitFrame(this.ACK_TIMEOUT_MS);
            if (!frame) {
                this._ackMisses++;
                if (this._ackMisses >= 3) {
                    this._ackSupported = false;
                    console.warn("CH9329 连续无应答，已切换为不等应答发送");
                    return null;
                }
                continue;
            }
            this._ackMisses = 0;
            if (frame.cmd === (cmd | 0x80)) {
                return frame;
            }
            if (frame.cmd === (cmd | 0xC0)) {
                // 芯片拒收（0xE1 超时 / 0xE2 帧头 / 0xE3 命令 / 0xE4 校验 / 0xE5 参数 / 0xE6 执行失败）
                console.warn("CH9329 命令出错", "cmd=0x" + cmd.toString(16), "status=0x" + (frame.data[0] || 0).toString(16));
                continue;
            }
            return frame;
        }
        return null;
    }

    this._runQueue = async function () {
        if (this._queueRunning) {
            return;
        }
        this._queueRunning = true;
        while (this._queue.length) {
            let job = this._queue.shift();
            let packet = job.build ? job.build() : job.packet;
            let startedAt = (job.isMove && packet) ? Date.now() : 0;
            let frame = packet ? await this._transfer(packet, job.retries) : null;
            if (startedAt) {
                let waited = Date.now() - startedAt;
                this.moveStats.totalWaitMs += waited;
                if (waited > this.moveStats.maxWaitMs) {
                    this.moveStats.maxWaitMs = waited;
                }
            }
            if (job.resolve) {
                job.resolve(frame);
            }
        }
        this._queueRunning = false;
    }

    this._enqueue = function (job) {
        let self = this;
        return new Promise(function (resolve) {
            job.resolve = resolve;
            self._queue.push(job);
            self._runQueue();
        });
    }

    // 按键等关键包：允许一次重发
    this.write = function (packet) {
        return this._enqueue({packet: packet, retries: 1});
    }

    // 移动包：队列中只保留最新一个，避免 9600bps 下淹没按键包
    this.writeMove = function (packet) {
        this.moveStats.submitted++;
        this._movePending = packet;
        if (this._moveQueued) {
            return Promise.resolve(null);
        }
        this._moveQueued = true;
        let self = this;
        return this._enqueue({
            retries: 0,
            isMove: true,
            build: function () {
                self._moveQueued = false;
                let pending = self._movePending;
                self._movePending = null;
                if (pending) {
                    self.moveStats.sent++;
                }
                return pending;
            }
        });
    }

    // 截断掉的位移要记下来：它决定了「余量累加」那个改法值不值得做
    this._countClamp = function (wantX, wantY, gotX, gotY) {
        let peak = Math.max(Math.abs(wantX), Math.abs(wantY));
        if (peak > this.moveStats.maxWanted) {
            this.moveStats.maxWanted = peak;
        }
        if (wantX === gotX && wantY === gotY) {
            return;
        }
        this.moveStats.clamped++;
        this.moveStats.lostUnits += Math.abs(wantX - gotX) + Math.abs(wantY - gotY);
    }

    this.resetMoveStats = function () {
        this.moveStats.submitted = 0;
        this.moveStats.sent = 0;
        this.moveStats.clamped = 0;
        this.moveStats.lostUnits = 0;
        this.moveStats.maxWanted = 0;
        this.moveStats.totalWaitMs = 0;
        this.moveStats.maxWaitMs = 0;
        this.moveStats.since = Date.now();
        return "已清零，现在开始移动鼠标，之后运行 ch.reportMoveStats()";
    }

    this.reportMoveStats = function () {
        let s = this.moveStats;
        let seconds = (Date.now() - s.since) / 1000;
        function round(v, digits) {
            let f = Math.pow(10, digits);
            return Math.round(v * f) / f;
        }
        return {
            "统计时长(秒)": round(seconds, 1),
            "上层移动次数": s.submitted,
            "实际发出包数": s.sent,
            "被合并丢弃": s.submitted - s.sent,
            "丢弃占比": s.submitted ? round((s.submitted - s.sent) / s.submitted * 100, 1) + "%" : "-",
            "每秒发出包数": seconds > 0 ? round(s.sent / seconds, 1) : 0,
            "单包平均耗时(ms)": s.sent ? round(s.totalWaitMs / s.sent, 2) : 0,
            "单包最慢(ms)": s.maxWaitMs,
            "被±127截断的包": s.clamped,
            "截断丢掉的位移": s.lostUnits,
            "单轴最大请求位移": s.maxWanted,
            // 分母用 submitted 而不是 sent：截断发生在提交那一刻，被合并掉的
            // 包同样经历过截断。用 sent 当分母会算出超过 100% 的怪数字
            "截断占比": s.submitted ? round(s.clamped / s.submitted * 100, 1) + "%" : "-"
        };
    }

    this.getInfo = async function () {
        let frame = await this._enqueue({
            packet: this.toUnit8Array([0x57, 0xAB, this.ADDR, 0x01, 0x00]),
            retries: 1
        });
        if (!frame || frame.cmd !== 0x81 || !frame.data || frame.data.length < 4) {
            return null;
        }
        let version = frame.data[0];
        let led = frame.data[2];
        return {
            version: "V" + (version >> 4) + "." + (version & 0x0f),
            usbConnected: frame.data[1] === 0x01,
            numLock: (led & 0x01) !== 0,
            capsLock: (led & 0x02) !== 0,
            scrollLock: (led & 0x04) !== 0,
            asleep: frame.data[3] === 0x03
        };
    }

    this.queryCapsLock = async function () {
        let info = await this.getInfo();
        return info ? info.capsLock : null;
    }

    // CMD_GET_PARA_CFG：返回 50 字节配置，波特率在第 3-6 字节，高字节在前
    this.PARA_CFG_LENGTH = 50;
    this.PARA_CFG_BAUD_OFFSET = 3;

    this.getParaCfg = async function () {
        let frame = await this._enqueue({
            packet: this.toUnit8Array([0x57, 0xAB, this.ADDR, 0x08, 0x00]),
            retries: 1
        });
        // CH9329F 会多回 15 个字节的补零，所以是「不少于 50」而不是「正好 50」。
        // 有用的配置项都在前 50 字节里，写回去时也只写这 50 个（协议规定的长度）
        if (!frame || frame.cmd !== 0x88 || !frame.data || frame.data.length < this.PARA_CFG_LENGTH) {
            return null;
        }
        return frame.data.slice(0, this.PARA_CFG_LENGTH);
    }

    this.readParaBaudRate = function (cfg) {
        let o = this.PARA_CFG_BAUD_OFFSET;
        return ((cfg[o] << 24) | (cfg[o + 1] << 16) | (cfg[o + 2] << 8) | cfg[o + 3]) >>> 0;
    }

    this.setParaCfg = async function (cfg) {
        let data = [0x57, 0xAB, this.ADDR, 0x09, this.PARA_CFG_LENGTH];
        for (let i = 0; i < this.PARA_CFG_LENGTH; i++) {
            data.push(cfg[i]);
        }
        let frame = await this._enqueue({packet: this.toUnit8Array(data), retries: 1});
        if (!frame || frame.cmd !== 0x89) {
            return {ok: false, status: frame ? frame.data[0] : null};
        }
        return {ok: frame.data[0] === 0x00, status: frame.data[0]};
    }

    this.reset = function () {
        return this._enqueue({
            packet: this.toUnit8Array([0x57, 0xAB, this.ADDR, 0x0F, 0x00]),
            retries: 0
        });
    }

    this.setBaudRate = async function (baud) {
        // 只许写探测列表里的值。写了别的，下次连接就找不回芯片，而恢复出厂
        // 配置本身也要求能和芯片通信——等于没有软件退路了
        if (Ch9329.BAUD_RATES.indexOf(baud) === -1) {
            return {
                ok: false,
                reason: "不支持的波特率 " + baud + "，写进去之后连接时探测不到，芯片会失联"
            };
        }
        let cfg = await this.getParaCfg();
        if (!cfg) {
            return {ok: false, reason: "读取芯片参数配置失败"};
        }
        if (this.readParaBaudRate(cfg) === baud) {
            return {ok: true, unchanged: true};
        }
        let next = new Uint8Array(cfg);
        // 读回的工作模式/串口模式带 0x80 表示由硬件引脚决定，但设置命令只接受 0x00-0x03 / 0x00-0x02
        next[0] = cfg[0] & 0x7f;
        next[1] = cfg[1] & 0x7f;
        if (next[0] > 0x03 || next[1] > 0x02) {
            return {ok: false, reason: "芯片当前工作模式超出可设置范围，已放弃写入"};
        }
        let o = this.PARA_CFG_BAUD_OFFSET;
        next[o] = (baud >>> 24) & 0xff;
        next[o + 1] = (baud >>> 16) & 0xff;
        next[o + 2] = (baud >>> 8) & 0xff;
        next[o + 3] = baud & 0xff;
        let result = await this.setParaCfg(next);
        if (!result.ok) {
            let status = result.status == null ? "无应答" : "0x" + result.status.toString(16);
            return {ok: false, reason: "写入参数配置失败（" + status + "）"};
        }
        return {ok: true};
    }

    // 0x80-0x83 表示模式由硬件引脚决定，低 7 位才是模式号本身
    this.readParaWorkingMode = function (cfg) {
        return cfg[0] & 0x7f;
    }

    // 工作模式：0=键盘+鼠标+自定义HID（出厂默认），1=键盘，2=键盘+鼠标，3=自定义HID。
    // macOS/Linux/Android 下厂商建议用 2。模式 0 是三功能复合设备，macOS 绑不上
    // 里面的相对鼠标，症状是相对模式完全没反应、绝对模式又拖不动。
    this.setWorkingMode = async function (mode) {
        // 不能只比大小：null >= 0 是 true，会被 Uint8Array 悄悄当成模式 0 写进芯片
        if (!Number.isInteger(mode) || mode < 0x00 || mode > 0x03) {
            return {ok: false, reason: "工作模式只能是 0-3"};
        }
        let cfg = await this.getParaCfg();
        if (!cfg) {
            return {ok: false, reason: "读取芯片参数配置失败"};
        }
        if (this.readParaWorkingMode(cfg) === mode) {
            return {ok: true, unchanged: true};
        }
        let next = new Uint8Array(cfg);
        next[0] = mode;
        // 串口模式同样可能带 0x80，而设置命令只接受 0x00-0x02
        next[1] = cfg[1] & 0x7f;
        if (next[1] > 0x02) {
            return {ok: false, reason: "芯片当前串口模式超出可设置范围，已放弃写入"};
        }
        let result = await this.setParaCfg(next);
        if (!result.ok) {
            let status = result.status == null ? "无应答" : "0x" + result.status.toString(16);
            return {ok: false, reason: "写入参数配置失败（" + status + "）"};
        }
        return {ok: true};
    }

    // CMD_SET_DEFAULT_CFG：参数配置和字符串描述符全部恢复出厂默认。
    // 波特率会回到 9600、工作模式回到 0，和其它配置一样要下次上电才生效。
    // 这是配置写坏时的退路，所以即使芯片状态已经很糟也要能发出去。
    this.restoreDefaultCfg = async function () {
        let frame = await this._enqueue({
            packet: this.toUnit8Array([0x57, 0xAB, this.ADDR, 0x0C, 0x00]),
            retries: 1
        });
        if (!frame || frame.cmd !== 0x8C) {
            return {ok: false, status: frame ? frame.data[0] : null};
        }
        return {ok: frame.data[0] === 0x00, status: frame.data[0]};
    }

    // false 表示芯片持续无应答、已降级为只发不等
    this.isAckEnabled = function () {
        return !!reader && this._ackSupported;
    }

    // 页面靠它决定要不要开指针锁定：绝对模式需要真实光标坐标，锁了就没法用了
    this.isMouseAbsolute = function () {
        return !!mouseAbsolute;
    }

    // false 表示串口已经写不进去了，后续命令直接丢弃而不是逐个抛错
    this.isConnected = function () {
        return !this._transportBroken;
    }

    this.markDisconnected = function () {
        this._transportBroken = true;
        let pending = this._queue;
        this._queue = [];
        for (let i = 0; i < pending.length; i++) {
            if (pending[i].resolve) {
                pending[i].resolve(null);
            }
        }
    }

    this.dispose = async function () {
        this._queue = [];
        try {
            if (reader) {
                await reader.cancel();
                reader.releaseLock();
            }
        } catch (e) {
        }
        try {
            if (writer) {
                writer.releaseLock();
            }
        } catch (e) {
        }
    }

    this.ensureCapsLockOff = async function () {
        let capsOn = await this.queryCapsLock();
        if (capsOn !== true) {
            return false;
        }
        await this.tapKey(0x39, false);
        await new Promise(function (resolve) {
            setTimeout(resolve, 60);
        });
        return true;
    }

    // 可打印字符 -> { code, shift }；仅覆盖 US 键盘常见字符（粘贴中文会跳过）
    this.resolveTypeChar = function (ch) {
        if (ch === "\n" || ch === "\r") {
            return {code: 0x28, shift: false};
        }
        if (ch === "\t") {
            return {code: 0x2B, shift: false};
        }
        if (ch === " ") {
            return {code: 0x2C, shift: false};
        }
        const shifted = {
            "!": 0x1E, "@": 0x1F, "#": 0x20, "$": 0x21, "%": 0x22, "^": 0x23,
            "&": 0x24, "*": 0x25, "(": 0x26, ")": 0x27, "_": 0x2D, "+": 0x2E,
            "{": 0x2F, "}": 0x30, "|": 0x31, ":": 0x33, "\"": 0x34, "~": 0x35,
            "<": 0x36, ">": 0x37, "?": 0x38
        };
        if (Object.prototype.hasOwnProperty.call(shifted, ch)) {
            return {code: shifted[ch], shift: true};
        }
        if (ch >= "A" && ch <= "Z") {
            return {code: Ch9329.KEYBOARD_MAP[ch.toLowerCase()], shift: true};
        }
        if (ch >= "a" && ch <= "z") {
            return {code: Ch9329.KEYBOARD_MAP[ch], shift: false};
        }
        if (ch >= "0" && ch <= "9") {
            return {code: Ch9329.KEYBOARD_MAP[ch], shift: false};
        }
        const unshifted = {
            "-": 0x2D, "=": 0x2E, "[": 0x2F, "]": 0x30, "\\": 0x31,
            ";": 0x33, "'": 0x34, "`": 0x35, ",": 0x36, ".": 0x37, "/": 0x38
        };
        if (Object.prototype.hasOwnProperty.call(unshifted, ch)) {
            return {code: unshifted[ch], shift: false};
        }
        return null;
    }

    // 协议要求「按下包 + 释放包」成对；有应答时按应答节奏推进，无应答时补一点间隔
    this.tapKey = async function (code, shift) {
        let mod = shift ? 0x02 : 0x00;
        let data = [0x57, 0xAB, this.ADDR, 0x02, 0x08, mod, 0x00, code, 0x00, 0x00, 0x00, 0x00, 0x00];
        let acked = await this.write(this.toUnit8Array(data));
        if (!acked) {
            await new Promise(function (resolve) {
                setTimeout(resolve, 20);
            });
        }
        await this.write(this.keyboardReleasePacket);
        if (!acked) {
            await new Promise(function (resolve) {
                setTimeout(resolve, 20);
            });
        }
    }

    this.typeText = async function (text) {
        if (!text) {
            return {typed: 0, skipped: 0, capsToggled: false};
        }
        let capsToggled = false;
        try {
            capsToggled = await this.ensureCapsLockOff();
        } catch (e) {
            capsToggled = false;
        }
        let typed = 0;
        let skipped = 0;
        for (let i = 0; i < text.length; i++) {
            let info = this.resolveTypeChar(text.charAt(i));
            if (!info || info.code == null) {
                skipped++;
                continue;
            }
            await this.tapKey(info.code, info.shift);
            typed++;
        }
        return {typed: typed, skipped: skipped, capsToggled: capsToggled};
    }

    this.sendCtrlAltDelete = async function () {
        // 修饰位：bit0 LCtrl | bit2 LAlt = 0x05，普通键 Delete = 0x4C
        let data = [0x57, 0xAB, this.ADDR, 0x02, 0x08, 0x05, 0x00, 0x4C, 0x00, 0x00, 0x00, 0x00, 0x00];
        await this.write(this.toUnit8Array(data));
        this.releaseAllKeys();
    }

    this.clicked = {command: 0x00};
    this.lastAbsX = 0;
    this.lastAbsY = 0;
    this._downAbsX = 0;
    this._downAbsY = 0;
    this._clickArmed = false;

    this.mouseRelativeClickLeft = function () {
        this.clicked.command = 0x01;
        this.sendRelativePacket(0x01, 0, 0, 0);
    }

    this.mouseRelativeClickRight = function () {
        this.clicked.command = 0x02;
        this.sendRelativePacket(0x02, 0, 0, 0);
    }

    this.mouseRelativeClickMiddle = function () {
        this.clicked.command = 0x04;
        this.sendRelativePacket(0x04, 0, 0, 0);
    }

    // CMD_SEND_MS_ABS_DATA：02 + 按键 + X(小端) + Y(小端) + 滚轮
    this.sendAbsolutePacket = function (buttons, wheel, asMove) {
        let xHighLow = this.hexHeightLow(this.lastAbsX);
        let yHighLow = this.hexHeightLow(this.lastAbsY);
        let data = [0x57, 0xAB, this.ADDR, 0x04, 0x07, 0x02, buttons, xHighLow[0], xHighLow[1], yHighLow[0], yHighLow[1], wheel & 0xff];
        let packet = this.toUnit8Array(data);
        return asMove ? this.writeMove(packet) : this.write(packet);
    }

    // CMD_SEND_MS_REL_DATA：01 + 按键 + dx + dy + 滚轮（dx/dy 为补码，范围 -127..127）
    this.sendRelativePacket = function (buttons, dx, dy, wheel, asMove) {
        let data = [0x57, 0xAB, this.ADDR, 0x05, 0x05, 0x01, buttons, dx & 0xff, dy & 0xff, wheel & 0xff];
        let packet = this.toUnit8Array(data);
        return asMove ? this.writeMove(packet) : this.write(packet);
    }

    this.hexHeightLow = function hexHeightLow(val) {
        let high = ((val >> 8) & 0xff); //高8位
        let low = (val & 0xff); //低8位
        return [low, high];
    }

    this.clamp = function (value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    this.getContentRect = function (videoEl) {
        let rect = videoEl.getBoundingClientRect();
        let vw = videoEl.videoWidth || 0;
        let vh = videoEl.videoHeight || 0;
        let fit = (window.getComputedStyle(videoEl).objectFit || "fill").toLowerCase();
        if (!vw || !vh || fit === "fill" || fit === "none") {
            return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
        }
        let scale = fit === "cover"
            ? Math.max(rect.width / vw, rect.height / vh)
            : Math.min(rect.width / vw, rect.height / vh);
        let contentWidth = vw * scale;
        let contentHeight = vh * scale;
        return {
            left: rect.left + (rect.width - contentWidth) / 2,
            top: rect.top + (rect.height - contentHeight) / 2,
            width: contentWidth,
            height: contentHeight
        };
    }

    this.mapToAbsolute = function (videoEl, clientX, clientY) {
        let content = this.getContentRect(videoEl);
        if (content.width <= 0 || content.height <= 0) {
            return {x: this.lastAbsX, y: this.lastAbsY};
        }
        let nx = (clientX - content.left) / content.width;
        let ny = (clientY - content.top) / content.height;
        nx = this.clamp(nx, 0, 1);
        ny = this.clamp(ny, 0, 1);
        // 协议：X = 4096 * x / X_MAX，上限收到 4095 以免越过 12 位坐标域
        return {
            x: this.clamp(Math.floor(nx * 4096), 0, 4095),
            y: this.clamp(Math.floor(ny * 4096), 0, 4095)
        };
    }

    this.forceReleaseAllMouse = function () {
        this.clicked.command = 0x00;
        this._clickArmed = false;
        if (mouseAbsolute) {
            return this.sendAbsolutePacket(0x00, 0x00);
        }
        return this.sendRelativePacket(0x00, 0, 0, 0);
    }

    this.forceReleaseAllInput = function () {
        this.forceReleaseAllMouse();
        this.releaseAllKeys();
    }

    this.mouseMove = function (videoEl, clientX, clientY) {
        let point = this.mapToAbsolute(videoEl, clientX, clientY);

        if (!mouseAbsolute) {
            // 相对模式：按视口位移下发 dx/dy，协议限定单包 -127..127
            if (this._lastClientX == null) {
                this._lastClientX = clientX;
                this._lastClientY = clientY;
                return;
            }
            let wantX = Math.round(clientX - this._lastClientX);
            let wantY = Math.round(clientY - this._lastClientY);
            let rdx = this.clamp(wantX, -127, 127);
            let rdy = this.clamp(wantY, -127, 127);
            this._countClamp(wantX, wantY, rdx, rdy);
            this._lastClientX = clientX;
            this._lastClientY = clientY;
            this.lastAbsX = point.x;
            this.lastAbsY = point.y;
            if (rdx === 0 && rdy === 0) {
                return;
            }
            if (this.clicked.command !== 0x00 && this._clickArmed) {
                this._clickArmed = false;
            }
            this.sendRelativePacket(this.clicked.command, rdx, rdy, 0, true);
            return;
        }

        // 按住时先锁在按下点，位移超过死区才算拖拽，避免手抖把点击变成拖拽。
        // 死区按客户端像素算：抖动来自手，和被控端分辨率无关。
        // （早先是在 0..4095 坐标系里比，16:9 下横向阈值是纵向的近两倍，是个椭圆）
        if (this.clicked.command !== 0x00 && this._clickArmed) {
            let dx = clientX - this._downClientX;
            let dy = clientY - this._downClientY;
            let limit = Ch9329.DRAG_DEAD_ZONE_PX;
            if ((dx * dx + dy * dy) < (limit * limit)) {
                return;
            }
            this._clickArmed = false;
        }

        if (point.x === this.lastAbsX && point.y === this.lastAbsY) {
            return;
        }
        this.lastAbsX = point.x;
        this.lastAbsY = point.y;
        // 队列只保留最新一个移动包，按键包不会被移动流淹没
        this.sendAbsolutePacket(this.clicked.command, 0x00, true);
    }

    // 指针锁定时浏览器直接给出位移，不用再按光标位置差分。锁定后光标不受
    // 屏幕边界限制，正好补上相对模式最大的短板：本机光标顶到屏幕边缘后，
    // clientX 不再变化，被控端光标就跟着卡在那边走不动了。
    // 单包只能带 ±127，甩得特别快时超出的部分会被截掉。
    this.mouseMoveBy = function (dx, dy) {
        if (mouseAbsolute) {
            return;
        }
        let wantX = Math.round(dx);
        let wantY = Math.round(dy);
        let rdx = this.clamp(wantX, -127, 127);
        let rdy = this.clamp(wantY, -127, 127);
        this._countClamp(wantX, wantY, rdx, rdy);
        if (rdx === 0 && rdy === 0) {
            return;
        }
        if (this.clicked.command !== 0x00 && this._clickArmed) {
            this._clickArmed = false;
        }
        return this.sendRelativePacket(this.clicked.command, rdx, rdy, 0, true);
    }

    // 指针解锁后光标会重新出现，位置和锁定前不连续，下一次移动必须重新取
    // 基准，否则那一下差分会把被控端光标甩出去一大段
    this.resetRelativeOrigin = function () {
        this._lastClientX = null;
        this._lastClientY = null;
    }

    this.mouseButtonDown = function (videoEl, clientX, clientY, buttons) {
        let point = this.mapToAbsolute(videoEl, clientX, clientY);
        this._lastClientX = clientX;
        this._lastClientY = clientY;
        this.lastAbsX = point.x;
        this.lastAbsY = point.y;
        this._downAbsX = point.x;
        this._downAbsY = point.y;
        this._downClientX = clientX;
        this._downClientY = clientY;
        // 先强制松所有键，清掉被控端可能卡住的鼠标键/修饰键残留；
        // 它会清空 _clickArmed，所以死区标记必须在它之后再置位
        this.forceReleaseAllMouse();

        this._clickArmed = true;
        this.clicked.command = buttons;
        if (mouseAbsolute) {
            this.sendAbsolutePacket(buttons, 0x00);
            return;
        }
        if (buttons === 0x01) {
            this.mouseRelativeClickLeft();
        } else if (buttons === 0x02) {
            this.mouseRelativeClickRight();
        } else if (buttons === 0x04) {
            this.mouseRelativeClickMiddle();
        }
    }

    this.mouseButtonUp = function (button) {
        // 无论本地是否认为按着，抬起都强制发释放包，避免被控端键卡住
        if (button !== 0 && button !== 1 && button !== 2) {
            this.forceReleaseAllMouse();
            return;
        }
        let wasClick = this._clickArmed;
        this._clickArmed = false;
        this.clicked.command = 0x00;

        if (mouseAbsolute) {
            if (wasClick) {
                this.lastAbsX = this._downAbsX;
                this.lastAbsY = this._downAbsY;
            }
            this.sendAbsolutePacket(0x00, 0x00);
            return;
        }
        this.sendRelativePacket(0x00, 0, 0, 0);
    }

    // notches 为有符号齿数，正数向上、负数向下；
    // 协议用补码表示：0x01-0x7F 向上，0x81-0xFF 向下，单位都是齿数
    this.mouseScroll = function (notches) {
        let count = Math.trunc(notches) || 0;
        if (count === 0) {
            return;
        }
        let wheel = this.clamp(count, -127, 127) & 0xff;
        if (mouseAbsolute) {
            return this.sendAbsolutePacket(this.clicked.command, wheel);
        }
        return this.sendRelativePacket(this.clicked.command, 0, 0, wheel);
    }
}

// 按住鼠标后要移动超过这么多客户端像素才算拖拽，小于它的位移当作原地点击。
// Windows 自己的拖拽阈值是 4px，这里略放宽一点，因为画面通常是缩放显示的。
// 手感不对可以在控制台直接改，例如 Ch9329.DRAG_DEAD_ZONE_PX = 4
Ch9329.DRAG_DEAD_ZONE_PX = 6;

// 不等应答发送时，两包之间要留的空闲间隔。协议里芯片默认「超过 3ms 未收到
// 下一个字节就算本包结束」，留不够包会被粘在一起。
Ch9329.PACKET_GAP_MS = 4;

// 探测列表。设置页的下拉框也由它生成，所以它同时是「允许写入芯片」的白名单：
// 写进一个探测不到的值，芯片就再也连不上了——连「恢复出厂配置」都得先能通信。
//
// 取值是 CH9329F 与常见高速串口芯片（CH343）两边都支持的交集，上限压在 2M：
// CH343 是全速 USB，手册明确建议避开 3Mbps 及以上的连续通讯。CH9329F 自己标称
// 到 15M，但那要配更快的串口芯片才有意义。
//
// 原版 CH9329（无 F 后缀）只支持到 115200，给它写更高的值会连不上。
//
// 数组顺序就是探测顺序，常用的排前面；上次连上的那个会被 baudRateOrder 提到最前。
Ch9329.BAUD_RATES = [9600, 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000];

// 浏览器里靠 <script> 全局引入；这里只是让 node 下的测试能 require
if (typeof module !== "undefined" && module.exports) {
    module.exports = Ch9329;
}

// 依次用候选波特率打开串口，取第一个能应答 GET_INFO 的；
// 全部不应答时退回首选波特率，保持「只发不等」的可用状态
Ch9329.connect = async function (port, baudRates, mouseAbsolute) {
    // 每个候选波特率的结果都记下来，失败时才能说清是打不开还是打开了没人应答
    let attempts = [];

    async function closePort() {
        if (port.readable || port.writable) {
            try {
                await port.close();
            } catch (e) {
            }
        }
    }

    for (let i = 0; i < baudRates.length; i++) {
        await closePort();
        try {
            await port.open({baudRate: baudRates[i]});
        } catch (e) {
            attempts.push({baudRate: baudRates[i], outcome: "open-failed", error: e});
            continue;
        }
        let ch = new Ch9329(port.writable.getWriter(), mouseAbsolute, port.readable.getReader());
        let info = await ch.getInfo();
        if (info) {
            attempts.push({baudRate: baudRates[i], outcome: "ok"});
            return {ch: ch, info: info, baudRate: baudRates[i], probed: true, attempts: attempts};
        }
        attempts.push({baudRate: baudRates[i], outcome: "no-reply"});
        await ch.dispose();
    }

    await closePort();
    try {
        await port.open({baudRate: baudRates[0]});
    } catch (e) {
        // 走到这里说明连端口都打不开，不是波特率的问题。attempts 里已经
        // 逐个记好了，翻成一句能照着做的提示再抛，别把浏览器的生硬报错扔给用户
        let error = new Error(Ch9329.explainConnectFailure(attempts));
        error.attempts = attempts;
        error.cause = e;
        throw error;
    }
    return {
        ch: new Ch9329(port.writable.getWriter(), mouseAbsolute, port.readable.getReader()),
        info: null,
        baudRate: baudRates[0],
        probed: false,
        attempts: attempts
    };
}

// 把探测结果翻成一句人话，给界面提示用
Ch9329.describeAttempts = function (attempts) {
    if (!attempts || !attempts.length) {
        return "没有可尝试的波特率";
    }
    return attempts.map(function (a) {
        if (a.outcome === "open-failed") {
            let message = a.error && a.error.message ? a.error.message : String(a.error);
            return a.baudRate + " 打不开串口（" + message + "）";
        }
        if (a.outcome === "no-reply") {
            return a.baudRate + " 打开成功但芯片无应答";
        }
        return a.baudRate + " 正常";
    }).join("；");
}

// 全部候选波特率都连不上时，说清到底卡在哪一步。
// 「每个都打不开」和「打开了但没人应答」是两码事：前者是端口本身用不了，
// 绝大多数时候是被另一个标签页占着；后者才是接线或芯片的问题。
Ch9329.explainConnectFailure = function (attempts) {
    let list = attempts || [];
    let detail = Ch9329.describeAttempts(list);
    let allOpenFailed = list.length > 0 && list.every(function (a) {
        return a.outcome === "open-failed";
    });
    if (!allOpenFailed) {
        return "连接 CH9329 失败。\n\n详细信息：" + detail;
    }
    return "打不开串口。\n\n"
        + "串口是独占的，同一个设备同时只能被一个页面打开。请关掉其它开着本站的"
        + "标签页（尤其是设置页），只留这一个，然后刷新重试。\n\n"
        + "都关了还不行的话，把 CH9329 拔下来重插。\n\n"
        + "详细信息：" + detail;
}

// ===== 查表常量：不可变，放在实例外面，避免每次 new 都重建 =====
// 键码表很长但只是查表，放在最后，打开文件先看到的是驱动逻辑

// 键码 -> USB HID 用法号
Ch9329.KEYBOARD_MAP = {
    8: 0x2A,  // Back
    9: 0x2B,  // Tab
    13: 0x28,  // Enter
    19: 0x48,  //Pause
    20: 0x39,  //Caps Lock
    27: 0x29,  //Escape
    32: 0x2C,  // Space
    33: 0x4B,  // PageUp
    34: 0x4E,  // Next
    35: 0x4D,  // End
    36: 0x4A,  // Home
    37: 0x50,  // Left
    38: 0x52,  // Up
    39: 0x4F,  // Right
    40: 0x51,  // Down
    44: 0x46,  // PrintScreen
    45: 0x49,  // Insert
    46: 0x4C,  // Delete
    48: 0x27,  // 0
    49: 0x1E,  // 1
    50: 0x1F,  // 2
    51: 0x20,  // 3
    52: 0x21,  // 4
    53: 0x22,  // 5
    54: 0x23,  // 6
    55: 0x24,  // 7
    56: 0x25,  // 8
    57: 0x26,  // 9
    65: 0x04,  // A
    66: 0x05,  // B
    67: 0x06,  // C
    68: 0x07,  // D
    69: 0x08,  // E
    70: 0x09,  // F
    71: 0x0A,  // G
    72: 0x0B,  // H
    73: 0x0C,  // I
    74: 0x0D,  // J
    75: 0x0E,  // K
    76: 0x0F,  // L
    77: 0x10,  // M
    78: 0x11,  // N
    79: 0x12,  // O
    80: 0x13,  // P
    81: 0x14,  // Q
    82: 0x15,  // R
    83: 0x16,  // S
    84: 0x17,  // T
    85: 0x18,  // U
    86: 0x19,  // V
    87: 0x1A,  // W
    88: 0x1B,  // X
    89: 0x1C,  // Y
    90: 0x1D,  // Z
    91: 0xE3,  // LWin
    93: 0x65,  // Applications
    96: 0x62,  // NumPad 0
    97: 0x59,  // NumPad 1
    98: 0x5A,  // NumPad 2
    99: 0x5B,  // NumPad 3
    100: 0x5C,  // NumPad 4
    101: 0x5D,  // NumPad 5
    102: 0x5E,  // NumPad 6
    103: 0x5F,  // NumPad 7
    104: 0x60,  // NumPad 8
    105: 0x61,  // NumPad 9
    106: 0x55,  // NumPad Multiply
    107: 0x57,  // NumPad Add
    109: 0x56,  // NumPad Subtract
    110: 0x63,  // NumPad Decimal
    111: 0x54,  // NumPad Divide
    112: 0x3A,  // F1
    113: 0x3B,  // F2
    114: 0x3C,  // F3
    115: 0x3D,  // F4
    116: 0x3E,  // F5
    117: 0x3F,  // F6
    118: 0x40,  // F7
    119: 0x41,  // F8
    120: 0x42,  // F9
    121: 0x43,  // F10
    122: 0x44,  // F11
    123: 0x45,  // F12
    144: 0x53,  // NumLock
    16: 0xE1,  // LShiftKey
    161: 0xE5,  // RShiftKey
    17: 0xE0,  // LControlKey
    163: 0xE4,  // RControlKey
    18: 0xE2,  // LAlt
    165: 0xE6,  // Ralt
    186: 0x33,  // ;
    187: 0x2E,  // =
    188: 0x36,  // ,
    189: 0x2D,  // -
    190: 0x37,  // .
    191: 0x38,  // /
    192: 0x35,  // `
    219: 0x2F,  // [
    220: 0x31,  // \
    221: 0x30,  // ]
    222: 0x34,  // '

    "Backspace": 0x2A,  // Back
    "Tab": 0x2B,  // Tab
    "Enter": 0x28,  // Enter
    "Pause": 0x48,  //Pause
    "CapsLock": 0x39,  //Caps Lock
    "Escape": 0x29,  //Escape
    "Space": 0x2C,  // Space
    "PageUp": 0x4B,  // PageUp
    "PageDown": 0x4E,  // Next
    "End": 0x4D,  // End
    "Home": 0x4A,  // Home
    "ArrowLeft": 0x50,  // Left
    "ArrowUp": 0x52,  // Up
    "ArrowRight": 0x4F,  // Right
    "ArrowDown": 0x51,  // Down
    "PrintScreen": 0x46,  // PrintScreen
    "Insert": 0x49,  // Insert
    "Delete": 0x4C,  // Delete
    "Digit0": 0x27,  // 0
    "Digit1": 0x1E,  // 1
    "Digit2": 0x1F,  // 2
    "Digit3": 0x20,  // 3
    "Digit4": 0x21,  // 4
    "Digit5": 0x22,  // 5
    "Digit6": 0x23,  // 6
    "Digit7": 0x24,  // 7
    "Digit8": 0x25,  // 8
    "Digit9": 0x26,  // 9
    "KeyA": 0x04,  // A
    "KeyB": 0x05,  // B
    "KeyC": 0x06,  // C
    "KeyD": 0x07,  // D
    "KeyE": 0x08,  // E
    "KeyF": 0x09,  // F
    "KeyG": 0x0A,  // G
    "KeyH": 0x0B,  // H
    "KeyI": 0x0C,  // I
    "KeyJ": 0x0D,  // J
    "KeyK": 0x0E,  // K
    "KeyL": 0x0F,  // L
    "KeyM": 0x10,  // M
    "KeyN": 0x11,  // N
    "KeyO": 0x12,  // O
    "KeyP": 0x13,  // P
    "KeyQ": 0x14,  // Q
    "KeyR": 0x15,  // R
    "KeyS": 0x16,  // S
    "KeyT": 0x17,  // T
    "KeyU": 0x18,  // U
    "KeyV": 0x19,  // V
    "KeyW": 0x1A,  // W
    "KeyX": 0x1B,  // X
    "KeyY": 0x1C,  // Y
    "KeyZ": 0x1D,  // Z
    "MetaLeft": 0xE3,  // LWin
    "ContextMenu": 0x65,  // 菜单键（HID Keyboard Application）
    "Numpad0": 0x62,  // NumPad 0
    "Numpad1": 0x59,  // NumPad 1
    "Numpad2": 0x5A,  // NumPad 2
    "Numpad3": 0x5B,  // NumPad 3
    "Numpad4": 0x5C,  // NumPad 4
    "Numpad5": 0x5D,  // NumPad 5
    "Numpad6": 0x5E,  // NumPad 6
    "Numpad7": 0x5F,  // NumPad 7
    "Numpad8": 0x60,  // NumPad 8
    "Numpad9": 0x61,  // NumPad 9
    "NumpadMultiply": 0x55,  // NumPad Multiply
    "NumpadAdd": 0x57,  // NumPad Add
    "NumpadSubtract": 0x56,  // NumPad Subtract
    "NumpadDecimal": 0x63,  // NumPad Decimal
    "NumpadDivide": 0x54,  // NumPad Divide
    "F1": 0x3A,  // F1
    "F2": 0x3B,  // F2
    "F3": 0x3C,  // F3
    "F4": 0x3D,  // F4
    "F5": 0x3E,  // F5
    "F6": 0x3F,  // F6
    "F7": 0x40,  // F7
    "F8": 0x41,  // F8
    "F9": 0x42,  // F9
    "F10": 0x43,  // F10
    "F11": 0x44,  // F11
    "F12": 0x45,  // F12
    "NumLock": 0x53,  // NumLock
    "ShiftLeft": 0xE1,  // LShiftKey
    "ShiftRight": 0xE5,  // RShiftKey
    "ControlLeft": 0xE0,  // LControlKey
    "ControlRight": 0xE4,  // RControlKey
    "AltLeft": 0xE2,  // LAlt
    "AltRight": 0xE6,  // Ralt
    "Semicolon": 0x33,  // ;
    "Equal": 0x2E,  // =
    "Comma": 0x36,  // ,
    "Minus": 0x2D,  // -
    "Period": 0x37,  // .
    "Slash": 0x38,  // /
    "Backquote": 0x35,  // `
    "BracketLeft": 0x2F,  // [
    "Backslash": 0x31,  // \
    "BracketRight": 0x30,  // ]
    "Quote": 0x34,   // '

    "Back": 0x2A,  // Back
    " ": 0x2C,  // Space
    "Next": 0x4E,  // Next
    "Left": 0x50,  // Left
    "Up": 0x52,  // Up
    "Right": 0x4F,  // Right
    "Down": 0x51,  // Down
    "0": 0x27,  // 0
    "1": 0x1E,  // 1
    "2": 0x1F,  // 2
    "3": 0x20,  // 3
    "4": 0x21,  // 4
    "5": 0x22,  // 5
    "6": 0x23,  // 6
    "7": 0x24,  // 7
    "8": 0x25,  // 8
    "9": 0x26,  // 9
    "a": 0x04,  // A
    "b": 0x05,  // B
    "c": 0x06,  // C
    "d": 0x07,  // D
    "e": 0x08,  // E
    "f": 0x09,  // F
    "g": 0x0A,  // G
    "h": 0x0B,  // H
    "i": 0x0C,  // I
    "j": 0x0D,  // J
    "k": 0x0E,  // K
    "l": 0x0F,  // L
    "m": 0x10,  // M
    "n": 0x11,  // N
    "o": 0x12,  // O
    "p": 0x13,  // P
    "q": 0x14,  // Q
    "r": 0x15,  // R
    "s": 0x16,  // S
    "t": 0x17,  // T
    "u": 0x18,  // U
    "v": 0x19,  // V
    "w": 0x1A,  // W
    "x": 0x1B,  // X
    "y": 0x1C,  // Y
    "z": 0x1D,  // Z
    "Shift": 0xE1,  // LShiftKey
    "Control": 0xE0,  // LControlKey
    "Alt": 0xE2,  // LAlt
    ";": 0x33,  // ;
    "=": 0x2E,  // =
    ",": 0x36,  // ,
    "-": 0x2D,  // -
    ".": 0x37,  // .
    "/": 0x38,  // /
    "`": 0x35,  // `
    "[": 0x2F,  // [
    "\\": 0x31,  // \
    "]": 0x30,  // ]
    "'": 0x34,   // '
    "!": 0x1E,   // !
    "@": 0x1F,   // @
    "#": 0x20,   // #
    "$": 0x21,   // $
    "%": 0x22,   // %
    "^": 0x23,   // ^
    "&": 0x24,   // &
    "*": 0x25,   // *
    "(": 0x26,   // (
    ")": 0x27,   // )
};

// 修饰键 -> USB HID 用法号
Ch9329.CONTROL_KEY_MAP = {
    16: 0xE1,  // LShiftKey
    161: 0xE5,  // RShiftKey
    17: 0xE0,  // LControlKey
    163: 0xE4,  // RControlKey
    18: 0xE2,  // LAlt
    165: 0xE6,  // Ralt
    "ShiftLeft": 0xE1,  // LShiftKey
    "ShiftRight": 0xE5,  // RShiftKey
    "ControlLeft": 0xE0,  // LControlKey
    "ControlRight": 0xE4,  // RControlKey
    "AltLeft": 0xE2,  // LAlt
    "AltRight": 0xE6,  // Ralt
    "MetaLeft": 0xE3,  // LWin
    "MetaRight": 0xE7,  // RWin
};

// 修饰键 -> USB HID 修饰位
Ch9329.CONTROL_KEY_BITS = {
    // USB HID modifier bitmasks
    16: 0x02,  // LShiftKey
    161: 0x20,  // RShiftKey
    17: 0x01,  // LControlKey
    163: 0x10,  // RControlKey
    18: 0x04,  // LAlt
    165: 0x40,  // RAlt
    "ShiftLeft": 0x02,
    "ShiftRight": 0x20,
    "ControlLeft": 0x01,
    "ControlRight": 0x10,
    "AltLeft": 0x04,
    "AltRight": 0x40,
    "MetaLeft": 0x08,
    "MetaRight": 0x80,
};
