import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { summarizeLedger } from '../src/normalizeLedger.js';
import { parseDelimited } from '../../scripts/build-ledger-snapshot.mjs';

const PUBLIC_FIELDS = new Set(['type', 'date', 'title', 'category', 'income', 'expense', 'net', 'details']);

function loadSnapshot() {
  const code = readFileSync(new URL('../../data/ledger-snapshot.js', import.meta.url), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(code, context);
  return context.window.LEDGER_SNAPSHOT;
}

const cents = (value) => Math.round((value ?? 0) * 100);

test('the website ledger snapshot only contains public fields', () => {
  const snapshot = loadSnapshot();
  assert.equal(snapshot.source, 'snapshot');
  assert.match(snapshot.sheetDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(snapshot.entries.length > 0);

  const check = (entry) => {
    for (const field of Object.keys(entry)) assert.ok(PUBLIC_FIELDS.has(field), `不应公开的字段：${field}`);
    assert.ok(entry.title, '每条记录都要有项目名');
    for (const field of ['income', 'expense', 'net']) {
      assert.ok(entry[field] === null || Number.isFinite(entry[field]), `${entry.title} 的 ${field} 不是数字`);
    }
  };
  for (const entry of snapshot.entries) {
    check(entry);
    (entry.details || []).forEach(check);
  }
});

test('each sale project total equals the sum of its details', () => {
  for (const entry of loadSnapshot().entries.filter((item) => item.type === 'group')) {
    const sum = (field) => entry.details.reduce((total, item) => total + cents(item[field]), 0);
    if (Number.isFinite(entry.income)) assert.equal(cents(entry.income), sum('income'), `${entry.title} 收入合计与明细不符`);
    if (Number.isFinite(entry.expense)) assert.equal(cents(entry.expense), sum('expense'), `${entry.title} 支出合计与明细不符`);
  }
});

test('snapshot totals are finite', () => {
  const summary = summarizeLedger(loadSnapshot().entries);
  assert.ok(Number.isFinite(summary.income) && summary.income > 0);
  assert.ok(Number.isFinite(summary.expense) && summary.expense > 0);
});

test('CSV parsing handles quotes, embedded newlines and CRLF', () => {
  assert.deepEqual(parseDelimited('日期,项目\r\n2025.06.29,"多行\n第二行"\r\n待补,"他说""好"""\r\n', ','), [
    ['日期', '项目'],
    ['2025.06.29', '多行\n第二行'],
    ['待补', '他说"好"'],
  ]);
  assert.deepEqual(parseDelimited('a\tb\n\t    缩进\n', '\t'), [['a', 'b'], ['', '    缩进']]);
});
