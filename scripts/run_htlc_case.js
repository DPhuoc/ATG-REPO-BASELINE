const fs = require('fs');
const path = require('path');

const HTLCBaseline = artifacts.require("HTLCBaseline");

function rpc(provider, method, params = []) {
  return new Promise((resolve, reject) => {
    provider.send(
      { jsonrpc: "2.0", method, params, id: Date.now() },
      (err, res) => {
        if (err) return reject(err);
        resolve(res.result);
      }
    );
  });
}

module.exports = async function (callback) {
  try {
    const accounts = await web3.eth.getAccounts();
    const scenario = process.env.SCENARIO || "claim";
    const outFile = process.env.OUTPUT_JSON || "htlc_result.json";

    const sender = accounts[0];
    const receiver = accounts[1];
    const preimage = web3.utils.utf8ToHex("demo-secret");
    const hashlock = web3.utils.keccak256(preimage);
    const startBlock = await web3.eth.getBlockNumber();
    const timelock = startBlock + 5;

    const htlc = await HTLCBaseline.new(
      receiver,
      hashlock,
      timelock,
      { from: sender, value: web3.utils.toWei("1", "ether") }
    );

    let tx;
    if (scenario === "claim") {
      tx = await htlc.claim(preimage, { from: receiver });
    } else if (scenario === "refund") {
      for (let i = 0; i < 6; i += 1) {
        await rpc(web3.currentProvider, "evm_mine", []);
      }
      tx = await htlc.refund({ from: sender });
    } else {
      throw new Error(`Unknown scenario: ${scenario}`);
    }

    const detail = await web3.eth.getTransaction(tx.tx);
    const endBlock = await web3.eth.getBlockNumber();
    const finalBalance = await web3.eth.getBalance(htlc.address);

    const result = {
      ok: true,
      contract: "HTLCBaseline",
      scenario,
      gasUsed: tx.receipt.gasUsed,
      calldataBytes: detail.input ? Math.max(0, (detail.input.length - 2) / 2) : 0,
      contractAddress: htlc.address,
      startBlock,
      endBlock,
      finalContractBalanceWei: finalBalance
    };

    fs.writeFileSync(path.resolve(outFile), JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(result, null, 2));
    callback();
  } catch (e) {
    console.error(e);
    callback(e);
  }
};
