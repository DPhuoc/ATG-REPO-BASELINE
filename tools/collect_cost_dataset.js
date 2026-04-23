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

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
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

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ignore
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
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

function writeCsv(rows, outFile) {
  if (rows.length === 0) {
    fs.writeFileSync(outFile, '', 'utf8');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    const vals = headers.map((h) => {
      const v = row[h] == null ? '' : String(row[h]);
      return `"${v.replace(/"/g, '""')}"`;
    });
    lines.push(vals.join(','));
  }
  fs.writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');
}

function toNum(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : '';
}

function toBool(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (['true', '1', 'yes'].includes(s)) return 'true';
  if (['false', '0', 'no'].includes(s)) return 'false';
  return s;
}

function duplicateStats(vecStr) {
  const parts = String(vecStr || '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => toNum(x))
    .filter((x) => x !== '');
  if (parts.length === 0) {
    return { sumOptions: '', maxOptionsPerLevel: '' };
  }
  return {
    sumOptions: parts.reduce((a, b) => a + b, 0),
    maxOptionsPerLevel: Math.max(...parts),
  };
}

function sourceRunId(file) {
  return path.basename(path.dirname(file));
}

function rowsFromContractSummary(file) {
  const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
  const runId = sourceRunId(file);
  const sourceKind = file.includes('ctlc-bench-') ? 'contract_bench_ctlc' : 'contract_bench_compare';

  return arr.map((r, idx) => {
    const scenario = String(r.scenario || '');
    const deployGas = toNum(r.deployGas);
    const gasUsed = toNum(r.gasUsed);
    const disableGas = toNum(r.disableGasUsed);
    const claimGas = toNum(r.claimGasUsed);
    const refundGasRaw = toNum(r.refundGasUsed);

    let bestClaimGas = '';
    let worstClaimGas = '';
    let refundGas = '';
    let bestDisableGas = '';
    let worstDisableGas = '';
    let refundDisableGas = '';

    if (scenario === 'best_claim' || scenario === 'claim' || scenario === 'claim_best') {
      bestClaimGas = claimGas || gasUsed;
      bestDisableGas = disableGas || '';
    }

    if (scenario === 'worst_claim' || scenario === 'claim_worst') {
      worstDisableGas = disableGas || '';
      const total = (disableGas || 0) + (claimGas || gasUsed || 0);
      worstClaimGas = total || '';
    }

    if (scenario === 'refund' || scenario === 'refund_best' || scenario === 'refund_worst') {
      refundDisableGas = disableGas || '';
      refundGas = scenario === 'refund'
        ? ((disableGas || 0) + (refundGasRaw || gasUsed || 0)) || ''
        : (refundGasRaw || gasUsed || '');
    }

    return {
      source_kind: sourceKind,
      run_id: runId,
      graph_id: '',
      family: 'contract-level',
      pair: '',
      direct: '',
      options: '',
      leader: '',
      contract_type: r.contract || '',
      scenario,
      levels: '',
      duplicate_vector: '',
      num_levels: '',
      sum_options: '',
      max_options_per_level: '',
      pattern: '',
      has_multi_level: '',
      has_multi_option: '',
      disable_steps_worst: '',
      deploy_gas: deployGas,
      gas_used: gasUsed,
      best_claim_gas: bestClaimGas,
      worst_claim_gas: worstClaimGas,
      refund_gas: refundGas,
      best_disable_gas: bestDisableGas,
      worst_disable_gas: worstDisableGas,
      refund_disable_gas: refundDisableGas,
      ok: toBool(r.ok),
      notes: '',
      error: r.error || '',
      source_path: file,
      row_index: idx
    };
  });
}

function rowsFromAnalysisCsv(file) {
  const runId = sourceRunId(file);
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));

  return rows.map((r, idx) => {
    const levels = toNum(r.levels);
    const pattern = r.pattern || '';
    const dup = duplicateStats(r.duplicateVector);

    return {
      source_kind: 'atg_analysis',
      run_id: runId,
      graph_id: runId,
      family: 'atg',
      pair: r.pair || '',
      direct: '',
      options: '',
      leader: '',
      contract_type: r.contract || '',
      scenario: 'pair_summary',
      levels,
      duplicate_vector: r.duplicateVector || '',
      num_levels: levels,
      sum_options: dup.sumOptions,
      max_options_per_level: dup.maxOptionsPerLevel,
      pattern,
      has_multi_level: pattern.includes('multi-level') ? 'true' : 'false',
      has_multi_option: pattern.includes('multi-option') ? 'true' : 'false',
      disable_steps_worst: levels !== '' ? Math.max(0, Number(levels) - 1) : '',
      deploy_gas: toNum(r.deployGasDecimal),
      gas_used: '',
      best_claim_gas: toNum(r.bestClaimGas),
      worst_claim_gas: toNum(r.worstClaimGas),
      refund_gas: toNum(r.refundGas),
      best_disable_gas: toNum(r.bestDisableGas),
      worst_disable_gas: toNum(r.worstDisableGas),
      refund_disable_gas: toNum(r.refundDisableGas),
      ok: toBool(r.okAll),
      notes: r.notes || '',
      error: '',
      source_path: file,
      row_index: idx
    };
  });
}

function rowsFromSweepCsv(file) {
  const runId = sourceRunId(file);
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));

  return rows.map((r, idx) => {
    const levels = toNum(r.Levels);
    const dupVec = r['Duplicate vector'] || '';
    const dup = duplicateStats(dupVec);
    const pattern = r.Pattern || '';

    return {
      source_kind: 'branchy_sweep',
      run_id: runId,
      graph_id: `branchy_direct_${r.direct}_options_${r.options}`,
      family: 'branchy',
      pair: 'target_pair',
      direct: r.direct,
      options: r.options,
      leader: '',
      contract_type: r.Contract || '',
      scenario: 'pair_summary',
      levels,
      duplicate_vector: dupVec,
      num_levels: levels,
      sum_options: dup.sumOptions,
      max_options_per_level: dup.maxOptionsPerLevel,
      pattern,
      has_multi_level: pattern.includes('multi-level') ? 'true' : 'false',
      has_multi_option: pattern.includes('multi-option') ? 'true' : 'false',
      disable_steps_worst: levels !== '' ? Math.max(0, Number(levels) - 1) : '',
      deploy_gas: '',
      gas_used: '',
      best_claim_gas: toNum(r['Best claim']),
      worst_claim_gas: toNum(r['Worst claim']),
      refund_gas: toNum(r.Refund),
      best_disable_gas: '',
      worst_disable_gas: '',
      refund_disable_gas: '',
      ok: toBool(r.Ok),
      notes: '',
      error: '',
      source_path: file,
      row_index: idx
    };
  });
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root || 'results');
  const out = path.resolve(args.out || 'paper2/data/processed/dataset.csv');

  const files = walk(root);

  const contractSummaryFiles = files.filter((f) =>
    /results\/(ctlc-bench-|compare-bench-)/.test(f) && path.basename(f) === 'summary.json'
  );
  const analysisFiles = files.filter((f) => path.basename(f) === 'analysis.csv' && f.includes('atg-bench-'));
  const sweepFiles = files.filter((f) => path.basename(f) === 'sweep.csv' && f.includes('branchy-sweep-'));

  const rows = [
    ...contractSummaryFiles.flatMap(rowsFromContractSummary),
    ...analysisFiles.flatMap(rowsFromAnalysisCsv),
    ...sweepFiles.flatMap(rowsFromSweepCsv),
  ];

  rows.sort((a, b) => {
    const ka = [a.source_kind, a.run_id, a.graph_id, a.pair, a.contract_type, a.scenario].join('|');
    const kb = [b.source_kind, b.run_id, b.graph_id, b.pair, b.contract_type, b.scenario].join('|');
    return ka.localeCompare(kb);
  });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeCsv(rows, out);

  const summary = {
    root,
    out,
    total_rows: rows.length,
    contract_summary_files: contractSummaryFiles.length,
    analysis_files: analysisFiles.length,
    sweep_files: sweepFiles.length,
    by_source_kind: rows.reduce((acc, r) => {
      acc[r.source_kind] = (acc[r.source_kind] || 0) + 1;
      return acc;
    }, {})
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
