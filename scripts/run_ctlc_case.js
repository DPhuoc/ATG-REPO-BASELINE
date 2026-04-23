const fs = require('fs');
const path = require('path');

const SECRETS = {
  level0: ['0xc0e980cb61fa', '0x575a0e1ec0cd'],
  level1: ['0x0e4c271c323a', '0x7863b0603954', '0xd297fd40fea7'],
};

function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const provider = web3.currentProvider;
    provider.send(
      {
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now(),
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
  });
}

async function mine(n = 1) {
  for (let i = 0; i < n; i += 1) {
    await rpc('evm_mine', []);
  }
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

async function fund(contractAddress, from, amountEth = '1') {
  return await web3.eth.sendTransaction({
    from,
    to: contractAddress,
    value: web3.utils.toWei(amountEth, 'ether'),
  });
}

function writeOutput(outputPath, payload) {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

module.exports = async function (callback) {
  const contractName = process.env.CONTRACT_NAME;
  const scenario = process.env.SCENARIO;
  const outputPath = process.env.OUTPUT_JSON;

  try {
    if (!contractName) throw new Error('Missing CONTRACT_NAME');
    if (!scenario) throw new Error('Missing SCENARIO');

    const Contract = artifacts.require(contractName);
    const accounts = await web3.eth.getAccounts();
    const payer = accounts[0];
    const counterparty = accounts[1];
    const party = accounts[2];
    const inst = await Contract.deployed();

    const result = {
      ok: true,
      contract: contractName,
      scenario,
      contractAddress: inst.address,
      startBlock: await currentBlock(),
      payer,
      counterparty,
      party,
    };

    const fundTx = await fund(inst.address, payer, '1');
    result.fundTx = fundTx.transactionHash || fundTx.tx || null;

    const isMultiple = contractName === 'CTLCMultipleEdges';

    if (scenario === 'best_claim') {
      const tx = isMultiple
        ? await inst.claim(0, 0, SECRETS.level0, { from: counterparty })
        : await inst.claim(0, SECRETS.level0, { from: counterparty });

      result.gasUsed = tx.receipt.gasUsed;
      result.tx = tx.tx;
    } else if (scenario === 'worst_claim') {
      await mineUntil(3);
      const disableTx = await inst.disableSubcontract(0, { from: party });
      const claimTx = isMultiple
        ? await inst.claim(1, 0, SECRETS.level1, { from: counterparty })
        : await inst.claim(1, SECRETS.level1, { from: counterparty });

      result.disableGasUsed = disableTx.receipt.gasUsed;
      result.claimGasUsed = claimTx.receipt.gasUsed;
      result.disableTx = disableTx.tx;
      result.claimTx = claimTx.tx;
    } else if (scenario === 'refund') {
      await mineUntil(3);
      const disableTx = await inst.disableSubcontract(0, { from: party });
      await mineUntil(4);
      const refundTx = await inst.refund({ from: party });

      result.disableGasUsed = disableTx.receipt.gasUsed;
      result.refundGasUsed = refundTx.receipt.gasUsed;
      result.disableTx = disableTx.tx;
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
      contract: contractName || null,
      scenario: scenario || null,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null,
    };
    writeOutput(outputPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    callback(err);
  }
};
