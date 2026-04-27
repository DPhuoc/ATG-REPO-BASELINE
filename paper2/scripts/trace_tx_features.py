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
    # web3.py may return HexBytes or hex string
    if isinstance(inp, (bytes, bytearray)):
        return len(inp)
    s = str(inp)
    if s.startswith("0x"):
        return max(0, (len(s) - 2) // 2)
    return len(s)

def main():
    if len(sys.argv) != 2:
        print("Usage: python3 trace_tx_features.py <tx_hash>")
        sys.exit(1)

    tx_hash = sys.argv[1]
    w3 = Web3(Web3.HTTPProvider(RPC))

    tx = w3.eth.get_transaction(tx_hash)
    actual_calldata_bytes = calldata_len(tx["input"])

    trace = w3.provider.make_request("debug_traceTransaction", [
        tx_hash,
        {"disableMemory": True, "disableStack": False, "disableStorage": True}
    ])["result"]

    struct_logs = trace.get("structLogs", [])
    sstore, call_like = count_ops(struct_logs)

    out = {
        "tx_hash": tx_hash,
        "actual_calldata_bytes": actual_calldata_bytes,
        "actual_sstore_count": sstore,
        "actual_call_count": call_like,
    }
    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
