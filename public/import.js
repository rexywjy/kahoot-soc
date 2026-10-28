// Question import from spreadsheets (.xlsx or .csv). Everything runs in the
// browser with no third-party libraries, so importing works offline.
const LETTERS = 'ABCDEF';
const HEADERS = { question: ['soal', 'pertanyaan', 'question'], answer: ['jawabanbenar', 'jawaban', 'kunci', 'kuncijawaban', 'correct', 'correctanswer', 'answer'] };
const BAD_FILE = 'This file could not be read. Save it as an Excel Workbook (.xlsx) or CSV and try again.';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TEMPLATE_ROWS = [
  ['Soal', 'A', 'B', 'C', 'D', 'Jawaban Benar'],
  ['Siapa yang membangun bahtera?', 'Musa', 'Nuh', 'Abraham', 'Daud', 'B'],
  ['Manakah yang termasuk murid Yesus?', 'Petrus', 'Yohanes', 'Goliat', 'Firaun', 'A,B'],
  ['Kitab pertama dalam Alkitab adalah…', 'Kejadian', 'Keluaran', 'Imamat', '', 'A'],
];

const decode = value => value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (match, hex, dec, name) => hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name] ?? match);
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)=(?:"([^"]*)"|'([^']*)')/g)].map(([, name, double, single]) => [name, decode(double ?? single)]));
// Joins the <t> runs of a shared or inline string, skipping phonetic hints and
// unescaping Excel's _xHHHH_ control-character codes.
const text = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)]
  .map(([, value = '']) => decode(value)).join('').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const columnIndex = ref => [.../^[A-Z]+/i.exec(ref)[0].toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// Returns rows as { row, cells }, where row is the spreadsheet's own row
// number so error messages match what the host sees in Excel.
export async function readSpreadsheet(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('Old .xls files are not supported. In Excel, choose File → Save As → Excel Workbook (.xlsx).');
  return parseCsv(new TextDecoder().decode(bytes));
}

async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map();
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error(BAD_FILE);
  let offset = view.getUint32(end + 16, true);
  for (let count = view.getUint16(end + 10, true); count > 0; count--) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error(BAD_FILE);
    const method = view.getUint16(offset + 10, true), size = view.getUint32(offset + 20, true), nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true), start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), { method, data: bytes.subarray(start, start + size) });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return async name => {
    const file = files.get(name);
    if (!file) return null;
    if (file.method === 0) return new TextDecoder().decode(file.data);
    if (file.method !== 8) throw new Error(BAD_FILE);
    return new Response(new Blob([file.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}

async function readXlsx(bytes) {
  const read = await unzip(bytes), workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error(BAD_FILE);
  const sheet = attributes(/<sheet\b[^>]*>/.exec(workbook)?.[0] ?? ''), id = Object.entries(sheet).find(([name]) => /(^|:)id$/.test(name))?.[1];
  const target = [...((await read('xl/_rels/workbook.xml.rels')) ?? '').matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => attributes(tag)).find(rel => rel.Id === id)?.Target;
  const path = !target ? 'xl/worksheets/sheet1.xml' : target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map(([, xml = '']) => text(xml));
  const xml = await read(path);
  if (!xml) throw new Error(BAD_FILE);
  return parseSheet(xml, shared);
}

export function parseSheet(xml, shared = []) {
  const rows = [];
  for (const [, rowAttributes, body = ''] of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = Number(attributes(rowAttributes).r) || (rows.at(-1)?.row ?? 0) + 1, cells = [];
    for (const [, cellAttributes, content = ''] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const { r, t } = attributes(cellAttributes), value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(content)?.[1];
      cells[r ? columnIndex(r) : cells.length] = t === 's' ? shared[Number(value)] ?? '' : t === 'inlineStr' ? text(content) : t === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : decode(value ?? '');
    }
    rows.push({ row, cells: Array.from(cells, cell => cell ?? '') });
  }
  return rows;
}

// Excel saves CSV with semicolons in many locales (including Indonesian), so
// the delimiter is detected from the header line.
export function parseCsv(source) {
  const input = source.replace(/^﻿/, ''), header = input.split(/\r?\n/, 1)[0];
  const delimiter = [';', '\t'].reduce((best, d) => header.split(d).length > header.split(best).length ? d : best, ',');
  const rows = [];
  let cells = [''], quoted = false, line = 1, row = 1;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cells[cells.length - 1] += '"'; i++; }
      else if (ch === '"') quoted = false;
      else { if (ch === '\n') line++; cells[cells.length - 1] += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) cells.push('');
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && input[i + 1] === '\n') i++; rows.push({ row, cells }); cells = ['']; row = ++line; }
    else cells[cells.length - 1] += ch;
  }
  if (cells.length > 1 || cells[0]) rows.push({ row, cells });
  return rows;
}

// Turns spreadsheet rows into editor questions. Game settings are not read
// from the file: every question gets the quiz defaults set in the editor.
export function rowsToQuestions(rows, settings) {
  const [header, ...body] = rows.filter(({ cells }) => cells.some(cell => String(cell).trim()));
  const expected = 'Use these column headers in the first row: Soal, A, B, C, D, Jawaban Benar.';
  if (!header) throw new Error(`This file is empty. ${expected}`);
  const key = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, ''), columns = { options: [] };
  header.cells.forEach((cell, i) => {
    const name = key(cell), letter = /^(?:opsi|option|pilihan)?([a-f])$/.exec(name)?.[1];
    if (letter) columns.options[LETTERS.indexOf(letter.toUpperCase())] ??= i;
    else if (HEADERS.question.includes(name)) columns.question ??= i;
    else if (HEADERS.answer.includes(name)) columns.answer ??= i;
  });
  const hole = [...columns.options].findIndex(column => column === undefined), optionCount = hole < 0 ? columns.options.length : hole;
  if (columns.question === undefined || columns.answer === undefined || optionCount < 2) throw new Error(`Row ${header.row} is missing a column. ${expected}`);
  if (optionCount !== columns.options.length) throw new Error(`Option columns must run in order (A, B, C, …) with no letter skipped. ${expected}`);
  const optionColumns = columns.options, questions = [], errors = [];
  for (const { row, cells } of body) {
    const cell = i => String(cells[i] ?? '').trim();
    const text = cell(columns.question), values = optionColumns.map(cell), answer = cell(columns.answer);
    if (!text && !answer && values.every(value => !value)) continue;
    const options = values.slice(0, values.findLastIndex(Boolean) + 1), problems = [];
    if (!text) problems.push('the question (Soal) is empty');
    else if (text.length > 500) problems.push('the question is longer than 500 characters');
    const gap = options.findIndex(value => !value), long = options.findIndex(value => value.length > 200);
    if (gap >= 0) problems.push(`option ${LETTERS[gap]} is empty but a later option is filled`);
    else if (options.length < 2) problems.push('it needs at least 2 options (A and B)');
    if (long >= 0) problems.push(`option ${LETTERS[long]} is longer than 200 characters`);
    if (new Set(options.map(value => value.toLowerCase())).size !== options.length) problems.push('two options have the same text');
    const tokens = answer.toUpperCase().replace(/\b(?:DAN|AND)\b/g, ',').split(/[\s,;/&+]+/).filter(Boolean);
    const correct = [...new Set(tokens.map(token => /^[A-F]$/.test(token) ? LETTERS.indexOf(token) : -1))].sort((a, b) => a - b);
    if (!tokens.length) problems.push('Jawaban Benar is empty');
    else if (correct.includes(-1)) problems.push(`Jawaban Benar must be option letters like A or A,B (found "${answer}")`);
    else if (correct.some(i => i >= options.length)) problems.push(`answer ${LETTERS[correct.find(i => i >= options.length)]} has no option text`);
    if (problems.length) errors.push(`Row ${row}: ${problems.join('; ')}.`);
    else questions.push({ text, type: correct.length > 1 ? 'multiple' : 'single', options, correct, ...settings });
  }
  if (!questions.length && !errors.length) errors.push(`No questions found below the header row (row ${header.row}).`);
  return { questions, errors };
}

let crcTable;
function crc32(data) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  let crc = -1;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
const littleEndian = (...fields) => {
  const out = new Uint8Array(fields.reduce((n, [, size]) => n + size, 0)), view = new DataView(out.buffer);
  let at = 0;
  for (const [value, size] of fields) { if (size === 2) view.setUint16(at, value, true); else view.setUint32(at, value, true); at += size; }
  return out;
};
// Builds a zip archive. Entries are stored uncompressed unless a raw-deflate
// function is given (tests use one to cover the compressed read path).
function zip(entries, deflate) {
  const encoder = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const path = encoder.encode(name), raw = encoder.encode(content), data = deflate ? deflate(raw) : raw, method = deflate ? 8 : 0, crc = crc32(raw);
    const common = [[20, 2], [0, 2], [method, 2], [0, 2], [33, 2], [crc, 4], [data.length, 4], [raw.length, 4], [path.length, 2], [0, 2]];
    parts.push(littleEndian([0x04034b50, 4], ...common), path, data);
    central.push(littleEndian([0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]), path);
    offset += 30 + path.length + data.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const all = [...parts, ...central, littleEndian([0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2], [size, 4], [offset, 4], [0, 2])];
  const out = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
  all.reduce((at, part) => { out.set(part, at); return at + part.length; }, 0);
  return out;
}

export function createWorkbook(rows, deflate = null) {
  const escapeXml = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shared = [], indexes = new Map();
  const sheetRows = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((value, c) => {
    if (value === '' || value == null) return '';
    const ref = String.fromCharCode(65 + c) + (r + 1), style = r === 0 ? ' s="1"' : '';
    if (typeof value === 'number') return `<c r="${ref}"${style}><v>${value}</v></c>`;
    if (!indexes.has(value)) { indexes.set(value, shared.length); shared.push(value); }
    return `<c r="${ref}"${style} t="s"><v>${indexes.get(value)}</v></c>`;
  }).join('')}</row>`).join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', type = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return zip([
    ['[Content_Types].xml', `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${type}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${type}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${type}.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${type}.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${xml}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', `${xml}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`],
    ['xl/sharedStrings.xml', `${xml}<sst xmlns="${main}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(value => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/sheet1.xml', `${xml}<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="50" customWidth="1"/><col min="2" max="5" width="22" customWidth="1"/><col min="6" max="6" width="16" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`],
  ], deflate);
}
export const templateWorkbook = () => createWorkbook(TEMPLATE_ROWS);
