const ConvertLib = artifacts.require("ConvertLib");
const MetaCoin = artifacts.require("MetaCoin");
const ECDSALib = artifacts.require("ECDSA");
const Swap = artifacts.require("Swap");
const TestCTLC = artifacts.require("TestCTLC");
const SwapImproved = artifacts.require("SwapImproved");
const CTLCOnly = artifacts.require("CTLCOnly");
const CTLCMultipleEdges = artifacts.require("CTLCMultipleEdges");
const { soliditySha3 } = require("web3-utils");

const k = (value) => soliditySha3({ type: "bytes", value });

module.exports = async function (deployer, network, accounts) {
  const [partyA, partyB, partyC] = accounts;

  await deployer.deploy(ConvertLib);
  await deployer.link(ConvertLib, MetaCoin);
  await deployer.deploy(MetaCoin);
  await deployer.deploy(ECDSALib);
  await deployer.link(ECDSALib, Swap);
  await deployer.link(ECDSALib, SwapImproved);
  await deployer.deploy(TestCTLC);

  // swap ([15])
  const arcs_left = [partyA, partyA, partyB, partyB, partyC, partyC];
  const arcs_right = [partyB, partyC, partyA, partyC, partyA, partyB];
  const leaders = [partyB, partyA, partyB, partyA];
  const party = partyB;
  const counterparty = partyC;
  const start = 12;
  const delta = 1;
  const timelocks = [start + 3 * delta, start + 4 * delta, start + 4 * delta, start + 3 * delta];

  const hashLockCB = k("0xc0e980cb61f5184197feb588e1f8238f3a7a8595ea7c7060066656b44a09305977a48ee5f38abf3ca3d0f02157e4ab526c9196abbb50efd0442bd93fab3076411b");
  const hashLockCBA = k("0xe4fbfb656ed8300fd5ffbe1714a83a6034ad7e1e370564de3e2d04d97b2453783a42ad698d6ff4eecc06197f312459b12638fba95cb6dc119acdcdb322f676aa1c");
  const hashLockCA = k("0xfd06d0c8823932cd41fbacc62e727cf056142c6d9469080aaab887ac13febfed47d74f3b811a71975a04c45a6596c7a671f56fdf73508db8a44e75c0c20e01511c");
  const hashLockCAB = k("0x7b7b37fc0195ae79d6b723d8740ee92d48f46bc68a4031e93961614c056135074633d58fb128b475b5f2bf00e583570bce539da28fa6756d43497f7d66ee953e1c");
  const hashlocks = [hashLockCB, hashLockCBA, hashLockCAB, hashLockCA];
  await deployer.deploy(Swap, arcs_left, arcs_right, leaders, party, counterparty, timelocks, hashlocks);

  // swap improved ([21])
  const _party = partyC;
  const _counterparty = partyB;
  const _hashlockA = "0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6";
  const _hashlockB = "0x405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace";
  const _hashlockC = "0xc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b";
  const _hashlocks = [_hashlockA, _hashlockB, _hashlockC];
  const _users = [partyA, partyB, partyC];
  const _start = 20; // raised from 1 so best/worst claim scenarios are still reachable after full migration
  const _delta = 1;
  const _diam = 1;
  await deployer.deploy(SwapImproved, _party, _counterparty, _hashlocks, _users, _start, _delta, _diam);

  // ctlc only
  const secretCAone = "0xc0e980cb61fa";
  const secretBCtwo = "0x575a0e1ec0cd";
  const secretBAone = "0x0e4c271c323a";
  const secretCBtwo = "0x7863b0603954";
  const secretBCthree = "0xd297fd40fea7";
  const hashLockCAone = k(secretCAone);
  const hashLockBCtwo = k(secretBCtwo);
  const hashLockBAone = k(secretBAone);
  const hashLockCBtwo = k(secretCBtwo);
  const hashLockBCthree = k(secretBCthree);

  const __party = partyC;
  const __counterparty = partyB;
  const __start = 1;
  const __delta = 1;
  const __timelocks = [__start + 2 * __delta, __start + 3 * __delta];
  const conditions = [
    [hashLockCAone, hashLockBCtwo],
    [hashLockBAone, hashLockCBtwo, hashLockBCthree],
  ];
  await deployer.deploy(CTLCOnly, __party, __counterparty, __timelocks, conditions);

  // ctlc multiple edges
  const CTLCMEtimelocks = [__start + 2 * __delta, __start + 3 * __delta];
  const CTLCMEconditions = [
    [[hashLockCAone, hashLockBCtwo]],
    [[hashLockBAone, hashLockCBtwo, hashLockBCthree]],
  ];
  await deployer.deploy(CTLCMultipleEdges, __party, __counterparty, CTLCMEtimelocks, CTLCMEconditions);
};
