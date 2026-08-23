# 卧附藏喵 · 南师附中猫协

南师附中猫协静态网站，包含校园猫档案、救助与照护记录、历次义卖、校园遇猫指南和猫墙联系方式。

网站地址：https://jiayi61.github.io/nsfz-cat-association/

## 文件结构

```text
index.html                 网站页面、样式与交互
assets/
  brand/                   猫协徽标
  cats/                    校园猫档案照片
  illustrations/           首页与指南插画
  join/                    猫墙二维码
  timeline/                救助时间线图片
```

网站为纯静态页面，可直接打开 `index.html` 预览，由 GitHub Pages 发布。

## Ledger Sync

唯一正式账本（source of truth）：[腾讯文档](https://docs.qq.com/sheet/DWndhWGJwQ2ljc3dH)

```text
腾讯文档
→ Cloudflare Worker
→ GET /ledger
→ GitHub Pages
```

主站仍由 GitHub Pages 托管。`worker/` 仅负责通过腾讯文档官方 Open API 读取在线表格、按表头整理公开字段，并返回统一 JSON。浏览器不会接触腾讯凭证；接口失败时，页面继续显示最后一次人工核对的 fallback 快照。

### 1. 腾讯文档配置

1. 在[腾讯文档开放平台](https://docs.qq.com/open/document/app/)注册开发者并创建第三方应用，等待应用审核通过。
2. 为应用申请 `scope.sheet.readonly`，以及转换 URL encodedID 所需的 `scope.drive.file.metadata.readonly`（或官方列出的等价只读权限）。
3. 配置 OAuth 回调地址，并用账本所有者账号完成一次授权。
4. 用授权回调中的 `code` 换取 `access_token`、`refresh_token` 与 `user_id`。其中 `user_id` 即 Open ID；换取和刷新 Token 必须在服务端完成。
5. 确认该账号对“南师附中猫协账本”拥有读取权限。

这份文档是普通在线表格，不是 SmartSheet。Worker 使用官方接口：

- `GET /openapi/drive/v2/util/converter`：把 URL 中的 `DWndhWGJwQ2ljc3dH` 转为 fileID
- `GET /openapi/spreadsheet/v3/files/{fileId}`：读取工作表 sheetID
- `GET /openapi/sheetbook/v2/{bookID}/values/{range}`：读取单元格二维数组
- `GET /oauth/v2/token?grant_type=refresh_token...`：刷新 Access Token

### 2. Cloudflare 配置

进入 `worker/` 后登录 Cloudflare，并创建一个可选的 KV namespace 用于复用 Access Token：

```sh
npx wrangler login
npx wrangler kv namespace create TOKEN_STORE
```

把命令返回的 namespace ID 填入 `worker/wrangler.toml` 注释中的 `[[kv_namespaces]]` 配置。未绑定 KV 时 Worker 仍可运行，但不同实例可能更频繁地刷新 Access Token。

依次添加以下 Worker secrets；不要把真实值写进仓库：

```sh
npx wrangler secret put TENCENT_DOCS_CLIENT_ID
npx wrangler secret put TENCENT_DOCS_CLIENT_SECRET
npx wrangler secret put TENCENT_DOCS_REFRESH_TOKEN
npx wrangler secret put TENCENT_DOCS_OPEN_ID
```

如果账本不在第一个工作表，可在 Cloudflare Worker variables 中再设置 `TENCENT_DOCS_SHEET_ID` 或 `TENCENT_DOCS_SHEET_NAME`。表格读取范围默认是 `A1:Z2000`。

### 3. 部署与接入主站

```sh
cd worker
npm test
npm run deploy
```

部署后，把 `index.html` 顶部脚本区的 `LEDGER_API_URL` 替换成 Worker 返回的完整地址，例如：

```js
const LEDGER_API_URL = 'https://nsfz-cat-ledger.example.workers.dev/ledger';
```

这一步只做一次。之后只需修改腾讯文档；Worker 的公开响应缓存 5 分钟，网站通常会在几分钟内显示新数据。

### 4. 表格约定

Worker 按表头文字查找列，不依赖固定列号。支持的核心表头包括“日期 / 时间”“项目 / 明细”“分类”“收入”“支出”“净额”。空金额保持为 `null`，异常日期原样展示，原表净额优先于自动计算。

只有分类或记录类型为“义卖汇总”的行会成为折叠项目。其后的“义卖明细”行，或分类、记录类型、所属项目均为空的连续行，会进入该项目 `details`；遇到下一条普通分类记录即结束。若表格结构更复杂，建议增加“记录类型”和“所属项目”列明确标记。

公开 API 只返回 `date`、`title`、`category`、`income`、`expense`、`net` 和 `details`。即使腾讯表格新增内部备注、成员姓名或付款信息，这些列也不会进入网站响应。
