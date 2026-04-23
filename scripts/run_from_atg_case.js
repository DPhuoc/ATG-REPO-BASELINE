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
  }
  return out;
}

function sendRpc(provider, method, params = []) {
  return new Promise((resolve, reject) => {
    provider.send(
      { jsonrpc: '2.0', id: Date.now(), method, params },
      (err, res) => {
        if (err) return reject(err);
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
  const receipt = await web3.eth.getTransactionReceipt(instance.transactionHash);
  return receipt ? String(receipt.gasUsed) : '';
}

function chooseOption(subcontract, idx = 0) {
  if (!subcontract || !Array.isArray(subcontract.optionSecretLabels) || subcontract.optionSecretLabels.length === 0) {
    throw new Error('subcontract has no claim options');
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

module.exports = async function(callback) {
  try {
    const args = parseArgs(process.argv);
    const scenario = args.scenario || 'best_claim';
    const compiled = args.compiled
      ? loadJson(args.compiled)
      : compileATG(loadJson(args.atg));

    const spec = pickContract(compiled, args.pair);
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
    const fundWei = String(args.fundWei || spec.fundingWei || '1000000000000000000');

    const instance = await Contract.new(
      party,
      counterparty,
      absoluteTimelocks,
      spec.conditions,
      { from: deployer },
    );

    await web3.eth.sendTransaction({ from: deployer, to: instance.address, value: fundWei });

    const result = {
      ok: true,
      pair: spec.key,
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
      party,
      counterparty,
      timelocks: absoluteTimelocks,
    };

    const levels = spec.subcontracts.length;
    const lastIdx = levels - 1;

    if (scenario === 'best_claim') {
      const labels = chooseOption(spec.subcontracts[0], 0);
      const secrets = labels.map((l) => spec.secretsByLabel[l]);
      let tx;
      if (spec.contractName === 'CTLCOnly') {
        tx = await instance.claim(0, secrets, { from: counterparty });
      } else {
        tx = await instance.claim(0, 0, secrets, { from: counterparty });
      }
      result.gasUsed = String(tx.receipt.gasUsed);
      result.claimGasUsed = result.gasUsed;
    } else if (scenario === 'worst_claim') {
      let disableTotal = 0n;
      for (let i = 0; i < lastIdx; i += 1) {
        await mineToBlock(web3, absoluteTimelocks[i]);
        const tx = await instance.disableSubcontract(i, { from: party });
        disableTotal += BigInt(tx.receipt.gasUsed);
      }
      const labels = chooseOption(spec.subcontracts[lastIdx], 0);
      const secrets = labels.map((l) => spec.secretsByLabel[l]);
      let claimTx;
      if (spec.contractName === 'CTLCOnly') {
        claimTx = await instance.claim(lastIdx, secrets, { from: counterparty });
      } else {
        claimTx = await instance.claim(lastIdx, 0, secrets, { from: counterparty });
      }
      result.disableGasUsed = String(disableTotal);
      result.claimGasUsed = String(claimTx.receipt.gasUsed);
      result.gasUsed = String(disableTotal + BigInt(claimTx.receipt.gasUsed));
    } else if (scenario === 'refund') {
      let disableTotal = 0n;
      for (let i = 0; i < lastIdx; i += 1) {
        await mineToBlock(web3, absoluteTimelocks[i]);
        const tx = await instance.disableSubcontract(i, { from: party });
        disableTotal += BigInt(tx.receipt.gasUsed);
      }
      await mineToBlock(web3, absoluteTimelocks[lastIdx]);
      const refundTx = await instance.refund({ from: party });
      result.disableGasUsed = String(disableTotal);
      result.refundGasUsed = String(refundTx.receipt.gasUsed);
      result.gasUsed = String(disableTotal + BigInt(refundTx.receipt.gasUsed));
    } else {
      throw new Error(`unknown scenario: ${scenario}`);
    }

    result.endBlock = String(await web3.eth.getBlockNumber());
    result.finalContractBalanceWei = await web3.eth.getBalance(instance.address);

    console.log(JSON.stringify(result, null, 2));
    callback();
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2));
    callback(err);
  }
};
