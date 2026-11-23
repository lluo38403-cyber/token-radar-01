// Token Radar, radar-2 entry (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <snapshot.json|directory>), scores every genuine pre-token protocol with
// the model in lib/model.ts, writes the ranked board to /output/board.json
// and the dashboard's data to /output/data.js, copies dashboard/ and
// screenshots/ into /output, and writes /output/dossier.json with the
// vendored make.fun library, so the judge can read the entry from the
// dossier alone. The program runs twice and writes the same bytes both
// times: nothing here reads the clock, the network, or a random value.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SHOT_MAX = 4;
const SHOT_MAX_BYTES = 524_288;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `--name <value>` (or `--name=<value>`) out of the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

// Read the dashboard data back and prove it parses: a corrupt data.js
// would ship a blank page, so refuse it here and name the file.
const dataText = readFileSync(join(outDir, 'data.js'), 'utf8');
if (!dataText.startsWith('window.RADAR=') || !dataText.trimEnd().endsWith(';')) {
  process.stderr.write(`token radar: ${join(outDir, 'data.js')} does not start with window.RADAR= or end with ';': the dashboard data was not written\n`);
  process.exit(1);
}
try {
  const body = dataText.slice('window.RADAR='.length).trimEnd();
  const jsonText = body.endsWith(';') ? body.slice(0, -1) : body;
  const parsed = JSON.parse(jsonText);
  if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length !== board.length) {
    process.stderr.write(`token radar: ${join(outDir, 'data.js')} holds ${Array.isArray(parsed?.rows) ? parsed.rows.length : 'no'} rows, the board has ${board.length}: the dashboard data does not match the board\n`);
    process.exit(1);
  }
} catch (e) {
  process.stderr.write(`token radar: ${join(outDir, 'data.js')} does not parse as JSON: ${(e as Error).message}\n`);
  process.exit(1);
}

/** Copy one directory's regular files into `to`, skipping dot-names, and report what landed. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const landed: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    landed.push(name);
  }
  return landed;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const size = statSync(join(here, 'screenshots', name)).size;
  if (size === 0) {
    process.stderr.write(`token radar: screenshots/${name} is empty: hand in a real render, not a zero-byte file\n`);
    process.exit(1);
  }
  if (size > SHOT_MAX_BYTES) {
    process.stderr.write(`token radar: screenshots/${name} is ${size} bytes, over the ${SHOT_MAX_BYTES} byte cap: shrink the render\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: SHOT_MAX, max_bytes: SHOT_MAX_BYTES }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: top implied value $${radar.summary.top_implied_usd}, median $${radar.summary.median_implied_usd}, ${radar.summary.category_count} categories, $${radar.summary.total_implied_usd} total implied value\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
