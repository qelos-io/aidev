import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutputFormat, printRows, OutputColumn } from '../output';

interface Row {
  id: string;
  title: string;
}

const columns: OutputColumn<Row>[] = [
  { key: 'ID', value: (r) => r.id },
  { key: 'Title', value: (r) => r.title },
];

function captureLogs(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    lines.push(String(msg));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines;
}

describe('parseOutputFormat', () => {
  it('defaults to table when raw is undefined', () => {
    assert.equal(parseOutputFormat(undefined), 'table');
  });

  it('accepts table, json, csv', () => {
    assert.equal(parseOutputFormat('table'), 'table');
    assert.equal(parseOutputFormat('json'), 'json');
    assert.equal(parseOutputFormat('csv'), 'csv');
  });

  it('rejects an invalid value', () => {
    assert.throws(() => parseOutputFormat('xml'), /Invalid output format/);
  });
});

describe('printRows table', () => {
  it('prints just the header for empty rows', () => {
    const lines = captureLogs(() => printRows([], columns, 'table'));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /ID/);
    assert.match(lines[0], /Title/);
  });

  it('prints a padded table for non-empty rows', () => {
    const rows: Row[] = [{ id: '1', title: 'Fix bug' }];
    const lines = captureLogs(() => printRows(rows, columns, 'table'));
    assert.equal(lines.length, 3);
    assert.match(lines[2], /1/);
    assert.match(lines[2], /Fix bug/);
  });
});

describe('printRows json', () => {
  it('prints [] for empty rows', () => {
    const lines = captureLogs(() => printRows([], columns, 'json'));
    const parsed = JSON.parse(lines.join('\n'));
    assert.deepEqual(parsed, []);
  });

  it('round-trips through JSON.parse', () => {
    const rows: Row[] = [{ id: '1', title: 'Fix bug' }];
    const lines = captureLogs(() => printRows(rows, columns, 'json'));
    const parsed = JSON.parse(lines.join('\n'));
    assert.deepEqual(parsed, [{ ID: '1', Title: 'Fix bug' }]);
  });
});

describe('printRows csv', () => {
  it('prints just the header for empty rows', () => {
    const lines = captureLogs(() => printRows([], columns, 'csv'));
    assert.deepEqual(lines, ['ID,Title']);
  });

  it('quotes a field containing a comma', () => {
    const rows: Row[] = [{ id: '1', title: 'Fix, bug' }];
    const lines = captureLogs(() => printRows(rows, columns, 'csv'));
    assert.equal(lines[1], '1,"Fix, bug"');
  });

  it('quotes and escapes a field containing a double quote', () => {
    const rows: Row[] = [{ id: '1', title: 'Say "hi"' }];
    const lines = captureLogs(() => printRows(rows, columns, 'csv'));
    assert.equal(lines[1], '1,"Say ""hi"""');
  });
});
