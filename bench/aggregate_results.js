const fs = require('fs');
const path = require('path');

const HEADERS = [
  'runId',
  'contract',
  'scenario',
  'deployGas',
  'gasUsed',
  'disableGasUsed',
  'claimGasUsed',
  'refundGasUsed',
  'contractAddress',
  'startBlock',
  'endBlock',
  'finalContractBalanceWei',
  'ok',
  'error',
];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toRow(raw, runDirName) {
  return {
    runId: runDirName,
    contract: raw.contract,
    scenario: raw.scenario,
    deployGas: raw.deployGas,
    gasUsed: raw.gasUsed,
    disableGasUsed: raw.disableGasUsed,
    claimGasUsed: raw.claimGasUsed,
    refundGasUsed: raw.refundGasUsed,
    contractAddress: raw.contractAddress,
    startBlock: raw.startBlock,
    endBlock: raw.endBlock,
    finalContractBalanceWei: raw.finalContractBalanceWei,
    ok: raw.ok,
    error: raw.error,
  };
}

function loadRunRows(resultsDir, runDirName) {
  const runDir = path.join(resultsDir, runDirName);
  const summaryPath = path.join(runDir, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    const summary = readJson(summaryPath);
    if (!Array.isArray(summary)) {
      throw new Error(`Expected array in ${summaryPath}`);
    }
    return summary.map((row) => toRow(row, runDirName));
  }

  const rows = [];
  for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const resultPath = path.join(runDir, entry.name, 'result.json');
    if (!fs.existsSync(resultPath)) continue;
    rows.push(toRow(readJson(resultPath), runDirName));
  }
  return rows;
}

function listRunDirs(resultsDir) {
  return fs
    .readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('ctlc-bench-'))
    .map((entry) => entry.name)
    .sort();
}

function chooseLatestRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.contract}::${row.scenario}`;
    const group = grouped.get(key) || [];
    group.push(row);
    grouped.set(key, group);
  }

  const chosen = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => a.runId.localeCompare(b.runId));
    let selected = group[group.length - 1];
    for (let i = group.length - 1; i >= 0; i -= 1) {
      if (group[i].ok === true) {
        selected = group[i];
        break;
      }
    }
    chosen.push(selected);
  }

  chosen.sort((a, b) => {
    const contractCmp = String(a.contract).localeCompare(String(b.contract));
    if (contractCmp !== 0) return contractCmp;
    return String(a.scenario).localeCompare(String(b.scenario));
  });
  return chosen;
}

function writeCsv(rows, headers, outFile) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    const vals = headers.map((header) => {
      const value = row[header] == null ? '' : String(row[header]);
      return `"${value.replace(/"/g, '""')}"`;
    });
    lines.push(vals.join(','));
  }
  fs.writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const resultsDir = path.resolve(args['results-dir'] || path.join(process.cwd(), 'results'));
  const mode = args.mode || 'latest';
  const outFile = path.resolve(
    args.out
      || path.join(
        resultsDir,
        mode === 'all' ? 'summary_all_runs.csv' : 'summary.csv'
      )
  );

  const runDirs = listRunDirs(resultsDir);
  const allRows = runDirs.flatMap((runDirName) => loadRunRows(resultsDir, runDirName));
  if (allRows.length === 0) {
    throw new Error(`No result rows found under ${resultsDir}`);
  }

  let rows;
  let headers = HEADERS;
  if (mode === 'all') {
    rows = allRows;
  } else if (mode === 'latest') {
    rows = chooseLatestRows(allRows);
  } else {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  writeCsv(rows, headers, outFile);
  console.log(`Wrote ${rows.length} rows to ${outFile}`);
}

main();
