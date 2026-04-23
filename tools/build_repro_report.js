#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { ctlc: null, comparators: null, atg: null, sweep: null, out: 'REPRO_REPORT.md' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--ctlc') out.ctlc = next, i++;
    else if (a === '--comparators') out.comparators = next, i++;
    else if (a === '--atg') out.atg = next, i++;
    else if (a === '--sweep') out.sweep = next, i++;
    else if (a === '--out') out.out = next, i++;
    else if (a === '--help') out.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node tools/build_repro_report.js \
    --ctlc results/ctlc-bench-.../summary.json \
    --comparators results/compare-bench-.../summary.json \
    [--atg results/atg-bench-.../analysis.csv] \
    [--sweep results/branchy-sweep-.../sweep.csv] \
    --out results/REPRO_REPORT.md
`);
}

function readMaybe(pathname) {
  if (!pathname || !fs.existsSync(pathname)) return null;
  const ext = path.extname(pathname).toLowerCase();
  const text = fs.readFileSync(pathname, 'utf8');
  if (ext === '.json') return JSON.parse(text);
  if (ext === '.csv') return parseCsv(text);
  throw new Error(`Unsupported extension for ${pathname}`);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line);
    const out = {};
    headers.forEach((h, i) => out[h] = cols[i] ?? '');
    return out;
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

function n(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^0x/i.test(s)) return parseInt(s, 16);
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

function lookupScenario(rows, contract, scenario) {
  return rows.find((r) => r.contract === contract && r.scenario === scenario);
}

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

function fmtPct(v) {
  return v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmt(v) {
  return v == null ? 'n/a' : String(v);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.ctlc && !args.comparators && !args.atg && !args.sweep)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const ctlc = readMaybe(args.ctlc) || [];
  const cmp = readMaybe(args.comparators) || [];
  const atg = readMaybe(args.atg) || [];
  const sweep = readMaybe(args.sweep) || [];

  const cOnlyBest = lookupScenario(ctlc, 'CTLCOnly', 'best_claim');
  const cOnlyWorst = lookupScenario(ctlc, 'CTLCOnly', 'worst_claim');
  const cOnlyRefund = lookupScenario(ctlc, 'CTLCOnly', 'refund');
  const cManyBest = lookupScenario(ctlc, 'CTLCMultipleEdges', 'best_claim');
  const cManyWorst = lookupScenario(ctlc, 'CTLCMultipleEdges', 'worst_claim');
  const cManyRefund = lookupScenario(ctlc, 'CTLCMultipleEdges', 'refund');
  const swapClaim = lookupScenario(cmp, 'Swap', 'claim');
  const swapRefundBest = lookupScenario(cmp, 'Swap', 'refund_best');
  const swapRefundWorst = lookupScenario(cmp, 'Swap', 'refund_worst');
  const siClaimBest = lookupScenario(cmp, 'SwapImproved', 'claim_best');
  const siClaimWorst = lookupScenario(cmp, 'SwapImproved', 'claim_worst');
  const siRefund = lookupScenario(cmp, 'SwapImproved', 'refund');

  const report = [];
  report.push('# ATG / CTLC Reproduction Report');
  report.push('');
  report.push(`Generated: ${new Date().toISOString()}`);
  report.push('');

  if (ctlc.length || cmp.length) {
    report.push('## 1) Contract-level benchmark summary');
    report.push('');
    report.push('| Protocol | Deploy | Claim (best) | Claim (worst total) | Refund (total) |');
    report.push('|---|---:|---:|---:|---:|');
    report.push(`| CTLCOnly | ${fmt(n(cOnlyBest?.deployGas))} | ${fmt(n(cOnlyBest?.gasUsed))} | ${fmt((n(cOnlyWorst?.disableGasUsed)||0) + (n(cOnlyWorst?.claimGasUsed)||0))} | ${fmt((n(cOnlyRefund?.disableGasUsed)||0) + (n(cOnlyRefund?.refundGasUsed)||0))} |`);
    report.push(`| CTLCMultipleEdges | ${fmt(n(cManyBest?.deployGas))} | ${fmt(n(cManyBest?.gasUsed))} | ${fmt((n(cManyWorst?.disableGasUsed)||0) + (n(cManyWorst?.claimGasUsed)||0))} | ${fmt((n(cManyRefund?.disableGasUsed)||0) + (n(cManyRefund?.refundGasUsed)||0))} |`);
    report.push(`| Swap | ${fmt(n(swapClaim?.deployGas))} | ${fmt(n(swapClaim?.gasUsed))} | ${fmt(n(swapClaim?.gasUsed))} | ${fmt(n(swapRefundWorst?.gasUsed))} / best ${fmt(n(swapRefundBest?.gasUsed))} |`);
    report.push(`| SwapImproved | ${fmt(n(siClaimBest?.deployGas))} | ${fmt(n(siClaimBest?.gasUsed))} | ${fmt(n(siClaimWorst?.gasUsed))} | ${fmt(n(siRefund?.gasUsed))} |`);
    report.push('');

    const deployDeltaSwapVsCTLC = pct(n(swapClaim?.deployGas), n(cOnlyBest?.deployGas));
    const deployDeltaSIMeVsCTLC = pct(n(siClaimBest?.deployGas), n(cOnlyBest?.deployGas));
    const claimDeltaCTLCVsSI = pct(n(cOnlyBest?.gasUsed), n(siClaimBest?.gasUsed));
    report.push('- CTLCOnly deploy vs Swap: ' + fmtPct(deployDeltaSwapVsCTLC));
    report.push('- CTLCOnly deploy vs SwapImproved: ' + fmtPct(deployDeltaSIMeVsCTLC));
    report.push('- CTLCOnly best-claim vs SwapImproved: ' + fmtPct(claimDeltaCTLCVsSI));
    report.push('');
  }

  if (atg.length) {
    report.push('## 2) ATG-compiled pair summary');
    report.push('');
    report.push('| Pair | Contract | Levels | Duplicate vector | Pattern | Best claim | Worst claim | Refund | Note |');
    report.push('|---|---|---:|---|---|---:|---:|---:|---|');
    for (const r of atg) {
      report.push(`| ${r.pair} | ${r.contract} | ${r.levels || ''} | ${r.duplicateVector || ''} | ${r.pattern || ''} | ${r.bestClaimGas || ''} | ${r.worstClaimGas || ''} | ${r.refundGas || ''} | ${r.notes || ''} |`);
    }
    report.push('');
  }

  if (sweep.length) {
    report.push('## 3) Branchy family sweep');
    report.push('');
    report.push('| direct | options | Contract | Levels | Duplicate vector | Pattern | Best claim | Worst claim | Refund | Ok |');
    report.push('|---:|---:|---|---:|---|---|---:|---:|---:|---|');
    for (const r of sweep) {
      report.push(`| ${r.direct} | ${r.options} | ${r.contract || ''} | ${r.levels || ''} | ${r.duplicateVector || ''} | ${r.pattern || ''} | ${r.bestClaimGas || ''} | ${r.worstClaimGas || ''} | ${r.refundGas || ''} | ${r.ok || ''} |`);
    }
    report.push('');
  }

  report.push('## 4) Suggested conclusions');
  report.push('');
  report.push('- Single-level pairs usually collapse to CTLCOnly, so best-claim and worst-claim match because there is no earlier subcontract to disable.');
  report.push('- Multi-level pairs show extra gas on worst-claim and refund because at least one disable step must execute before the final claim or refund.');
  report.push('- Multi-option pairs compile to CTLCMultipleEdges, which raises deploy and claim costs relative to CTLCOnly because the contract stores and checks more than one condition option per level.');
  report.push('- Comparator-style protocols can still be cheaper on refund paths, which is consistent with timeout-style refund logic, while CTLC pays for explicit disable progression across subcontract levels.');
  report.push('');

  fs.writeFileSync(args.out, report.join('\n') + '\n');
  console.log(`wrote ${args.out}`);
}

main();
