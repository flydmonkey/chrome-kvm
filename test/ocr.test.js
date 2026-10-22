const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Ocr = require("../ocr.js");

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
        setItem: (key, value) => {
            data[key] = String(value);
        }
    };
}

test("识别语言", async (t) => {
    await t.test("按固定顺序去重，未知的丢掉，空了用默认", () => {
        assert.deepStrictEqual(Ocr.normalizeLangs(["chi_tra", "eng", "eng", "fra"]), ["eng", "chi_tra"]);
        assert.deepStrictEqual(Ocr.normalizeLangs(["kor", "jpn", "chi_sim"]), ["chi_sim", "jpn", "kor"]);
        assert.deepStrictEqual(Ocr.normalizeLangs([]), Ocr.DEFAULT_LANGS);
        assert.deepStrictEqual(Ocr.normalizeLangs("eng"), Ocr.DEFAULT_LANGS);
        assert.strictEqual(Ocr.langString(["chi_sim", "chi_tra", "eng"]), "eng+chi_sim+chi_tra");
    });

    await t.test("中英混选时先英文优先、再中文优先；只选一边时只认一遍", () => {
        assert.deepStrictEqual(Ocr.recognitionPlan(["chi_tra", "eng", "chi_sim"]),
            {first: "eng+chi_sim+chi_tra", second: "chi_sim+chi_tra+eng"});
        assert.deepStrictEqual(Ocr.recognitionPlan(["eng"]), {first: "eng", second: null});
        assert.deepStrictEqual(Ocr.recognitionPlan(["chi_sim", "chi_tra"]), {first: "chi_sim+chi_tra", second: null});
    });

    await t.test("日文、韩文和中文一样：和英文混选时认两遍", () => {
        assert.deepStrictEqual(Ocr.recognitionPlan(["eng", "jpn"]), {first: "eng+jpn", second: "jpn+eng"});
        assert.deepStrictEqual(Ocr.recognitionPlan(["kor", "eng", "chi_sim"]),
            {first: "eng+chi_sim+kor", second: "chi_sim+kor+eng"});
        assert.deepStrictEqual(Ocr.recognitionPlan(["kor"]), {first: "kor", second: null});
    });

    await t.test("默认英文加简体，不含繁体", () => {
        assert.deepStrictEqual(Ocr.DEFAULT_LANGS, ["eng", "chi_sim"]);
    });

    await t.test("存取，坏数据退回默认", () => {
        const storage = memoryStorage();
        assert.deepStrictEqual(Ocr.saveLangs(storage, ["chi_tra"]), ["chi_tra"]);
        assert.deepStrictEqual(Ocr.loadLangs(storage), ["chi_tra"]);
        assert.deepStrictEqual(Ocr.loadLangs(memoryStorage({[Ocr.STORAGE_KEY]: "{oops"})), Ocr.DEFAULT_LANGS);
        assert.deepStrictEqual(Ocr.loadLangs(null), Ocr.DEFAULT_LANGS);
    });

    await t.test("每种语言的语言包都在仓库里", () => {
        for (const lang of Ocr.LANGUAGES) {
            const file = path.join(__dirname, "..", Ocr.VENDOR_DIR, "lang", lang.id + ".traineddata.gz");
            assert.ok(fs.existsSync(file), file);
        }
    });
});

test("画面区域", async (t) => {
    const box = {left: 0, top: 0, width: 1920, height: 1080};

    await t.test("contain 时去掉两侧黑边", () => {
        const content = Ocr.contentRect(box, {width: 1024, height: 768}, "contain");
        assert.deepStrictEqual(content, {left: 240, top: 0, width: 1440, height: 1080});
    });

    await t.test("fill 或尺寸未知时就是整个元素", () => {
        assert.deepStrictEqual(Ocr.contentRect(box, {width: 1024, height: 768}, "fill"), box);
        assert.deepStrictEqual(Ocr.contentRect(box, {width: 0, height: 0}, "contain"), box);
    });

    await t.test("放大平移后元素偏到窗口外，也能换算回画面像素", () => {
        // 1280×720 放大 200% 到 3840×2160，平移到左上角在 (-1900, -1060)
        const zoomed = {left: -1900, top: -1060, width: 3840, height: 2160};
        const content = Ocr.contentRect(zoomed, {width: 1280, height: 720}, "fill");
        // 元素 3 个像素对应画面 1 个像素：屏幕 (1400, 740) → 画面 (3300/3, 1800/3)
        const rect = Ocr.selectionToVideo({x: 1700, y: 1040}, {x: 1400, y: 740}, content, {width: 1280, height: 720});
        assert.deepStrictEqual(rect, {x: 1100, y: 600, width: 100, height: 100});
    });

    await t.test("从右下往左上拖也一样", () => {
        const content = {left: 0, top: 0, width: 960, height: 540};
        const video = {width: 1920, height: 1080};
        const a = Ocr.selectionToVideo({x: 100, y: 100}, {x: 200, y: 150}, content, video);
        const b = Ocr.selectionToVideo({x: 200, y: 150}, {x: 100, y: 100}, content, video);
        assert.deepStrictEqual(a, {x: 200, y: 200, width: 200, height: 100});
        assert.deepStrictEqual(b, a);
    });

    await t.test("框到黑边的部分裁掉", () => {
        const content = {left: 240, top: 0, width: 1440, height: 1080};
        const rect = Ocr.selectionToVideo({x: 100, y: 100}, {x: 600, y: 400}, content, {width: 1440, height: 1080});
        assert.deepStrictEqual(rect, {x: 0, y: 100, width: 360, height: 300});
    });

    await t.test("太小或完全在黑边里返回 null", () => {
        const content = {left: 240, top: 0, width: 1440, height: 1080};
        const video = {width: 1440, height: 1080};
        assert.strictEqual(Ocr.selectionToVideo({x: 500, y: 500}, {x: 504, y: 600}, content, video), null);
        assert.strictEqual(Ocr.selectionToVideo({x: 10, y: 10}, {x: 200, y: 200}, content, video), null);
        assert.strictEqual(Ocr.selectionToVideo({x: 300, y: 300}, {x: 500, y: 500}, content, {width: 0, height: 0}), null);
    });
});

test("预处理", async (t) => {
    await t.test("小区域放大更多，且不超过边长上限", () => {
        assert.strictEqual(Ocr.scaleFor(400, 60), 3);
        assert.strictEqual(Ocr.scaleFor(1200, 300), 2);
        assert.strictEqual(Ocr.scaleFor(1920, 1080), 2);
        assert.strictEqual(Ocr.scaleFor(3840, 2160), 1);
        assert.strictEqual(Ocr.scaleFor(0, 0), 1);
        for (const side of [100, 601, 1999, 2001, 4096]) {
            assert.ok(side * Ocr.scaleFor(side, 10) <= Math.max(Ocr.MAX_SIDE_PX, side));
        }
    });

    await t.test("浅底深字转灰度，不反色", () => {
        const px = new Uint8ClampedArray([255, 255, 255, 255, 250, 250, 250, 255, 0, 0, 0, 255]);
        assert.strictEqual(Ocr.preprocess(px), false);
        assert.deepStrictEqual(Array.from(px), [255, 255, 255, 255, 250, 250, 250, 255, 0, 0, 0, 255]);
    });

    await t.test("深底浅字（BIOS 蓝底白字）反色成浅底深字", () => {
        const px = new Uint8ClampedArray([0, 0, 170, 255, 0, 0, 170, 255, 255, 255, 255, 255]);
        assert.strictEqual(Ocr.preprocess(px), true);
        // 蓝底灰度 19，反色后 236；白字反成 0
        assert.deepStrictEqual(Array.from(px), [236, 236, 236, 255, 236, 236, 236, 255, 0, 0, 0, 255]);
    });

    await t.test("空图不出错", () => {
        assert.strictEqual(Ocr.preprocess(new Uint8ClampedArray(0)), false);
    });
});

test("整理识别结果", async (t) => {
    await t.test("去掉汉字与全角标点之间的空格，保留英文单词间的空格", () => {
        assert.strictEqual(Ocr.cleanText("系统 无 法 启动 ， 请 检查 硬盘"), "系统无法启动，请检查硬盘");
        assert.strictEqual(Ocr.cleanText("系 統 無 法 啟動"), "系統無法啟動");
        assert.strictEqual(Ocr.cleanText("Error 0x7B at 192.168.1.20"), "Error 0x7B at 192.168.1.20");
        assert.strictEqual(Ocr.cleanText("硬盘 SATA 0 未 检测 到"), "硬盘 SATA 0 未检测到");
    });

    await t.test("汉字旁的半角标点：去掉前面的空格，夹在汉字中间的换成全角", () => {
        assert.strictEqual(Ocr.cleanText("網路設定已儲存 , 請重新啟動電腦"), "網路設定已儲存，請重新啟動電腦");
        assert.strictEqual(Ocr.cleanText("网络配置 : IP 地址 192.168.1.20"), "网络配置: IP 地址 192.168.1.20");
        assert.strictEqual(Ocr.cleanText("是否继续 ? 是"), "是否继续？是");
        // 英文和数字里的标点不动
        assert.strictEqual(Ocr.cleanText("Boot Device : SATA0, 192.168.1.1"), "Boot Device : SATA0, 192.168.1.1");
    });

    await t.test("日文假名之间的空格去掉，夹在假名中间的半角标点换成全角", () => {
        assert.strictEqual(Ocr.cleanText("ディスク が 見つかり ませ ん"), "ディスクが見つかりません");
        assert.strictEqual(Ocr.cleanText("起動 デバイス を 選択 し て くだ さい"), "起動デバイスを選択してください");
        assert.strictEqual(Ocr.cleanText("保存 しました , 再起動 し ます"), "保存しました，再起動します");
        assert.strictEqual(Ocr.cleanText("ﾃﾞｨｽｸ ｴﾗｰ"), "ﾃﾞｨｽｸｴﾗｰ");
    });

    await t.test("韩文词之间本来就有空格，保留；只去掉标点前多余的空格", () => {
        assert.strictEqual(Ocr.cleanText("부팅 장치를 선택하십시오"), "부팅 장치를 선택하십시오");
        assert.strictEqual(Ocr.cleanText("디스크 오류 , 다시 시도하십시오"), "디스크 오류, 다시 시도하십시오");
        assert.strictEqual(Ocr.cleanText("저장 : 완료"), "저장: 완료");
    });

    await t.test("判断有没有中日韩文字（全角标点不算）", () => {
        assert.strictEqual(Ocr.hasCjk("Error 0x7B"), false);
        assert.strictEqual(Ocr.hasCjk("，：（）。、"), false);
        assert.strictEqual(Ocr.hasCjk("SATA 硬盘"), true);
        assert.strictEqual(Ocr.hasCjk("繁體"), true);
        assert.strictEqual(Ocr.hasCjk("Boot メニュー"), true);
        assert.strictEqual(Ocr.hasCjk("Boot 메뉴"), true);
    });

    await t.test("行尾空白去掉，多余空行合并，首尾空白去掉", () => {
        assert.strictEqual(Ocr.cleanText("\n  a  \r\nb\n\n\n\nc\n"), "a\nb\n\nc");
        assert.strictEqual(Ocr.cleanText(null), "");
    });

    await t.test("字数不算空白", () => {
        assert.strictEqual(Ocr.charCount("系统 OK\n"), 4);
        assert.strictEqual(Ocr.charCount(""), 0);
    });
});

test("引擎文件", async (t) => {
    await t.test("SIMD 检测", () => {
        assert.strictEqual(Ocr.simdSupported(WebAssembly), true);
        assert.strictEqual(Ocr.simdSupported(null), false);
        assert.strictEqual(Ocr.simdSupported({validate: () => { throw new Error("x"); }}), false);
    });

    await t.test("按 SIMD 支持挑引擎，挑出来的文件都在仓库里", () => {
        const dir = path.join(__dirname, "..", Ocr.VENDOR_DIR);
        for (const simd of [true, false]) {
            const options = Ocr.workerOptions("http://127.0.0.1:8765/" + Ocr.VENDOR_DIR, simd);
            assert.strictEqual(options.cacheMethod, "none");
            assert.ok(options.corePath.endsWith("core/" + Ocr.coreFile(simd)));
            assert.ok(fs.existsSync(path.join(dir, "core", Ocr.coreFile(simd))));
        }
        assert.ok(fs.existsSync(path.join(dir, "worker.min.js")));
        assert.ok(fs.existsSync(path.join(dir, "tesseract.min.js")));
    });

    await t.test("基础路径有没有结尾斜杠都行", () => {
        const a = Ocr.workerOptions("http://x/vendor/tesseract", true);
        const b = Ocr.workerOptions("http://x/vendor/tesseract/", true);
        assert.deepStrictEqual(a, b);
        assert.strictEqual(a.langPath, "http://x/vendor/tesseract/lang");
    });

    await t.test("进度文案", () => {
        assert.strictEqual(Ocr.progressText("recognizing text", 0.456), "正在识别 46%…");
        assert.strictEqual(Ocr.progressText("loading language traineddata", 0.5), "正在加载语言包…");
        assert.strictEqual(Ocr.progressText("something new"), "正在准备识别…");
    });
});
