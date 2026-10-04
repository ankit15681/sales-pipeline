import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The folder rules, checked on every test run:
 *  - shared/ is the contract. It imports nothing from client/ or server/.
 *  - server/ is the fake backend. It never imports from client/.
 *  - client/ talks to the backend only through shared/api.ts. The one exception
 *    is the composition root, client/app/instance.ts, which starts the fake
 *    backend (and tests, which use it as a harness). Both go through server/index.ts.
 */
const SRC = resolve(__dirname);
const COMPOSITION_ROOT = 'client/app/instance.ts';

type Area = 'client' | 'server' | 'shared';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Relative import specifiers, from `import … from`, `export … from` and `import()`. */
function relativeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\1/g)) out.push(m[2]);
  return out;
}

const areaOf = (pathFromSrc: string): Area | null => {
  const top = pathFromSrc.split('/')[0];
  return top === 'client' || top === 'server' || top === 'shared' ? top : null;
};

const imports = sourceFiles(SRC)
  .map((abs) => relative(SRC, abs))
  .filter((file) => file !== 'boundaries.test.ts')
  .flatMap((file) =>
    relativeImports(join(SRC, file)).map((spec) => ({
      file,
      spec,
      target: relative(SRC, resolve(SRC, dirname(file), spec)),
    })),
  );

describe('folder boundaries', () => {
  it('every source file lives in client/, server/ or shared/', () => {
    const stray = sourceFiles(SRC)
      .map((abs) => relative(SRC, abs))
      .filter((f) => f !== 'boundaries.test.ts' && !areaOf(f));
    expect(stray).toEqual([]);
  });

  it('shared/ imports only from shared/', () => {
    const bad = imports.filter((i) => areaOf(i.file) === 'shared' && areaOf(i.target) !== 'shared');
    expect(bad).toEqual([]);
  });

  it('server/ never imports from client/', () => {
    const bad = imports.filter((i) => areaOf(i.file) === 'server' && areaOf(i.target) === 'client');
    expect(bad).toEqual([]);
  });

  it('client/ reaches server/ only from the composition root and tests, through server/index.ts', () => {
    const toServer = imports.filter((i) => areaOf(i.file) === 'client' && areaOf(i.target) === 'server');
    const allowedFile = (f: string) => f === COMPOSITION_ROOT || f.endsWith('.test.ts');
    expect(toServer.filter((i) => !allowedFile(i.file))).toEqual([]);
    expect(toServer.filter((i) => i.target !== 'server' && i.target !== 'server/index')).toEqual([]);
    expect(toServer.length).toBeGreaterThan(0); // the scan itself works
  });
});
