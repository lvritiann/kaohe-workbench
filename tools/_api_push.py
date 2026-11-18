# -*- coding: utf-8 -*-
"""通过 GitHub Git Data API 推送（github.com 被代理阻断时用）"""
import base64
import time
import json
import os
import urllib.request

ROOT = r"D:/加油站综合考核系统"
TOKEN = open(os.path.join(ROOT, ".gh_token.txt"), encoding="utf-8").read().strip()
OWNER, REPO = "lvritiann", "kaohe-workbench"
BRANCH = "main"
API = "https://api.github.com"
PROXY = "http://127.0.0.1:54216"

FILES = [
    "README.md", ".gitignore",
    "docs/assets/score.js", "docs/sw.js",
    "tools/read_check_zip.py",
    "tools/_t_chain.py", "tools/_t_record.py", "tools/_t_expect.js",
    "tools/_api_push.py",
]

MSG = """feat(v6): 照片硬压 500KB + 导出改系统分享，修掉手机端「未安装可打开该链接的应用」

现场反馈：安卓给某站打分后，页面报「已打包下载」，系统同时弹
「未安装可打开该链接的应用」。根因是 a[download] + blob 在微信/企微/QQ 的
X5 内核里不生效，浏览器把 blob: 当超链接交给系统 Intent，系统没有能开
application/zip 的应用；而代码一个字都没校验下载结果，所以「失败报成功」是必然。

导出方式（downloadBlob + offerExport）
- 四级降级：Web Share 系统分享 -> 内置浏览器明确提示 -> a[download] -> 手动兜底
- 微信/企微/QQ 内核不再点空炮，直接提示「右上角 ··· -> 在浏览器打开」
- 下载 Blob MIME 改 application/octet-stream，绕开安卓「按 zip 类型找应用」
- 取消分享不算失败：面板给「重新分享」，复用闭包里已打好的包，
  全文件不存在重新打包路径（JSZip.generateAsync 全程只调一次）
- 文案不再谎报，按实际走的分支说话

草稿安全
- 只在 shared（确认分享成功）时清草稿。下载是否落盘浏览器不回话，
  拿草稿去赌就是「文件没到手、数据也没了」

照片压缩（原来只有长边 1280 + q0.75，没有字节校验，≤500KB 是碰巧）
- 单张硬保证 500KB：长边 1600，质量 0.82 逐档降到 0.5，
  还超就缩边重试最多 4 轮；全超则取最省一档并提示「已压缩到最大程度」
- b64Bytes 按 base64 真实换算，不用估算
- 拦截 toDataURL 返回 'data:,' 的空图，不静默存空照片
- 打包前总量闸 30MB（73 项 x 3 张 x 500KB 会到 100MB，安卓 JSZip 会 OOM），
  超限不打包并给「返回修改 / 仍然导出」
- 每项 3 张按剩余额度收，修掉 multiple 跨次累加会变 4 张以上的老 bug

其它
- sw.js: kaohe-v6-6 -> kaohe-v6-7（不升版本，已装旧 SW 的手机看不到这次修复）
- README: 数据流/月度 SOP 改「导出并分享」；排错新增「未安装可打开该链接的应用」
  的成因与三种处置；补记「照片进表当前是断的」——连接器没暴露
  upload_attachment / create_float_images，实测调用返回「工具不存在」"""



def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method)
    data = json.dumps(body).encode() if body is not None else None
    if data:
        req.data = data
        req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "kaohe-deploy")
    # 直连 api.github.com（不走上游代理，代理对 github 域不稳定）
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    last = None
    for attempt in range(3):
        try:
            with op.open(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception as e:      # noqa: BLE001
            last = e
            time.sleep(2 + attempt * 3)
    raise last


ref = call("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
head_sha = ref["object"]["sha"]
head = call("GET", f"/repos/{OWNER}/{REPO}/git/commits/{head_sha}")
base_tree = head["tree"]["sha"]
print("远端 HEAD:", head_sha[:8])

entries = []
for rel in FILES:
    raw = open(os.path.join(ROOT, rel.replace("/", os.sep)), "rb").read()
    blob = call("POST", f"/repos/{OWNER}/{REPO}/git/blobs",
                {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
    entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print("  blob", rel, len(raw), "bytes")

tree = call("POST", f"/repos/{OWNER}/{REPO}/git/trees",
            {"base_tree": base_tree, "tree": entries})
commit = call("POST", f"/repos/{OWNER}/{REPO}/git/commits",
              {"message": MSG, "tree": tree["sha"], "parents": [head_sha]})
print("新 commit:", commit["sha"][:8])
call("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
     {"sha": commit["sha"], "force": False})
print("已更新 ref heads/%s" % BRANCH)
