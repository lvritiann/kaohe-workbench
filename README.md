# 加油站综合考核工作台

陕西高速延长石油有限责任公司 · 计划经营科｜覆盖 15 座高速公路加油站。

规则源：《高速公路加油站目标责任考核方案》V1.0（2026-11-12 16:53 定稿，另一空间 worktree `main-116434f9`）。
**本工作台一律以 V5 五段制为准；仓库内任何「三段加权」「四段制」「55.65/28.80」「等级制」的历史表述均已作废。**

## 一、V5 计分口径

| 段 | 项目 | 基准 | 封顶 | 算法 |
|---|---|---|---|---|
| 一 | 油品销量 | 40 | 48 | 40 × 完成率倍数 |
| 二 | 非油销量 | 10 | 12 | 销售5 + 毛利5，各封顶6 |
| 三 | 油品人效 | 15 | 25 | 人效 ÷ 65 × 15 |
| 四 | 二级运营检查 | 20 | 20 | 检查折算百分制 × 20% |
| 五 | 神秘访客 | 15 | 15 | 神访百分制 × 15%，未测按当月参评站均分填补 |

- **综合** ＝ 五段之和 − 投诉扣分 + 进步加分；基准 100、封顶 120；**不设等级，只出 1–15 名**，同分油品段高者排前。
- **少扣多奖**：完成率 ≥100% 用 `1 + 1.5×(rate−1)`；<100% 用 `1 + 0.5×(rate−1)`。
- **人效** ＝ (会计月当量总量 ÷ 会计月天数) ÷ (月均在岗人数 − 4)；当量 SGE ＝ 汽油吨×**56** ＋ 柴油吨×**28**；月均在岗 ＝ 各日在岗之和 ÷ 会计月天数；基准 **65**（15 站算术平均 65.15 取整，当年固定）。
- **会计月** ＝ 上月 26 日 — 本月 25 日，天数按实计（28/29/30/31）。
- **非油**：销售完成率**不含烟草**，毛利率完成率**含烟草**；毛利率 ＝ 全月毛利额 ÷ 全月销售额，不按日均毛利率平均。
- **投诉**：升级 10 分/件、重复 20 分/件、监管转办 50 分/件，不设下限；重大投诉触发一票否决。
- **进步加分**：年度人效同比每升 1% 加 0.2 分，上限 3 分。
- **一票否决 6 项**：资质证照办理、核心检测报告、散装汽油销售管控、危险废物管理、油品质量合规、重大投诉。触发即当期综合得分 0、排名垫底、当年不得评优。
- **玉华宫**按定稿附录B：月均在岗 12 人 → 分母 8 → 人效 70.10 → 人效段 16.18。

## 二、页面

| 页面 | 用途 |
|---|---|
| `index.html` | 首页、五段分值、运营状态摘要、全部入口 |
| `score.html` | 现场打分：6 项否决 + 73 项判定，默认满分反向打分，支持照片 |
| `rank.html` | 综合排名榜，五段拆解，停业站单列不参与排名 |
| `eff.html` | **人效看板**：当月实时人效、15 站排序、历史月度趋势 |
| `calc.html` | 五段得分可复算，站长自核 |
| `inbox.html` | 待交箱（本机登记，防漏交） |
| `status.html` | 运营管理：停业/复营指令签发 |
| `direct.html` | 直推客户端：浏览器直连 GitHub 台账，无需服务器 |

手机端优先，支持日间/暗色主题；Service Worker 离线缓存，站点无信号也能打分。

**登录秒开**：`score.html` 不再同步加载 862KB 的 Excel 组件与 96KB 的 Zip 组件。登录只等几百字节的 `data/inspectors.json`，73 项题目后台预取，导出组件登录后后台备好、提交时确保就绪（首屏从约 1 MB 降到约 40 KB）。名单与题目都有 localStorage 兜底，断网可登录、可打分。

## 三、数据流

```
金山日报「202610销售及库存日报（新)」
   └─ AirScript tools/airscript/eff_push.js（每日定时）
        └─ HTTP PUT → GitHub docs/data/efficiency.json → eff.html 人效看板
                                                     └─ 月度留痕 history[]

现场打分 score.html（选打分人 + 口令）
   └─ 导出 检查表_站名_月份_时间戳.zip
        ├─ 检查表.xlsx（评分表 / 汇总）
        ├─ photos/（压缩至长边 1280px）
        └─ manifest.json（站点、月份、检查人、扣分项、折算分）
   └─ 科室 python tools/read_check_zip.py <zip>
        └─ inbox/检查表/<包名>/：wps_upload_queue.json + kdocs_upload_payload.json + 检查明细_导入行.tsv
   └─ TSV 粘进「检查明细」→ 金山连接器上传 payload 内照片拿 attachment_id
        → create_float_images 插到对应行 → 回填队列
   └─ 科室汇总五段 → tools/build_rank.py → docs/data/rank.json → rank.html

运营状态 status.html / status_push.bat / direct.html
   └─ docs/data/station_status.json（停业站当月不排名）
```

**照片只进金山在线表，GitHub 仓库零照片。**

## 四、关键文件

- `docs/assets/config.js` — 全局口径（唯一规则源）
- `docs/assets/engine.js` — 五段计分引擎
- `docs/data/items.json` — 73 判定项 + 6 否决项（由 `tools/export_items.py` 从权威 Excel 导出并校验）
- `docs/data/stations.json` — 定稿附录B 15 站人效基准
- `docs/data/inspectors.json` — 打分人名单与口令
- `docs/data/efficiency.json` — 实时/月均人效（AirScript 推，或本地生成）
- `docs/data/rank.json` — 月度五段排名
- `docs/data/station_status.json` — 运营状态台账
- `tools/build_efficiency.py` — 本地生成/覆盖 V5 人效数据
- `tools/build_rank.py` — 生成月度五段排名
- `tools/read_check_zip.py` — 拆解现场打分 zip，产出金山上传队列
- `tools/airscript/eff_push.js` — 金山日报簿内 AirScript（**含令牌，已 gitignore，勿外发**）

## 五、部署

GitHub Pages：仓库 `lvritiann/kaohe-workbench`，源 `main` / `docs`。
线上：<https://lvritiann.github.io/kaohe-workbench/>

推送：`git add -A && git commit -m "..." && git push`。令牌放 `.gh_token.txt`，已 gitignore。
每次改 `docs/` 下前端资源后，**同步升级 `docs/sw.js` 的 `CACHE` 版本号**，否则用户手机端一直用旧缓存。

## 六、科室月度 SOP

| 时点 | 动作 |
|---|---|
| 25—31 日 | 现场检查打分，导出 zip |
| 次月 3 日 | 计划经营科汇总核对：从既有报表／在线驾驶舱取数（油品、非油、人数、投诉），**站端只确认结果、不另行填报** |
| 次月 5 日 | 汇总五段，`python tools/build_rank.py` 生成 rank.json |
| 次月 7 日 | 投诉统计并入 |
| 次月 10 日 | 推 GitHub，发榜 |
| 次月 15 日 | 后 3 位交分析报告 |

`build_rank.py` 的演示数据必须替换成科室核算数据后才算正式发榜；页面会自动识别 `dataMode: "demo"` 并显示黄条提示。

## 七、打分人账号

名单在 `docs/data/inspectors.json`，**16 人**，来自《通讯录人员拼音及手机号.xlsx》全量替换（2026-11-13），旧的 6 组测试账号与口令已全部移除。
口令＝本人手机号**后四位**，字符串保存以保留前导零（如 `0999`／`0045`／`0085`）。
下拉选人 + 输口令即可打分。**这只是署名动作，不是安全边界**（前端校验可绕过，不做服务端鉴权）。
换名单：只改这个 JSON，不需改代码；把 ID 前缀换成新值可让旧登录会话失效、强制重新选人。改完推 GitHub，联网打开一次即可（`/data/` 为网络优先缓存，强刷一次更稳妥）。

## 八、排错（高频场景）

1. **打不开登录页**：确认 `data/items.json`、`data/inspectors.json` 存在且为合法 JSON；联网打开一次让 SW 缓存。
2. **口令不对**：手机号**后四位、含前导零**（`0045` 不能输成 `45`）、无空格；名单改过要联网打开一次并强刷（`/data/` 网络优先）。
3. **点提交没反应**：每个扣分项必须填原因；提交弹层必须勾「已逐项核对」。
4. **照片没进 zip**：手机需允许相册/相机权限；单张压缩到 1280px，最多 3 张。
5. **分数与定稿对不上**：确认用 56/28（不是 55.65/28.80）、月均在岗−4、会计月天数按实计、毛利含烟草、分母不是当日人数。
6. **人效看板不刷新**：AirScript 末尾的 `main();` 不能删；看 `efficiency.json` 的 `updatedAt`；SW 对 `/data/` 是「先网络后缓存」，断网才用旧值。
7. **照片进金山**：`python tools/read_check_zip.py <zip>` 一次产出三件 —— `检查明细_导入行.tsv`（粘贴）、`kdocs_upload_payload.json`（base64 直传清单）、`wps_upload_queue.json`（回填 attachmentId）。照片只进金山在线表，GitHub 零照片；在线表需先扩「照片文件名 / 照片附件ID」两列。
8. **换打分人 / 改题目**：改对应 JSON → 推 GitHub → 升 sw 版本 → 页面强刷。
9. **离线**：首次联网打开后自动缓存；断网可打分可导出，照片只存本地草稿。
10. **停业站仍出现在榜上**：检查 `station_status.json` 的 `from`/`active` 与 `status.html` 签发的变更单是否已推送。
11. **`git push` 卡住 / SIGTERM**：代理环境下 HTTP/2 大包会挂起。改用「显式令牌 + HTTP/1.1」（令牌只从 `.gh_token.txt` 读，不写入 git 配置）：
    `python -c "import subprocess;t=open('.gh_token.txt',encoding='utf-8').read().strip();subprocess.run(['git','-c','http.version=HTTP/1.1','-c','http.postBuffer=5242880','push','https://x-access-token:'+t+'@github.com/lvritiann/kaohe-workbench.git','main'])"`
    验证：看 GitHub 仓库最新提交 SHA 是否等于本地 `git rev-parse --short HEAD`。若 `git ls-remote` 报 `schannel: server closed abruptly`，只是网络抖动，用 API 查 `branches/main` 确认即可，不要盲目重推。
12. **登录慢 / 提交时提示「离线组件未就绪」**：登录页已改为只等名单，不再同步加载 862KB Excel + 96KB Zip 组件。若仍慢，多半是 Service Worker 旧缓存 —— 确认 `sw.js` 版本为 `kaohe-v5-2` 后强刷一次。导出组件在登录后后台加载；首次提交若未就绪会弹提示，联网打开一次即可，已填内容存在本机草稿不会丢。

13. **`git push` 被拒（non-fast-forward）**：AirScript 每次运行都会直接向 GitHub 推 `docs/data/efficiency.json`，远端因此多出本地没有的提交。**千万不要 `--force`**，会丢掉实时人效数据。按第 11 条的显式令牌写法先 `git fetch <仓库地址> main`，再 `git rebase FETCH_HEAD`，最后重推。验证：线上 `efficiency.json` 的 `updatedAt` 没有回退成旧值。

## 九、口径红线

- **数据归口计划经营科**：全部计分数据从既有报表／在线驾驶舱按月汇总核对，站端只确认结果、不另行填报（定稿第十二章）；任何页面与文档都不得再设置站点填报环节。
- 不要用「实际在岗」单点人数代替「月均在岗」。
- 不要再引入 90/80/70/60 等级线，V5 只排名。
- 不要改 SGE 系数、基准 65、扣减 4 人这三项，除非定稿修订。
- `tools/airscript/` 目录含明文令牌，**不入库、不外发**；令牌轮换后需重粘脚本。

## 十、分站柴汽销量数据源（成品油驾驶舱）

2026-11-13 全量核查结果，链路从上到下：

| 层 | 位置 | 说明 |
|---|---|---|
| 在线看板 | <https://lvritiann.github.io/youpin-sales-cockpit/> | 单文件静态页，数据构建期注入；站点排行恒 15 对实体站 |
| 本地工程 | `D:/高速延长公司综合管理平台/_publish/youpin-sales-cockpit/` | `cockpit/index.html` 由 `_kdocs/build_cockpit2.py` 生成 |
| **驾驶舱底表** | `D:/高速延长公司综合管理平台/_publish/成品油经营数据中转簿.xlsx` →「站级明细」 | 1002 行；字段 `会计月｜站名｜路段｜零售吨｜柴油吨｜汽油吨｜升｜含税金额元｜万元` |
| 原始日报 | 金山《202611销售及库存日报（新).xlsx》file_id `hLsU8RQ4Q9MPTbvtSaRtxxQdQoC38LbED` | AirScript v2.6 抽成 `_incoming/data.json`（meta/sale/channels/bigcust/trade） |
| 油品任务 | 金山《加油站成品油月任务及完成2026.xlsx》file_id `xV6qJtcKQ9MkjdHk42kUrxSqEqE1Jm1At` | 定稿表8 的油品任务与实际销量来源 |
| 周报 | 成品油销售周报2026（ima 个人库） | 分站 周/月/年 柴油、汽油、合计、汽柴比，单位吨 |

口径：会计月＝上月 26 日—本月 25 日；站级明细按站区分行（华山南/华山北等），**去末尾「东南西北」后缀合并为 15 站**；只取吨数，不取含税金额。

本地生成器：
- `python tools/build_oil_sales.py` → `inbox/油源/oil_sales_all.json`（34 期 / 501 条站月记录）+ `oil_sales_<最新月>.tsv`。全量台账只存本机 `inbox/`，**不推公开仓库**。
- `python tools/build_kdocs_template.py` → `inbox/油源/考核工作台数据源_扩列_<日期>.xlsx`（本地预览 / 回滚备份）。

## 十一、金山「考核工作台数据源」表结构

文件：<https://www.kdocs.cn/l/crmBWYFuwdwx> （file_id `85jEfN5x3rM95XxYSTpi1xHALnB45UGde`）

| 表 | 列数 | 内容 |
|---|---|---|
| 检查明细 | 19 | 原 12 列 ＋ 照片文件名／照片附件ID／折算得分(100)／运营段得分(20)／一票否决项／数据来源／更新时间 |
| 月度汇总 | 30 | 一行一站一月：会计月区间、真实柴汽销量、五段得分、投诉/进步/否决、综合、名次、状态、来源 |

- 现场打分 zip 经 `tools/read_check_zip.py` 产出的 `检查明细_导入行.tsv` 与「检查明细」19 列**逐列对齐**（已回归验证）。
- 「月度汇总」已填 2026-10 会计月 15 站真实柴汽吨数（来自中转簿），其余段留空待科室核算。华山该月仍标「正常营业」——关停自 2026-11-01 起，状态按会计月判定，不套当前状态。
- 两表均冻结首行 + 前两列。照片经 `upload_attachment → create_float_images` 插入后，把 `attachment_id` 回填「照片附件ID」列；GitHub 仓库零照片。
