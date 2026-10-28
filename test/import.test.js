import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { validateQuiz } from '../lib/game.js';
import { TEMPLATE_ROWS, createWorkbook, parseCsv, parseSheet, readSpreadsheet, rowsToQuestions, templateWorkbook } from '../public/import.js';

const settings = { duration: 20, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false };
const rows = (...values) => values.map((cells, i) => ({ row: i + 1, cells }));
const header = ['Soal', 'A', 'B', 'C', 'D', 'Jawaban Benar'];

test('rows become single and multiple-answer questions using the editor defaults', () => {
  const { questions, errors } = rowsToQuestions(rows(header,
    ['Siapa yang membangun bahtera?', 'Musa', 'Nuh', 'Abraham', 'Daud', 'B'],
    ['Murid Yesus?', 'Petrus', 'Yohanes', 'Goliat', 'Firaun', ' b , a '],
    ['', '', '', '', '', ''],
    ['Tiga opsi', 'Satu', 'Dua', 'Tiga', '', 'c'],
    ['Pakai dan', 'Satu', 'Dua', 'Tiga', 'Empat', 'A dan D'],
  ), settings);
  assert.deepEqual(errors, []);
  assert.deepEqual(questions[0], { text: 'Siapa yang membangun bahtera?', type: 'single', options: ['Musa', 'Nuh', 'Abraham', 'Daud'], correct: [1], ...settings });
  assert.deepEqual([questions[1].type, questions[1].correct], ['multiple', [0, 1]]);
  assert.deepEqual([questions[2].options, questions[2].correct], [['Satu', 'Dua', 'Tiga'], [2]]);
  assert.deepEqual(questions[3].correct, [0, 3]);
  assert.doesNotThrow(() => validateQuiz({ title: 'Imported', questions }));
});

test('header names are flexible and columns can be in any order', () => {
  const { questions } = rowsToQuestions(rows(['Kunci Jawaban', 'Opsi A', 'Opsi B', 'Pertanyaan'], ['a', 'Ya', 'Tidak', 'Benar?']), settings);
  assert.deepEqual([questions[0].text, questions[0].options, questions[0].correct], ['Benar?', ['Ya', 'Tidak'], [0]]);
});

test('invalid rows are reported with their spreadsheet row numbers', () => {
  const { questions, errors } = rowsToQuestions(rows(header,
    ['Ok', 'Satu', 'Dua', '', '', 'A'],
    ['', 'Satu', 'Dua', '', '', 'A'],
    ['Gap', 'Satu', '', 'Tiga', '', 'A'],
    ['Wrong letter', 'Satu', 'Dua', '', '', 'X'],
    ['Missing option', 'Satu', 'Dua', '', '', 'C'],
    ['Same', 'Satu', 'satu', '', '', 'A'],
    ['No answer', 'Satu', 'Dua', '', '', ''],
  ), settings);
  assert.equal(questions.length, 1);
  assert.equal(errors.length, 6);
  assert.match(errors[0], /^Row 3: the question \(Soal\) is empty/);
  assert.match(errors[1], /^Row 4: option B is empty/);
  assert.match(errors[2], /^Row 5: .*found "X"/);
  assert.match(errors[3], /^Row 6: answer C has no option text/);
  assert.match(errors[4], /^Row 7: two options have the same text/);
  assert.match(errors[5], /^Row 8: Jawaban Benar is empty/);
});

test('missing or out-of-order headers are rejected', () => {
  assert.throws(() => rowsToQuestions([], settings), /empty/);
  assert.throws(() => rowsToQuestions(rows(['Soal', 'A', 'B', 'C']), settings), /missing a column/);
  assert.throws(() => rowsToQuestions(rows(['Soal', 'A', 'B', 'D', 'Jawaban Benar']), settings), /no letter skipped/);
});

test('CSV parsing detects semicolons and handles quotes, line breaks and BOM', () => {
  const parsed = parseCsv('﻿Soal;A;B;Jawaban Benar\r\n"Kata ""kunci""; ya?";"Satu\nbaris";Dua;A,B\r\n');
  assert.deepEqual(parsed, [{ row: 1, cells: ['Soal', 'A', 'B', 'Jawaban Benar'] }, { row: 2, cells: ['Kata "kunci"; ya?', 'Satu\nbaris', 'Dua', 'A,B'] }]);
  assert.deepEqual(parseCsv('Soal,A\nx,y').map(r => r.cells), [['Soal', 'A'], ['x', 'y']]);
});

test('sheet XML supports shared, inline, numeric and boolean cells, and keeps row numbers', () => {
  const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><r><t>Rich </t></r><r><t>text &amp; more</t></r></is></c></row><row r="3"/><row r="4"><c r="B4"><v>1945</v></c><c r="C4" t="b"><v>1</v></c></row></sheetData>';
  assert.deepEqual(parseSheet(xml, ['Soal']), [{ row: 1, cells: ['Soal', '', 'Rich text & more'] }, { row: 3, cells: [] }, { row: 4, cells: ['', '1945', 'TRUE'] }]);
});

test('the downloadable template and compressed workbooks read back as questions', async () => {
  const template = await readSpreadsheet(new File([templateWorkbook()], 'template.xlsx'));
  assert.deepEqual(template.map(r => r.cells), TEMPLATE_ROWS.map(cells => cells.slice(0, cells.findLastIndex(Boolean) + 1)));
  assert.equal(rowsToQuestions(template, settings).questions.length, 3);
  const compressed = createWorkbook([header, ['Tahun?', 1945, 1950, '<&>', '', 'A']], deflateRawSync);
  const [, row] = await readSpreadsheet(new File([compressed], 'questions.xlsx'));
  assert.deepEqual(row, { row: 2, cells: ['Tahun?', '1945', '1950', '<&>', '', 'A'] });
  await assert.rejects(readSpreadsheet(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'old.xls')), /\.xls files are not supported/);
});
