const { ethers, writeOutput, buildKeyMap, pkFor, signDigest } = require('./swap_signing_common');

const SEEDS = {
  CB: '0xc0e980cb61f5184197feb588e1f8238f3a7a8595ea7c7060066656b44a09305977a48ee5f38abf3ca3d0f02157e4ab526c9196abbb50efd0442bd93fab3076411b',
  CBA: '0xe4fbfb656ed8300fd5ffbe1714a83a6034ad7e1e370564de3e2d04d97b2453783a42ad698d6ff4eecc06197f312459b12638fba95cb6dc119acdcdb322f676aa1c',
  CAB: '0x7b7b37fc0195ae79d6b723d8740ee92d48f46bc68a4031e93961614c056135074633d58fb128b475b5f2bf00e583570bce539da28fa6756d43497f7d66ee953e1c',
  CA: '0xfd06d0c8823932cd41fbacc62e727cf056142c6d9469080aaab887ac13febfed47d74f3b811a71975a04c45a6596c7a671f56fdf73508db8a44e75c0c20e01511c',
};

function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: '2.0', id: Date.now(), method, params },
      (err, result) => (err ? reject(err) : resolve(result))
    );
  });
}

async function mine(n = 1) {
  for (let i = 0; i < n; i += 1) await rpc('evm_mine', []);
}

async function currentBlock() {
  return await web3.eth.getBlockNumber();
}

async function mineUntil(target) {
  let bn = await currentBlock();
  while (bn < target) {
    await mine(1);
    bn = await currentBlock();
  }
}

async function fund(to, from, amountEth = '1') {
  return await web3.eth.sendTransaction({
    from,
    to,
    value: web3.utils.toWei(amountEth, 'ether'),
  });
}

function nestedSigs(seed, privateKeys) {
  let digest = ethers.keccak256(seed);
  const sigs = [];
  for (const pk of privateKeys) {
    const sig = signDigest(pk, digest);
    sigs.push(sig);
    digest = ethers.keccak256(sig);
  }
  return sigs;
}

module.exports = async function (callback) {
  const scenario = process.env.SCENARIO;
  const outputPath = process.env.OUTPUT_JSON;
  const keysPath = process.env.KEYS_JSON;
  const mnemonic = process.env.MNEMONIC;

  try {
    if (!scenario) throw new Error('Missing SCENARIO');

    const Swap = artifacts.require('Swap');
    const inst = await Swap.deployed();
    const accounts = await web3.eth.getAccounts();
    const keyMap = buildKeyMap(accounts, mnemonic, keysPath);

    const payer = accounts[0];
    const partyA = accounts[0];
    const partyB = accounts[1];
    const partyC = accounts[2];
    const party = partyB;
    const counterparty = partyC;

    const result = {
      ok: true,
      contract: 'Swap',
      scenario,
      contractAddress: inst.address,
      startBlock: await currentBlock(),
      payer,
      party,
      counterparty,
    };

    const refundTimeout = 15;

    if (scenario === 'claim') {
      const fundTx = await fund(inst.address, payer, '1');
      result.fundTx = fundTx.transactionHash || fundTx.tx || null;

      const plans = [
        { i: 0, seed: SEEDS.CB, path: [partyB, partyC], pks: [pkFor(keyMap, partyB), pkFor(keyMap, partyC)] },
        { i: 1, seed: SEEDS.CBA, path: [partyA, partyB, partyC], pks: [pkFor(keyMap, partyA), pkFor(keyMap, partyB), pkFor(keyMap, partyC)] },
        { i: 2, seed: SEEDS.CAB, path: [partyB, partyA, partyC], pks: [pkFor(keyMap, partyB), pkFor(keyMap, partyA), pkFor(keyMap, partyC)] },
        { i: 3, seed: SEEDS.CA, path: [partyA, partyC], pks: [pkFor(keyMap, partyA), pkFor(keyMap, partyC)] },
      ];

      const unlocks = [];
      let total = 0;
      for (const p of plans) {
        const sigs = nestedSigs(p.seed, p.pks);
        const tx = await inst.unlock(p.i, p.seed, p.path, sigs, { from: counterparty });
        unlocks.push({ index: p.i, gasUsed: tx.receipt.gasUsed, tx: tx.tx });
        total += Number(tx.receipt.gasUsed);
      }

      const claimTx = await inst.claim({ from: counterparty });
      result.unlocks = unlocks;
      result.claimGasUsed = claimTx.receipt.gasUsed;
      result.gasUsed = total + Number(claimTx.receipt.gasUsed);
      result.claimTx = claimTx.tx;
    } else if (scenario === 'refund_best') {
      const fundTx = await fund(inst.address, payer, '1');
      result.fundTx = fundTx.transactionHash || fundTx.tx || null;

      await mineUntil(refundTimeout);
      const refundTx = await inst.refund({ from: party });
      result.refundGasUsed = refundTx.receipt.gasUsed;
      result.gasUsed = refundTx.receipt.gasUsed;
      result.refundTx = refundTx.tx;
    } else if (scenario === 'refund_worst') {
      const fundTx = await fund(inst.address, payer, '1');
      result.fundTx = fundTx.transactionHash || fundTx.tx || null;

      const partialPlans = [
        { i: 0, seed: SEEDS.CB, path: [partyB, partyC], pks: [pkFor(keyMap, partyB), pkFor(keyMap, partyC)] },
        { i: 1, seed: SEEDS.CBA, path: [partyA, partyB, partyC], pks: [pkFor(keyMap, partyA), pkFor(keyMap, partyB), pkFor(keyMap, partyC)] },
        { i: 2, seed: SEEDS.CAB, path: [partyB, partyA, partyC], pks: [pkFor(keyMap, partyB), pkFor(keyMap, partyA), pkFor(keyMap, partyC)] },
      ];

      const unlocks = [];
      let total = 0;
      for (const p of partialPlans) {
        const sigs = nestedSigs(p.seed, p.pks);
        const tx = await inst.unlock(p.i, p.seed, p.path, sigs, { from: counterparty });
        unlocks.push({ index: p.i, gasUsed: tx.receipt.gasUsed, tx: tx.tx });
        total += Number(tx.receipt.gasUsed);
      }

      await mineUntil(refundTimeout);
      const refundTx = await inst.refund({ from: party });
      result.unlocks = unlocks;
      result.refundGasUsed = refundTx.receipt.gasUsed;
      result.gasUsed = total + Number(refundTx.receipt.gasUsed);
      result.refundTx = refundTx.tx;
    } else {
      throw new Error(`Unsupported scenario: ${scenario}`);
    }

    result.endBlock = await currentBlock();
    result.finalContractBalanceWei = await web3.eth.getBalance(inst.address);

    writeOutput(outputPath, result);
    console.log(JSON.stringify(result, null, 2));
    callback();
  } catch (err) {
    const failure = {
      ok: false,
      contract: 'Swap',
      scenario: scenario || null,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null,
    };
    writeOutput(outputPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    callback(err);
  }
};
