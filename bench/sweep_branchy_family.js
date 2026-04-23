#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

function parseArgs(argv) {
  const out = {
    maxOptions: 4,
    direct: 'both',
    retries: 3,
    outdir: null,
    pair: 'D->B|evm|fund:db',
    keepGenerated: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--maxOptions') out.maxOptions = Number(next), i++;
    else if (a === '--direct') out.direct = next, i++;
    else if (a === '--retries') out.retries = Number(next), i++;
    else if (a === '--outdir') out.outdir = next, i++;
    else if (a === '--pair') out.pair = next, i++;
    else if (a === '--keepGenerated') out.keepGenerated = /^(1|true|yes)$/i.test(next), i++;
    else if (a === '--help') out.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!Number.isInteger(out.maxOptions) || out.maxOptions < 0) throw new Error('--maxOptions must be >= 0');
  if (!['both', 'true', 'false'].includes(out.direct)) throw new Error('--direct must be one of both|true|false');
  return out;
}

function usage() {
  console.log(`Usage:
  node bench/sweep_branchy_family.js [--maxOptions 4] [--direct both] [--retries 3] [--outdir results/branchy-sweep]

Requires existing project scripts from earlier steps:
  - tools/generate_branchy_atg.js (this kit)
  - bench/run_atg_suite.js
  - tools/summarize_atg_results.js
`);
}

function sh(cmd, args, opts = {}) {
  const res = cp.spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (res.status !== 0) {
    const err = new Error(`${cmd} ${args.join(' ')} failed with code ${res.status}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    throw err;
  }
  return res;
}

function listAtgBenchDirs(base) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .filter((x) => x.startsWith('atg-bench-'))
    .map((x) => path.join(base, x))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function newestNewDir(before, after) {
  const beforeSet = new Set(before);
  for (const d of after) {
    if (!beforeSet.has(d)) return d;
  }
  return after[0] || null;
}

function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? '';
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') q = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCsv(rows, outPath) {
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
}

function boolModes(which) {
  if (which === 'both') return [false, true];
  return [which === 'true'];
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();

  const projectRoot = process.cwd();
  const resultsBase = path.join(projectRoot, 'results');
  ensureDir(resultsBase);

  const outdir = args.outdir || path.join(resultsBase, `branchy-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  ensureDir(outdir);
  const genDir = path.join(outdir, 'generated-atgs');
  ensureDir(genDir);

  const rows = [];
  const logs = [];

  for (const direct of boolModes(args.direct)) {
    for (let options = 0; options <= args.maxOptions; options++) {
      if (!direct && options === 0) continue;
      const name = `branchy_direct-${direct ? '1' : '0'}_options-${options}.json`;
      const atgPath = path.join(genDir, name);
      sh('node', ['tools/generate_branchy_atg.js', '--out', atgPath, '--direct', String(direct), '--options', String(options)]);

      const before = listAtgBenchDirs(resultsBase);
      try {
        sh('node', ['bench/run_atg_suite.js', '--atg', atgPath, '--pair', args.pair, '--retries', String(args.retries)]);
      } catch (e) {
        rows.push({
          direct,
          options,
          pair: args.pair,
          ok: false,
          error: (e.stderr || e.message || '').trim().slice(0, 5000),
        });
        logs.push({ direct, options, stage: 'run_atg_suite', error: e.message, stderr: e.stderr, stdout: e.stdout });
        continue;
      }
      const after = listAtgBenchDirs(resultsBase);
      const runDir = newestNewDir(before, after);
      if (!runDir) {
        rows.push({ direct, options, pair: args.pair, ok: false, error: 'could not locate fresh atg-bench directory' });
        continue;
      }

      const analysisCsv = path.join(runDir, 'analysis.csv');
      try {
        sh('node', ['tools/summarize_atg_results.js', '--compiled', path.join(runDir, 'compiled.atg.json'), '--summary', path.join(runDir, 'summary.json'), '--out', analysisCsv]);
      } catch (e) {
        rows.push({ direct, options, pair: args.pair, ok: false, error: 'summarize_atg_results failed: ' + (e.stderr || e.message) });
        logs.push({ direct, options, stage: 'summarize', error: e.message, stderr: e.stderr, stdout: e.stdout });
        continue;
      }

      const parsed = parseCsv(fs.readFileSync(analysisCsv, 'utf8'));
      const row = parsed.find((r) => r.pair === args.pair) || parsed[0] || {};
      rows.push({
        direct,
        options,
        pair: args.pair,
        contract: row.contract || '',
        levels: row.levels || '',
        duplicateVector: row.duplicateVector || '',
        pattern: row.pattern || '',
        bestClaimGas: row.bestClaimGas || '',
        worstClaimGas: row.worstClaimGas || '',
        refundGas: row.refundGas || '',
        bestDisableGas: row.bestDisableGas || '',
        worstDisableGas: row.worstDisableGas || '',
        refundDisableGas: row.refundDisableGas || '',
        deployGasDecimal: row.deployGasDecimal || '',
        ok: row.okAll || '',
        notes: row.notes || '',
        runDir,
      });
    }
  }

  fs.writeFileSync(path.join(outdir, 'sweep.json'), JSON.stringify(rows, null, 2));
  writeCsv(rows, path.join(outdir, 'sweep.csv'));
  fs.writeFileSync(path.join(outdir, 'debug.json'), JSON.stringify(logs, null, 2));
  if (!args.keepGenerated) {
    // Keep generated ATGs by default if debugging is needed; remove only on explicit false? We keep them.
  }
  console.log(`Wrote ${path.join(outdir, 'sweep.csv')}`);
}

main();
