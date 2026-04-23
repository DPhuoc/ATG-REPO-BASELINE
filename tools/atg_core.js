const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let hashBytes;
try {
  const { keccak256 } = require('ethers');
  hashBytes = (hexValue) => keccak256(hexValue);
} catch (_) {
  const { soliditySha3 } = require('web3-utils');
  hashBytes = (hexValue) => soliditySha3({ type: 'bytes', value: hexValue });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x));
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function saveJson(filePath, value) {
  fs.writeFileSync(path.resolve(filePath), JSON.stringify(value, null, 2));
}

function normalizeATG(atg) {
  const out = deepClone(atg);
  out.nodes = out.nodes || [];
  out.arcs = out.arcs || [];
  out.compiler = out.compiler || {};
  out.defaults = out.defaults || {};
  out.accountIndexByNode = out.accountIndexByNode || {};
  out.fundingWeiByFundId = out.fundingWeiByFundId || {};
  out.defaults.delta = Number(out.compiler.delta || out.defaults.delta || 1);
  out.defaults.startOffset = Number(out.compiler.startOffset || out.defaults.startOffset || 5);
  out.defaults.defaultFundingWei = String(out.defaults.defaultFundingWei || '1000000000000000000');
  return out;
}

function validateATG(atgInput) {
  const atg = normalizeATG(atgInput);
  assert(typeof atg.leader === 'string' && atg.leader.length > 0, 'atg.leader is required');
  assert(Array.isArray(atg.nodes) && atg.nodes.length > 0, 'atg.nodes must be a non-empty array');
  assert(Array.isArray(atg.arcs) && atg.arcs.length > 0, 'atg.arcs must be a non-empty array');
  const nodeSet = new Set(atg.nodes);
  assert(nodeSet.size === atg.nodes.length, 'atg.nodes contains duplicates');
  assert(nodeSet.has(atg.leader), 'atg.leader must be present in atg.nodes');

  const arcIds = new Set();
  for (let i = 0; i < atg.arcs.length; i += 1) {
    const a = atg.arcs[i];
    assert(typeof a.from === 'string' && nodeSet.has(a.from), `arc[${i}].from must be a known node`);
    assert(typeof a.to === 'string' && nodeSet.has(a.to), `arc[${i}].to must be a known node`);
    assert(a.from !== a.to, `arc[${i}] must not be a self-loop`);
    a.id = a.id || `arc_${i}`;
    assert(!arcIds.has(a.id), `duplicate arc id: ${a.id}`);
    arcIds.add(a.id);
    a.tam = a.tam || 'evm';
    a.fundId = a.fundId || 'default-fund';
  }

  validateInSemiconnected(atg);
  materializeAccountMap(atg);
  return atg;
}

function materializeAccountMap(atg) {
  const seen = new Set();
  for (const node of atg.nodes) {
    if (atg.accountIndexByNode[node] !== undefined) {
      const idx = Number(atg.accountIndexByNode[node]);
      assert(Number.isInteger(idx) && idx >= 1, `accountIndexByNode[${node}] must be an integer >= 1`);
      seen.add(idx);
    }
  }

  let next = 1;
  for (const node of atg.nodes) {
    if (atg.accountIndexByNode[node] === undefined) {
      while (seen.has(next)) next += 1;
      atg.accountIndexByNode[node] = next;
      seen.add(next);
    }
  }
}

function validateInSemiconnected(atg) {
  const incoming = new Map();
  for (const n of atg.nodes) incoming.set(n, []);
  for (const a of atg.arcs) incoming.get(a.to).push(a.from);

  const q = [atg.leader];
  const seen = new Set([atg.leader]);
  while (q.length) {
    const v = q.shift();
    for (const u of incoming.get(v) || []) {
      if (!seen.has(u)) {
        seen.add(u);
        q.push(u);
      }
    }
  }

  assert(seen.size === atg.nodes.length, `ATG is not in-semiconnected with respect to leader ${atg.leader}`);
}

function buildIncomingIndex(atg) {
  const incoming = new Map();
  for (const n of atg.nodes) incoming.set(n, []);
  for (const a of atg.arcs) incoming.get(a.to).push(a);
  return incoming;
}

function unfoldATG(atgInput) {
  const atg = validateATG(atgInput);
  const incoming = buildIncomingIndex(atg);
  const xedges = [];
  let nextId = 0;

  const stack = [{
    current: atg.leader,
    pathNodes: [atg.leader],
    pathXEdges: [],
  }];

  while (stack.length) {
    const state = stack.pop();
    const ins = incoming.get(state.current) || [];
    for (const arc of ins) {
      if (state.pathNodes.includes(arc.from)) {
        continue;
      }

      const xedge = {
        xedgeId: `xe_${nextId}`,
        ordinal: nextId,
        arcId: arc.id,
        from: arc.from,
        to: arc.to,
        tam: arc.tam,
        fundId: arc.fundId,
        level: state.pathXEdges.length + 1,
        pathToRootXEdgeIds: [],
        pathToRootArcIds: [],
        sourcePathNodes: [arc.from, ...state.pathNodes],
      };
      nextId += 1;

      const newPath = [xedge, ...state.pathXEdges];
      xedge.pathToRootXEdgeIds = newPath.map((e) => e.xedgeId);
      xedge.pathToRootArcIds = newPath.map((e) => e.arcId);
      xedges.push(xedge);

      stack.push({
        current: arc.from,
        pathNodes: [arc.from, ...state.pathNodes],
        pathXEdges: newPath,
      });
    }
  }

  return xedges;
}

function makeSecretHex(label, bytes = 16) {
  const hex = crypto.createHash('sha256').update(String(label)).digest('hex');
  return `0x${hex.slice(0, bytes * 2)}`;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

function compileATG(atgInput) {
  const atg = validateATG(atgInput);
  const xedges = unfoldATG(atg);
  const pairGroups = groupBy(xedges, (e) => `${e.from}->${e.to}|${e.tam}|${e.fundId}`);
  const contracts = [];

  for (const [pairKey, edges] of pairGroups.entries()) {
    const [pair, tam, fundId] = pairKey.split('|');
    const [from, to] = pair.split('->');
    const levelGroups = groupBy(edges, (e) => String(e.level));
    const levels = [...levelGroups.keys()].map((x) => Number(x)).sort((a, b) => a - b);

    const secretsByLabel = {};
    const subcontracts = [];
    let hasMultipleOptions = false;

    for (const level of levels) {
      const sameLevel = levelGroups.get(String(level)) || [];
      const options = sameLevel.map((edge) => {
        return edge.pathToRootXEdgeIds.map((xedgeId) => {
          const label = `secret:${xedgeId}`;
          if (!secretsByLabel[label]) {
            secretsByLabel[label] = makeSecretHex(`${pairKey}:${label}`);
          }
          return label;
        });
      });

      if (options.length > 1) hasMultipleOptions = true;

      const hashedOptions = options.map((option) => option.map((label) => hashBytes(secretsByLabel[label])));
      subcontracts.push({
        level,
        relativeTimelock: atg.defaults.startOffset + (level * atg.defaults.delta),
        optionSecretLabels: options,
        optionHashlocks: hashedOptions,
        duplicateCount: options.length,
      });
    }

    const fundingWei = String(atg.fundingWeiByFundId[fundId] || atg.defaults.defaultFundingWei);
    const contractName = hasMultipleOptions ? 'CTLCMultipleEdges' : 'CTLCOnly';
    const conditions = hasMultipleOptions
      ? subcontracts.map((s) => s.optionHashlocks)
      : subcontracts.map((s) => s.optionHashlocks[0]);

    contracts.push({
      key: pairKey,
      contractName,
      partyNode: from,
      counterpartyNode: to,
      partyAccountIndex: Number(atg.accountIndexByNode[from]),
      counterpartyAccountIndex: Number(atg.accountIndexByNode[to]),
      tam,
      fundId,
      fundingWei,
      relativeTimelocks: subcontracts.map((s) => s.relativeTimelock),
      conditions,
      subcontracts,
      secretsByLabel,
      xedgeIds: edges.map((e) => e.xedgeId),
    });
  }

  return {
    schemaVersion: 1,
    leader: atg.leader,
    defaults: atg.defaults,
    accountIndexByNode: atg.accountIndexByNode,
    xedges,
    contracts: contracts.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

module.exports = {
  loadJson,
  saveJson,
  validateATG,
  validateInSemiconnected,
  unfoldATG,
  compileATG,
};
