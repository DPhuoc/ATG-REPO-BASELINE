#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--compiled') out.compiled = argv[++i];
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node tools/summarize_atg_results.js --compiled results/atg-bench-.../compiled.atg.json --summary results/atg-bench-.../summary.json --out results/atg-bench-.../analysis.csv
`);
}

function loadJson(p) { return JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')); }
function hexOrDecToInt(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') return String(v);
  const s = String(v).trim();
  if (/^0x/i.test(s)) return String(parseInt(s, 16));
  if (/^\d+$/.test(s)) return s;
  return s;
}

function toCsv(rows) {
  const headers = [
    'pair', 'contract', 'levels', 'duplicateVector', 'pattern',
    'bestClaimGas', 'worstClaimGas', 'refundGas',
    'bestDisableGas', 'worstDisableGas', 'refundDisableGas',
    'deployGasDecimal', 'okAll', 'notes'
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return `${headers.join(',')}\n${rows.map((r) => headers.map((h) => esc(r[h] ?? '')).join(',')).join('\n')}\n`;
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.compiled || !args.summary) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const compiled = loadJson(args.compiled);
  const summary = loadJson(args.summary);
  const byPair = new Map();
  for (const row of summary) {
    if (!byPair.has(row.pair)) byPair.set(row.pair, []);
    byPair.get(row.pair).push(row);
  }

  const outRows = [];
  for (const spec of compiled.contracts || []) {
    const rows = byPair.get(spec.key) || [];
    const map = Object.fromEntries(rows.map((r) => [r.scenario, r]));
    const levels = spec.subcontracts.length;
    const dupVec = spec.subcontracts.map((s) => s.duplicateCount).join('|');
    const hasDup = spec.subcontracts.some((s) => s.duplicateCount > 1);
    const pattern = hasDup ? (levels > 1 ? 'multi-level+multi-option' : 'single-level+multi-option') : (levels > 1 ? 'multi-level' : 'single-level');
    const okAll = rows.length > 0 && rows.every((r) => String(r.ok) === 'true' || r.ok === true);
    let notes = [];
    if (levels === 1) notes.push('best_claim and worst_claim are expected to match');
    if (!hasDup) notes.push('pair compiles to CTLCOnly');
    else notes.push('pair compiles to CTLCMultipleEdges');
    if (levels > 1) notes.push(`expect ${levels - 1} disable step(s) before last claim/refund`);

    outRows.push({
      pair: spec.key,
      contract: spec.contractName,
      levels,
      duplicateVector: dupVec,
      pattern,
      bestClaimGas: map.best_claim?.gasUsed || '',
      worstClaimGas: map.worst_claim?.gasUsed || '',
      refundGas: map.refund?.gasUsed || '',
      bestDisableGas: map.best_claim?.disableGasUsed || '',
      worstDisableGas: map.worst_claim?.disableGasUsed || '',
      refundDisableGas: map.refund?.disableGasUsed || '',
      deployGasDecimal: hexOrDecToInt(map.best_claim?.deployGas || map.worst_claim?.deployGas || map.refund?.deployGas || ''),
      okAll,
      notes: notes.join('; '),
    });
  }

  const outPath = path.resolve(args.out || path.join(path.dirname(args.summary), 'analysis.csv'));
  fs.writeFileSync(outPath, toCsv(outRows));
  console.log(`Wrote ${outPath}`);
})();
