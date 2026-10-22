// 发布用：把要上线的文件复制到 _site/，HTML 里引用的本地脚本和样式加上 ?v=内容哈希。
// GitHub Pages 不让设缓存头，浏览器会按启发式缓存脚本，刷新页面时只重新验证 HTML，
// 于是新页面配旧脚本。网址带上哈希后，文件一改网址就变，没改的照样走缓存。
// 源码里不写版本号，本地开发直接打开仓库目录就行
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {execFileSync} = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "_site");
// 只在仓库里用、不用上线的
const EXCLUDE = [/^\./, /^openspec\//, /^test\//, /^scripts\//, /^package(-lock)?\.json$/];

function hashOf(content) {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
}

// 只改本站的相对路径；带协议、已经有查询串或锚点的不动
const ASSET_REF = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^":?#]+\.(?:js|css))(")/g;

function versionAssets(html, versionOf) {
    return html.replace(ASSET_REF, function (all, before, file, after) {
        return before + file + "?v=" + versionOf(file) + after;
    });
}

function publishedFiles() {
    return execFileSync("git", ["ls-files", "-z"], {cwd: ROOT, encoding: "utf8"})
        .split("\0")
        .filter(Boolean)
        .filter(function (file) {
            return !EXCLUDE.some(function (pattern) {
                return pattern.test(file);
            });
        });
}

function build() {
    fs.rmSync(OUT, {recursive: true, force: true});
    const files = publishedFiles();
    const versions = {};
    function versionOf(file) {
        if (!versions[file]) {
            if (files.indexOf(file) === -1) {
                throw new Error("HTML 引用了不会发布的文件：" + file);
            }
            versions[file] = hashOf(fs.readFileSync(path.join(ROOT, file)));
        }
        return versions[file];
    }
    files.forEach(function (file) {
        const target = path.join(OUT, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        if (file.endsWith(".html")) {
            fs.writeFileSync(target, versionAssets(fs.readFileSync(path.join(ROOT, file), "utf8"), versionOf));
        } else {
            fs.copyFileSync(path.join(ROOT, file), target);
        }
    });
    console.log("_site/：" + files.length + " 个文件，" + Object.keys(versions).length + " 个脚本和样式加了版本号");
}

if (require.main === module) {
    build();
}

module.exports = {versionAssets: versionAssets, hashOf: hashOf, publishedFiles: publishedFiles};
