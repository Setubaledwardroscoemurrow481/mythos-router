import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  initMemory,
  appendEntry,
  readMemory,
  getEntryCount,
  needsDream,
  writeCompressedMemory,
  getMemoryContext,
  getMemoryPath,
} from '../src/memory.js';


const memoryPath = getMemoryPath();
let backup: string | null = null;

describe('Memory System', () => {
  beforeEach(() => {
    if (existsSync(memoryPath)) {
      backup = readFileSync(memoryPath, 'utf-8');
    }
    if (existsSync(memoryPath)) {
      unlinkSync(memoryPath);
    }
  });

  afterEach(() => {
    if (backup !== null) {
      writeFileSync(memoryPath, backup, 'utf-8');
    } else if (existsSync(memoryPath)) {
      unlinkSync(memoryPath);
    }
  });


  it('creates MEMORY.md if it does not exist', () => {
    assert.equal(existsSync(memoryPath), false);
    initMemory();
    assert.equal(existsSync(memoryPath), true);
  });

  it('does not overwrite existing MEMORY.md', () => {
    writeFileSync(memoryPath, '# Custom Memory\n', 'utf-8');
    initMemory();
    const content = readFileSync(memoryPath, 'utf-8');
    assert.ok(content.includes('# Custom Memory'));
  });

  it('skips creation in dry-run mode', () => {
    initMemory(true); // dry-run
    assert.equal(existsSync(memoryPath), false);
  });


  it('appends and reads back entries', () => {
    initMemory();
    appendEntry('CREATE: src/test.ts', '✅ verified');
    appendEntry('MODIFY: src/config.ts', '✅ verified');

    const { entries } = readMemory();
    assert.equal(entries.length, 2);
    assert.ok(entries[0]!.action.includes('CREATE'));
    assert.ok(entries[1]!.action.includes('MODIFY'));
  });

  it('sanitizes pipes in entry content', () => {
    initMemory();
    appendEntry('test|with|pipes', 'result|here');

    const raw = readFileSync(memoryPath, 'utf-8');
    const dataLines = raw.split('\n').filter(
      (l) => l.startsWith('|') && !l.includes('---') && !l.includes('Timestamp'),
    );
    assert.equal(dataLines.length, 1);
    assert.ok(!dataLines[0]!.includes('test|with'));
  });

  it('skips append in dry-run mode', () => {
    initMemory();
    const before = readFileSync(memoryPath, 'utf-8');
    appendEntry('should-not-appear', 'dry-run', true);
    const after = readFileSync(memoryPath, 'utf-8');
    assert.equal(before, after);
  });


  it('returns 0 for fresh memory', () => {
    initMemory();
    assert.equal(getEntryCount(), 0);
  });

  it('returns correct count after appending', () => {
    initMemory();
    appendEntry('action1', 'result1');
    appendEntry('action2', 'result2');
    appendEntry('action3', 'result3');
    assert.equal(getEntryCount(), 3);
  });


  it('returns false when under threshold', () => {
    initMemory();
    appendEntry('test', 'test');
    assert.equal(needsDream(), false);
  });


  it('returns full content when under maxChars', () => {
    initMemory();
    appendEntry('short action', 'short result');
    const ctx = getMemoryContext(10_000);
    assert.ok(ctx.includes('short action'));
  });

  it('truncates content when over maxChars', () => {
    initMemory();
    for (let i = 0; i < 20; i++) {
      appendEntry(`action number ${i} with some extra text`, `result number ${i}`);
    }
    const ctx = getMemoryContext(200);
    assert.ok(ctx.includes('[truncated]'));
    assert.ok(ctx.length <= 220);
  });


  it('writes compressed memory with summary and recent entries', () => {
    initMemory();
    const recentEntries = [
      { timestamp: '2026-01-01 00:00:00', action: 'recent1', result: '✅' },
      { timestamp: '2026-01-01 00:01:00', action: 'recent2', result: '✅' },
    ];
    writeCompressedMemory('This is a dream summary.', recentEntries);

    const content = readFileSync(memoryPath, 'utf-8');
    assert.ok(content.includes('Dream Summary'));
    assert.ok(content.includes('This is a dream summary.'));
    assert.ok(content.includes('recent1'));
    assert.ok(content.includes('recent2'));
  });

  it('skips write in dry-run mode', () => {
    initMemory();
    const before = readFileSync(memoryPath, 'utf-8');
    writeCompressedMemory('summary', [], true);
    const after = readFileSync(memoryPath, 'utf-8');
    assert.equal(before, after);
  });
});
