const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const BIN_DIR = path.join(process.cwd(), 'node_modules', '.bin');
const GANACHE_BIN = process.platform === 'win32'
  ? path.join(BIN_DIR, 'ganache.cmd')
  : path.join(BIN_DIR, 'ganache');
const TRUFFLE_BIN = process.platform === 'win32'
  ? path.join(BIN_DIR, 'truffle.cmd')
  : path.join(BIN_DIR, 'truffle');

const PORT = Number(process.env.GANACHE_PORT || 8545);
const HOST = process.env.GANACHE_HOST || '127.0.0.1';

const DEFAULT_CASES = [
  { contract: 'CTLCOnly', scenario: 'best_claim' },
  { contract: 'CTLCOnly', scenario: 'worst_claim' },
  { contract: 'CTLCOnly', scenario: 'refund' },
  { contract: 'CTLCMultipleEdges', scenario: 'best_claim' },
  { contract: 'CTLCMultipleEdges', scenario: 'worst_claim' },
  { contract: 'CTLCMultipleEdges', scenario: 'refund' },
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

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rpcRequest(method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: '/',
        method: 'POST',
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
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function isPortInUse() {
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

async function waitForRpc(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await rpcRequest('web3_clientVersion', []);
      if (res && res.result) return;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error(`RPC server ${HOST}:${PORT} did not become ready within ${timeoutMs}ms`);
}

async function waitForPortFree(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortInUse())) return;
    await sleep(250);
  }
  throw new Error(`Port ${PORT} stayed busy for more than ${timeoutMs}ms`);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDeployGas(migrateLogText, contractName) {
  const re = new RegExp(`Deploying '${escapeRegExp(contractName)}'[\\s\\S]*?> gas used:\\s+(\\d+)`, 'm');
  const match = migrateLogText.match(re);
  return match ? Number(match[1]) : null;
}

function writeCsv(rows, outFile) {
  const headers = [
    'contract','scenario','deployGas','gasUsed','disableGasUsed','claimGasUsed','refundGasUsed',
    'contractAddress','startBlock','endBlock','finalContractBalanceWei','ok','error',
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

function spawnLogged(cmd, args, options) {
  const { cwd, env, logFile } = options;
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      process.stdout.write(s);
      out.write(s);
      buffer += s;
    });
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      process.stderr.write(s);
      out.write(s);
      buffer += s;
    });
    child.on('error', (err) => {
      out.end();
      reject(err);
    });
    child.on('close', (code) => {
      out.end();
      if (code === 0) resolve(buffer);
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function startGanache(logFile) {
  if (!fs.existsSync(GANACHE_BIN)) {
    throw new Error(`Ganache binary not found: ${GANACHE_BIN}`);
  }
  if (await isPortInUse()) {
    throw new Error(`Port ${PORT} is already in use. Stop the existing Ganache/JSON-RPC process first.`);
  }

  const out = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(
    GANACHE_BIN,
    [
      '--server.host', HOST,
      '--server.port', String(PORT),
      '--wallet.totalAccounts', '10',
      '--wallet.defaultBalance', '1000',
      '--miner.blockGasLimit', '30000000',
      '--miner.blockTime', '0',
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    }
  );

  child.stdout.on('data', (chunk) => out.write(chunk.toString()));
  child.stderr.on('data', (chunk) => out.write(chunk.toString()));
  child.on('close', () => out.end());

  try {
    await waitForRpc();
    return child;
  } catch (err) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (_) {}
    throw err;
  }
}

async function stopProcess(child) {
  if (!child) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (_) {}

  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    sleep(2000),
  ]);

  if (await isPortInUse()) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (_) {}
  }

  await waitForPortFree();
}

function selectCases(contractFilter, scenarioFilter) {
  return DEFAULT_CASES.filter((c) => {
    if (contractFilter && c.contract !== contractFilter) return false;
    if (scenarioFilter && c.scenario !== scenarioFilter) return false;
    return true;
  });
}

async function run() {
  const args = parseArgs(process.argv);
  const cases = selectCases(args.contract, args.scenario);
  if (cases.length === 0) throw new Error('No benchmark cases matched the provided filters.');

  const runDir = path.resolve(args.outdir || path.join(process.cwd(), 'results', `ctlc-bench-${timestamp()}`));
  fs.mkdirSync(runDir, { recursive: true });

  const summary = [];

  for (const testCase of cases) {
    const label = `${testCase.contract}__${testCase.scenario}`;
    const caseDir = path.join(runDir, label);
    fs.mkdirSync(caseDir, { recursive: true });

    const ganacheLog = path.join(caseDir, 'ganache.log');
    const migrateLog = path.join(caseDir, 'migrate.log');
    const execLog = path.join(caseDir, 'exec.log');
    const resultJson = path.join(caseDir, 'result.json');

    let ganache;
    try {
      console.log(`\n=== ${label} ===`);
      ganache = await startGanache(ganacheLog);

      await spawnLogged(TRUFFLE_BIN, ['migrate', '--reset', '--network', 'development'], {
        cwd: process.cwd(),
        logFile: migrateLog,
      });

      const migrateText = fs.readFileSync(migrateLog, 'utf8');
      const deployGas = parseDeployGas(migrateText, testCase.contract);

      await spawnLogged(TRUFFLE_BIN, ['exec', 'scripts/run_ctlc_case.js', '--network', 'development'], {
        cwd: process.cwd(),
        logFile: execLog,
        env: {
          CONTRACT_NAME: testCase.contract,
          SCENARIO: testCase.scenario,
          OUTPUT_JSON: resultJson,
        },
      });

      const result = JSON.parse(fs.readFileSync(resultJson, 'utf8'));
      result.deployGas = deployGas;
      fs.writeFileSync(resultJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      summary.push(result);
    } catch (err) {
      const failure = {
        ok: false,
        contract: testCase.contract,
        scenario: testCase.scenario,
        error: err && err.message ? err.message : String(err),
      };
      fs.writeFileSync(resultJson, `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
      summary.push(failure);
      console.error(failure.error);
    } finally {
      try {
        await stopProcess(ganache);
      } catch (e) {
        console.error(`Warning while stopping Ganache: ${e.message || e}`);
      }
      await sleep(500);
    }
  }

  fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeCsv(summary, path.join(runDir, 'summary.csv'));
  console.log(`\nDone. Results saved under: ${runDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
