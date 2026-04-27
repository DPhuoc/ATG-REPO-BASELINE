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
        {"disableMemory": True, "disableStack": False, "disableStorage": True}
    ])["result"]

    struct_logs = trace.get("structLogs", [])
    sstore, call_like = count_ops(struct_logs)

    return {
        "tx_hash": tx_hash,
        "actual_calldata_bytes": actual_calldata_bytes,
        "actual_sstore_count": sstore,
        "actual_call_count": call_like,
    }

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 experiments/trace_result_json.py <input_result.json> <output_trace.json>")
        sys.exit(1)

    in_file = sys.argv[1]
    out_file = sys.argv[2]

    data = json.load(open(in_file))
    w3 = Web3(Web3.HTTPProvider(RPC))

    out = {
        "contract": data.get("contract", ""),
        "scenario": data.get("scenario", ""),
        "traces": {}
    }

    # Hỗ trợ cả key cũ lẫn key chuẩn hóa tương lai
    key_map = {
        "fundTx": "fund",
        "tx": "tx",
        "txHash": "tx",
        "disableTx": "disable",
        "disableTxHash": "disable",
        "claimTx": "claim",
        "claimTxHash": "claim",
        "refundTx": "refund",
        "refundTxHash": "refund",
    }

    seen = set()
    for raw_key, role in key_map.items():
        if raw_key in data and data[raw_key]:
            tx_hash = data[raw_key]
            if tx_hash in seen:
                continue
            seen.add(tx_hash)
            out["traces"][role] = trace_tx(w3, tx_hash)

    with open(out_file, "w") as f:
        json.dump(out, f, indent=2)

    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
