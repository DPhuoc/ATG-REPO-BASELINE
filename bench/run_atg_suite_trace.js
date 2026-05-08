#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const { compileATG, loadJson } = require('../tools/atg_core');

const HOST = process.env.GANACHE_HOST || '127.0.0.1';
const PORT = Number(process.env.GANACHE_PORT || 8545);

const BIN_DIR = path.join(process.cwd(), 'node_modules', '.bin');
const GANACHE_BIN = process.platform === 'win32'
  ? path.join(BIN_DIR, 'ganache.cmd')
  : path.join(BIN_DIR, 'ganache');

const TRUFFLE_BIN = process.platform === 'win32'
  ? path.join(BIN_DIR, 'truffle.cmd')
  : path.join(BIN_DIR, 'truffle');

const TRACE_SCRIPT = 'experiments/scale_trace/scripts/trace_result_json.py';

const DEFAULT_SCENARIOS = ['best_claim', 'worst_claim', 'refund'];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) {
      out[k] = true;
    } else {
      out[k] = v;
      i += 1;
    }
  }
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeName(s) {
  return String(s || '')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.once('error', () => resolve(false));
    socket.connect(PORT, HOST);
  });
}

function rpcRequest(method, params = []) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        method: 'POST',
        path: '/',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            resolve(parsed.result);
          } catch (e) {
            reject(e);
          }
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function waitForRpc(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await rpcRequest('web3_clientVersion', []);
      if (version) return;
    } catch (_) {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Ganache RPC did not become ready on ${HOST}:${PORT}`);
}

async function waitForPortFree(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen())) return;
    await sleep(250);
  }
  throw new Error(`Port ${PORT} stayed busy`);
}

function spawnLogged(cmd, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };
  const logFile = options.logFile;
  const out = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      buffer += s;
      process.stdout.write(s);
      if (out) out.write(s);
    });

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      buffer += s;
      process.stderr.write(s);
      if (out) out.write(s);
    });

    child.on('error', (err) => {
      if (out) out.end();
      reject(err);
    });

    child.on('close', (code) => {
      if (out) out.end();
      if (code === 0) resolve(buffer);
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function startGanache(logFile) {
  if (!fs.existsSync(GANACHE_BIN)) {
    throw new Error(`Ganache binary not found: ${GANACHE_BIN}`);
  }

  if (await isPortOpen()) {
    throw new Error(`Port ${PORT} is already in use`);
  }

  const out = fs.createWriteStream(logFile, { flags: 'a' });

  const child = spawn(
    GANACHE_BIN,
    [
      '--server.host', HOST,
      '--server.port', String(PORT),
      '--wallet.totalAccounts', '50',
      '--wallet.defaultBalance', '1000',
      '--miner.blockGasLimit', '30000000',
      '--miner.blockTime', '0',
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  );

  child.stdout.on('data', (chunk) => out.write(chunk.toString()));
  child.stderr.on('data', (chunk) => out.write(chunk.toString()));
  child.on('close', () => out.end());

  try {
    await waitForRpc();
    return child;
  } catch (e) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (_) {}
    throw e;
  }
}

async function stopGanache(child) {
  if (!child) return;

  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (_) {}

  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    sleep(2000),
  ]);

  if (await isPortOpen()) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (_) {}
  }

  await waitForPortFree().catch(() => {});
}

function traceResultJson(resultJson, traceJson, traceLog) {
  if (!fs.existsSync(resultJson)) {
    fs.writeFileSync(traceLog, `missing result json: ${resultJson}\n`, 'utf8');
    return false;
  }

  const proc = spawnSync(
    'python3',
    [TRACE_SCRIPT, resultJson, traceJson],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  fs.writeFileSync(
    traceLog,
    [
      `COMMAND: python3 ${TRACE_SCRIPT} ${resultJson} ${traceJson}`,
      `STATUS: ${proc.status}`,
      '',
      'STDOUT:',
      proc.stdout || '',
      '',
      'STDERR:',
      proc.stderr || '',
      '',
    ].join('\n'),
    'utf8',
  );

  if (proc.status !== 0) {
    throw new Error(`trace failed for ${resultJson}; see ${traceLog}`);
  }

  return true;
}

function writeCsv(rows, outFile) {
  if (!rows.length) {
    fs.writeFileSync(outFile, '', 'utf8');
    return;
  }

  const headers = [
    'graph_id',
    'pair',
    'contract',
    'scenario',
    'deployGas',
    'gasUsed',
    'disableGasUsed',
    'claimGasUsed',
    'refundGasUsed',
    'contractAddress',
    'ok',
    'error',
    'caseDir',
  ];

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

function graphIdFromAtg(atgPath, atgObj) {
  return (
    atgObj.graph_id ||
    atgObj.graphId ||
    (atgObj.meta && (atgObj.meta.graph_id || atgObj.meta.graphId)) ||
    path.basename(atgPath, path.extname(atgPath))
  );
}

async function run() {
  const args = parseArgs(process.argv);

  if (!args.atg) {
    throw new Error('Usage: node bench/run_atg_suite_trace.js --atg <atg.json> [--outdir dir] [--pair pairKey] [--scenario scenario]');
  }

  if (!fs.existsSync(TRACE_SCRIPT)) {
    throw new Error(`Missing trace script: ${TRACE_SCRIPT}`);
  }

  if (!fs.existsSync(TRUFFLE_BIN)) {
    throw new Error(`Truffle binary not found: ${TRUFFLE_BIN}`);
  }

  const atgPath = path.resolve(args.atg);
  const atgObj = loadJson(atgPath);
  const graphId = graphIdFromAtg(atgPath, atgObj);

  const outdir = path.resolve(args.outdir || path.join(process.cwd(), 'results', `atg-trace-${timestamp()}`));
  fs.mkdirSync(outdir, { recursive: true });

  console.log(`Compiling ATG: ${atgPath}`);
  const compiled = compileATG(atgObj);
  const compiledPath = path.join(outdir, 'compiled.atg.json');
  fs.writeFileSync(compiledPath, `${JSON.stringify(compiled, null, 2)}\n`, 'utf8');
  fs.copyFileSync(atgPath, path.join(outdir, 'source_atg.json'));

  console.log('Running truffle compile once...');
  await spawnLogged(TRUFFLE_BIN, ['compile'], {
    cwd: process.cwd(),
    logFile: path.join(outdir, 'truffle_compile.log'),
  });

  let contracts = compiled.contracts || [];
  if (args.pair) {
    contracts = contracts.filter((c) => c.key === args.pair);
    if (!contracts.length) throw new Error(`pair not found: ${args.pair}`);
  }

  const scenarios = args.scenario
    ? [args.scenario]
    : DEFAULT_SCENARIOS;

  const summary = [];

  for (const spec of contracts) {
    for (const scenario of scenarios) {
      const label = safeName(`${spec.key}__${spec.contractName}__${scenario}`);
      const caseDir = path.join(outdir, label);
      fs.mkdirSync(caseDir, { recursive: true });

      const resultJson = path.join(caseDir, 'result.json');
      const traceJson = path.join(caseDir, 'trace.json');
      const execLog = path.join(caseDir, 'exec.log');
      const traceLog = path.join(caseDir, 'trace.log');
      const ganacheLog = path.join(caseDir, 'ganache.log');

      let ganache = null;

      try {
        console.log(`\n=== ${label} ===`);
        ganache = await startGanache(ganacheLog);

        await spawnLogged(
          TRUFFLE_BIN,
          [
            'exec',
            'scripts/run_from_atg_case.js',
            '--network',
            'development',
            '--compiled',
            compiledPath,
            '--pair',
            spec.key,
            '--scenario',
            scenario,
            '--out',
            resultJson,
          ],
          {
            cwd: process.cwd(),
            logFile: execLog,
          },
        );

        traceResultJson(resultJson, traceJson, traceLog);

        const result = JSON.parse(fs.readFileSync(resultJson, 'utf8'));
        summary.push({
          graph_id: graphId,
          pair: spec.key,
          contract: result.contract || spec.contractName,
          scenario,
          deployGas: result.deployGas || '',
          gasUsed: result.gasUsed || '',
          disableGasUsed: result.disableGasUsed || '',
          claimGasUsed: result.claimGasUsed || '',
          refundGasUsed: result.refundGasUsed || '',
          contractAddress: result.contractAddress || '',
          ok: result.ok === true ? 'true' : 'false',
          error: result.error || '',
          caseDir,
        });
      } catch (e) {
        console.error(`FAILED ${label}: ${e.message || e}`);
        const failure = {
          ok: false,
          graph_id: graphId,
          pair: spec.key,
          contract: spec.contractName,
          scenario,
          error: e.message || String(e),
          caseDir,
        };
        fs.writeFileSync(resultJson, `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
        summary.push({
          graph_id: graphId,
          pair: spec.key,
          contract: spec.contractName,
          scenario,
          deployGas: '',
          gasUsed: '',
          disableGasUsed: '',
          claimGasUsed: '',
          refundGasUsed: '',
          contractAddress: '',
          ok: 'false',
          error: failure.error,
          caseDir,
        });
      } finally {
        await stopGanache(ganache);
      }
    }
  }

  fs.writeFileSync(path.join(outdir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeCsv(summary, path.join(outdir, 'summary.csv'));

  console.log(`\nDone. Output: ${outdir}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
