#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) out[k] = true;
    else {
      out[k] = v;
      i += 1;
    }
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((r) => r.some((x) => String(x).trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = r[idx] ?? '';
      });
      return obj;
    });
}

function esc(v) {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function appendCsvRow(outFile, headers, row) {
  const exists = fs.existsSync(outFile);
  if (!exists) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, `${headers.join(',')}\n`, 'utf8');
  }
  const line = headers.map((h) => esc(row[h])).join(',') + '\n';
  fs.appendFileSync(outFile, line, 'utf8');
}

const args = parseArgs(process.argv);
const pair = args.pair || 'D->B|evm|fund:db';

if (!args.search || !args.analysis || !args.out || !args.leader || !args.graphId) {
  console.error('Usage: node tools/append_leader_family_row.js --search <search.json> --analysis <analysis.csv> --out <out.csv> --graphId <id> --direct <bool> --options <N> --leaderRole <original|best> --leader <node> [--pair D->B|evm|fund:db]');
  process.exit(1);
}

const search = JSON.parse(fs.readFileSync(path.resolve(args.search), 'utf8'));
const cand = search.candidates.find((c) => String(c.leader) === String(args.leader));
if (!cand) throw new Error(`Leader not found in search results: ${args.leader}`);

const rows = parseCsv(fs.readFileSync(path.resolve(args.analysis), 'utf8'));
const r = rows.find((x) => String(x.pair) === pair);
if (!r) throw new Error(`Pair not found in analysis.csv: ${pair}`);

const rank = search.candidates.findIndex((c) => String(c.leader) === String(args.leader)) + 1;

const headers = [
  'graph_id',
  'direct',
  'options',
  'leader_role',
  'leader',
  'rank',
  'score',
  'total_pairs',
  'total_levels',
  'total_options',
  'total_disable_steps',
  'num_ctlc_multiple',
  'contract',
  'levels',
  'duplicate_vector',
  'pattern',
  'deploy_gas',
  'best_claim_gas',
  'worst_claim_gas',
  'refund_gas',
  'ok_all',
  'analysis_path'
];

const outRow = {
  graph_id: args.graphId,
  direct: args.direct,
  options: args.options,
  leader_role: args.leaderRole || '',
  leader: args.leader,
  rank,
  score: cand.score,
  total_pairs: cand.total_pairs,
  total_levels: cand.total_levels,
  total_options: cand.total_options,
  total_disable_steps: cand.total_disable_steps,
  num_ctlc_multiple: cand.num_ctlc_multiple,
  contract: r.contract || '',
  levels: r.levels || '',
  duplicate_vector: r.duplicateVector || '',
  pattern: r.pattern || '',
  deploy_gas: r.deployGasDecimal || '',
  best_claim_gas: r.bestClaimGas || '',
  worst_claim_gas: r.worstClaimGas || '',
  refund_gas: r.refundGas || '',
  ok_all: r.okAll || '',
  analysis_path: path.resolve(args.analysis)
};

appendCsvRow(path.resolve(args.out), headers, outRow);
console.log(JSON.stringify(outRow, null, 2));
