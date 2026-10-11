const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function idFor(item) {
  if (item.id) return String(item.id);
  if (item.awemeId) return String(item.awemeId);
  return crypto.createHash('sha1').update([item.url, item.author, item.title, item.publishedAt].join('|')).digest('hex');
}

function loadRecords(file) {
  const value = read(file, []);
  return Array.isArray(value) ? value : [];
}

function upsert(file, incoming) {
  const map = new Map(loadRecords(file).map(item => [idFor(item), item]));
  const now = new Date().toISOString();
  for (const raw of incoming || []) {
    const item = { ...raw, id: idFor(raw), firstSeenAt: raw.firstSeenAt || now, updatedAt: now };
    const previous = map.get(item.id);
    map.set(item.id, previous ? { ...previous, ...item, firstSeenAt: previous.firstSeenAt } : item);
  }
  const records = [...map.values()].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  write(file, records);
  return { records, added: (incoming || []).filter(item => !loadRecords(file).some(old => idFor(old) === idFor(item))).length };
}

function upsertSafe(file, incoming) {
  const previous = loadRecords(file);
  const existing = new Set(previous.map(idFor));
  const result = upsert(file, incoming);
  result.addedRecords = (incoming || []).filter(item => !existing.has(idFor(item)));
  result.added = result.addedRecords.length;
  return result;
}

module.exports = { read, write, loadRecords, upsert: upsertSafe, idFor };
