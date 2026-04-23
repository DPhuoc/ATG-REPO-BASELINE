#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    leader: 'A',
    source: 'D',
    middle: 'B',
    direct: true,
    options: 2,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--leader') out.leader = next, i++;
    else if (a === '--source') out.source = next, i++;
    else if (a === '--middle') out.middle = next, i++;
    else if (a === '--direct') out.direct = /^(1|true|yes)$/i.test(next), i++;
    else if (a === '--options') out.options = Number(next), i++;
    else if (a === '--out') out.out = next, i++;
    else if (a === '--help') out.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!Number.isInteger(out.options) || out.options < 0) throw new Error('--options must be >= 0');
  if (!out.direct && out.options === 0) throw new Error('ATG would be disconnected: use --direct true or --options >= 1');
  return out;
}

function makeArc(id, from, to, fundId) {
  return { id, from, to, tam: 'evm', fundId };
}

function buildATG({ leader, source, middle, direct, options }) {
  const nodes = new Set([leader, source, middle]);
  const arcs = [];

  // target pair we care about
  arcs.push(makeArc('db', source, middle, 'fund:db'));

  // direct edge to leader gives one shorter path -> extra subcontract level
  if (direct) {
    arcs.push(makeArc('ba_direct', middle, leader, 'fund:ba_direct'));
  }

  // each option creates an alternate branch middle -> Xi -> leader
  for (let i = 1; i <= options; i++) {
    const x = `X${i}`;
    nodes.add(x);
    arcs.push(makeArc(`b_${x}`.toLowerCase(), middle, x, `fund:b${x.toLowerCase()}`));
    arcs.push(makeArc(`${x}_a`.toLowerCase(), x, leader, `fund:${x.toLowerCase()}a`));
  }

  return {
    leader,
    nodes: Array.from(nodes),
    arcs,
    meta: {
      family: 'branchy',
      parameters: { direct, options },
      expectedTargetPair: `${source}->${middle}|evm|fund:db`,
      expectedPattern: direct && options > 1
        ? 'multi-level+multi-option'
        : direct && options === 1
          ? 'multi-level'
          : (!direct && options > 1)
            ? 'single-level+multi-option'
            : 'single-level'
    }
  };
}

function usage() {
  console.log(`Usage:
  node tools/generate_branchy_atg.js --out examples/branchy.json [--direct true] [--options 2]

Behavior:
  direct=true, options=0  => single-level target pair D->B
  direct=true, options=1  => multi-level target pair D->B
  direct=true, options=K>1=> multi-level+multi-option target pair D->B
  direct=false, options=K>1=> single-level+multi-option target pair D->B
`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.out) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  const atg = buildATG(args);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(atg, null, 2));
  console.log(`wrote ${args.out}`);
  console.log(JSON.stringify(atg.meta, null, 2));
}

main();
