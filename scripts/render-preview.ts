import { lstat, mkdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createApp } from '../src/app.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultNight = '2026-10-28';

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

// Resolve existing ancestors too: a symlink outside the repo can point back into it.
async function canonicalPath(path: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error('Cannot resolve preview output path.');
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    const entry = await lstat(path).catch((entryError: unknown) => {
      if (entryError instanceof Error && 'code' in entryError && entryError.code === 'ENOENT') return null;
      throw entryError;
    });
    if (entry?.isSymbolicLink()) {
      return canonicalPath(resolve(dirname(path), await readlink(path)), depth + 1);
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalPath(parent, depth + 1), relative(parent, path));
  }
}

export async function previewOutputPath(output: string): Promise<string> {
  if (!output.trim()) throw new Error('Specify an output file outside the repository.');
  const requested = resolve(output);
  const [root, target] = await Promise.all([realpath(repositoryRoot), canonicalPath(requested)]);
  if (isWithin(repositoryRoot, requested) || isWithin(root, target)) {
    throw new Error('Preview output must be outside the repository.');
  }
  return target;
}

export async function renderPreview(
  output: string,
  night = defaultNight,
  app = createApp(),
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) throw new Error('Night must use YYYY-MM-DD.');
  const target = await previewOutputPath(output);
  const response = await app.request(`/digest/${night}`);
  if (response.status !== 200) {
    throw new Error(`Digest render failed with HTTP ${response.status}.`);
  }
  if (!response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Digest response must be HTML.');
  }
  const html = await response.text();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html, { encoding: 'utf8', mode: 0o600 });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      output: { type: 'string' },
      night: { type: 'string', default: defaultNight },
    },
  });
  if (!values.output) throw new Error('Required: --output <file outside the repository>.');
  await renderPreview(values.output, values.night);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // Never print the response body or environment: either can contain the lane marker.
    console.error(error instanceof Error ? error.message : 'Preview render failed.');
    process.exitCode = 1;
  });
}
