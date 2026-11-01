import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { previewOutputPath, renderPreview } from '../scripts/render-preview.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'rig-preview-test-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('preview output', () => {
  it('rejects output inside the repository', async () => {
    await expect(previewOutputPath(join(repositoryRoot, 'preview.html'))).rejects.toThrow('outside the repository');
  });

  it('rejects an outside symlink that points into the repository', async () => {
    const alias = join(temporaryDirectory, 'alias');
    await symlink(repositoryRoot, alias);
    await expect(previewOutputPath(join(alias, 'preview.html'))).rejects.toThrow('outside the repository');
  });

  it('rejects a dangling file symlink that points into the repository', async () => {
    const alias = join(temporaryDirectory, 'alias.html');
    await symlink(join(repositoryRoot, 'missing-preview.html'), alias);
    await expect(previewOutputPath(alias)).rejects.toThrow('outside the repository');
  });

  it('writes the server response without modifying the HTML', async () => {
    const app = new Hono();
    const html = '<!doctype html><html><body>test marker</body></html>';
    app.get('/digest/2026-10-28', (c) => c.html(html));
    const output = join(temporaryDirectory, 'pages', 'index.html');
    await renderPreview(output, undefined, app);
    expect(await readFile(output, 'utf8')).toBe(html);
  });

  it('fails without writing a failed response', async () => {
    const output = join(temporaryDirectory, 'index.html');
    await expect(renderPreview(output, undefined, new Hono())).rejects.toThrow('HTTP 404');
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
