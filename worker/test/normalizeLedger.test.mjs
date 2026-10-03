import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanTitle, normalizeLedgerRows, parseMoney, summarizeLedger } from '../src/normalizeLedger.js';

const realSheet = JSON.parse(readFileSync(new URL('./fixtures/tencent-ledger-2026-08-22.json', import.meta.url), 'utf8'));

test('parseMoney keeps blanks null and parses common money formats', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('not money'), null);
  assert.equal(parseMoney('¥1,005'), 1005);
  assert.equal(parseMoney('￥ 6.80 元'), 6.8);
  assert.equal(parseMoney('(23.50)'), -23.5);
  assert.equal(parseMoney(0), 0);
});

test('normalization matches moved headers and preserves unusual dates', () => {
  const rows = [
    ['说明', '忽略'],
    ['支出', '项目 / 明细', '日期 / 时间', '收入', '分类', '净额'],
    ['', '跨年捐款', '2025.12–2026', '¥1,005', '捐款', ''],
    ['6.8', '中招包装打样', '2025.04.23', '', '活动物料', ''],
    ['', '待确认项目', '待补', '', '其他', ''],
  ];
  const entries = normalizeLedgerRows(rows);
  assert.deepEqual(entries[0], {
    type: 'entry', date: '2025.12–2026', title: '跨年捐款', category: '捐款', income: 1005, expense: null, net: 1005,
  });
  assert.equal(entries[1].expense, 6.8);
  assert.equal(entries[1].net, -6.8);
  assert.equal(entries[2].date, '待补');
  assert.equal(entries[2].income, null);
  assert.equal(entries[2].expense, null);
  assert.equal(entries[2].net, null);
});

test('only explicit sale summaries become groups', () => {
  const rows = [
    ['日期', '项目', '分类', '收入', '支出', '净额', '记录类型', '所属项目', '内部备注', '成员姓名'],
    ['2025.06', '2025 科技文化节义卖', '义卖汇总', '3649.70', '1664.86', '1984.84', '', '', 'private', '张三'],
    ['2025.06.18', '订购便利贴', '义卖明细', '', '150', '', '', '', 'private', '李四'],
    ['2025.06.29', '义卖收入', '', '3649.70', '', '', '', '', 'private', '王五'],
    ['2026.03', '流浪猫绝育捐款', '捐款', '1005', '', '', '', '', 'private', '赵六'],
    ['2026.03', '流浪猫绝育费用', '医疗', '', '1700', '', '', '', 'private', '钱七'],
  ];
  const entries = normalizeLedgerRows(rows);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].type, 'group');
  assert.equal(entries[0].details.length, 2);
  assert.equal(entries[1].type, 'entry');
  assert.equal(entries[2].type, 'entry');
  assert.equal('成员姓名' in entries[0], false);
  assert.equal('内部备注' in entries[0].details[0], false);
});

test('an explicit net value is not overwritten', () => {
  const rows = [
    ['日期', '项目', '分类', '收入', '支出', '净额'],
    ['2025.05', '补款调整', '调整', '100', '20', '75'],
  ];
  assert.equal(normalizeLedgerRows(rows)[0].net, 75);
});

test('cleanTitle keeps the public part of a sheet title', () => {
  assert.equal(cleanTitle('    订购贴纸'), '订购贴纸');
  assert.equal(cleanTitle('科技文化节义卖收入支付宝微信\n支付宝81+95=176\n现金498'), '科技文化节义卖收入');
  assert.equal(cleanTitle('余量售卖收入（支付宝733.2+微信257.8）'), '余量售卖收入');
  assert.equal(cleanTitle('余量售卖（含捐款30）'), '余量售卖（含捐款 30）');
  assert.equal(cleanTitle('微信支付宝该月总收入'), '微信支付宝该月总收入');
  assert.equal(cleanTitle('购买40斤猫粮'), '购买 40 斤猫粮');
  assert.equal(cleanTitle('2025 春季周边销售'), '2025 春季周边销售');
  assert.equal(cleanTitle('微信'), '微信');
  // 多行单元格被复制成一行时，后面的收款算式也要去掉
  assert.equal(cleanTitle('科技文化节义卖收入支付宝微信 支付宝81+95+533.7-10=699.7 微信2514-47-15=2452 现金498'), '科技文化节义卖收入');
  assert.equal(cleanTitle('收到微信5月捐款'), '收到微信 5 月捐款');
});

test('the real Tencent sheet keeps indented sale details inside their projects', () => {
  const entries = normalizeLedgerRows(realSheet.rows);
  const groups = entries.filter((entry) => entry.type === 'group');

  assert.deepEqual(groups.map((group) => [group.title, group.details.length]), [
    ['2025 春季周边销售', 7],
    ['2025 科技文化节义卖', 9],
    ['2025 秋季运动会义卖', 15],
  ]);
  assert.equal(entries.length, 25); // 22 条普通记录 + 3 个义卖项目
  assert.equal(entries.filter((entry) => entry.title === '订购贴纸').length, 0, 'details must not leak to the top level');

  const sports = groups[2];
  assert.equal(sports.income, 12111.3);
  assert.equal(sports.expense, 12855.17);
  assert.equal(sports.net, -743.87);
  assert.equal(sports.details[1].date, '待补');

  const techFestival = groups[1];
  assert.equal(techFestival.details.at(-1).title, '科技文化节义卖收入');
  assert.equal(techFestival.details.at(-1).income, 3649.7);
  assert.equal(groups[0].details[2].title, '余量售卖收入');

  // 第一个义卖项目之后的普通记录要回到顶层
  const nextTopLevel = entries[entries.indexOf(groups[0]) + 1];
  assert.equal(nextTopLevel.title, '中招包装打样');
  assert.equal(nextTopLevel.type, 'entry');
});

test('totals of the real sheet match the Tencent document', () => {
  const summary = summarizeLedger(normalizeLedgerRows(realSheet.rows));
  assert.equal(summary.income, 24328.47);
  assert.equal(summary.expense, 27593.67);
  assert.equal(summary.records, 53); // 不含 3 行义卖汇总
  // 腾讯账本顶部“当前余额” = 期初余额 −135.65 + 收入 − 支出
  assert.equal(Math.round((-135.65 + summary.income - summary.expense) * 100) / 100, -3400.85);
});

test('rows above the header (title, opening balance) never become entries', () => {
  const entries = normalizeLedgerRows(realSheet.rows);
  assert.equal(entries.some((entry) => entry.title.includes('期初余额') || entry.title.includes('猫协账本')), false);
  assert.equal(entries[0].date, '2025.02.11');
});
