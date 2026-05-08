const fs = require('fs');
const path = require('path');
const { compileATG, loadJson } = require('../tools/atg_core');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--atg') out.atg = argv[++i];
    else if (a === '--compiled') out.compiled = argv[++i];
    else if (a === '--pair') out.pair = argv[++i];
    else if (a === '--scenario') out.scenario = argv[++i];
    else if (a === '--fund-wei') out.fundWei = argv[++i];
    else if (a === '--out' || a === '--output' || a === '--output-json') out.outputJson = argv[++i];
  }
  return out;
}

function sendRpc(provider, method, params = []) {
  return new Promise((resolve, reject) => {
    provider.send(
      { jsonrpc: '2.0', id: Date.now(), method, params },
      (err, res) => {
        if (err) return reject(err);
        if (res && res.error) return reject(new Error(res.error.message || JSON.stringify(res.error)));
        resolve(res && res.result);
      },
    );
  });
}

async function mineOne(provider) {
  await sendRpc(provider, 'evm_mine', []);
}

async function mineToBlock(web3, targetBlock) {
  while ((await web3.eth.getBlockNumber()) < targetBlock) {
    await mineOne(web3.currentProvider);
  }
}

async function getDeployGas(web3, instance) {
  const txHash = instance.transactionHash || instance.tx || '';
  if (!txHash) return '';
  const receipt = await web3.eth.getTransactionReceipt(txHash);
  return receipt ? String(receipt.gasUsed) : '';
}

function txHashOf(txLike) {
  return (txLike && (txLike.tx || txLike.transactionHash)) || '';
}

function addTx(result, role, txLike, extra = {}) {
  const txHash = txHashOf(txLike);
  if (!txHash) return;

  if (!Array.isArray(result.transactions)) result.transactions = [];
  result.transactions.push({ role, txHash, ...extra });

  if (!Array.isArray(result.txRoles)) result.txRoles = [];
  result.txRoles.push({ role, txHash, ...extra });

  if (role === 'deploy') {
    result.deployTxHash = txHash;
  } else if (role === 'fund') {
    result.fundTxHash = txHash;
  } else if (role === 'claim') {
    result.claimTxHash = txHash;
    if (!result.txHash) result.txHash = txHash;
    if (!result.tx) result.tx = txHash;
  } else if (role === 'refund') {
    result.refundTxHash = txHash;
    if (!result.refundTx) result.refundTx = txHash;
  } else if (role === 'disable') {
    if (!Array.isArray(result.disableTxHashes)) result.disableTxHashes = [];
    result.disableTxHashes.push(txHash);
    if (!result.disableTxHash) result.disableTxHash = txHash;
    if (!result.disableTx) result.disableTx = txHash;
  }
}

function chooseOption(subcontract, idx = 0) {
  if (!subcontract || !Array.isArray(subcontract.optionSecretLabels) || subcontract.optionSecretLabels.length === 0) {
    throw new Error('subcontract has no claim options');
  }
  if (idx < 0 || idx >= subcontract.optionSecretLabels.length) {
    throw new Error(`option index out of range: idx=${idx}, options=${subcontract.optionSecretLabels.length}`);
  }
  return subcontract.optionSecretLabels[idx];
}

function pickContract(compiled, pairKey) {
  const list = compiled.contracts || [];
  if (!pairKey) {
    if (list.length !== 1) {
      throw new Error(`compiled spec contains ${list.length} contracts; pass --pair`);
    }
    return list[0];
  }
  const found = list.find((c) => c.key === pairKey);
  if (!found) {
    throw new Error(`pair not found: ${pairKey}`);
  }
  return found;
}

function writeOutput(outputPath, payload) {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compiledGraphId(compiled) {
  return (
    compiled.graph_id ||
    compiled.graphId ||
    (compiled.meta && (compiled.meta.graph_id || compiled.meta.graphId)) ||
    ''
  );
}

function secretsFromLabels(spec, labels) {
  return labels.map((label) => {
    const secret = spec.secretsByLabel && spec.secretsByLabel[label];
    if (!secret) throw new Error(`missing secret for label: ${label}`);
    return secret;
  });
}

module.exports = async function(callback) {
  const args = parseArgs(process.argv);
  const scenario = args.scenario || process.env.SCENARIO || 'best_claim';
  const outputPath = args.outputJson || process.env.OUTPUT_JSON || '';

  try {
    if (!args.compiled && !args.atg) {
      throw new Error('Missing --compiled or --atg');
    }

    const compiled = args.compiled
      ? loadJson(args.compiled)
      : compileATG(loadJson(args.atg));

    const spec = pickContract(compiled, args.pair || process.env.PAIR || '');
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    const party = accounts[spec.partyAccountIndex];
    const counterparty = accounts[spec.counterpartyAccountIndex];

    if (!party || !counterparty) {
      throw new Error(`account index out of range: party=${spec.partyAccountIndex}, counterparty=${spec.counterpartyAccountIndex}`);
    }

    const currentBlock = await web3.eth.getBlockNumber();
    const absoluteTimelocks = spec.relativeTimelocks.map((x) => currentBlock + Number(x));
    const Contract = artifacts.require(spec.contractName);
    const fundWei = String(args.fundWei || process.env.FUND_WEI || spec.fundingWei || '1000000000000000000');

    const instance = await Contract.new(
      party,
      counterparty,
      absoluteTimelocks,
      spec.conditions,
      { from: deployer },
    );

    const result = {
      ok: true,
      graph_id: compiledGraphId(compiled),
      pair: spec.key,
      pairKey: spec.key,
      contract: spec.contractName,
      scenario,
      deployGas: await getDeployGas(web3, instance),
      gasUsed: '',
      disableGasUsed: '',
      claimGasUsed: '',
      refundGasUsed: '',
      contractAddress: instance.address,
      startBlock: String(currentBlock),
      endBlock: '',
      finalContractBalanceWei: '',
      deployer,
      party,
      counterparty,
      fundingWei: fundWei,
      timelocks: absoluteTimelocks,
      transactions: [],
      txRoles: [],
    };

    addTx(result, 'deploy', instance);

    const fundTx = await web3.eth.sendTransaction({
      from: deployer,
      to: instance.address,
      value: fundWei,
    });
    addTx(result, 'fund', fundTx);

    const levels = spec.subcontracts.length;
    const lastIdx = levels - 1;
    if (levels <= 0) throw new Error('compiled contract has no subcontracts');

    if (scenario === 'best_claim') {
      const labels = chooseOption(spec.subcontracts[0], 0);
      const secrets = secretsFromLabels(spec, labels);
      let claimTx;
      if (spec.contractName === 'CTLCOnly') {
        claimTx = await instance.claim(0, secrets, { from: counterparty });
      } else {
        claimTx = await instance.claim(0, 0, secrets, { from: counterparty });
      }
      addTx(result, 'claim', claimTx, { level: 0, option: 0 });
      result.gasUsed = String(claimTx.receipt.gasUsed);
      result.claimGasUsed = result.gasUsed;
    } else if (scenario === 'worst_claim') {
      let disableTotal = 0n;
      for (let i = 0; i < lastIdx; i += 1) {
        await mineToBlock(web3, absoluteTimelocks[i]);
        const disableTx = await instance.disableSubcontract(i, { from: party });
        addTx(result, 'disable', disableTx, { level: i });
        disableTotal += BigInt(disableTx.receipt.gasUsed);
      }

      const labels = chooseOption(spec.subcontracts[lastIdx], 0);
      const secrets = secretsFromLabels(spec, labels);
      let claimTx;
      if (spec.contractName === 'CTLCOnly') {
        claimTx = await instance.claim(lastIdx, secrets, { from: counterparty });
      } else {
        claimTx = await instance.claim(lastIdx, 0, secrets, { from: counterparty });
      }
      addTx(result, 'claim', claimTx, { level: lastIdx, option: 0 });
      result.disableGasUsed = String(disableTotal);
      result.claimGasUsed = String(claimTx.receipt.gasUsed);
      result.gasUsed = String(disableTotal + BigInt(claimTx.receipt.gasUsed));
    } else if (scenario === 'refund') {
      let disableTotal = 0n;
      for (let i = 0; i < lastIdx; i += 1) {
        await mineToBlock(web3, absoluteTimelocks[i]);
        const disableTx = await instance.disableSubcontract(i, { from: party });
        addTx(result, 'disable', disableTx, { level: i });
        disableTotal += BigInt(disableTx.receipt.gasUsed);
      }

      await mineToBlock(web3, absoluteTimelocks[lastIdx]);
      const refundTx = await instance.refund({ from: party });
      addTx(result, 'refund', refundTx, { level: lastIdx });
      result.disableGasUsed = String(disableTotal);
      result.refundGasUsed = String(refundTx.receipt.gasUsed);
      result.gasUsed = String(disableTotal + BigInt(refundTx.receipt.gasUsed));
    } else {
      throw new Error(`unknown scenario: ${scenario}`);
    }

    result.endBlock = String(await web3.eth.getBlockNumber());
    result.finalContractBalanceWei = await web3.eth.getBalance(instance.address);

    writeOutput(outputPath, result);
    console.log(JSON.stringify(result, null, 2));
    callback();
  } catch (err) {
    const failure = {
      ok: false,
      contract: null,
      scenario,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null,
    };
    writeOutput(outputPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    callback(err);
  }
};
