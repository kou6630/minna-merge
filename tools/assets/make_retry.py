"""角度テストに落ちた物だけを集めて、作り直し用のシート（r21-x<回>-<n>）を作る。

使い方: python -P tools/assets/make_retry.py <回>
  angle_report.json と angle_keep.json から、まだ合格していない物を集め、同じ種類（箱・右の壁ぎわの家具・床板）ごとに
  4つずつのシートにして r5_spec.json に足し、型紙の絵を作る。作るシートの名前を angle_retry.txt に書く。
  （シートの中の位置が変わるだけで、物の名前・大きさ・指示は同じ。切り出すときは型紙の新しい位置で置き方を決める）
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.stdout.reconfigure(encoding="utf-8")
rnd = sys.argv[1]
spec_path = HERE / "r5_spec.json"
spec = json.loads(spec_path.read_text("utf-8"))
keep = set(json.loads((HERE / "angle_keep.json").read_text("utf-8")))
# 前の作り直しのシートは残す（そこで合格した物の元の絵。後の回のシートほど後に切り出すので、新しい物が勝つ）
for sec in ("sheets", "plates"):
    spec[sec] = {k: v for k, v in spec[sec].items() if not k.startswith(f"r21-x{rnd}-")}
items: dict[str, tuple[str, list]] = {}
for sec in ("sheets", "plates"):
    for sh, its in spec[sec].items():
        if not sh.startswith("r21-"):
            continue
        for it in its:
            if it[0] not in keep:
                kind = "plate" if sec == "plates" else ("side" if "-side" in sh else ("fest" if "fest" in sh else "box"))
                items[it[0]] = (kind, it, sh)
groups: dict[str, list] = {}
for n, (kind, it, sh) in items.items():
    # お祭りの大きな物は、元のシートの縮尺のまま、元のシートで作り直す
    if kind == "fest":
        continue
    groups.setdefault(kind, []).append(it)
names = []
for kind, its in groups.items():
    for k in range(0, len(its), 4):
        name = f"r21-x{rnd}-{'side' if kind == 'side' else kind}{k // 4 + 1}"
        spec["plates" if kind == "plate" else "sheets"][name] = its[k:k + 4]
        names.append(name)
fest = sorted({sh for n, (kind, it, sh) in items.items() if kind == "fest"})
spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=1), "utf-8")
import make_refs  # noqa: E402
make_refs.make_round5_refs()
(HERE / "angle_retry.txt").write_text(" ".join(names + fest), "utf-8")
print(f"作り直す物 {len(items)} 個 → シート {len(names) + len(fest)} 枚: {' '.join(names + fest)}")
