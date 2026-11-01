import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const fixtureDir = fileURLToPath(new URL('../runs/', import.meta.url));
const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };

describe('readNight', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeEvents(events: unknown[]): void {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
  }

  it('reads the real fixture into five sorted jobs and counts its bad line', () => {
    const digest = readNight(fixtureDir, night);
    expect(digest).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it.each([
    '', '../2026-10-28', '2026-10-28/../../secret', '/2026-10-28', '..\\2026-10-28',
    '2026-10-28.jsonl', '2026-1-28', ' 2026-10-28', '2026-10-28\n',
    '2026-02-29', '2026-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '2026-10-00',
  ])('rejects invalid night %j before reading its file', (invalidNight) => {
    if (!invalidNight.includes('/') && !invalidNight.includes('\\')) {
      writeFileSync(join(runsDir, `${invalidNight}.jsonl`), JSON.stringify(event));
    }
    expect(readNight(runsDir, invalidNight)).toBeNull();
  });

  it('does not read a real file outside the runs directory through traversal', () => {
    const nestedRunsDir = join(runsDir, 'logs');
    mkdirSync(nestedRunsDir);
    writeFileSync(join(runsDir, `${night}.jsonl`), JSON.stringify(event));
    expect(readNight(nestedRunsDir, `../${night}`)).toBeNull();
  });

  it('accepts a real leap day', () => {
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29')?.night).toBe('2024-02-29');
  });

  it('returns null for a missing file or directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it('returns an empty digest for an empty file', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and invalid event fields without losing valid events', () => {
    const invalidEvents: unknown[] = [
      null, [], 'text', 123, {},
      { ...event, at: null },
      { ...event, at: 'tomorrow' },
      { ...event, at: '2026-02-30T01:00:00+01:00' },
      { ...event, at: '2026-10-28T24:00:00+01:00' },
      { ...event, at: '2026-10-28T23:00:00' },
      { ...event, at: '2026-10-28T23:00:00+24:00' },
      { ...event, at: '2026-10-28T23:00:00+01:00\n' },
      { ...event, job: null },
      { ...event, job: '  ' },
      { ...event, status: 'unknown' },
      { ...event, status: ['ok'] },
      { ...event, owner: undefined },
      { ...event, owner: 42 },
      { ...event, error: 42 },
      { ...event, error: null },
    ];
    const lines = [JSON.stringify(event), '{broken', ...invalidEvents.map((value) => JSON.stringify(value)),
      JSON.stringify({ ...event, owner: null, status: 'retry' })];
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\r\n') + '\r\n');
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalidEvents.length + 1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0]).toMatchObject({ runs: 2, retries: 1, owner: null, lastStatus: 'retry' });
  });

  it('counts interior blank lines but does not count a final newline as a record', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), `${JSON.stringify(event)}\n\n \n`);
    expect(readNight(runsDir, night)?.badLines).toBe(2);
  });

  it('compares times across offsets, handles unordered events, and retains the latest error', () => {
    writeEvents([
      { ...event, at: '2026-10-29T02:00:00+01:00', owner: null },
      { ...event, at: '2026-10-29T03:00:00+04:00', status: 'retry', error: 'early error' },
      { ...event, at: '2026-10-28T23:30:00Z', status: 'fail', error: 'latest error' },
      { ...event, at: '2026-10-29T01:15:00+02:00', status: 'retry', error: 'middle error' },
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: 'job', owner: null, runs: 4, retries: 2, lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-29T03:00:00+04:00', lastAt: '2026-10-29T02:00:00+01:00',
    }]);
  });

  it('uses later lines for tied latest events and errors while preserving the first timestamp', () => {
    writeEvents([
      { ...event, at: '2026-10-28T23:00:00+01:00', status: 'retry', error: 'first' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'fail', error: 'second' },
      { ...event, at: '2026-10-29T00:00:00+02:00', owner: null },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'second',
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-29T00:00:00+02:00',
    });
  });

  it('sorts by job deterministically and accepts job names that match object keys', () => {
    writeEvents(['z', '__proto__', 'constructor', 'A', 'a'].map((job) => ({ ...event, job })));
    expect(readNight(runsDir, night)?.rows.map((row) => row.job))
      .toEqual(['A', '__proto__', 'a', 'constructor', 'z']);
  });
});
