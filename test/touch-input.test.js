const test = require("node:test");
const assert = require("node:assert");
const TouchInput = require("../touch-input.js");

const LONG = TouchInput.LONG_PRESS_MS;
const SLOP = TouchInput.SLOP_PX;
const STEP = TouchInput.SCROLL_STEP_PX;

test("绝对模式触摸", async (t) => {
    await t.test("落指就把光标移过去，点按抬起是左键单击", () => {
        const g = TouchInput.createGestures(true);
        assert.deepStrictEqual(g.down(1, 100, 50, 0), [{type: "move", x: 100, y: 50}]);
        assert.deepStrictEqual(g.up(1, 102, 51, 120), [{type: "click", button: "left", x: 100, y: 50}]);
        assert.strictEqual(g.active(), false);
    });

    await t.test("抖动在容差内仍算点按，点的是落指的位置", () => {
        const g = TouchInput.createGestures(true);
        g.down(1, 100, 50, 0);
        assert.deepStrictEqual(g.move(1, 100 + SLOP - 1, 50), []);
        assert.deepStrictEqual(g.up(1, 100 + SLOP - 1, 50, 200), [{type: "click", button: "left", x: 100, y: 50}]);
    });

    await t.test("拖动超过容差就按住左键拖拽，从落指处开始", () => {
        const g = TouchInput.createGestures(true);
        g.down(1, 100, 50, 0);
        assert.deepStrictEqual(g.move(1, 130, 50), [
            {type: "down", button: "left", x: 100, y: 50},
            {type: "move", x: 130, y: 50}
        ]);
        assert.deepStrictEqual(g.move(1, 160, 70), [{type: "move", x: 160, y: 70}]);
        assert.deepStrictEqual(g.up(1, 170, 75, 900), [
            {type: "move", x: 170, y: 75},
            {type: "up", button: "left"}
        ]);
    });

    await t.test("按住不动到时间就是右键，之后抬起和移动都不再出动作", () => {
        const g = TouchInput.createGestures(true);
        g.down(1, 100, 50, 0);
        assert.deepStrictEqual(g.tick(LONG - 1), [], "时间不到不算");
        assert.deepStrictEqual(g.tick(LONG), [{type: "click", button: "right", x: 100, y: 50}]);
        assert.deepStrictEqual(g.tick(LONG + 100), [], "只触发一次");
        assert.deepStrictEqual(g.move(1, 200, 50), []);
        assert.deepStrictEqual(g.up(1, 200, 50, LONG + 300), []);
    });

    await t.test("已经在拖了就不会再变成右键", () => {
        const g = TouchInput.createGestures(true);
        g.down(1, 100, 50, 0);
        g.move(1, 150, 50);
        assert.deepStrictEqual(g.tick(LONG + 10), []);
    });
});

test("相对模式触摸（触控板）", async (t) => {
    await t.test("落指不动光标，滑动超过容差后按增量移动", () => {
        const g = TouchInput.createGestures(false);
        assert.deepStrictEqual(g.down(1, 100, 100, 0), []);
        assert.deepStrictEqual(g.move(1, 105, 100), [], "容差内不动，免得点一下光标也跟着抖");
        assert.deepStrictEqual(g.move(1, 120, 90), [{type: "moveBy", dx: 20, dy: -10}]);
        assert.deepStrictEqual(g.move(1, 125, 95), [{type: "moveBy", dx: 5, dy: 5}]);
        assert.deepStrictEqual(g.up(1, 125, 95, 500), [], "滑过之后抬起不点击");
    });

    await t.test("快速轻点是左键单击，不带坐标", () => {
        const g = TouchInput.createGestures(false);
        g.down(1, 100, 100, 0);
        assert.deepStrictEqual(g.up(1, 101, 100, TouchInput.TAP_MAX_MS), [{type: "click", button: "left"}]);
    });

    await t.test("按得太久再抬起不算点击", () => {
        const g = TouchInput.createGestures(false);
        g.down(1, 100, 100, 0);
        assert.deepStrictEqual(g.up(1, 100, 100, TouchInput.TAP_MAX_MS + 1), []);
    });

    await t.test("长按后按住左键，接着滑动就是拖拽，抬起松开", () => {
        const g = TouchInput.createGestures(false);
        g.down(1, 100, 100, 0);
        assert.deepStrictEqual(g.tick(LONG), [{type: "down", button: "left"}]);
        assert.deepStrictEqual(g.move(1, 103, 100), [{type: "moveBy", dx: 3, dy: 0}],
            "长按之后不再有容差，细微移动也要跟上");
        assert.deepStrictEqual(g.up(1, 103, 100, LONG + 400), [{type: "up", button: "left"}]);
    });
});

test("双指", async (t) => {
    for (const absolute of [true, false]) {
        const name = absolute ? "绝对模式" : "相对模式";

        await t.test(name + "：双指轻点是右键", () => {
            const g = TouchInput.createGestures(absolute);
            g.down(1, 100, 100, 0);
            g.down(2, 200, 100, 20);
            const actions = g.up(1, 100, 100, 150);
            assert.strictEqual(actions.length, 1);
            assert.strictEqual(actions[0].type, "click");
            assert.strictEqual(actions[0].button, "right");
            if (absolute) {
                assert.strictEqual(actions[0].x, 150);
                assert.strictEqual(actions[0].y, 100);
            }
            assert.deepStrictEqual(g.up(2, 200, 100, 170), [], "第二根手指抬起不再出动作");
            assert.strictEqual(g.active(), false);
        });

        await t.test(name + "：双指往下拖是向上滚，按步长出齿数，零头留着", () => {
            const g = TouchInput.createGestures(absolute);
            g.down(1, 100, 100, 0);
            g.down(2, 200, 100, 0);
            assert.deepStrictEqual(g.move(1, 100, 100 + 2 * SLOP + 2), [], "刚越过容差只定基准");
            // 两指都往下 STEP：重心移动 STEP
            g.move(1, 100, 100 + 2 * SLOP + 2 + STEP);
            const actions = g.move(2, 200, 100 + STEP * 1.5);
            assert.deepStrictEqual(actions, [{type: "scroll", notches: 1}]);
        });

        await t.test(name + "：双指往上推是向下滚", () => {
            const g = TouchInput.createGestures(absolute);
            g.down(1, 100, 300, 0);
            g.down(2, 200, 300, 0);
            g.move(1, 100, 300 - 2 * SLOP - 2);
            g.move(2, 200, 300 - 2 * SLOP - 2);
            const actions = g.move(1, 100, 300 - 2 * SLOP - 2 - 2 * STEP * 2);
            assert.deepStrictEqual(actions, [{type: "scroll", notches: -2}]);
        });

        await t.test(name + "：滑过的双指抬起不右击", () => {
            const g = TouchInput.createGestures(absolute);
            g.down(1, 100, 100, 0);
            g.down(2, 200, 100, 0);
            g.move(1, 100, 200);
            assert.deepStrictEqual(g.up(1, 100, 200, 100), []);
        });
    }

    await t.test("拖拽中途落下第二根手指，先把左键松开", () => {
        const g = TouchInput.createGestures(true);
        g.down(1, 100, 100, 0);
        g.move(1, 150, 100);
        assert.deepStrictEqual(g.down(2, 300, 100, 200), [{type: "up", button: "left"}]);
    });

    await t.test("第三根手指不理会", () => {
        const g = TouchInput.createGestures(true);
        g.down(1, 100, 100, 0);
        g.down(2, 200, 100, 0);
        assert.deepStrictEqual(g.down(3, 300, 100, 0), []);
        assert.deepStrictEqual(g.move(3, 400, 100), []);
        assert.deepStrictEqual(g.up(3, 400, 100, 10), []);
    });
});

test("触摸被系统打断", async (t) => {
    await t.test("拖拽中被取消要松开左键，且不补点击", () => {
        const g = TouchInput.createGestures(true);
        g.down(1, 100, 100, 0);
        g.move(1, 150, 100);
        assert.deepStrictEqual(g.cancel(1), [{type: "up", button: "left"}]);
        assert.strictEqual(g.active(), false);
    });

    await t.test("点按中被取消什么都不发", () => {
        const g = TouchInput.createGestures(false);
        g.down(1, 100, 100, 0);
        assert.deepStrictEqual(g.cancel(1), []);
        assert.deepStrictEqual(g.tick(LONG * 2), []);
    });

    await t.test("不认识的触点直接忽略", () => {
        const g = TouchInput.createGestures(true);
        assert.deepStrictEqual(g.move(9, 1, 1), []);
        assert.deepStrictEqual(g.up(9, 1, 1, 0), []);
        assert.deepStrictEqual(g.cancel(9), []);
    });
});

test("屏幕键盘的功能键", async (t) => {
    await t.test("按 key 认功能键，字符不归这里管", () => {
        assert.strictEqual(TouchInput.softKeyCode("Backspace"), "Backspace");
        assert.strictEqual(TouchInput.softKeyCode("ArrowUp"), "ArrowUp");
        assert.strictEqual(TouchInput.softKeyCode("a"), null);
        assert.strictEqual(TouchInput.softKeyCode("Unidentified"), null);
        assert.strictEqual(TouchInput.softKeyCode("constructor"), null);
    });

    await t.test("不带文字的编辑动作映射成按键", () => {
        assert.strictEqual(TouchInput.inputTypeKey("deleteContentBackward"), "Backspace");
        assert.strictEqual(TouchInput.inputTypeKey("insertLineBreak"), "Enter");
        assert.strictEqual(TouchInput.inputTypeKey("insertText"), null);
    });

    await t.test("映射出的键名协议层都认得", () => {
        const Ch9329 = require("../ch9329.js");
        ["Backspace", "Enter", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
            "Home", "End", "PageUp", "PageDown"].forEach(function (key) {
            assert.ok(Ch9329.KEYBOARD_MAP[TouchInput.softKeyCode(key)] != null, key);
        });
    });
});
