import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const isLocal = (url) => !/^(https?:|data:|#|mailto:|javascript:)/.test(url) && !url.startsWith('//');

/** The top-level files and folders the Pages workflow copies into the site. */
function published() {
  const copy = read('.github/workflows/pages.yml').match(/cp -R ([^\n]+?) _site\//);
  assert.ok(copy, 'the workflow should assemble the site with a single cp -R');
  return new Set(copy[1].trim().split(/\s+/));
}

/** Every local file the page asks for, following ES-module imports. */
function referenced() {
  const found = new Set();
  const pending = [];
  for (const [, url] of read('index.html').matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (!isLocal(url)) continue;
    const path = url.split(/[?#]/)[0];
    found.add(path);
    if (path.endsWith('.js')) pending.push(path);
  }
  while (pending.length) {
    const module = pending.pop();
    if (!existsSync(new URL(`../${module}`, import.meta.url))) continue;
    for (const [, specifier] of read(module).matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
      const path = posix.normalize(posix.join(posix.dirname(module), specifier));
      if (!found.has(path)) {
        found.add(path);
        pending.push(path);
      }
    }
  }
  return found;
}

test('everything the site asks for exists and is published', () => {
  const copied = published();
  const missing = [];
  const unpublished = [];
  for (const path of referenced()) {
    if (path.startsWith('/') || path.startsWith('../')) {
      missing.push(`${path} (not relative to the site; breaks on a project sub-path)`);
      continue;
    }
    if (!existsSync(new URL(`../${path}`, import.meta.url))) missing.push(path);
    if (!copied.has(path.split('/')[0])) unpublished.push(path);
  }
  assert.deepEqual(missing, [], 'every file the site references should be in the repo');
  assert.deepEqual(unpublished, [], 'and the deploy should copy it, or it 404s on the live site');
});

test('the whole game module graph is reached from the page', () => {
  const graph = referenced();
  for (const module of ['src/main.js', 'src/physics.js', 'src/renderer.js', 'src/audio.js', 'src/ghost.js']) {
    assert.ok(graph.has(module), `${module} should be reachable`);
  }
});

test('the site does not publish its own tests or tooling', () => {
  const copied = published();
  for (const internal of ['test', 'node_modules', '.github', 'package.json']) {
    assert.ok(!copied.has(internal), `${internal} should stay out of the site`);
  }
});
