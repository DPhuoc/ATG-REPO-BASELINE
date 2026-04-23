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

const args = parseArgs(process.argv);
if (!args.out) {
  console.error('Usage: node tools/generate_leader_sensitive_family.js --out <file.json> --direct true|false --options <N> [--leader A]');
  process.exit(1);
}

const direct = String(args.direct ?? 'true').toLowerCase() !== 'false';
const options = Math.max(1, Number(args.options || 1));
const leader = args.leader || 'A';

const nodes = ['A', 'B', 'D'];
const arcs = [
  { id: 'ab', from: 'A', to: 'B', tam: 'evm', fundId: 'fund:ab' },
  { id: 'db', from: 'D', to: 'B', tam: 'evm', fundId: 'fund:db' }
];

if (direct) {
  arcs.push({ id: 'ba', from: 'B', to: 'A', tam: 'evm', fundId: 'fund:ba' });
}

for (let i = 1; i <= options; i += 1) {
  const x = `X${i}`;
  nodes.push(x);
  arcs.push({ id: `bx${i}`, from: 'B', to: x, tam: 'evm', fundId: `fund:bx${i}` });
  arcs.push({ id: `x${i}a`, from: x, to: 'A', tam: 'evm', fundId: `fund:x${i}a` });
}

const atg = {
  leader,
  nodes,
  arcs,
  meta: {
    family: 'leader_sensitive',
    direct,
    options,
    targetPair: 'D->B|evm|fund:db'
  }
};

fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(atg, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  out: path.resolve(args.out),
  leader,
  direct,
  options,
  nodes: atg.nodes.length,
  arcs: atg.arcs.length
}, null, 2));
