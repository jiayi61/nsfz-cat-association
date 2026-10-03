const HEADER_ALIASES = {
  date: ['日期时间', '日期', '时间'],
  title: ['项目明细', '项目名称', '项目', '明细', '事项'],
  category: ['分类', '类别'],
  income: ['收入', '收款'],
  expense: ['支出', '费用'],
  net: ['净额', '结余'],
  recordType: ['记录类型', '项目类型', '类型'],
  groupRef: ['所属项目', '归属项目', '项目汇总'],
};

// 腾讯账本里，义卖项目的明细行靠在“项目 / 明细”前加空格缩进来标记。
const INDENTED = /^[ \t 　]+(?=\S)/;
const PAYMENT_CHANNEL = /支付宝|微信|现金/;
const TRAILING_PAYMENT_CHANNELS = /(?:[、+＋和\s]*(?:支付宝|微信|现金))+\s*$/;
// “支付宝81+95…”“现金498” 这类收款算式（多行单元格被压成一行时会出现）
const PAYMENT_ARITHMETIC = /(?:支付宝|微信|现金)\s*\d+(?:\.\d+)?\s*(?:[+\-=＋－]|$)/;
const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff';
const CJK_BEFORE_LATIN = new RegExp(`([${CJK}])([A-Za-z0-9])`, 'g');
const LATIN_BEFORE_CJK = new RegExp(`([A-Za-z0-9])([${CJK}])`, 'g');

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s/／|｜·、:：()（）_-]+/g, '');
}

export function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const original = String(value).trim();
  if (!original) return null;
  const negativeByParentheses = /^\(.*\)$/.test(original);
  const cleaned = original
    .replace(/[¥￥元,，\s]/g, '')
    .replace(/^\((.*)\)$/, '$1');
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) return null;

  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return null;
  return negativeByParentheses ? -Math.abs(amount) : amount;
}

/**
 * 把表格里的项目名整理成适合公开展示的标题：
 * - 只取第一行（多行单元格的后几行通常是内部算式）
 * - 去掉括号里的支付渠道拆分，例如“（支付宝733.2+微信257.8）”
 * - 去掉结尾单独列出的支付渠道，例如“…收入支付宝微信”
 * - 汉字与数字、字母之间补一个空格，和网站排版一致
 */
export function cleanTitle(value) {
  const firstLine = String(value ?? '').split(/\r?\n/)[0];
  let title = firstLine.replace(/[（(]([^（）()]*)[）)]/g, (match, inner) => (
    PAYMENT_CHANNEL.test(inner) && /\d/.test(inner) ? '' : match
  ));
  const arithmetic = title.search(PAYMENT_ARITHMETIC);
  if (arithmetic > 0) title = title.slice(0, arithmetic);
  const withoutChannels = title.replace(TRAILING_PAYMENT_CHANNELS, '');
  if (withoutChannels.trim()) title = withoutChannels;
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(CJK_BEFORE_LATIN, '$1 $2')
    .replace(LATIN_BEFORE_CJK, '$1 $2');
}

function buildColumnMap(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => {
      const aliasSet = new Set(aliases.map(normalizeHeader));
      return [field, normalized.findIndex((header) => aliasSet.has(header))];
    }),
  );
}

function findHeader(rows) {
  const candidates = rows.slice(0, 20).map((row, index) => ({ index, columns: buildColumnMap(row) }));
  const match = candidates.find(({ columns }) => {
    const recognized = Object.values(columns).filter((index) => index >= 0).length;
    return columns.title >= 0 && recognized >= 3 && (columns.income >= 0 || columns.expense >= 0 || columns.net >= 0);
  });
  if (!match) throw new Error('Ledger header row was not found');
  return match;
}

function readCell(row, index) {
  if (index < 0) return '';
  return String(row[index] ?? '').trim();
}

function calculateNet(income, expense, explicitNet) {
  if (explicitNet !== null) return explicitNet;
  if (income === null && expense === null) return null;
  return (income ?? 0) - (expense ?? 0);
}

function rowToEntry(row, columns) {
  const income = parseMoney(columns.income >= 0 ? row[columns.income] : null);
  const expense = parseMoney(columns.expense >= 0 ? row[columns.expense] : null);
  const explicitNet = parseMoney(columns.net >= 0 ? row[columns.net] : null);
  const rawTitle = columns.title >= 0 ? String(row[columns.title] ?? '') : '';
  return {
    date: readCell(row, columns.date),
    title: cleanTitle(rawTitle),
    indented: INDENTED.test(rawTitle),
    category: readCell(row, columns.category),
    income,
    expense,
    net: calculateNet(income, expense, explicitNet),
    recordType: readCell(row, columns.recordType),
    groupRef: readCell(row, columns.groupRef),
  };
}

function isBlankRecord(record) {
  return !record.date && !record.title && !record.category && record.income === null && record.expense === null && record.net === null;
}

function isGroupSummary(record) {
  return record.category === '义卖汇总' || record.recordType === '义卖汇总' || record.recordType.toLowerCase() === 'group';
}

function isExplicitDetail(record, currentGroup) {
  const type = record.recordType.toLowerCase();
  return (
    record.indented ||
    record.category === '义卖明细' ||
    record.recordType === '义卖明细' ||
    type === 'detail' ||
    (record.groupRef && record.groupRef === currentGroup.title)
  );
}

function publicEntry(record, type = 'entry') {
  return {
    type,
    date: record.date,
    title: record.title,
    category: record.category,
    income: record.income,
    expense: record.expense,
    net: record.net,
  };
}

export function normalizeLedgerRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Ledger rows are empty');
  const { index: headerIndex, columns } = findHeader(rows);
  const entries = [];
  let currentGroup = null;

  const flushGroup = () => {
    if (!currentGroup) return;
    entries.push(currentGroup);
    currentGroup = null;
  };

  for (const row of rows.slice(headerIndex + 1)) {
    if (!Array.isArray(row)) continue;
    const record = rowToEntry(row, columns);
    if (isBlankRecord(record) || !record.title) continue;

    if (isGroupSummary(record)) {
      flushGroup();
      currentGroup = { ...publicEntry(record, 'group'), details: [] };
      continue;
    }

    if (currentGroup) {
      const implicitDetail = !record.category && !record.recordType && !record.groupRef;
      if (isExplicitDetail(record, currentGroup) || implicitDetail) {
        currentGroup.details.push(publicEntry(record));
        continue;
      }
      flushGroup();
    }

    entries.push(publicEntry(record));
  }

  flushGroup();
  return entries;
}

function toCents(value) {
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function entryCents(entry) {
  if (entry.income === null && entry.expense === null && Number.isFinite(entry.net)) {
    return entry.net >= 0 ? { income: toCents(entry.net), expense: 0 } : { income: 0, expense: toCents(-entry.net) };
  }
  return { income: toCents(entry.income), expense: toCents(entry.expense) };
}

/** 收入、支出合计（按分计算，避免浮点误差）。义卖项目优先用汇总行，没有汇总值时再加总明细。 */
export function summarizeLedger(entries) {
  let income = 0;
  let expense = 0;
  let records = 0;
  for (const entry of entries) {
    if (entry.type === 'group') {
      const details = (entry.details || []).map(entryCents);
      income += Number.isFinite(entry.income) ? toCents(entry.income) : details.reduce((sum, item) => sum + item.income, 0);
      expense += Number.isFinite(entry.expense) ? toCents(entry.expense) : details.reduce((sum, item) => sum + item.expense, 0);
      records += details.length;
    } else {
      const cents = entryCents(entry);
      income += cents.income;
      expense += cents.expense;
      records += 1;
    }
  }
  return { income: income / 100, expense: expense / 100, records };
}
