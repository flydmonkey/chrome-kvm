// 浅色 / 深色主题。放在 <head> 里同步执行，赶在页面绘制前定下主题，免得先闪一下深色。
// 选择存在本机；「跟随系统」时系统切换深浅色会立即跟着变，另一个标签页改了也会同步过来。
var Theme = (function () {
    var STORAGE_KEY = "chrome-kvm-theme";
    var CHOICES = ["auto", "light", "dark"];
    var media = null;

    function normalize(choice) {
        return CHOICES.indexOf(choice) >= 0 ? choice : "auto";
    }

    // 系统偏好拿不到时按深色：画面区域本来就是黑的，深色是这个工具一直以来的样子
    function resolve(choice, prefersLight) {
        choice = normalize(choice);
        if (choice !== "auto") {
            return choice;
        }
        return prefersLight ? "light" : "dark";
    }

    function storage() {
        try {
            return typeof localStorage !== "undefined" ? localStorage : null;
        } catch (e) {
            return null;
        }
    }

    function current() {
        var store = storage();
        try {
            return normalize(store ? store.getItem(STORAGE_KEY) : null);
        } catch (e) {
            return "auto";
        }
    }

    function apply() {
        if (typeof document === "undefined") {
            return;
        }
        document.documentElement.setAttribute("data-theme", resolve(current(), !!(media && media.matches)));
    }

    function set(choice) {
        choice = normalize(choice);
        var store = storage();
        try {
            if (choice === "auto") {
                store.removeItem(STORAGE_KEY);
            } else {
                store.setItem(STORAGE_KEY, choice);
            }
        } catch (e) {
            return false;
        }
        apply();
        return true;
    }

    if (typeof window !== "undefined") {
        media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
        if (media && media.addEventListener) {
            media.addEventListener("change", apply);
        }
        window.addEventListener("storage", function (event) {
            if (event.key === STORAGE_KEY || event.key === null) {
                apply();
            }
        });
        apply();
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        CHOICES: CHOICES,
        normalize: normalize,
        resolve: resolve,
        current: current,
        set: set,
        apply: apply
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = Theme;
}
