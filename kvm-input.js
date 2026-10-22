// 控制页：键盘鼠标事件转发给 CH9329，工具栏展开收起、全屏切换

function open() {
    if (window.__chromeKvmInputBound) {
        return;
    }
    window.__chromeKvmInputBound = true;

    videoElement.style.cursor = "none";
    document.addEventListener('keydown', (event) => {
        // 快捷键面板里填自定义快捷键时，按键是给输入框的，不能发给被控端
        if (isEditableTarget(event.target)) {
            return;
        }
        event.preventDefault()
        // 按住不放时本机会连发 keydown，但被控端只要收到「按下」就会自己按
        // 它的设置重复。再转发一遍只是重发同一份报告，低波特率下白白占串口。
        // 粘贴和连按期间用户的按键会和模拟敲键的报告互相覆盖，也先不转发
        if (!ch || event.repeat || pasting || keyRepeating) {
            return;
        }
        ch.keydown(event.code);
    })

    document.addEventListener('keyup', (event) => {
        if (isEditableTarget(event.target)) {
            return;
        }
        event.preventDefault();
        if (!ch || pasting || keyRepeating) {
            return;
        }
        ch.keyup(event.code);
    });

    // 累积滚动量再按齿数下发，保留滚动快慢；一格滚轮在 Chrome 里约 100px
    const WHEEL_PIXELS_PER_NOTCH = 100;
    let wheelPixels = 0;
    document.addEventListener('wheel', function (event) {
        if (!ch) {
            return;
        }
        let delta = event.deltaY;
        if (event.deltaMode === 1) {
            delta *= 16;   // 行
        } else if (event.deltaMode === 2) {
            delta *= 400;  // 页
        }
        wheelPixels += delta;
        let notches = Math.trunc(wheelPixels / WHEEL_PIXELS_PER_NOTCH);
        if (notches === 0) {
            return;
        }
        wheelPixels -= notches * WHEEL_PIXELS_PER_NOTCH;
        // 浏览器 deltaY 向下为正，协议齿数向上为正
        ch.mouseScroll(-notches);
    }, {passive: true});

    // 相对模式下位移靠光标位置差分算，本机光标一顶到屏幕边缘就不再变化，
    // 被控端光标也跟着走不动了。指针锁定把光标从边界里解放出来，并直接给
    // movementX/movementY。绝对模式要的是真实坐标，锁上反而没法用。
    function pointerLocked() {
        return document.pointerLockElement === videoElement;
    }

    function lockPointer() {
        if (!ch || ch.isMouseAbsolute() || pointerLocked()) {
            return;
        }
        // unadjustedMovement 关掉本机的指针加速：被控端自己还会再加一层，
        // 两层叠加会让鼠标很难控
        let pending;
        try {
            pending = videoElement.requestPointerLock({unadjustedMovement: true});
        } catch (e) {
            pending = null;
        }
        if (!pending || !pending.catch) {
            return;  // 老浏览器不返回 Promise，当作已经发起
        }
        pending.catch(function (first) {
            // 有的平台不支持免加速，退回普通锁定也比不锁强
            let retry;
            try {
                retry = videoElement.requestPointerLock();
            } catch (e) {
                pointerLockRejected = true;
                console.warn("指针锁定失败，相对模式下光标到屏幕边缘会走不动", e);
                renderStatus(lastInfo);
                return;
            }
            if (retry && retry.catch) {
                retry.catch(function (e) {
                    pointerLockRejected = true;
                    console.warn("指针锁定失败，相对模式下光标到屏幕边缘会走不动",
                        e || first);
                    renderStatus(lastInfo);
                });
            }
        });
    }

    // 锁定失败会走这里而不是抛异常，requestPointerLock 的 Promise 也可能
    // 早于它 reject，两条路都要收口
    document.addEventListener('pointerlockerror', function () {
        pointerLockRejected = true;
        renderStatus(lastInfo);
    });

    document.addEventListener('pointerlockchange', function () {
        if (pointerLocked()) {
            pointerLockRejected = false;
        } else if (ch) {
            // 解锁多半是按了 Esc，这时鼠标键的抬起事件收不到，先清干净。
            // 只在解锁时做：上锁时清会把用户刚按下的那个键也松掉，拖拽就断了
            ch.forceReleaseAllMouse();
            // 光标重新出现的位置和锁定前不连续，下次移动要重新取差分基准
            ch.resetRelativeOrigin();
        }
        renderStatus(lastInfo);
    });

    // mousemove 被浏览器对齐到画面刷新，一帧最多一次（实测间隔约 29ms），
    // 手已经动了，位移还要等到下一帧才发出去。pointerrawupdate 按鼠标硬件的
    // 回报率触发，能把这段等待省掉。事件密了也不怕：绝对坐标排队时只留最新
    // 的，相对位移排队时累加，都不会淹没串口。只在安全上下文里有，没有就退回
    const moveEvent = ('onpointerrawupdate' in window) ? 'pointerrawupdate' : 'mousemove';
    videoElement.addEventListener(moveEvent, (event) => {
        // 触摸有自己的一套手势，见 bindTouch
        if (event.pointerType === "touch") {
            return;
        }
        if (!pointerLocked()) {
            // 放大时先按指针把画面摆好，再换算坐标，两边才对得上
            panView(event.clientX, event.clientY);
        }
        if (!ch) {
            return;
        }
        if (pointerLocked()) {
            ch.mouseMoveBy(event.movementX, event.movementY);
            return;
        }
        ch.mouseMove(videoElement, event.clientX, event.clientY);
    });


    videoElement.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (!ch) {
            return;
        }
        let buttons = 0x00;
        if (event.button === 0) {
            buttons = 0x01;
        } else if (event.button === 1) {
            buttons = 0x04;
        } else if (event.button === 2) {
            buttons = 0x02;
        }
        if (buttons) {
            ch.mouseButtonDown(videoElement, event.clientX, event.clientY, buttons);
        }
        lockPointer();
    });
    videoElement.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    // 用 document 捕获，避免移出 video 时丢右键抬起；按 button 位释放
    document.addEventListener('mouseup', (event) => {
        if (!ch) {
            return;
        }
        ch.mouseButtonUp(event.button);
    });

    bindTouch();

    // 失焦/切走页面时强制松开所有键，防止被控端卡住
    window.addEventListener('blur', () => {
        if (ch) {
            ch.forceReleaseAllInput();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && ch) {
            ch.forceReleaseAllInput();
        }
    });

}

document.addEventListener('DOMContentLoaded', () => {
    start()
});

// 切换工具栏的显示和隐藏
function toggleToolbar() {
    const toolbar = document.querySelector('.floating-toolbar');
    toolbar.classList.toggle('hidden');
    // 箭头方向交给 CSS 旋转，这里只更新文案
    const collapsed = toolbar.classList.contains('hidden');
    if (collapsed) {
        toggleShortcutPanel(false);
        toggleViewPanel(false);
        toggleProfilePanel(false);
        togglePowerPanel(false);
        toggleOcrPanel(false);
    }
    document.querySelector('#toggleTooltip').innerText = I18n.t(collapsed ? "toolbar.expand" : "toolbar.collapse");
    document.querySelector('#toggleButton').setAttribute('aria-label', I18n.t(collapsed ? "toolbar.expandLabel" : "toolbar.collapseLabel"));
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        // 进入全屏
        document.documentElement.requestFullscreen();
    } else {
        // 退出全屏
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// 画面尺寸要等元数据到了才有，所以拿到流之后还得再刷一次状态
['loadedmetadata', 'resize', 'playing', 'emptied'].forEach(function (name) {
    videoElement.addEventListener(name, renderVideoStatus);
});
