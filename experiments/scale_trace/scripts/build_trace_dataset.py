#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path


def parse_num(x):
    if x is None or x == "":
        return None
    s = str(x)
    if s.startswith("0x"):
        return int(s, 16)
    try:
        return float(s)
    except Exception:
        return None


def read_csv_dict(path):
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def load_manifest(path):
    rows = {}
    if not path.exists():
        return rows
    for r in csv.DictReader(open(path)):
        rows[r["graph_id"]] = r
    return rows


def duplicate_stats(duplicate_vector):
    vals = []
    for x in str(duplicate_vector or "").split("|"):
        x = x.strip()
        if not x:
            continue
        try:
            vals.append(int(x))
        except Exception:
            pass
    if not vals:
        return "", "", ""
    return sum(vals), max(vals), max(0, len(vals) - 1)


def role_matches(trace_role, wanted):
    # Supports exact roles like "claim" and suffixed roles like "claim_level0"
    return trace_role == wanted or trace_role.startswith(wanted + "_")


def trace_sum(trace, wanted_roles):
    total = {
        "calldata": 0,
        "sstore": 0,
        "call": 0,
        "steps": 0,
    }

    traces = trace.get("traces", {})
    found = False

    for trace_role, tr in traces.items():
        if not any(role_matches(trace_role, wanted) for wanted in wanted_roles):
            continue

        found = True
        total["calldata"] += int(tr.get("actual_calldata_bytes", 0))
        total["sstore"] += int(tr.get("actual_sstore_count", 0))
        total["call"] += int(tr.get("actual_call_count", 0))
        total["steps"] += int(tr.get("opcode_steps", 0))

    if not found:
        return None
    return total


def first_trace_value(trace, wanted_roles, field):
    traces = trace.get("traces", {})
    for trace_role, tr in traces.items():
        if any(role_matches(trace_role, wanted) for wanted in wanted_roles):
            return tr.get(field, "")
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", default="experiments/scale_trace/runs")
    ap.add_argument("--manifest", default="experiments/scale_trace/manifests/corpus_manifest.csv")
    ap.add_argument("--out", default="experiments/scale_trace/datasets/dataset_trace_pair.csv")
    args = ap.parse_args()

    manifest = load_manifest(Path(args.manifest))
    runs = Path(args.runs)
    pair_rows = {}

    for graph_dir in sorted(runs.iterdir()):
        if not graph_dir.is_dir():
            continue

        graph_id = graph_dir.name
        meta = manifest.get(graph_id, {})
        split = meta.get("split", "")
        family = meta.get("family", "")

        analysis_rows = read_csv_dict(graph_dir / "analysis.csv")
        topo = {}
        for r in analysis_rows:
            pair = r.get("pair", "")
            if pair:
                topo[pair] = r

        for result_path in graph_dir.rglob("result.json"):
            trace_path = result_path.parent / "trace.json"
            if not trace_path.exists():
                continue

            try:
                result = json.load(open(result_path))
                trace = json.load(open(trace_path))
            except Exception:
                continue

            if str(result.get("ok", "")).lower() not in {"true", "1"}:
                continue

            pair = result.get("pair") or result.get("pairKey") or result.get("pair_id") or ""
            contract = result.get("contract", "")
            scenario = result.get("scenario", "")

            if not pair:
                continue

            key = (graph_id, pair, contract)
            if key not in pair_rows:
                t = topo.get(pair, {})
                duplicate_vector = t.get("duplicateVector", "")
                sum_options, max_options, disable_steps = duplicate_stats(duplicate_vector)

                pair_rows[key] = {
                    "graph_id": graph_id,
                    "family": family,
                    "split": split,
                    "pair": pair,
                    "contract_type": contract,
                    "pattern": t.get("pattern", ""),
                    "num_levels": t.get("levels", ""),
                    "duplicate_vector": duplicate_vector,
                    "sum_options": sum_options,
                    "max_options_per_level": max_options,
                    "disable_steps_worst": disable_steps,

                    "deploy_gas": "",
                    "best_claim_gas": "",
                    "worst_claim_gas": "",
                    "refund_gas": "",

                    "actual_deploy_calldata_bytes": "",
                    "actual_deploy_sstore_count": "",
                    "actual_deploy_call_count": "",
                    "actual_deploy_opcode_steps": "",

                    "actual_best_claim_calldata_bytes": "",
                    "actual_best_claim_sstore_count": "",
                    "actual_best_claim_call_count": "",
                    "actual_best_claim_opcode_steps": "",

                    "actual_worst_path_calldata_bytes": "",
                    "actual_worst_path_sstore_count": "",
                    "actual_worst_path_call_count": "",
                    "actual_worst_path_opcode_steps": "",

                    "actual_refund_path_calldata_bytes": "",
                    "actual_refund_path_sstore_count": "",
                    "actual_refund_path_call_count": "",
                    "actual_refund_path_opcode_steps": "",
                }

            row = pair_rows[key]

            deploy_trace = trace_sum(trace, ["deploy"])
            if deploy_trace:
                row["actual_deploy_calldata_bytes"] = deploy_trace["calldata"]
                row["actual_deploy_sstore_count"] = deploy_trace["sstore"]
                row["actual_deploy_call_count"] = deploy_trace["call"]
                row["actual_deploy_opcode_steps"] = deploy_trace["steps"]

            deploy_gas = parse_num(result.get("deployGas"))
            if deploy_gas is not None:
                row["deploy_gas"] = int(deploy_gas)

            if scenario == "best_claim":
                gas = parse_num(result.get("claimGasUsed")) or parse_num(result.get("gasUsed"))
                if gas is not None:
                    row["best_claim_gas"] = int(gas)

                ts = trace_sum(trace, ["claim", "tx"])
                if ts:
                    row["actual_best_claim_calldata_bytes"] = ts["calldata"]
                    row["actual_best_claim_sstore_count"] = ts["sstore"]
                    row["actual_best_claim_call_count"] = ts["call"]
                    row["actual_best_claim_opcode_steps"] = ts["steps"]

            elif scenario == "worst_claim":
                disable_gas = parse_num(result.get("disableGasUsed")) or 0
                claim_gas = parse_num(result.get("claimGasUsed")) or parse_num(result.get("gasUsed")) or 0
                row["worst_claim_gas"] = int(disable_gas + claim_gas)

                ts = trace_sum(trace, ["disable", "claim", "tx"])
                if ts:
                    row["actual_worst_path_calldata_bytes"] = ts["calldata"]
                    row["actual_worst_path_sstore_count"] = ts["sstore"]
                    row["actual_worst_path_call_count"] = ts["call"]
                    row["actual_worst_path_opcode_steps"] = ts["steps"]

            elif scenario == "refund":
                disable_gas = parse_num(result.get("disableGasUsed")) or 0
                refund_gas = parse_num(result.get("refundGasUsed")) or parse_num(result.get("gasUsed")) or 0
                row["refund_gas"] = int(disable_gas + refund_gas)

                ts = trace_sum(trace, ["disable", "refund", "tx"])
                if ts:
                    row["actual_refund_path_calldata_bytes"] = ts["calldata"]
                    row["actual_refund_path_sstore_count"] = ts["sstore"]
                    row["actual_refund_path_call_count"] = ts["call"]
                    row["actual_refund_path_opcode_steps"] = ts["steps"]

    out_rows = list(pair_rows.values())
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    if not out_rows:
        out.write_text("")
        print({"written": str(out), "rows": 0})
        return

    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)

    print({"written": str(out), "rows": len(out_rows)})


if __name__ == "__main__":
    main()
