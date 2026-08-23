import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLedgerRows, parseMoney } from '../src/normalizeLedger.js';

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
