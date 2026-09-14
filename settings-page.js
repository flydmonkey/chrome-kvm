// 设置页的页面逻辑：枚举设备、填下拉框、写波特率、存配置。
async function authUsb() {
    await navigator.serial.requestPort();
    window.location.reload();
}

async function authMedia() {
    navigator.mediaDevices.getUserMedia({video: true, audio: true})
        .then((stream) => {
            window.location.reload();
        })
}

function fillDeviceOptions(selector, list, savedDeviceId) {
    for (let i = 0; i < list.length; i++) {
        let device = list[i];
        let option = document.createElement("option");
        option.setAttribute("value", device.deviceId);
        option.innerText = device.label || ("未命名设备 " + String(device.deviceId).slice(0, 8));
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
    navigator.serial.getPorts()
        .then((ports) => {
            let selector = document.querySelector("#choice2");
            let saved = SettingsStore.savedUsbFilter(settings);
            for (let i = 0; i < ports.length; i++) {
                let port = ports[i];
                let info = port.getInfo();
                let htmlOptionElement = document.createElement("option");
                htmlOptionElement.setAttribute("value", JSON.stringify(info));
                htmlOptionElement.innerText = "usbProductId=" + info.usbProductId + "," + "usbVendorId=" + info.usbVendorId;
                if (saved
                    && saved.usbVendorId === info.usbVendorId
                    && saved.usbProductId === info.usbProductId) {
                    htmlOptionElement.setAttribute("selected", "selected");
                }
                selector.appendChild(htmlOptionElement);
            }
        })
        .catch(e => {
            alert(e.message);
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
        return "（芯片出厂默认）";
    }
    if (baud === 115200) {
        return "（推荐；原版 CH9329 的上限）";
    }
    return "（需 CH9329F + 高速串口芯片）";
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
    let settings = SettingsStore.readOrEmpty();
    let ports = await navigator.serial.getPorts();
    if (ports.length === 0) {
        alert("这个网址下还没有授权任何串口。请先点「授权控制器」。");
        return null;
    }

    let filter = selectedSerialFilter() || SettingsStore.savedUsbFilter(settings);
    let port = SettingsStore.matchPort(ports, filter);
    if (!port) {
        if (ports.length === 1) {
            port = ports[0];
        } else {
            alert("有多个已授权的串口，请先在上面的下拉框里选中 CH9329 那个再写入。");
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
        alert("CH9329 没有应答，无法写入。\n\n探测结果：" + detail
            + "\n\n如果显示「打不开串口」，多半是 KVM 页面还占着这个端口，先关掉其它标签页再试。");
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
        alert("写入失败：" + result.reason);
        return;
    }

    SettingsStore.patch({baudRate: target});
    if (result.unchanged) {
        alert("芯片波特率已经是 " + target + "，无需改动。");
        return;
    }
    alert("已写入 " + target + "。请把 CH9329 断电重插（拔掉 USB 再插回）后生效。");
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
        alert("写入失败：" + result.reason);
        return;
    }
    // 只有真正写进芯片才记下来，否则下拉框会显示一个芯片上并不存在的模式
    SettingsStore.patch({workingMode: target});
    if (result.unchanged) {
        alert("芯片工作模式已经是 " + target + "，无需改动。");
        return;
    }
    alert("已写入工作模式 " + target + "。请把 CH9329 断电重插（拔掉 USB 再插回）后生效。\n\n"
        + "被控端可能会把它当成一台新键盘而弹出识别向导，走完或关掉即可。");
}

async function restoreDefaults() {
    if (!confirm("这会把芯片的参数配置和字符串描述符全部恢复出厂默认：\n"
            + "波特率回到 9600，工作模式回到 0。\n\n确定继续吗？")) {
        return;
    }
    let result = await withChip(function (ch) {
        return ch.restoreDefaultCfg();
    });
    if (!result) {
        return;
    }
    if (!result.ok) {
        let status = result.status == null ? "无应答" : "0x" + result.status.toString(16);
        alert("恢复出厂配置失败（" + status + "）");
        return;
    }
    SettingsStore.patch({baudRate: 9600, workingMode: 0});
    alert("已恢复出厂配置。请把 CH9329 断电重插（拔掉 USB 再插回）后生效，之后波特率是 9600。");
}

function save() {
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
        mouseClickMode: "absolute",
        mouseModeVersion: 1,
        baudRate: parseInt(document.querySelector("#choice6").value) || 9600,
        // 工作模式是芯片里的状态，只有「写入工作模式」才会真正改它。这里带上
        // 已存的值，否则整体覆盖式的 write() 会把它抹掉，下拉框就回到模式 0 了
        workingMode: SettingsStore.readOrEmpty().workingMode
    };
    let mouseClickMode = document.querySelector("#choice5");
    if (mouseClickMode.value === "absolute" || mouseClickMode.value === "relative") {
        config.mouseClickMode = mouseClickMode.value;
    }

    if (!SettingsStore.write(config)) {
        alert("保存失败，浏览器可能禁用了本地存储");
        return;
    }
    alert("保存成功")
    window.location.reload();
}

function renderUsed() {
    let settings = SettingsStore.read();
    if (!settings) {
        return;
    }
    // 下拉框列的是「能选什么」，这里列的是「实际存了什么」，两者不一定一致
    let shown = 0;
    shown += showSavedLine("#usedVideo", "视频", settings.video);
    shown += showSavedLine("#usedAudio", "音频", settings.audio);
    shown += showSavedLine("#usedUsb", "控制器", settings.usb);
    if (shown > 0) {
        document.querySelector("#savedSection").style.display = "block";
    }
}

function showSavedLine(selector, name, device) {
    if (!device || !device.label) {
        return 0;
    }
    let element = document.querySelector(selector);
    element.innerHTML = name + "：<span></span>";
    element.querySelector("span").innerText = device.label;
    element.style.display = "block";
    return 1;
}

renderMedia();
renderUsb();
renderUsed();

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
