#!/usr/bin/env python3
import json
import sys
from web3 import Web3

RPC = "http://127.0.0.1:8545"


def count_ops(struct_logs):
    sstore = 0
    call_like = 0
    for step in struct_logs:
        op = step.get("op", "")
        if op == "SSTORE":
            sstore += 1
        if op in {"CALL", "STATICCALL", "DELEGATECALL", "CALLCODE"}:
            call_like += 1
    return sstore, call_like


def calldata_len(inp):
    if isinstance(inp, (bytes, bytearray)):
        return len(inp)
    s = str(inp)
    if s.startswith("0x"):
        return max(0, (len(s) - 2) // 2)
    return len(s)


def trace_tx(w3, tx_hash):
    tx = w3.eth.get_transaction(tx_hash)
    actual_calldata_bytes = calldata_len(tx["input"])

    trace = w3.provider.make_request("debug_traceTransaction", [
        tx_hash,
        {"disableMemory": True, "disableStack": False, "disableStorage": True},
    ])["result"]

    struct_logs = trace.get("structLogs", [])
    sstore, call_like = count_ops(struct_logs)

    return {
        "tx_hash": tx_hash,
        "actual_calldata_bytes": actual_calldata_bytes,
        "actual_sstore_count": sstore,
        "actual_call_count": call_like,
        "opcode_steps": len(struct_logs),
    }


def add_trace(out, w3, role, tx_hash, suffix=None, seen=None):
    if not tx_hash:
        return

    # Deduplicate by tx hash. One tx should appear only once in traces.
    if seen is not None:
        if tx_hash in seen:
            return
        seen.add(tx_hash)

    key = role if suffix is None else f"{role}_{suffix}"

    if key in out["traces"]:
        idx = 2
        while f"{key}_{idx}" in out["traces"]:
            idx += 1
        key = f"{key}_{idx}"

    out["traces"][key] = trace_tx(w3, tx_hash)


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 trace_result_json.py <input_result.json> <output_trace.json>")
        sys.exit(1)

    in_file = sys.argv[1]
    out_file = sys.argv[2]

    data = json.load(open(in_file))
    w3 = Web3(Web3.HTTPProvider(RPC))

    out = {
        "graph_id": data.get("graph_id", ""),
        "pair": data.get("pair", ""),
        "contract": data.get("contract", ""),
        "scenario": data.get("scenario", ""),
        "contractAddress": data.get("contractAddress", ""),
        "traces": {},
    }

    seen = set()

    # Preferred normalized schema.
    for item in data.get("txRoles", []) or []:
        role = item.get("role")
        tx_hash = item.get("txHash")
        level = item.get("level")
        suffix = None if level is None else f"level{level}"
        add_trace(out, w3, role, tx_hash, suffix=suffix, seen=seen)

    # Backward-compatible scalar fields.
    key_map = {
        "deployTxHash": "deploy",
        "deployTx": "deploy",
        "fundTxHash": "fund",
        "fundTx": "fund",
        "txHash": "tx",
        "tx": "tx",
        "claimTxHash": "claim",
        "claimTx": "claim",
        "disableTxHash": "disable",
        "disableTx": "disable",
        "refundTxHash": "refund",
        "refundTx": "refund",
    }

    for raw_key, role in key_map.items():
        add_trace(out, w3, role, data.get(raw_key), seen=seen)

    # Backward-compatible arrays for multi-level disables.
    for idx, tx_hash in enumerate(data.get("disableTxHashes", []) or []):
        add_trace(out, w3, "disable", tx_hash, suffix=f"idx{idx}", seen=seen)

    with open(out_file, "w") as f:
        json.dump(out, f, indent=2)

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
