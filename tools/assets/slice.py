"""生成したシートを1つずつの画像に切り出し、白い背景を透明にする。

使い方: python -P tools/assets/slice.py
入力:  assets-src/raw/*.png
出力:  apps/client/public/assets/...
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets-src" / "raw"
OUT = ROOT / "apps" / "client" / "public" / "assets"
CHECK = ROOT / "assets-src" / "check"

# 系列の番号（packages/shared/src/defs.ts と同じ）
CHAIN_INDEX = {
    "bread": 0, "sweets": 1, "veg": 2, "flower": 3, "fish": 4, "goods": 5, "tools": 6,
    "oven": 10, "crate": 11, "bucket": 12, "fishbox": 13, "shelf": 14, "toolbox": 15,
}

CUSTOMERS = ["boy", "student", "mother", "salaryman", "grandma", "grandpa"]
OWNERS = ["bread", "veg", "flower", "fish", "goods", "tools"]
ICONS = ["coin", "energy", "xp", "storage", "order", "sell"]


def ink_mask(a: np.ndarray, loose: bool = False) -> np.ndarray:
    """白っぽくない画素 = True"""
    lo = a.min(axis=2).astype(int)
    hi = a.max(axis=2).astype(int)
    if loose:
        bg = (lo >= 226) & (hi - lo <= 26)
    else:
        bg = (lo >= 238) & (hi - lo <= 18)
    return ~bg


def split_runs(counts: np.ndarray, n: int) -> list[tuple[int, int]]:
    """空白の帯のうち長いもの n-1 本で区切り、n 個の範囲を返す"""
    blank = counts <= 2
    runs = []
    i = 0
    L = len(counts)
    while i < L:
        if blank[i]:
            j = i
            while j < L and blank[j]:
                j += 1
            if i > 0 and j < L:  # 端の余白は区切りにしない
                runs.append((j - i, i, j))
            i = j
        else:
            i += 1
    if len(runs) < n - 1:
        raise ValueError(f"区切りが足りない: {len(runs)} < {n - 1}")
    cuts = sorted(sorted(runs, reverse=True)[: n - 1], key=lambda r: r[1])
    edges = [0] + [(s + e) // 2 for _, s, e in cuts] + [L]
    return [(edges[k], edges[k + 1]) for k in range(n)]


def cut_sheet(path: Path, rows: list[int]) -> list[Image.Image]:
    a = np.asarray(Image.open(path).convert("RGB"))
    ink = ink_mask(a)
    pieces = []
    for (y0, y1), ncols in zip(split_runs(ink.sum(axis=1), len(rows)), rows):
        for (x0, x1) in split_runs(ink[y0:y1].sum(axis=0), ncols):
            pieces.append(cutout(a[y0:y1, x0:x1]))
    return pieces


def cutout(a: np.ndarray) -> Image.Image:
    """枠に触れている白い部分を透明にし、絵のまわりで切り詰める"""
    bgish = ~ink_mask(a, loose=True)
    labels, _ = ndimage.label(bgish)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    border = border[border > 0]
    bg = np.isin(labels, border)
    # 小さなゴミ（離れた点）を消す
    fg_labels, n = ndimage.label(~bg)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(fg_labels), fg_labels, index=range(1, n + 1))
        biggest = sizes.max()
        for k, s in enumerate(sizes, start=1):
            if s < biggest * 0.004:
                bg[fg_labels == k] = True
    alpha = np.where(bg, 0, 255).astype(np.float32)
    # 縁の白っぽいにじみを半透明にする
    near = ndimage.binary_dilation(bg, iterations=2) & ~bg
    lo = a.min(axis=2).astype(np.float32)
    alpha[near] = np.clip((255 - lo[near]) / 110.0, 0, 1) * 255
    rgba = np.dstack([a, alpha.astype(np.uint8)])
    ys, xs = np.nonzero(alpha > 0)
    if len(xs) == 0:
        raise ValueError("絵が見つからない")
    pad = 4
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
    return Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")


def fit(im: Image.Image, size: int) -> Image.Image:
    im = im.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    return im


def save_check(name: str, pieces: list[Image.Image]):
    """確認用: 切り出した絵を濃い色の上に並べる"""
    CHECK.mkdir(parents=True, exist_ok=True)
    cell = 200
    sheet = Image.new("RGBA", (cell * len(pieces), cell), (60, 70, 90, 255))
    for i, p in enumerate(pieces):
        q = fit(p, cell - 10)
        sheet.alpha_composite(q, (i * cell + (cell - q.width) // 2, (cell - q.height) // 2))
    sheet.convert("RGB").save(CHECK / f"{name}.png")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    manifest = {"items": {}, "customers": [], "owners": [], "icons": {}, "bg": {}}
    problems = []
    for path in sorted(RAW.glob("*.png")):
        name = path.stem
        try:
            if name.startswith("items-") or name.startswith("gen-"):
                key = name.split("-", 1)[1]
                rows = [4, 4] if name.startswith("items-") else [3, 2]
                pieces = cut_sheet(path, rows)
                (OUT / "items").mkdir(parents=True, exist_ok=True)
                for t, p in enumerate(pieces, start=1):
                    kind = CHAIN_INDEX[key] * 100 + t
                    fit(p, 192).save(OUT / "items" / f"{kind}.png", optimize=True)
                    manifest["items"][kind] = f"assets/items/{kind}.png"
            elif name in ("chara-customers", "chara-owners"):
                names = CUSTOMERS if name == "chara-customers" else OWNERS
                pieces = cut_sheet(path, [3, 3])
                sub = "customers" if name == "chara-customers" else "owners"
                (OUT / sub).mkdir(parents=True, exist_ok=True)
                for n, p in zip(names, pieces):
                    fit(p, 320).save(OUT / sub / f"{n}.png", optimize=True)
                    manifest[sub].append({"key": n, "src": f"assets/{sub}/{n}.png"})
            elif name == "ui-icons":
                pieces = cut_sheet(path, [3, 3])
                (OUT / "ui").mkdir(parents=True, exist_ok=True)
                for n, p in zip(ICONS, pieces):
                    fit(p, 128).save(OUT / "ui" / f"{n}.png", optimize=True)
                    manifest["icons"][n] = f"assets/ui/{n}.png"
            elif name.startswith("bg-"):
                key = name[3:]
                (OUT / "bg").mkdir(parents=True, exist_ok=True)
                im = Image.open(path).convert("RGB")
                if key in ("ground", "shutter"):
                    im = im.resize((640, 640), Image.LANCZOS)
                im.save(OUT / "bg" / f"{key}.jpg", quality=88)
                manifest["bg"][key] = f"assets/bg/{key}.jpg"
                continue
            else:
                continue
            save_check(name, pieces)
            print(f"✓ {name}: {len(pieces)}個")
        except Exception as e:  # noqa: BLE001
            problems.append(f"{name}: {e}")
            print(f"✗ {name}: {e}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
