const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

function writeOutput(outputPath, payload) {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizePrivateKey(pk) {
  if (pk == null) return null;
  if (typeof pk === 'string') {
    let s = pk.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    if (/^[0-9a-fA-F]{64}$/.test(s)) s = `0x${s}`;
    try {
      const b = ethers.getBytes(s);
      if (b.length === 32) return ethers.hexlify(b);
    } catch (_) {}
    return null;
  }
  if (Array.isArray(pk)) {
    try {
      const b = Uint8Array.from(pk);
      if (b.length === 32) return ethers.hexlify(b);
    } catch (_) {}
    return null;
  }
  if (pk && typeof pk === 'object') {
    if (pk.type === 'Buffer' && Array.isArray(pk.data)) {
      try {
        const b = Uint8Array.from(pk.data);
        if (b.length === 32) return ethers.hexlify(b);
      } catch (_) {}
    }
    if (pk.secretKey) return normalizePrivateKey(pk.secretKey);
    if (pk.privateKey) return normalizePrivateKey(pk.privateKey);
  }
  return null;
}

function loadKeyMap(keysPath) {
  if (!keysPath || !fs.existsSync(keysPath)) return {};
  const raw = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  const out = {};

  if (raw.private_keys && typeof raw.private_keys === 'object') {
    for (const [addr, sk] of Object.entries(raw.private_keys)) {
      const norm = normalizePrivateKey(sk);
      if (norm) out[String(addr).toLowerCase()] = norm;
    }
  }
  if (raw.addresses && typeof raw.addresses === 'object' && !Array.isArray(raw.addresses)) {
    for (const [addr, info] of Object.entries(raw.addresses)) {
      const norm = normalizePrivateKey(info);
      if (norm) out[String(addr).toLowerCase()] = norm;
    }
  }
  if (Array.isArray(raw.addresses)) {
    for (const item of raw.addresses) {
      if (item && item.address) {
        const norm = normalizePrivateKey(item);
        if (norm) out[String(item.address).toLowerCase()] = norm;
      }
    }
  }
  return out;
}

function deriveKeyMapFromMnemonic(accounts, mnemonic) {
  if (!mnemonic) return { ok: false, map: {}, error: 'missing mnemonic' };
  const map = {};
  const mismatches = [];
  for (let i = 0; i < accounts.length; i += 1) {
    const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic.trim(), '', `m/44'/60'/0'/0/${i}`);
    map[String(accounts[i]).toLowerCase()] = wallet.privateKey;
    if (wallet.address.toLowerCase() !== String(accounts[i]).toLowerCase()) {
      mismatches.push({ index: i, expected: String(accounts[i]), derived: wallet.address });
    }
  }
  return { ok: mismatches.length === 0, map, mismatches };
}

function buildKeyMap(accounts, mnemonic, keysPath) {
  const byMnemonic = deriveKeyMapFromMnemonic(accounts, mnemonic);
  if (byMnemonic.ok) return byMnemonic.map;
  const byFile = loadKeyMap(keysPath);
  if (Object.keys(byFile).length > 0) return byFile;
  const msg = byMnemonic.mismatches && byMnemonic.mismatches.length > 0
    ? `Mnemonic-derived addresses did not match Ganache accounts. Example mismatch: ${JSON.stringify(byMnemonic.mismatches[0])}`
    : `Could not parse private keys from ${keysPath || '<no keys file>'}`;
  throw new Error(msg);
}

function pkFor(map, addr) {
  const pk = map[String(addr).toLowerCase()];
  if (!pk) throw new Error(`Missing private key for ${addr}`);
  const norm = normalizePrivateKey(pk);
  if (!norm) throw new Error(`Invalid private key material for ${addr}`);
  return norm;
}

function signDigest(privateKey, digest) {
  const sk = normalizePrivateKey(privateKey);
  if (!sk) throw new Error('invalid private key after normalization');
  const sig = new ethers.SigningKey(sk).sign(digest);
  return ethers.Signature.from(sig).serialized;
}

module.exports = { ethers, writeOutput, buildKeyMap, pkFor, signDigest };
