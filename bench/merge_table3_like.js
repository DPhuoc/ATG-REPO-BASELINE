const fs = require('fs');
const path = require('path');

function loadSummary(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function asNum(x) {
  if (x == null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pick(arr, contract, scenario) {
  return arr.find((r) => r.contract === contract && r.scenario === scenario && r.ok);
}

function buildRow(name, data) {
  return {
    protocol: name,
    deployGas: data.deployGas ?? '',
    claimBestGas: data.claimBestGas ?? '',
    claimWorstGas: data.claimWorstGas ?? '',
    refundBestGas: data.refundBestGas ?? '',
    refundWorstGas: data.refundWorstGas ?? '',
  };
}

function csv(rows) {
  const headers = ['protocol', 'deployGas', 'claimBestGas', 'claimWorstGas', 'refundBestGas', 'refundWorstGas'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','));
  }
  return `${lines.join('\n')}\n`;
}

const ctlcSummary = loadSummary(process.argv[2]);
const cmpSummary = loadSummary(process.argv[3]);
const outFile = process.argv[4] || path.resolve('table3_like.csv');

const ctlcOnlyBest = pick(ctlcSummary, 'CTLCOnly', 'best_claim');
const ctlcOnlyWorst = pick(ctlcSummary, 'CTLCOnly', 'worst_claim');
const ctlcOnlyRefund = pick(ctlcSummary, 'CTLCOnly', 'refund');
const ctlcMeBest = pick(ctlcSummary, 'CTLCMultipleEdges', 'best_claim');
const ctlcMeWorst = pick(ctlcSummary, 'CTLCMultipleEdges', 'worst_claim');
const ctlcMeRefund = pick(ctlcSummary, 'CTLCMultipleEdges', 'refund');

const swapClaim = pick(cmpSummary, 'Swap', 'claim');
const swapRefundBest = pick(cmpSummary, 'Swap', 'refund_best');
const swapRefundWorst = pick(cmpSummary, 'Swap', 'refund_worst');
const siClaimBest = pick(cmpSummary, 'SwapImproved', 'claim_best');
const siClaimWorst = pick(cmpSummary, 'SwapImproved', 'claim_worst');
const siRefund = pick(cmpSummary, 'SwapImproved', 'refund');

const rows = [
  buildRow('Herlihy [15] / Swap', {
    deployGas: swapClaim?.deployGas,
    claimBestGas: swapClaim?.gasUsed,
    claimWorstGas: swapClaim?.gasUsed,
    refundBestGas: swapRefundBest?.gasUsed,
    refundWorstGas: swapRefundWorst?.gasUsed,
  }),
  buildRow('Imoto et al. [21] / SwapImproved', {
    deployGas: siClaimBest?.deployGas,
    claimBestGas: siClaimBest?.gasUsed,
    claimWorstGas: siClaimWorst?.gasUsed,
    refundBestGas: siRefund?.gasUsed,
    refundWorstGas: siRefund?.gasUsed,
  }),
  buildRow('Ours / CTLCOnly', {
    deployGas: ctlcOnlyBest?.deployGas,
    claimBestGas: ctlcOnlyBest?.gasUsed,
    claimWorstGas: (asNum(ctlcOnlyWorst?.disableGasUsed) || 0) + (asNum(ctlcOnlyWorst?.claimGasUsed) || 0),
    refundBestGas: ctlcOnlyRefund?.refundGasUsed,
    refundWorstGas: (asNum(ctlcOnlyRefund?.disableGasUsed) || 0) + (asNum(ctlcOnlyRefund?.refundGasUsed) || 0),
  }),
  buildRow('Ours / CTLCMultipleEdges', {
    deployGas: ctlcMeBest?.deployGas,
    claimBestGas: ctlcMeBest?.gasUsed,
    claimWorstGas: (asNum(ctlcMeWorst?.disableGasUsed) || 0) + (asNum(ctlcMeWorst?.claimGasUsed) || 0),
    refundBestGas: ctlcMeRefund?.refundGasUsed,
    refundWorstGas: (asNum(ctlcMeRefund?.disableGasUsed) || 0) + (asNum(ctlcMeRefund?.refundGasUsed) || 0),
  }),
];

fs.writeFileSync(outFile, csv(rows), 'utf8');
console.log(`Wrote ${outFile}`);
