// 控制页：触屏手势、屏幕键盘，以及清掉早期版本留下的 Service Worker 缓存

// 触屏：手势规则在 touch-input.js，这里只负责把动作落到 Ch9329 上
function bindTouch() {
    let gestures = null;
    let longPressTimer = null;
    const BUTTONS = {left: {bits: 0x01, index: 0}, right: {bits: 0x02, index: 2}};

    function pressButton(action, button) {
        if (action.x != null) {
            panView(action.x, action.y);
            ch.mouseButtonDown(videoElement, action.x, action.y, button.bits);
            return;
        }
        // 相对模式的按键不带坐标；mouseButtonDown 会把传入的坐标记成差分基准，
        // 随便给个值会让之后的鼠标移动跳一大段，所以按完把基准清掉
        ch.mouseButtonDown(videoElement, 0, 0, button.bits);
        ch.resetRelativeOrigin();
    }

    function perform(actions) {
        if (!ch) {
            return;
        }
        actions.forEach(function (action) {
            let button = BUTTONS[action.button];
            if (action.type === "move") {
                panView(action.x, action.y);
                ch.mouseMove(videoElement, action.x, action.y);
            } else if (action.type === "moveBy") {
                ch.mouseMoveBy(action.dx, action.dy);
            } else if (action.type === "down") {
                pressButton(action, button);
            } else if (action.type === "up") {
                ch.mouseButtonUp(button.index);
            } else if (action.type === "click") {
                pressButton(action, button);
                ch.mouseButtonUp(button.index);
            } else if (action.type === "scroll") {
                ch.mouseScroll(action.notches);
            }
        });
    }

    videoElement.addEventListener("pointerdown", function (event) {
        if (event.pointerType !== "touch") {
            return;
        }
        // 不拦的话浏览器还会补发一套 mousedown/mouseup，同一下点击就发了两遍
        event.preventDefault();
        if (!ch) {
            return;
        }
        let absolute = ch.isMouseAbsolute();
        // 串口重连后鼠标模式可能变了，空闲时按当前模式重建
        if (!gestures || (!gestures.active() && gestures.absolute !== absolute)) {
            gestures = TouchInput.createGestures(absolute);
        }
        try {
            videoElement.setPointerCapture(event.pointerId);
        } catch (e) {
            // 拿不到捕获也能用，只是手指滑出画面后就收不到移动了
        }
        perform(gestures.down(event.pointerId, event.clientX, event.clientY, event.timeStamp));
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(function () {
            if (gestures) {
                perform(gestures.tick(performance.now()));
            }
        }, TouchInput.LONG_PRESS_MS + 20);
    });

    videoElement.addEventListener("pointermove", function (event) {
        if (event.pointerType !== "touch" || !gestures) {
            return;
        }
        perform(gestures.move(event.pointerId, event.clientX, event.clientY));
    });

    videoElement.addEventListener("pointerup", function (event) {
        if (event.pointerType !== "touch" || !gestures) {
            return;
        }
        perform(gestures.up(event.pointerId, event.clientX, event.clientY, event.timeStamp));
    });

    videoElement.addEventListener("pointercancel", function (event) {
        if (event.pointerType !== "touch" || !gestures) {
            return;
        }
        perform(gestures.cancel(event.pointerId));
    });
}

// 屏幕键盘：聚焦一个看不见的输入框把系统软键盘叫出来，打进去的字逐个敲给被控端。
// 只能打 US 键盘能直接打出的字符，和粘贴一样
let softKeyboardQueue = Promise.resolve();

function sendSoftKeys(task) {
    softKeyboardQueue = softKeyboardQueue.then(task).catch(function (e) {
        console.warn("屏幕键盘发送失败", e);
    });
}

function softTypeText(text) {
    sendSoftKeys(async function () {
        if (!ch || pasting || keyRepeating) {
            return;
        }
        for (const char of text) {
            let info = ch.resolveTypeChar(char);
            if (info && info.code != null) {
                await ch.tapKey(info.code, info.shift);
            }
        }
    });
}

function softTapKey(code) {
    sendSoftKeys(async function () {
        if (!ch || pasting || keyRepeating) {
            return;
        }
        await ch.tapCombo([code]);
    });
}

function toggleSoftKeyboard() {
    let input = document.getElementById("softKeyboard");
    if (document.activeElement === input) {
        input.blur();
    } else {
        // 手机上面板会挡住大半个画面，弹出键盘时让出来
        toggleShortcutPanel(false);
        input.focus();
    }
    // 窗口本身没有焦点时 focus/blur 事件不会派发，按钮状态按实际焦点定
    document.getElementById("softKeyboardButton").setAttribute("aria-pressed",
        String(document.activeElement === input));
}

(function bindSoftKeyboard() {
    let input = document.getElementById("softKeyboard");
    let button = document.getElementById("softKeyboardButton");
    if (!input || !button) {
        return;
    }
    // 只在有触摸屏的设备上露出按钮，桌面上有实体键盘用不着
    if (navigator.maxTouchPoints > 0) {
        button.hidden = false;
    }
    input.addEventListener("focus", function () {
        button.setAttribute("aria-pressed", "true");
    });
    input.addEventListener("blur", function () {
        button.setAttribute("aria-pressed", "false");
        input.value = "";
    });
    input.addEventListener("keydown", function (event) {
        let code = TouchInput.softKeyCode(event.key);
        if (code) {
            event.preventDefault();
            softTapKey(code);
        }
    });
    input.addEventListener("beforeinput", function (event) {
        let code = TouchInput.inputTypeKey(event.inputType);
        if (code && event.cancelable) {
            event.preventDefault();
            softTapKey(code);
        }
    });
    // 软键盘的联想输入会先「组字」，组完才是最终的字；组字期间框里的内容随时会变，
    // 所以只在不组字的时候把框里的字发出去再清空
    input.addEventListener("input", function (event) {
        if (event.isComposing) {
            return;
        }
        let text = input.value;
        input.value = "";
        if (text) {
            softTypeText(text);
        }
    });
    input.addEventListener("compositionend", function () {
        let text = input.value;
        input.value = "";
        if (text) {
            softTypeText(text);
        }
    });
})();

// 卸载 Service Worker 并清空 Cache Storage，不再使用 SW 缓存
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
