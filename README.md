# 卧附藏喵 · 南师附中猫协

南师附中猫协的网站：校园猫档案、照护记录、公开账本、义卖记录、遇猫指南和猫墙二维码。

- 网站：https://jiayi61.github.io/nsfz-cat-association/
- 正式账本：[腾讯文档《南师附中猫协账本》](https://docs.qq.com/sheet/DWndhWGJwQ2ljc3dH)（网站上的账本以它为准）

## 文件结构

```text
index.html                       网页内容、样式和交互（纯静态，由 GitHub Pages 发布）
data/ledger-snapshot.js          网站显示的账本数据，由脚本从腾讯账本生成，不要手动改
scripts/build-ledger-snapshot.mjs 把腾讯账本导出的 CSV 转成 data/ledger-snapshot.js
assets/
  brand/                         猫协徽标
  cats/                          校园猫档案照片
  illustrations/                 首页插画
  join/                          猫墙二维码
  timeline/                      照护记录与义卖照片
worker/                          （可选）实时同步腾讯账本的 Cloudflare Worker，目前未部署
```

## 本地预览

```sh
python3 -m http.server 8000
```

然后打开 http://localhost:8000 。直接双击 `index.html` 也能看，只是访问统计不会加载。

## 修改网站内容

所有文字都在 `index.html` 里，按页面顺序排列：

| 板块 | 在 `index.html` 里找 | 照片放在 |
| --- | --- | --- |
| 校园猫档案 | `<article class="cat-card">` | `assets/cats/` |
| 首页三个数字 | `<section class="stats-band">` | — |
| 照护记录 | `<article class="timeline-entry">` | `assets/timeline/` |
| 义卖亮点和全部义卖列表 | `<section … id="sales">`、`<ol class="sales-history-list">` | `assets/timeline/` |
| 遇猫指南 | `<article class="guide-item">` | — |
| 加入猫协 | `<section class="join-section">` | `assets/join/` |

几个需要一起改的地方：

- 新增一次义卖时，在 `sales-history-list` 里加一行，同时把首页的“9 次义卖与周边发售”和列表标题“全部 9 次……”改成新数字。
- 新增或减少常驻猫时，同步改首页的“4 只常驻猫”。
- “花在送医和绝育上”的金额会从账本里自动计算（分类含“医疗”“绝育”或“TNR”的支出），不用手改。
- 照护记录里的 `账本 ·` 小字是对应的账本金额，改账本时顺手核对一下。

写作约定：

- 数字、英文和汉字之间空一格，例如“IB 楼”“1.5 小时”；日期写成 `2025.06.18`。
- 只写有记录可查的事实；金额以账本为准。
- 标题里两个短语用 `<span class="phrase">…</span>` 分开（例如 `义卖，` 和 `也是照护的一部分。`），手机上会在短语之间换行，不会只剩一个字掉到下一行。段落结尾由页面脚本自动处理，最后一行至少保留 4 个字。

## 更新账本

腾讯账本改动以后，按下面三步把网站上的账本更新到最新：

1. 在腾讯文档打开账本，点右上角菜单 → 导出为 → **本地CSV文件（当前工作表）**。
2. 在仓库根目录运行（`--date` 填腾讯文档显示的“上次修改”日期）：

   ```sh
   node scripts/build-ledger-snapshot.mjs ~/Downloads/南师附中猫协账本.csv --date 2026-08-22
   ```

3. 脚本会打印收入合计和支出合计。和腾讯账本核对一致后，提交 `data/ledger-snapshot.js`。

也可以在腾讯文档里全选、复制，粘贴成一个 `.tsv` 文本文件再交给脚本。

### 账本表格约定

网站按表头文字找列，列的顺序可以调整：

- 表头需要有：`日期 / 时间`、`项目 / 明细`、`分类`、`收入`、`支出`、`净额`。
- 一次义卖记成一个项目：汇总行的分类写 `义卖汇总`，下面每笔明细在“项目 / 明细”前**加空格缩进**（现在账本里就是这样写的）。遇到下一条没有缩进的记录，这个项目就结束。
- 网站只公开日期、项目、分类、收入、支出、净额。预付款、已补款、支付方式等其他列不会出现在网站上。
- 项目名只取单元格第一行；括号里的收款拆分（如“（支付宝733.2+微信257.8）”）和结尾的“支付宝微信”会自动去掉。
- 金额可以写成 `¥1,005.00`、`1005` 或 `(23.50)`（表示负数）；空着就是没有。日期原样显示，写“待补”也可以。
- 网站把账本倒过来显示，最新的记录在最上面，所以账本里请按时间顺序往下记。

## 实时同步（可选）：Cloudflare Worker

**状态：未部署。** 现在网站显示的是 `data/ledger-snapshot.js` 快照。部署 Worker 以后，网页会先显示快照，再自动换成腾讯账本的实时数据；接口出错时继续显示快照。

```text
腾讯文档 → Cloudflare Worker（GET /ledger）→ 网站
```

Worker 和快照脚本用的是同一套解析规则（`worker/src/normalizeLedger.js`），两边显示的内容一致。浏览器不会接触任何腾讯凭证。

### 1. 腾讯文档开放平台

1. 在[腾讯文档开放平台](https://docs.qq.com/open/document/app/)注册开发者，创建第三方应用并等待审核。
2. 申请 `scope.sheet.readonly`，以及把链接里的 ID 转成 fileID 所需的 `scope.drive.file.metadata.readonly`（或官方列出的等价只读权限）。
3. 配置 OAuth 回调地址，用账本所有者的账号授权一次。
4. 用回调里的 `code` 换取 `access_token`、`refresh_token` 和 `user_id`（即 Open ID）。换取和刷新 Token 都必须在服务端完成。

Worker 用到的官方接口：

- `GET /openapi/drive/v2/util/converter`：把链接里的 `DWndhWGJwQ2ljc3dH` 转成 fileID
- `GET /openapi/spreadsheet/v3/files/{fileId}`：读取工作表 ID
- `GET /openapi/sheetbook/v2/{bookID}/values/{range}`：读取单元格
- `GET /oauth/v2/token?grant_type=refresh_token…`：刷新 Access Token

### 2. Cloudflare

```sh
cd worker
npx wrangler login
npx wrangler kv namespace create TOKEN_STORE   # 可选，用来缓存 Access Token
```

把返回的 namespace ID 填进 `worker/wrangler.toml` 里注释掉的 `[[kv_namespaces]]`。然后添加 secrets（不要把真实值写进仓库）：

```sh
npx wrangler secret put TENCENT_DOCS_CLIENT_ID
npx wrangler secret put TENCENT_DOCS_CLIENT_SECRET
npx wrangler secret put TENCENT_DOCS_REFRESH_TOKEN
npx wrangler secret put TENCENT_DOCS_OPEN_ID
```

账本不在第一个工作表时，再设置变量 `TENCENT_DOCS_SHEET_ID` 或 `TENCENT_DOCS_SHEET_NAME`。默认读取 `A1:Z2000`。

### 3. 部署并接入网站

```sh
cd worker
npm test
npm run deploy
```

把 `index.html` 脚本里的 `LEDGER_API_URL` 换成 Worker 的完整地址，例如 `https://nsfz-cat-ledger.example.workers.dev/ledger`。之后只需修改腾讯文档，Worker 的响应缓存 5 分钟。

## 测试

```sh
cd worker
npm test
```

测试覆盖账本解析（包括 2026-08-22 真实账本结构的回归测试）、快照文件只含公开字段、义卖项目合计与明细一致，以及 Worker 的跨域和出错处理。推送到 GitHub 时会自动运行（`.github/workflows/test.yml`）。
