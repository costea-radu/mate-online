// Teste pentru parsarea căilor Supabase Storage (node --test, fără dependențe).
const test = require('node:test');
const assert = require('node:assert');
const { parseStoragePath } = require('../api/_lib/http');

test('parseStoragePath: URL public standard', () => {
  const { bucket, filePath } = parseStoragePath(
    'https://xyz.supabase.co/storage/v1/object/public/materiale/clasa-9/test.pdf');
  assert.strictEqual(bucket, 'materiale');
  assert.strictEqual(filePath, 'clasa-9/test.pdf');
});

test('parseStoragePath: elimină query params', () => {
  const { filePath } = parseStoragePath(
    'https://xyz.supabase.co/storage/v1/object/public/b/a/b.pdf?token=abc&x=1');
  assert.strictEqual(filePath, 'a/b.pdf');
});

test('parseStoragePath: format signed (/object/sign/)', () => {
  const { bucket, filePath } = parseStoragePath(
    'https://xyz.supabase.co/storage/v1/object/sign/rezolvari/2025/bac.pdf');
  assert.strictEqual(bucket, 'rezolvari');
  assert.strictEqual(filePath, '2025/bac.pdf');
});

test('parseStoragePath: URL fără /object/ aruncă eroare', () => {
  assert.throws(() => parseStoragePath('https://example.com/oops/file.pdf'));
});
