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
    else { out[k] = v; i += 1; }
  }
  return out;
}

function randInt(lo, hi) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

const args = parseArgs(process.argv);
const count = Number(args.count || 300);
const outdir = args.outdir || 'paper2/data/raw/random_graphs';
fs.mkdirSync(outdir, { recursive: true });

for (let g = 1; g <= count; g += 1) {
  const n = randInt(4, 7);
  const nodes = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  const arcs = [];
  let idc = 0;

  // ensure at least one cycle-like backbone
  for (let i = 0; i < n; i += 1) {
    const from = nodes[i];
    const to = nodes[(i + 1) % n];
    arcs.push({
      id: `e${idc++}`,
      from, to,
      tam: 'evm',
      fundId: `fund:${from.toLowerCase()}${to.toLowerCase()}`
    });
  }

  const extra = randInt(n, n + 3);
  for (let i = 0; i < extra; i += 1) {
    const from = nodes[randInt(0, n - 1)];
    const to = nodes[randInt(0, n - 1)];
    if (from === to) continue;
    arcs.push({
      id: `e${idc++}`,
      from, to,
      tam: 'evm',
      fundId: `fund:${from.toLowerCase()}${to.toLowerCase()}`
    });
  }

  const atg = {
    leader: nodes[0],
    nodes,
    arcs,
    meta: {
      family: 'random_v1',
      graph_id: `random_v1_${g}`
    }
  };

  fs.writeFileSync(
    path.join(outdir, `random_v1_${g}.json`),
    JSON.stringify(atg, null, 2) + '\n',
    'utf8'
  );
}

console.log(JSON.stringify({ outdir: path.resolve(outdir), count }, null, 2));
