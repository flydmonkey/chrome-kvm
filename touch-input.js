// 触屏操作：把触摸点的按下、移动、抬起翻译成鼠标动作。只出动作不碰串口和 DOM，
// 页面拿到动作再调 Ch9329，所以手势规则可以单测。
//
// 绝对模式（触摸位置就是光标位置）：
//   单指点按 = 左键单击；按住不动 0.5 秒 = 右键；单指拖动 = 按住左键拖拽
// 相对模式（当触控板用）：
//   单指滑动 = 移动光标；轻点 = 左键单击；按住 0.5 秒后再拖 = 按住左键拖拽
// 两种模式通用：
//   双指上下滑 = 滚轮；双指轻点 = 右键
var TouchInput = (function () {
    // 手指按下后抖动在这个范围内都算没动，否则点一下经常变成拖一下
    var SLOP_PX = 10;
    var LONG_PRESS_MS = 500;
    // 相对模式下轻点必须够快，慢慢按下去再抬起更像是想拖而犹豫了
    var TAP_MAX_MS = 300;
    // 双指滑动多少像素算滚一格
    var SCROLL_STEP_PX = 40;

    function distance(ax, ay, bx, by) {
        return Math.hypot(ax - bx, ay - by);
    }

    // 动作：
    //   {type: "move", x, y}               绝对模式下把光标移到这个客户端坐标
    //   {type: "moveBy", dx, dy}           相对位移
    //   {type: "down", button, x?, y?}     按下（button: "left" | "right"）
    //   {type: "up", button}               抬起
    //   {type: "click", button, x?, y?}    单击（按下再抬起）
    //   {type: "scroll", notches}          滚轮，正数向上
    function createGestures(absolute) {
        var pointers = {};
        var count = 0;
        var mode = "idle";
        var one = null;
        var two = null;

        function centroid() {
            var sx = 0;
            var sy = 0;
            var n = 0;
            for (var id in pointers) {
                sx += pointers[id].x;
                sy += pointers[id].y;
                n++;
            }
            return {x: sx / n, y: sy / n};
        }

        function endOne(actions) {
            if (one && one.holding) {
                actions.push({type: "up", button: "left"});
            }
            one = null;
        }

        function down(id, x, y, t) {
            var actions = [];
            if (pointers[id] || count >= 2) {
                return actions;
            }
            pointers[id] = {x: x, y: y};
            count++;
            if (count === 1) {
                mode = "one";
                one = {startT: t, startX: x, startY: y, lastX: x, lastY: y,
                    moved: false, holding: false, longFired: false};
                if (absolute) {
                    actions.push({type: "move", x: x, y: y});
                }
                return actions;
            }
            // 第二根手指落下：前面单指的动作作废，改按双指算
            endOne(actions);
            mode = "two";
            var c = centroid();
            two = {startT: t, startX: c.x, startY: c.y, lastY: c.y, moved: false, acc: 0};
            return actions;
        }

        function move(id, x, y) {
            var actions = [];
            if (!pointers[id]) {
                return actions;
            }
            pointers[id].x = x;
            pointers[id].y = y;
            if (mode === "one") {
                if (!one.moved && distance(x, y, one.startX, one.startY) > SLOP_PX) {
                    one.moved = true;
                }
                if (!one.moved) {
                    return actions;
                }
                if (absolute) {
                    if (one.longFired) {
                        return actions;   // 已经当右键用掉了
                    }
                    if (!one.holding) {
                        one.holding = true;
                        actions.push({type: "down", button: "left", x: one.startX, y: one.startY});
                    }
                    actions.push({type: "move", x: x, y: y});
                    return actions;
                }
                actions.push({type: "moveBy", dx: x - one.lastX, dy: y - one.lastY});
                one.lastX = x;
                one.lastY = y;
                return actions;
            }
            if (mode === "two") {
                var c = centroid();
                if (!two.moved && distance(c.x, c.y, two.startX, two.startY) > SLOP_PX) {
                    two.moved = true;
                    two.lastY = c.y;
                    return actions;
                }
                if (!two.moved) {
                    return actions;
                }
                // 自然滚动：手指往下拖，内容往下走，也就是向上滚
                two.acc += c.y - two.lastY;
                two.lastY = c.y;
                var notches = Math.trunc(two.acc / SCROLL_STEP_PX);
                if (notches !== 0) {
                    two.acc -= notches * SCROLL_STEP_PX;
                    actions.push({type: "scroll", notches: notches});
                }
            }
            return actions;
        }

        function up(id, x, y, t) {
            var actions = [];
            if (!pointers[id]) {
                return actions;
            }
            if (mode === "one") {
                if (one.holding) {
                    if (absolute) {
                        actions.push({type: "move", x: x, y: y});
                    }
                    actions.push({type: "up", button: "left"});
                } else if (!one.moved && !one.longFired) {
                    if (absolute) {
                        actions.push({type: "click", button: "left", x: one.startX, y: one.startY});
                    } else if (t - one.startT <= TAP_MAX_MS) {
                        actions.push({type: "click", button: "left"});
                    }
                }
                one = null;
            } else if (mode === "two") {
                // 第一根手指抬起就结算：没怎么动、时间也短就是双指轻点
                if (!two.moved && t - two.startT <= TAP_MAX_MS) {
                    var c = centroid();
                    actions.push(absolute
                        ? {type: "click", button: "right", x: c.x, y: c.y}
                        : {type: "click", button: "right"});
                }
                two = null;
                mode = "ending";
            }
            delete pointers[id];
            count--;
            if (count === 0) {
                mode = "idle";
            }
            return actions;
        }

        function cancel(id) {
            var actions = [];
            if (!pointers[id]) {
                return actions;
            }
            if (mode === "one") {
                endOne(actions);
            }
            two = null;
            delete pointers[id];
            count--;
            mode = count === 0 ? "idle" : "ending";
            return actions;
        }

        // 长按靠页面的定时器在 LONG_PRESS_MS 之后调一次
        function tick(t) {
            var actions = [];
            if (mode !== "one" || one.moved || one.longFired || one.holding) {
                return actions;
            }
            if (t - one.startT < LONG_PRESS_MS) {
                return actions;
            }
            one.longFired = true;
            if (absolute) {
                actions.push({type: "click", button: "right", x: one.startX, y: one.startY});
            } else {
                // 相对模式长按是拖拽的开始：先按住左键，接下来的滑动都带着它
                one.holding = true;
                one.moved = true;
                actions.push({type: "down", button: "left"});
            }
            return actions;
        }

        return {
            absolute: !!absolute,
            down: down,
            move: move,
            up: up,
            cancel: cancel,
            tick: tick,
            active: function () {
                return count > 0;
            }
        };
    }

    // 屏幕键盘上的功能键。软键盘常常不给 event.code，只能靠 event.key 认
    var SOFT_KEYS = {
        Backspace: "Backspace",
        Enter: "Enter",
        Tab: "Tab",
        Escape: "Escape",
        Delete: "Delete",
        ArrowLeft: "ArrowLeft",
        ArrowRight: "ArrowRight",
        ArrowUp: "ArrowUp",
        ArrowDown: "ArrowDown",
        Home: "Home",
        End: "End",
        PageUp: "PageUp",
        PageDown: "PageDown"
    };

    function softKeyCode(key) {
        return Object.prototype.hasOwnProperty.call(SOFT_KEYS, key) ? SOFT_KEYS[key] : null;
    }

    // beforeinput 里不带文字的编辑动作对应的按键
    var INPUT_TYPE_KEYS = {
        deleteContentBackward: "Backspace",
        deleteContentForward: "Delete",
        insertLineBreak: "Enter",
        insertParagraph: "Enter"
    };

    function inputTypeKey(inputType) {
        return Object.prototype.hasOwnProperty.call(INPUT_TYPE_KEYS, inputType) ? INPUT_TYPE_KEYS[inputType] : null;
    }

    return {
        SLOP_PX: SLOP_PX,
        LONG_PRESS_MS: LONG_PRESS_MS,
        TAP_MAX_MS: TAP_MAX_MS,
        SCROLL_STEP_PX: SCROLL_STEP_PX,
        createGestures: createGestures,
        softKeyCode: softKeyCode,
        inputTypeKey: inputTypeKey
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = TouchInput;
}
