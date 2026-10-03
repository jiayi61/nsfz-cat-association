#!/usr/bin/env node
// 把腾讯账本的导出文件转换成网站使用的 data/ledger-snapshot.js。
//
// 用法：
//   node scripts/build-ledger-snapshot.mjs <账本导出文件> [--date 2026-08-22] [--out data/ledger-snapshot.js]
//
// 支持的输入：
//   .csv   腾讯文档 → 右上角菜单 → 导出为 → 本地CSV文件（当前工作表）
//   .tsv   在腾讯文档里全选、复制，粘贴进一个文本文件
//   .json  形如 { "rows": [[...], ...] } 的二维数组
//
// 解析规则与 Cloudflare Worker 完全相同（worker/src/normalizeLedger.js），
// 所以网站上的快照和实时同步显示的内容一致。只有日期、项目、分类、收入、支出、净额会写进快照。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLedgerRows, summarizeLedger } from '../worker/src/normalizeLedger.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET_URL = 'https://docs.qq.com/sheet/DWndhWGJwQ2ljc3dH';

function parseArgs(argv) {
  const options = { input: '', date: '', out: resolve(ROOT, 'data/ledger-snapshot.js') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') options.date = argv[++index] ?? '';
    else if (arg === '--out') options.out = resolve(argv[++index] ?? '');
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (!options.input) options.input = arg;
    else throw new Error(`无法识别的参数：${arg}`);
  }
  return options;
}

function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    // 有些表格软件导出的 CSV 是 GBK 编码
    return new TextDecoder('gb18030').decode(buffer);
  }
}

/** 解析 CSV / TSV，支持引号、引号内换行和 "" 转义。 */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readRows(file) {
  const buffer = readFileSync(file);
  if (extname(file).toLowerCase() === '.json') {
    const parsed = JSON.parse(decode(buffer));
    const rows = Array.isArray(parsed) ? parsed : parsed.rows;
    if (!Array.isArray(rows)) throw new Error('JSON 里没有找到 rows 二维数组');
    return rows;
  }
  const text = decode(buffer);
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delimiter = (sample.match(/\t/g) || []).length > (sample.match(/,/g) || []).length ? '\t' : ',';
  return parseDelimited(text, delimiter);
}

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const yuan = (amount) => `¥${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input) {
    console.log('用法：node scripts/build-ledger-snapshot.mjs <账本导出的 .csv/.tsv/.json> [--date YYYY-MM-DD] [--out 输出路径]');
    process.exit(options.help ? 0 : 1);
  }
  const sheetDate = options.date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sheetDate)) throw new Error('--date 需要写成 YYYY-MM-DD');

  const entries = normalizeLedgerRows(readRows(resolve(options.input)));
  const summary = summarizeLedger(entries);
  const groups = entries.filter((entry) => entry.type === 'group');

  const snapshot = { source: 'snapshot', sheetDate, entries };
  const output = [
    '// 由 scripts/build-ledger-snapshot.mjs 自动生成。要改内容，请改腾讯账本后重新生成，不要手动编辑。',
    `// 来源：腾讯文档《南师附中猫协账本》 ${SHEET_URL}`,
    `// 账本日期 ${sheetDate}｜${summary.records} 笔记录｜收入合计 ${yuan(summary.income)}｜支出合计 ${yuan(summary.expense)}`,
    `window.LEDGER_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};`,
    '',
  ].join('\n');
  writeFileSync(options.out, output);

  console.log(`已写入 ${options.out}`);
  console.log(`账本日期 ${sheetDate}`);
  console.log(`${summary.records} 笔记录，其中 ${groups.length} 个义卖项目：${groups.map((group) => `${group.title}（${group.details.length} 笔）`).join('、') || '无'}`);
  console.log(`收入合计 ${yuan(summary.income)}，支出合计 ${yuan(summary.expense)}`);
  console.log('请和腾讯账本核对这两个合计，一致后再提交。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`生成失败：${error.message}`);
    process.exit(1);
  }
}
