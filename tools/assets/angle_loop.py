"""11〜20章の型紙の家具を切り出し、角度テストをして、合格した物は残し、不合格のあるシートの名前を出す。

使い方: python -P tools/assets/angle_loop.py [シートの名前の頭（省くと r21-）]
  1. slice.py で切り出す（angle_keep.json にある合格ずみの物は上書きしない）
  2. check_angles.py で、上辺・下辺・横辺をテスト
  3. 合格した物を angle_keep.json に足し、不合格の物があるシートを angle_redo.txt に書く
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.stdout.reconfigure(encoding="utf-8")
prefix = sys.argv[1] if len(sys.argv) > 1 else "r21-"
spec = json.loads((HERE / "r5_spec.json").read_text("utf-8"))
sheets = {n: items for sec in ("sheets", "plates") for n, items in spec[sec].items() if n.startswith(prefix)}
raw = ROOT / "assets-src" / "raw"
have = [n for n in sheets if (raw / f"{n}.png").exists()]
subprocess.run([sys.executable, "-P", str(HERE / "slice.py"), *have], stdout=subprocess.DEVNULL)
report = HERE / "angle_report.json"
args = [sys.executable, "-P", str(HERE / "check_angles.py"), "--report", str(report)]
for n in have:
    args += ["--sheet", n]
subprocess.run(args, stdout=subprocess.DEVNULL)
res = json.loads(report.read_text("utf-8"))
keep_path = HERE / "angle_keep.json"
keep = set(json.loads(keep_path.read_text("utf-8"))) if keep_path.exists() else set()
keep |= {r["name"] for r in res if r["ok"]}
keep_path.write_text(json.dumps(sorted(keep), ensure_ascii=False, indent=1), "utf-8")
bad = {r["name"]: r["why"] for r in res if not r["ok"] and r["name"] not in keep}
redo = sorted({n for n, items in sheets.items() for it in items if it[0] in bad})
(HERE / "angle_redo.txt").write_text(" ".join(redo), "utf-8")
missing = [n for n in sheets if n not in have]
print(f"合格 {len(keep & {it[0] for its in sheets.values() for it in its})} / {sum(len(v) for v in sheets.values())}  不合格 {len(bad)}  作り直すシート {len(redo)}  まだないシート {len(missing)}")
for n, why in sorted(bad.items()):
    print(f"  ✗ {n}: {'／'.join(why)[:120]}")
