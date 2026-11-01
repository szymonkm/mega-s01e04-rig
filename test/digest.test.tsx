import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const baseConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
};

const runDirs: string[] = [];
let previousLaneMarker: string | undefined;

beforeEach(() => {
  previousLaneMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = 'DIGEST-TEST-MARKER';
});

afterEach(async () => {
  if (previousLaneMarker === undefined) {
    delete process.env.LANE_MARKER;
  } else {
    process.env.LANE_MARKER = previousLaneMarker;
  }

  await Promise.all(runDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function appWithNight(night: string, content: string) {
  const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-tests-'));
  runDirs.push(runsDir);
  await writeFile(join(runsDir, `${night}.jsonl`), content, 'utf8');
  return createApp({ ...baseConfig, runsDir });
}

describe('digest routes', () => {
  it('serves the same sorted jobs in HTML and JSON, with escaped and retained row data', async () => {
    const night = '2026-10-28';
    const app = await appWithNight(
      night,
      [
        JSON.stringify({
          at: '2026-10-28T09:00:00+02:00',
          job: 'zeta',
          status: 'ok',
          owner: 'Zed',
        }),
        JSON.stringify({
          at: '2026-10-28T09:10:00+02:00',
          job: '<script>alpha</script>',
          status: 'retry',
          owner: null,
          error: '<img src=x onerror=alert(1)>',
        }),
        JSON.stringify({
          at: '2026-10-28T13:10:00+05:30',
          job: '<script>alpha</script>',
          status: 'retry',
          owner: null,
        }),
        JSON.stringify({
          at: '2026-10-28T14:10:00+05:30',
          job: '<script>alpha</script>',
          status: 'retry',
          owner: null,
        }),
        JSON.stringify({
          at: '2026-10-28T15:10:00+05:30',
          job: '<script>alpha</script>',
          status: 'fail',
          owner: null,
        }),
      ].join('\n'),
    );

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(digest.rows.map((row) => row.job)).toEqual([
      '<script>alpha</script>',
      'zeta',
    ]);
    expect(html.indexOf('&lt;script&gt;alpha&lt;/script&gt;')).toBeLessThan(
      html.indexOf('zeta'),
    );
    expect(html).toContain('DIGEST-TEST-MARKER');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alpha</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');

    const alpha = digest.rows[0];
    expect(alpha).toMatchObject({
      owner: null,
      runs: 4,
      retries: 3,
      lastStatus: 'fail',
      lastError: '<img src=x onerror=alert(1)>',
      firstAt: '2026-10-28T09:10:00+02:00',
      lastAt: '2026-10-28T15:10:00+05:30',
    });
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T09:10:00+02:00');
    expect(html).toContain('2026-10-28T15:10:00+05:30');
    expect(html).toContain('class="warn">3</td>');
    expect(html).toContain('class="warn">fail</td>');
  });

  it('returns 404 for a night without a file on both routes', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-tests-'));
    runDirs.push(runsDir);
    const app = createApp({ ...baseConfig, runsDir });

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-30'),
      app.request('/api/digest/2026-10-30'),
    ]);

    expect(htmlResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
  });

  it('renders an empty night in HTML and returns empty rows in JSON', async () => {
    const night = '2026-10-29';
    const app = await appWithNight(night, '');

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(digest.rows).toEqual([]);
  });

  it('counts malformed lines and still renders valid rows', async () => {
    const night = '2026-10-28';
    const app = await appWithNight(
      night,
      [
        '{not valid json',
        JSON.stringify({
          at: '2026-10-28T08:00:00-04:00',
          job: 'valid-job',
          status: 'ok',
          owner: 'Ari',
        }),
      ].join('\n'),
    );

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(html).toContain('Invalid lines: 1');
    expect(html).toContain('valid-job');
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual(['valid-job']);
  });
});
