#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { compileATG, loadJson, saveJson } = require('../tools/atg_core');

const FIXED_MNEMONIC = 'test test test test test test test test test test test junk';
const ROOT = process.cwd();
const LOCAL_BIN = (name) => path.join(ROOT, 'node_modules', '.bin', name);
const GANACHE = LOCAL_BIN('ganache');
const TRUFFLE = LOCAL_BIN('truffle');

function parseArgs(argv) {
  const out = { scenarios: null, retries: 2 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--atg') out.atg = argv[++i];
    else if (a === '--compiled') out.compiled = argv[++i];
    else if (a === '--outdir') out.outdir = argv[++i];
    else if (a === '--pair') out.pair = argv[++i];
    else if (a === '--scenario') out.scenarios = [argv[++i]];
    else if (a === '--retries') out.retries = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node bench/run_atg_suite.js --atg examples/triangle_atg.json
  node bench/run_atg_suite.js --compiled out/triangle.compiled.json --pair "B->C|evm|fund:bc"
  node bench/run_atg_suite.js --atg examples/multi_level_duplicate_atg.json --pair "D->B|evm|fund:db" --retries 3
`);
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function timestampDir(prefix) { return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`; }

async function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitForPort(port, desired, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const open = await isPortOpen(port);
    if (open === desired) return;
    await sleep(200);
  }
  throw new Error(`port ${port} did not become ${desired ? 'open' : 'closed'} in time`);
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch (_) {
    try { proc.kill('SIGTERM'); } catch (_) {}
  }
}

function startGanache(caseDir) {
  const logPath = path.join(caseDir, 'ganache.log');
  const out = fs.openSync(logPath, 'a');
  const child = spawn(GANACHE, [
    '--wallet.mnemonic', FIXED_MNEMONIC,
    '--wallet.totalAccounts', '20',
    '--wallet.defaultBalance', '1000',
    '--wallet.accountKeysPath', path.join(caseDir, 'ganache-keys.json'),
    '--miner.blockGasLimit', '30000000',
    '--miner.blockTime', '0',
    '--server.host', '127.0.0.1',
    '--server.port', '8545',
  ], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  return { child, logPath };
}

function runCmd(bin, args, logPath, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(logPath, 'a');
    const p = spawn(bin, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', out, out],
    });
    p.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${bin} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function findLastJsonObject(text) {
  const start = text.lastIndexOf('{');
  if (start < 0) return null;
  const slice = text.slice(start);
  try { return JSON.parse(slice); } catch (_) { return null; }
}

async function migrate(caseDir) {
  const logPath = path.join(caseDir, 'migrate.log');
  fs.writeFileSync(logPath, '');
  await runCmd(TRUFFLE, ['migrate', '--reset', '--network', 'development'], logPath);
  const text = fs.readFileSync(logPath, 'utf8');
  const gasMap = {};
  const regex = /Deploying '([^']+)'[\s\S]*?> gas used:\s+(\d+)/g;
  let m;
  while ((m = regex.exec(text)) !== null) gasMap[m[1]] = String(m[2]);
  return gasMap;
}

async function execCase(caseDir, opts) {
  const logPath = path.join(caseDir, 'exec.log');
  fs.writeFileSync(logPath, '');
  const args = ['exec', 'scripts/run_from_atg_case.js', '--network', 'development', '--'];
  if (opts.compiled) args.push('--compiled', opts.compiled);
  if (opts.atg) args.push('--atg', opts.atg);
  if (opts.pair) args.push('--pair', opts.pair);
  if (opts.scenario) args.push('--scenario', opts.scenario);
  await runCmd(TRUFFLE, args, logPath);
  const text = fs.readFileSync(logPath, 'utf8');
  const json = findLastJsonObject(text);
  if (!json) throw new Error('could not find JSON result in exec log');
  return json;
}

function toCsv(rows) {
  const headers = [
    'pair', 'contract', 'scenario', 'deployGas', 'gasUsed',
    'disableGasUsed', 'claimGasUsed', 'refundGasUsed',
    'contractAddress', 'startBlock', 'endBlock', 'finalContractBalanceWei',
    'party', 'counterparty', 'ok', 'error', 'attempts',
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return `${headers.join(',')}\n${rows.map((r) => headers.map((h) => esc(r[h] ?? '')).join(',')).join('\n')}\n`;
}

async function runOneCase(compiledPath, spec, scenario, caseDir, retries) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    let ganacheProc = null;
    try {
      if (await isPortOpen(8545)) {
        throw new Error('Port 8545 is already in use. Stop the existing Ganache/JSON-RPC process first.');
      }
      const started = startGanache(caseDir);
      ganacheProc = started.child;
      await waitForPort(8545, true, 35000);
      const gasMap = await migrate(caseDir);
      const result = await execCase(caseDir, {
        compiled: compiledPath,
        pair: spec.key,
        scenario,
      });
      result.deployGas = result.deployGas || gasMap[result.contract] || '';
      result.ok = true;
      result.attempts = attempt;
      return result;
    } catch (err) {
      lastErr = err;
      fs.appendFileSync(path.join(caseDir, 'attempts.log'), `[attempt ${attempt}] ${err.stack || err.message}\n`);
      if (ganacheProc) {
        killTree(ganacheProc);
        try { await waitForPort(8545, false, 20000); } catch (_) {}
      }
      if (attempt <= retries) {
        await sleep(1000 * attempt);
        continue;
      }
      throw err;
    } finally {
      if (ganacheProc) {
        killTree(ganacheProc);
        try { await waitForPort(8545, false, 20000); } catch (_) {}
      }
    }
  }
  throw lastErr || new Error('unknown case error');
}

(async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.atg && !args.compiled)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (!fs.existsSync(GANACHE)) throw new Error(`ganache not found: ${GANACHE}`);
  if (!fs.existsSync(TRUFFLE)) throw new Error(`truffle not found: ${TRUFFLE}`);

  const compiled = args.compiled ? loadJson(args.compiled) : compileATG(loadJson(args.atg));
  const scenarios = args.scenarios || ['best_claim', 'worst_claim', 'refund'];
  const contracts = (compiled.contracts || []).filter((c) => !args.pair || c.key === args.pair);
  if (contracts.length === 0) throw new Error('no contracts selected');

  const outDir = path.resolve(args.outdir || path.join(ROOT, 'results', timestampDir('atg-bench')));
  mkdirp(outDir);
  const compiledPath = path.join(outDir, 'compiled.atg.json');
  saveJson(compiledPath, compiled);

  const rows = [];
  for (const spec of contracts) {
    for (const scenario of scenarios) {
      const caseName = `${spec.key.replace(/[^a-zA-Z0-9_.-]+/g, '_')}__${scenario}`;
      const caseDir = path.join(outDir, caseName);
      mkdirp(caseDir);
      try {
        const result = await runOneCase(compiledPath, spec, scenario, caseDir, args.retries);
        rows.push(result);
        fs.writeFileSync(path.join(caseDir, 'result.json'), JSON.stringify(result, null, 2));
      } catch (err) {
        const row = {
          pair: spec.key,
          contract: spec.contractName,
          scenario,
          deployGas: '', gasUsed: '', disableGasUsed: '', claimGasUsed: '', refundGasUsed: '',
          contractAddress: '', startBlock: '', endBlock: '', finalContractBalanceWei: '',
          party: '', counterparty: '', ok: false, error: err.message, attempts: args.retries + 1,
        };
        rows.push(row);
        fs.writeFileSync(path.join(caseDir, 'result.json'), JSON.stringify(row, null, 2));
      }
    }
  }

  saveJson(path.join(outDir, 'summary.json'), rows);
  fs.writeFileSync(path.join(outDir, 'summary.csv'), toCsv(rows));
  console.log(`Wrote ${path.join(outDir, 'summary.csv')}`);
})();
