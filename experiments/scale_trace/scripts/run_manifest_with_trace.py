#!/usr/bin/env python3
import argparse
import csv
import subprocess
from pathlib import Path


def run(cmd):
    print("+", " ".join(cmd))
    return subprocess.run(cmd, check=True)


def kill_ganache():
    subprocess.run("pkill -f ganache || true", shell=True)
    subprocess.run("fuser -k 8545/tcp || true", shell=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="experiments/scale_trace/manifests/corpus_manifest.csv")
    ap.add_argument("--split", default="train")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--outroot", default="experiments/scale_trace/runs")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.manifest)))
    rows = [r for r in rows if r["split"] == args.split]
    rows = rows[args.offset: args.offset + args.limit]

    outroot = Path(args.outroot)
    outroot.mkdir(parents=True, exist_ok=True)

    for r in rows:
        graph_id = r["graph_id"]
        atg_path = r["atg_path"]
        run_dir = outroot / graph_id

        if run_dir.exists() and (run_dir / "summary.json").exists() and not args.force:
            print(f"SKIP existing {graph_id}")
            continue

        if args.force and run_dir.exists():
            subprocess.run(["rm", "-rf", str(run_dir)], check=True)

        run_dir.mkdir(parents=True, exist_ok=True)

        kill_ganache()

        cmd = [
            "node",
            "bench/run_atg_suite_trace.js",
            "--atg",
            atg_path,
            "--outdir",
            str(run_dir),
            "--retries",
            "3",
        ]

        try:
            run(cmd)
        except subprocess.CalledProcessError as e:
            (run_dir / "FAILED").write_text(str(e))
            print(f"FAILED {graph_id}: {e}")
            continue

        compiled = run_dir / "compiled.atg.json"
        summary = run_dir / "summary.json"

        if compiled.exists() and summary.exists():
            try:
                run([
                    "node",
                    "tools/summarize_atg_results.js",
                    "--compiled",
                    str(compiled),
                    "--summary",
                    str(summary),
                    "--out",
                    str(run_dir / "analysis.csv"),
                ])
            except subprocess.CalledProcessError as e:
                (run_dir / "ANALYSIS_FAILED").write_text(str(e))

    kill_ganache()


if __name__ == "__main__":
    main()
