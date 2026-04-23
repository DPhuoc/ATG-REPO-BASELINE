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
    if (!v || v.startsWith('--')) {
      out[k] = true;
    } else {
      out[k] = v;
      i += 1;
    }
  }
  return out;
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x));
}

function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9_.-]/g, '_');
}

function nodeId(n) {
  if (typeof n === 'string') return n;
  if (!n || typeof n !== 'object') return '';
  return n.id || n.name || n.label || n.node || n.user || '';
}

function normalizeNodes(atg) {
  const out = [];
  for (const k of ['nodes', 'users', 'vertices']) {
    if (Array.isArray(atg[k])) {
      out.push(...atg[k].map(nodeId).filter(Boolean));
    }
  }
  return [...new Set(out)];
}

function normalizeArcs(atg) {
  const raw = atg.arcs || atg.edges || atg.transfers || [];
  return raw.map((a, idx) => {
    const from = a.from || a.src || a.sender || a.u;
    const to = a.to || a.dst || a.receiver || a.v;
    const tam = a.tam || a.chain || a.backend || a.network || 'evm';
    const fundId =
      a.fundId ||
      a.fund ||
      a.asset ||
      a.spec ||
      `fund:${String(from || 'x').toLowerCase()}${String(to || 'y').toLowerCase()}`;
    return {
      id: a.id || `arc_${idx}`,
      from,
      to,
      tam,
      fundId,
      raw: a
    };
  }).filter((a) => a.from && a.to);
}

function ensureNodes(nodes, arcs) {
  const set = new Set(nodes);
  for (const a of arcs) {
    set.add(a.from);
    set.add(a.to);
  }
  return [...set];
}

function buildIncoming(nodes, arcs) {
  const m = new Map(nodes.map((n) => [n, []]));
  for (const a of arcs) {
    if (!m.has(a.to)) m.set(a.to, []);
    m.get(a.to).push(a);
  }
  return m;
}

function isValidLeader(nodes, arcs, leader) {
  const incoming = buildIncoming(nodes, arcs);
  const seen = new Set([leader]);
  const q = [leader];

  while (q.length) {
    const cur = q.shift();
    for (const a of incoming.get(cur) || []) {
      if (!seen.has(a.from)) {
        seen.add(a.from);
        q.push(a.from);
      }
    }
  }
  return seen.size === nodes.length;
}

function unfold(nodes, arcs, leader) {
  const incoming = buildIncoming(nodes, arcs);
  let nextId = 0;
  const out = [];
  const stack = [{
    current: leader,
    pathNodes: [leader],
    pathEdges: []
  }];

  while (stack.length) {
    const s = stack.pop();
    for (const a of incoming.get(s.current) || []) {
      if (s.pathNodes.includes(a.from)) continue;

      const level = s.pathEdges.length + 1;
      const xe = {
        edgeId: `xe_${nextId++}`,
        arc: a,
        level
      };

      out.push(xe);
      stack.push({
        current: a.from,
        pathNodes: [a.from, ...s.pathNodes],
        pathEdges: [xe, ...s.pathEdges]
      });
    }
  }
  return out;
}

function summarizePairs(xedges) {
  const groups = new Map();

  for (const e of xedges) {
    const k = `${e.arc.from}->${e.arc.to}|${e.arc.tam}|${e.arc.fundId}`;
    if (!groups.has(k)) {
      groups.set(k, {
        pair: k,
        from: e.arc.from,
        to: e.arc.to,
        tam: e.arc.tam,
        fundId: e.arc.fundId,
        levelCounts: new Map()
      });
    }
    const g = groups.get(k);
    g.levelCounts.set(e.level, (g.levelCounts.get(e.level) || 0) + 1);
  }

  const rows = [...groups.values()].map((g) => {
    const levels = [...g.levelCounts.keys()].sort((a, b) => a - b);
    const counts = levels.map((l) => g.levelCounts.get(l));
    const numLevels = levels.length;
    const sumOptions = counts.reduce((a, b) => a + b, 0);
    const maxOptionsPerLevel = Math.max(...counts);

    let pattern = 'single-level';
    if (numLevels > 1 && maxOptionsPerLevel > 1) pattern = 'multi-level+multi-option';
    else if (numLevels > 1) pattern = 'multi-level';
    else if (maxOptionsPerLevel > 1) pattern = 'single-level+multi-option';

    return {
      pair: g.pair,
      from: g.from,
      to: g.to,
      tam: g.tam,
      fundId: g.fundId,
      contract_type: maxOptionsPerLevel > 1 ? 'CTLCMultipleEdges' : 'CTLCOnly',
      levels: numLevels,
      duplicate_vector: counts.join('|'),
      sum_options: sumOptions,
      max_options_per_level: maxOptionsPerLevel,
      pattern,
      has_multi_level: numLevels > 1,
      has_multi_option: maxOptionsPerLevel > 1,
      disable_steps_worst: Math.max(0, numLevels - 1)
    };
  });

  rows.sort((a, b) => a.pair.localeCompare(b.pair));
  return rows;
}

function aggregate(pairSummaries, xedges) {
  const totalPairs = pairSummaries.length;
  const totalLevels = pairSummaries.reduce((s, p) => s + p.levels, 0);
  const totalOptions = pairSummaries.reduce((s, p) => s + p.sum_options, 0);
  const totalDisableSteps = pairSummaries.reduce((s, p) => s + p.disable_steps_worst, 0);
  const numMultiple = pairSummaries.filter((p) => p.contract_type === 'CTLCMultipleEdges').length;
  const numOnly = totalPairs - numMultiple;
  const maxLevels = Math.max(0, ...pairSummaries.map((p) => p.levels));
  const maxOptionsPerLevel = Math.max(0, ...pairSummaries.map((p) => p.max_options_per_level));

  return {
    total_xedges: xedges.length,
    total_pairs: totalPairs,
    total_levels: totalLevels,
    total_options: totalOptions,
    total_disable_steps: totalDisableSteps,
    num_ctlc_only: numOnly,
    num_ctlc_multiple: numMultiple,
    max_levels: maxLevels,
    max_options_per_level: maxOptionsPerLevel
  };
}

function scoreCandidate(agg, objective) {
  const deploy_proxy =
    200 * agg.total_pairs +
    250 * agg.total_levels +
    350 * agg.total_options +
    600 * agg.num_ctlc_multiple;

  const runtime_proxy =
    400 * agg.total_disable_steps +
    120 * agg.total_levels +
    80 * agg.total_options +
    150 * agg.num_ctlc_multiple;

  const balanced_proxy = deploy_proxy + runtime_proxy;

  let score = balanced_proxy;
  if (objective === 'deploy') score = deploy_proxy;
  else if (objective === 'runtime') score = runtime_proxy;

  return {
    deploy_proxy,
    runtime_proxy,
    balanced_proxy,
    score
  };
}

function writeCsv(rows, outFile) {
  if (!rows.length) {
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

function emitLeaderFiles(baseAtg, ranked, emitDir) {
  fs.mkdirSync(emitDir, { recursive: true });
  for (const cand of ranked) {
    const x = deepClone(baseAtg);
    x.leader = cand.leader;
    const outFile = path.join(emitDir, `leader_${safeName(cand.leader)}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(x, null, 2)}\n`, 'utf8');
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.atg) {
    console.error('Usage: node tools/search_leader.js --atg <file.json> [--objective balanced|deploy|runtime] [--out out.json] [--csv out.csv] [--emitDir dir]');
    process.exit(1);
  }

  const atgFile = path.resolve(args.atg);
  const objective = args.objective || 'balanced';
  const outJson = path.resolve(args.out || 'paper2/data/processed/leader_search.json');
  const outCsv = path.resolve(args.csv || 'paper2/data/processed/leader_search.csv');
  const emitDir = args.emitDir ? path.resolve(args.emitDir) : '';

  const baseAtg = JSON.parse(fs.readFileSync(atgFile, 'utf8'));
  let nodes = normalizeNodes(baseAtg);
  const arcs = normalizeArcs(baseAtg);
  nodes = ensureNodes(nodes, arcs);

  if (!nodes.length) {
    throw new Error('No nodes found in ATG.');
  }
  if (!arcs.length) {
    throw new Error('No arcs found in ATG.');
  }

  const candidates = nodes
    .filter((n) => isValidLeader(nodes, arcs, n))
    .map((leader) => {
      const xedges = unfold(nodes, arcs, leader);
      const pairSummaries = summarizePairs(xedges);
      const agg = aggregate(pairSummaries, xedges);
      const proxy = scoreCandidate(agg, objective);

      return {
        leader,
        ...agg,
        ...proxy,
        pair_summaries: pairSummaries
      };
    });

  if (!candidates.length) {
    throw new Error('No valid leader found. The ATG may not be in-semiconnected for any node.');
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.total_levels !== b.total_levels) return a.total_levels - b.total_levels;
    if (a.total_options !== b.total_options) return a.total_options - b.total_options;
    if (a.num_ctlc_multiple !== b.num_ctlc_multiple) return a.num_ctlc_multiple - b.num_ctlc_multiple;
    return a.leader.localeCompare(b.leader);
  });

  if (emitDir) {
    emitLeaderFiles(baseAtg, candidates, emitDir);
  }

  const csvRows = candidates.map((c, idx) => ({
    rank: idx + 1,
    leader: c.leader,
    total_xedges: c.total_xedges,
    total_pairs: c.total_pairs,
    total_levels: c.total_levels,
    total_options: c.total_options,
    total_disable_steps: c.total_disable_steps,
    num_ctlc_only: c.num_ctlc_only,
    num_ctlc_multiple: c.num_ctlc_multiple,
    max_levels: c.max_levels,
    max_options_per_level: c.max_options_per_level,
    deploy_proxy: c.deploy_proxy,
    runtime_proxy: c.runtime_proxy,
    balanced_proxy: c.balanced_proxy,
    score: c.score
  }));

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.mkdirSync(path.dirname(outCsv), { recursive: true });

  const result = {
    source_atg: atgFile,
    original_leader: baseAtg.leader || '',
    objective,
    candidate_count: candidates.length,
    best_leader: candidates[0].leader,
    candidates
  };

  fs.writeFileSync(outJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  writeCsv(csvRows, outCsv);

  console.log(JSON.stringify({
    source_atg: atgFile,
    objective,
    original_leader: baseAtg.leader || '',
    candidate_count: candidates.length,
    best_leader: candidates[0].leader,
    top3: csvRows.slice(0, 3),
    out_json: outJson,
    out_csv: outCsv,
    emit_dir: emitDir || ''
  }, null, 2));
}

main();
