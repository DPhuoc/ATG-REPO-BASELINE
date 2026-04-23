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

function arc(id, from, to) {
  return { id, from, to, tam: 'evm', fundId: `fund:${id}` };
}

const args = parseArgs(process.argv);
const family = args.family || 'diamond';
const options = Math.max(1, Number(args.options || 1));
const leader = args.leader || 'A';
const out = args.out;

if (!out) {
  console.error('Usage: node tools/generate_holdout_motifs.js --family diamond|ring --options N --leader A --out <file.json>');
  process.exit(1);
}

let nodes = [];
let arcs = [];
let graphId = `holdout_${family}_opt${options}`;

if (family === 'diamond') {
  // Multiple valid leaders; different upstream structure than leader-sensitive family
  nodes = ['A', 'B', 'C', 'D'];
  arcs = [
    arc('ba', 'B', 'A'),
    arc('ca', 'C', 'A'),
    arc('db', 'D', 'B'),
    arc('ad', 'A', 'D'),
  ];

  for (let i = 1; i <= options; i += 1) {
    const x = `X${i}`;
    nodes.push(x);
    arcs.push(arc(`bx${i}`, 'B', x));
    arcs.push(arc(`x${i}c`, x, 'C'));
  }
} else if (family === 'ring') {
  // Ring-like family with shortcuts; unseen relative to leader-sensitive family
  nodes = ['A', 'B', 'C', 'D'];
  arcs = [
    arc('ba', 'B', 'A'),
    arc('cb', 'C', 'B'),
    arc('dc', 'D', 'C'),
    arc('ad', 'A', 'D'),
  ];

  for (let i = 1; i <= options; i += 1) {
    const x = `X${i}`;
    nodes.push(x);
    arcs.push(arc(`cx${i}`, 'C', x));
    arcs.push(arc(`x${i}a`, x, 'A'));
  }
} else {
  console.error(`Unknown family: ${family}`);
  process.exit(1);
}

const atg = {
  leader,
  nodes,
  arcs,
  meta: {
    graph_id: graphId,
    family,
    options,
    original_leader: leader
  }
};

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(path.resolve(out), JSON.stringify(atg, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  out: path.resolve(out),
  family,
  options,
  leader,
  nodes: atg.nodes.length,
  arcs: atg.arcs.length,
  graph_id: graphId
}, null, 2));
