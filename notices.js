// 顶部提示条，两个页面共用，用来代替 alert。alert 会抢焦点触发 blur，把被控端
// 上正按着的键全部松开；启动时视频、串口各弹一个还会一个接一个挡住画面。
// 依赖 PageLogic.noticeTimeout，页面里要先引入 page-logic.js
var Notices = (function () {
    var FLASH_KEY = "chrome-kvm-flash";

    function stack() {
        return document.getElementById("noticeStack");
    }

    // options: {level: "info"|"warn"|"error", key, timeout, closable,
    //           link: {text, href}, action: {text, onClick}}
    // 同一个 key 只保留最新一条，重连之类反复出现的提示不会越堆越多。
    // 返回 {setMessage, remove}，进度类的提示靠它原地改字，不用反复重建。
    function show(message, options) {
        options = options || {};
        var level = options.level || "info";
        var container = stack();
        if (!container) {
            console.warn(message);
            return {setMessage: function () {}, remove: function () {}};
        }
        if (options.key) {
            dismiss(options.key);
        }

        var notice = document.createElement("div");
        notice.className = "notice notice-" + level;
        if (level === "error") {
            notice.setAttribute("role", "alert");
        }
        if (options.key) {
            notice.dataset.key = options.key;
        }

        var body = document.createElement("div");
        body.className = "notice-body";
        var text = document.createElement("span");
        text.textContent = message;
        body.appendChild(text);
        if (options.link) {
            var link = document.createElement("a");
            link.href = options.link.href;
            link.textContent = options.link.text;
            body.appendChild(link);
        }
        if (options.action) {
            var action = document.createElement("button");
            action.className = "notice-action";
            action.type = "button";
            action.textContent = options.action.text;
            action.addEventListener("click", options.action.onClick);
            body.appendChild(action);
        }
        notice.appendChild(body);

        if (options.closable !== false) {
            var close = document.createElement("button");
            close.className = "notice-close";
            close.type = "button";
            close.setAttribute("aria-label", I18n.t("notice.close"));
            close.textContent = "×";
            close.addEventListener("click", function () {
                notice.remove();
            });
            notice.appendChild(close);
        }

        container.appendChild(notice);

        var timeout = PageLogic.noticeTimeout(level, options.timeout);
        if (timeout > 0) {
            setTimeout(function () {
                notice.remove();
            }, timeout);
        }
        return {
            setMessage: function (next) {
                text.textContent = next;
            },
            remove: function () {
                notice.remove();
            }
        };
    }

    function dismiss(key) {
        var container = stack();
        if (!container) {
            return;
        }
        container.querySelectorAll(".notice").forEach(function (notice) {
            if (notice.dataset.key === key) {
                notice.remove();
            }
        });
    }

    // 马上要刷新页面时用：提示存进 sessionStorage，刷新后由 showFlash 显示
    function flash(message, options) {
        try {
            sessionStorage.setItem(FLASH_KEY, JSON.stringify({message: message, options: options || {}}));
        } catch (e) {
            console.warn(message);
        }
    }

    function showFlash() {
        var raw = null;
        try {
            raw = sessionStorage.getItem(FLASH_KEY);
            sessionStorage.removeItem(FLASH_KEY);
        } catch (e) {
            return;
        }
        if (!raw) {
            return;
        }
        try {
            var saved = JSON.parse(raw);
            show(saved.message, saved.options);
        } catch (e) {
            // 坏数据直接丢掉
        }
    }

    return {
        show: show,
        dismiss: dismiss,
        flash: flash,
        showFlash: showFlash
    };
})();
