const { ethers, writeOutput, buildKeyMap, pkFor, signDigest } = require('./swap_signing_common');

const SECRETS = [1, 2, 3];

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

module.exports = async function (callback) {
  const scenario = process.env.SCENARIO;
  const outputPath = process.env.OUTPUT_JSON;
  const keysPath = process.env.KEYS_JSON;
  const mnemonic = process.env.MNEMONIC;

  try {
    if (!scenario) throw new Error('Missing SCENARIO');

    const SwapImproved = artifacts.require('SwapImproved');
    const inst = await SwapImproved.deployed();
    const accounts = await web3.eth.getAccounts();
    const keyMap = buildKeyMap(accounts, mnemonic, keysPath);

    const payer = accounts[0];
    const partyA = accounts[0];
    const partyB = accounts[1];
    const partyC = accounts[2];
    const party = partyC;
    const counterparty = partyB;

    const start = 20;
    const delta = 1;
    const diam = 1;
    const refundTimeout = start + (diam + 3 + 1) * delta + 1;

    const result = {
      ok: true,
      contract: 'SwapImproved',
      scenario,
      contractAddress: inst.address,
      startBlock: await currentBlock(),
      payer,
      party,
      counterparty,
    };

    const fundTx = await fund(inst.address, payer, '1');
    result.fundTx = fundTx.transactionHash || fundTx.tx || null;

    const allSecretsHash = ethers.solidityPackedKeccak256(['uint256', 'uint256', 'uint256'], SECRETS);

    if (scenario === 'claim_best') {
      const sigUsers = [partyB];
      const sigs = [signDigest(pkFor(keyMap, partyB), allSecretsHash)];

      const tx = await inst.claim(SECRETS, sigs, sigUsers, { from: counterparty });
      result.sigCount = sigs.length;
      result.claimGasUsed = tx.receipt.gasUsed;
      result.gasUsed = tx.receipt.gasUsed;
      result.claimTx = tx.tx;
    } else if (scenario === 'claim_worst') {
      const sigUsers = [partyA, partyB, partyC];
      const sigs = sigUsers.map((addr) => signDigest(pkFor(keyMap, addr), allSecretsHash));

      const tx = await inst.claim(SECRETS, sigs, sigUsers, { from: counterparty });
      result.sigCount = sigs.length;
      result.claimGasUsed = tx.receipt.gasUsed;
      result.gasUsed = tx.receipt.gasUsed;
      result.claimTx = tx.tx;
    } else if (scenario === 'refund') {
      await mineUntil(refundTimeout);
      const tx = await inst.refund({ from: party });
      result.refundGasUsed = tx.receipt.gasUsed;
      result.gasUsed = tx.receipt.gasUsed;
      result.refundTx = tx.tx;
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
      contract: 'SwapImproved',
      scenario: scenario || null,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null,
    };
    writeOutput(outputPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    callback(err);
  }
};
