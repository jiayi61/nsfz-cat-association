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
  return {
    date: readCell(row, columns.date),
    title: readCell(row, columns.title),
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
