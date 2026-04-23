#!/usr/bin/env node
const path = require('path');
const { loadJson, saveJson, compileATG } = require('./atg_core');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--atg') out.atg = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--pretty') out.pretty = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node tools/compile_atg.js --atg examples/triangle_atg.json --out examples/triangle_atg.compiled.json
`);
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.atg) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  const atg = loadJson(args.atg);
  const compiled = compileATG(atg);
  const outPath = args.out || path.resolve(process.cwd(), 'compiled.atg.json');
  saveJson(outPath, compiled);
  console.log(`Wrote ${outPath}`);
  console.log(`Contracts: ${compiled.contracts.length}`);
  for (const c of compiled.contracts) {
    console.log(`- ${c.key} => ${c.contractName} (levels=${c.subcontracts.length})`);
  }
})();
