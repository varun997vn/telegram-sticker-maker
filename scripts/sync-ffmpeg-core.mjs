#!/usr/bin/env node
/**
 * Copy the ffmpeg.wasm core into `public/` so it is served from our own origin.
 *
 * The default core URL in @ffmpeg/ffmpeg points at a CDN. Serving it ourselves
 * removes a third-party runtime dependency from a tool whose whole premise is
 * that nothing leaves the user's machine, and it means the files are cached
 * alongside the app rather than fetched cross-origin on first export.
 *
 * The ESM build is the one to copy: @ffmpeg/ffmpeg spawns a module worker, so
 * its `importScripts` path always fails and it falls back to importing the
 * core as a module.
 *
 * These files are ~32 MB, so they are gitignored and regenerated from
 * node_modules on every build rather than committed.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const to = join(root, 'public', 'ffmpeg');

const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(from))) {
  console.error(
    `Could not find the ffmpeg core at ${from}.\nRun "npm install" first — @ffmpeg/core is a dev dependency.`,
  );
  process.exit(1);
}

await mkdir(to, { recursive: true });

for (const file of FILES) {
  const source = join(from, file);
  const destination = join(to, file);

  // Skip an unchanged copy: the wasm is large enough that rewriting it on
  // every dev-server restart is noticeable.
  const sourceStat = await stat(source);
  const destinationStat = (await exists(destination)) ? await stat(destination) : null;

  if (destinationStat && destinationStat.size === sourceStat.size && destinationStat.mtimeMs >= sourceStat.mtimeMs) {
    continue;
  }

  await copyFile(source, destination);
  console.log(`ffmpeg core: copied ${file} (${(sourceStat.size / 1e6).toFixed(1)} MB)`);
}
