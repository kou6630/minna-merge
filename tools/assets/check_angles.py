"""置く家具・物の角度テスト。切り出した絵（iso/<名前>.png）を、型紙の箱（2:1 ダイメトリック・26.6°）と比べる。

使い方:
  python -P tools/assets/check_angles.py [名前 ...]       名前を省くと、型紙で作った物を全部
  python -P tools/assets/check_angles.py --sheet r21-f1    そのシートの物だけ
  --report <ファイル.json>  結果を書き出す / --png <フォルダ> 確かめ用の重ね絵を書き出す

見るところ（どれか1つでも外れたら不合格）:
  下辺: 足元の左右2本の線が ±26.6° か（±1.5°以内）。足元の手前・左・右の角が、型紙の箱の角の近くにあるか
  横辺: 左右の縦の線が垂直で、型紙の箱の左右の端に重なっているか
  上辺: 上の左右2本の線が ±26.6° の型紙の線に重なっているか（箱形の物だけ。床板の型紙の物＝テーブルや植木は、型紙の範囲からはみ出していないか）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
ISO = ROOT / "apps" / "client" / "public" / "assets" / "story" / "iso"
SPEC = json.loads((Path(__file__).parent / "r5_spec.json").read_text("utf-8"))
REF_UNIT = SPEC["unit"]  # 型紙の 1マスの横の長さ（px）
SLOPE_DEG = float(np.degrees(np.arctan(0.5)))  # 26.565


def spec_items() -> dict[str, dict]:
    """名前 → {W, D, H, kind（box / plate）, sheet}"""
    out: dict[str, dict] = {}
    units = SPEC.get("units", {})
    shapes = SPEC.get("shapes", {})
    for sheet, items in SPEC["sheets"].items():
        for n, W, D, H, _ in items:
            out[n] = {"W": W, "D": D, "H": H, "kind": "box", "sheet": sheet, "unit": units.get(sheet, REF_UNIT)}
    for sheet, items in SPEC.get("plates", {}).items():
        for n, W, D, H, _ in items:
            out[n] = {"W": W, "D": D, "H": H, "kind": "plate", "sheet": sheet, "unit": units.get(sheet, REF_UNIT), "shape": shapes.get(n)}
    return out


def hull(points: np.ndarray) -> np.ndarray:
    """凸包（反時計回り）"""
    from scipy.spatial import ConvexHull
    return points[ConvexHull(points).vertices]


def dist_to_poly(p: np.ndarray, poly: np.ndarray) -> float:
    """点から多角形の辺までのいちばん近い距離"""
    best = 1e9
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ab = b - a
        t = float(np.clip(np.dot(p - a, ab) / max(1e-9, np.dot(ab, ab)), 0, 1))
        best = min(best, float(np.hypot(*(p - (a + t * ab)))))
    return best


def bottom_slopes(mask: np.ndarray) -> tuple[float | None, float | None]:
    """足元の下側の凸包の、左右のいちばん長い辺の角度（度）"""
    cols = [(x, np.where(mask[:, x])[0].max()) for x in range(mask.shape[1]) if mask[:, x].any()]
    P = np.array(cols, float)
    H: list = []
    for p in P:
        while len(H) >= 2 and ((H[-1][0] - H[-2][0]) * (p[1] - H[-2][1]) - (H[-1][1] - H[-2][1]) * (p[0] - H[-2][0])) >= 0:
            H.pop()
        H.append(p)
    H = np.array(H)
    k = int(H[:, 1].argmax())
    out = []
    for seg in (H[: k + 1], H[k:]):
        L = [(np.hypot(*(b - a)), (b[1] - a[1]) / (b[0] - a[0] + 1e-9)) for a, b in zip(seg[:-1], seg[1:])]
        L = [t for t in L if abs(t[1]) < 1.2 and t[0] > 6]
        out.append(float(np.degrees(np.arctan(max(L)[1]))) if L else None)
    return out[0], out[1]


def check(name: str, info: dict, meta: dict, png_dir: Path | None = None) -> dict:
    path = ISO / f"{name}.png"
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)
    mask = a[:, :, 3] > 128
    h, w = mask.shape
    W, D = float(meta["W"]), float(meta["D"])
    u = 64.0 / float(meta["s"])  # 絵の中の 1マス分の横の長さ（px）
    xc, yc = meta["ax"] * w, meta["ay"] * h
    Hs = info["H"] * u / info.get("unit", REF_UNIT)
    # 型紙の箱の角（足元: 左 L・手前 F・右 R・奥 B）
    L = np.array([xc - D * u, yc - D * u / 2])
    F = np.array([xc, yc])
    R = np.array([xc + W * u, yc - W * u / 2])
    B = np.array([xc + (W - D) * u, yc - (W + D) * u / 2])
    up = np.array([0, Hs])
    span = (W + D) * u
    tol = max(4.0, 0.05 * span)

    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(float)
    # 外形の凸包（細かい点を減らすため、1px おきに間引く）
    Hl = hull(pts)

    res: dict = {"name": name, "kind": info["kind"], "ok": True, "why": []}

    def fail(msg: str):
        res["ok"] = False
        res["why"].append(msg)

    # 下辺: 足元の左右の角度（箱形の物。丸い物・テーブルと椅子の組は、床板の角で見る）
    sl, sr = bottom_slopes(mask)
    res["bottom_deg"] = [None if sl is None else round(sl, 2), None if sr is None else round(sr, 2)]
    if info["kind"] == "box":
        if sl is None or abs(sl - SLOPE_DEG) > 1.5:
            fail(f"下辺(左)の角度 {res['bottom_deg'][0]}°（{SLOPE_DEG:.1f}°のはず）")
        if sr is None or abs(sr + SLOPE_DEG) > 1.5:
            fail(f"下辺(右)の角度 {res['bottom_deg'][1]}°（-{SLOPE_DEG:.1f}°のはず）")

    def edge_fit(p0: np.ndarray, p1: np.ndarray, n: int = 24) -> float:
        """型紙の辺の上の点が、物の外形（凸包）の近くにある割合"""
        ok = 0
        for t in np.linspace(0.08, 0.92, n):
            if dist_to_poly(p0 + (p1 - p0) * t, Hl) <= tol:
                ok += 1
        return ok / n

    def outside(poly: np.ndarray) -> float:
        """物の外形の点のうち、型紙の形から tol より外へはみ出している割合"""
        pp = Image.new("L", (w, h), 0)
        ImageDraw.Draw(pp).polygon([tuple(p) for p in poly], fill=255)
        grow = np.asarray(pp) > 0
        # tol の分だけ広げる
        from scipy.ndimage import binary_dilation
        grow = binary_dilation(grow, iterations=int(round(tol)))
        return float((mask & ~grow).sum() / max(1, mask.sum()))

    def reach_top(p0: np.ndarray, p1: np.ndarray, n: int = 24) -> float:
        """上辺: 型紙の上の線のところで、物がその高さまで届いている割合（上に小物がのっているのはよい）"""
        ok = 0
        for t in np.linspace(0.08, 0.92, n):
            x, y = p0 + (p1 - p0) * t
            col = mask[:, int(np.clip(round(x), 0, w - 1))]
            if col.any() and np.where(col)[0].min() <= y + tol:
                ok += 1
        return ok / n

    if info["kind"] == "box":
        fits = {
            "下辺(左)": edge_fit(L, F), "下辺(右)": edge_fit(F, R),
            "横辺(左)": edge_fit(L, L - up), "横辺(右)": edge_fit(R, R - up),
            "上辺(左)": reach_top(L - up, B - up), "上辺(右)": reach_top(B - up, R - up),
        }
        res["fit"] = {k: round(v, 2) for k, v in fits.items()}
        for k, v in fits.items():
            need = 0.75 if k.startswith("上辺") else 0.8
            if v < need:
                fail(f"{k}が型紙の線からずれている（{v:.0%} が重なる。{need:.0%} 以上のはず）")
        hexagon = np.array([L, F, R, R - up, B - up, L - up])
        # 上にのせた小物（コップやランプなど）の分は、上に少しだけはみ出してよい
        roomy = np.array([L, F, R, R - up * 1.6, B - up * 1.6, L - up * 1.6])
        res["outside"] = round(outside(roomy), 3)
        if res["outside"] > 0.02:
            fail(f"型紙の箱から {res['outside']:.1%} はみ出している")
    else:
        # 床板の型紙の物（テーブルと椅子の組・ベンチ・植木など）
        lowest = ys.max()
        lx_ = xs[ys >= lowest - 2].mean()
        res["fit"] = {"床板の幅": round(float((xs.max() - xs.min()) / span), 2)}
        if info.get("shape") == "round":
            # 丸い物（植木）: 角度はない。床板のまん中に立っているか（いちばん下の点が、手前の角の真上あたり）
            mid = (L[0] + R[0]) / 2
            if abs(lx_ - mid) > span * 0.25 or abs(lowest - (L[1] + R[1]) / 2 - D * u / 4 - W * u / 4) > span * 0.3:
                fail("床板のまん中に立っていない")
        else:
            # 組（テーブルと椅子・ベンチ）: 正面向きに描かれていないか。いちばん手前の点が床板の手前の角のあたりにあり、
            # 左右の端が床板の左右の角のあたりまで来ている。はみ出しは少しまで（椅子が少し出るのはよい）
            top = max(Hs * 2.5, span * 1.4)
            column = np.array([L, F, R, R - [0, top], B - [0, top], L - [0, top]])
            res["outside"] = round(outside(column), 3)
            if res["outside"] > 0.12:
                fail(f"床板の範囲から {res['outside']:.1%} はみ出している")
            if abs(xs.min() - L[0]) > tol * 3 or abs(xs.max() - R[0]) > tol * 3:
                fail("左右の端が床板の角に来ていない（向きがずれている）")
            # 足元の線の形: 斜めに置いた組は、いちばん手前（下）から左右の角へ上がっていく「V」の形。
            # 正面向きの組は、足が横一列にそろって平ら。左右の端の足元が、手前からどれだけ上がっているかで見る
            env = {x: np.where(mask[:, x])[0].max() for x in range(w) if mask[:, x].any()}

            def rise(x0: float, x1: float, need: float):
                cs = [x for x in env if x0 <= x <= x1]
                return (lowest - max(env[x] for x in cs)) / max(1e-6, need) if cs else 0.0
            rl = rise(L[0] - span * 0.05, L[0] + span * 0.15, yc - L[1])
            rr = rise(R[0] - span * 0.15, R[0] + span * 0.05, yc - R[1])
            res["fit"]["足元の上がり"] = [round(float(rl), 2), round(float(rr), 2)]
            hull_ok = sl is not None and sr is not None and abs(sl - SLOPE_DEG) <= 7 and abs(sr + SLOPE_DEG) <= 7
            v_ok = max(rl, rr) >= 0.78 and min(rl, rr) >= 0.2
            if not (hull_ok or v_ok):
                fail("足元が横一列で、正面向きに描かれている（足元の線が斜めになっていない）")

    if png_dir:
        png_dir.mkdir(parents=True, exist_ok=True)
        sheet = im.copy()
        d = ImageDraw.Draw(sheet)
        col = (0, 200, 0, 255) if res["ok"] else (255, 0, 0, 255)
        if info["kind"] == "box":
            for p0, p1 in [(L, F), (F, R), (L, L - up), (R, R - up), (L - up, B - up), (B - up, R - up), (F, F - up), (L - up, F - up), (F - up, R - up)]:
                d.line([tuple(p0), tuple(p1)], fill=col, width=2)
        else:
            d.polygon([tuple(p) for p in (L, F, R, B)], outline=col, width=2)
        sheet.save(png_dir / f"{name}.png")
    return res


def main():
    argv = sys.argv[1:]
    report = None
    png_dir = None
    sheets: list[str] = []
    names: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--report":
            report = Path(argv[i + 1]); i += 2
        elif argv[i] == "--png":
            png_dir = Path(argv[i + 1]); i += 2
        elif argv[i] == "--sheet":
            sheets.append(argv[i + 1]); i += 2
        else:
            names.append(argv[i]); i += 1
    items = spec_items()
    meta = json.loads((ISO / "box-meta.json").read_text("utf-8"))
    if sheets:
        names += [n for n, it in items.items() if it["sheet"] in sheets]
    if not names:
        names = [n for n in items if n in meta and (ISO / f"{n}.png").exists()]
    results = []
    for n in names:
        if n not in items or n not in meta or not (ISO / f"{n}.png").exists():
            results.append({"name": n, "ok": False, "why": ["型紙・配置データ・絵のどれかがない"]})
            continue
        results.append(check(n, items[n], meta[n], png_dir))
    bad = [r for r in results if not r["ok"]]
    for r in results:
        mark = "✓" if r["ok"] else "✗"
        print(f"{mark} {r['name']:<22} {r.get('kind', '')} 下辺{r.get('bottom_deg')} {r.get('fit', '')} はみ出し{r.get('outside', '')} {'／'.join(r['why'])}")
    print(f"合格 {len(results) - len(bad)} / {len(results)}")
    if report:
        report.write_text(json.dumps(results, ensure_ascii=False, indent=1), "utf-8")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
