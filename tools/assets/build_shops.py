"""第8回: お店の壁（奥・右・手前の腰壁）を、平らな立面図から正確な 2:1 ダイメトリックの形に組み立てる。

AI の1マス分の壁の絵を並べると、角や床とのつなぎ目が合わない。
ここでは壁を厚み・上のふちまで計算で描き、1マスずつの縦の帯に切り分けて保存する。
帯はゲーム内で各マスの足元の点に置くので、角も床の端もぴったり合う。

使い方: python -P tools/assets/build_shops.py   （assets-src/raw/r8-wall-*.png, r8-low-*.png から作る）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import slice as S  # noqa: E402
from build_town import paste_quad, fill_poly, mean_color  # noqa: E402

RAW = S.RAW
OUT = S.OUT / "story" / "iso"
K = 1.5            # 出力の拡大率（ゲーム内 1 マス = 64px → 96px）
T = 64 * K
HT, HL = 150, 46   # 壁の高さ（ゲーム内 px）
TH = 0.14          # 壁の厚み（マス）
SW, SD = 8, 6
SHOPS = {"bakery": "L", "fry": "R", "cake": "L", "cloth": "R",
         # 神社の参道のお店。ゲームでは左右反転して置く（形は通りのお店と同じ L / R で作る）
         "cafe": "L", "dagashi": "R", "gym": "L",
         # 11〜20章: 北の道（花屋・本屋・ラーメン屋・おもちゃ屋・時計屋・和菓子屋）と西の道（八百屋・写真館・銭湯）
         "flower": "L", "book": "R", "ramen": "L", "toy": "R", "clock": "L", "wagashi": "R",
         "yaoya": "L", "photo": "R", "sento": "L"}
# 右の壁を腰の高さの仕切りにする店（右どなり＝奥にお店があり、高い壁だとその中が隠れる）
LOW_RIGHT = ("bakery", "fry", "cafe", "flower", "ramen", "book", "toy", "sento")
# 11〜20章の腰壁のシート（jobs.mjs の R21_LOW_PAIRS と同じ順）
R21_LOWS = (("r21-low-1", ["flower", "book"]), ("r21-low-2", ["ramen", "yaoya"]), ("r21-low-3", ["photo", "sento"]),
            ("r21-low-4", ["toy", "clock"]), ("r21-low-5", ["wagashi", "wagashi"]))


def P(gx, gy, z, o):
    return (o[0] + (gx + gy) * T, o[1] + (gy - gx) * T / 2 - z * K)


def strip(tex: Image.Image, tiles: float, h: int) -> Image.Image:
    """立面図の帯を、tiles マス分・高さ h の比率にそろえる"""
    return tex.resize((max(1, int(tiles * 128)), int(h * 128 / 78)), Image.LANCZOS)


def render_wall(tex: Image.Image, direction: str, length: float, h: float, thick_dir: int, ends: tuple[bool, bool], shade: float):
    """1本の壁を描く。direction='gx' は gx 方向（gy 一定）、'gy' は gy 方向（gx 一定）。
    原点（足元の始点）は (gx, gy) = (0, 0)。厚みは thick_dir 側（-1 or +1）に出す。
    戻り値: 画像, 始点の足元の画像内座標"""
    pad = 40
    w = int((length + 2) * T + 2 * pad)
    hh = int((length + 2) * T / 2 + h * K + 2 * pad)
    o = (pad + T, hh / 2 + (length * T / 4 if direction == "gx" else -length * T / 4) + h * K / 2)
    cv = Image.new("RGBA", (w, hh), (0, 0, 0, 0))
    if direction == "gx":
        A = lambda t, z, d=0.0: P(t, d, z, o)  # noqa: E731
    else:
        A = lambda t, z, d=0.0: P(-d, t, z, o)  # noqa: E731  gy 方向の壁の厚みは gx 側
    td = TH * thick_dir
    wall_col = mean_color(tex, (0.0, 0.15))
    cap = tuple(min(255, int(c * 1.12)) for c in wall_col)
    endc = tuple(int(c * 0.62) for c in wall_col)
    # 見える面（立面図を貼る）
    paste_quad(cv, tex, A(0, h), A(length, h), A(0, 0), shade=shade)
    # 足元のうすい影
    fill_poly(cv, [A(0, 0), A(length, 0), A(length, 8), A(0, 8)], (20, 14, 8), 46)
    # 端の面（厚みの断面）
    for t, show in ((0, ends[0]), (length, ends[1])):
        if show:
            fill_poly(cv, [A(t, 0), A(t, 0, td), A(t, h, td), A(t, h)], endc)
    # 上のふち
    fill_poly(cv, [A(0, h), A(length, h), A(length, h, td), A(0, h, td)], cap)
    fill_poly(cv, [A(0, h), A(length, h), A(length, h - 2), A(0, h - 2)], (0, 0, 0), 40)
    return cv, o


def slices(cv: Image.Image, o, direction: str, n0: int, count: int, prefix: str, meta: dict):
    """壁の画像を1マスずつの縦の帯に切る。帯 i の基準点は、gx 壁ならそのマスの始点、gy 壁ならそのマスの終点の足元"""
    bb = cv.getbbox()
    xs = [o[0] + i * T for i in range(count + 1)]
    for i in range(count):
        x0 = bb[0] if i == 0 else int(round(xs[i]))
        x1 = bb[2] if i == count - 1 else int(round(xs[i + 1]))
        piece = cv.crop((x0, 0, x1, cv.height))
        pb = piece.getbbox()
        if not pb:
            continue
        piece = piece.crop((0, pb[1], piece.width, pb[3]))
        if direction == "gx":
            fx, fy = xs[i], o[1] - i * T / 2
            W, D = 1, 0
        else:
            fx, fy = xs[i + 1], o[1] + (i + 1) * T / 2
            W, D = 0, 1
        name = f"{prefix}_{n0 + i}"
        piece.save(OUT / f"{name}.png", optimize=True)
        meta[name] = {"ax": round((fx - x0) / piece.width, 4), "ay": round((fy - pb[1]) / piece.height, 4), "s": round(1 / K, 5), "W": W, "D": D}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    meta = json.loads(S.META_PATH.read_text("utf-8"))
    lows = {}
    only = [a for a in sys.argv[1:]]
    sheets = [(f"r8-low-{k}", shops) for k, shops in (("a", ["bakery", "fry"]), ("b", ["cake", "cloth"]), ("c", ["cafe", "dagashi"]), ("d", ["gym", "gym"]))]
    for k, shops in sheets + list(R21_LOWS):
        if only and not any(sh in only for sh in shops):
            continue
        if not (RAW / f"{k}.png").exists():
            print(f"  （{k} はまだない）")
            continue
        ps = S.cut_sheet_chroma(RAW / f"{k}.png", [1, 1, 1, 1], "blue")
        for i, sh in enumerate(shops):
            lows.setdefault(sh, {"dirty": ps[i * 2], "clean": ps[i * 2 + 1]})
    for shop, side in SHOPS.items():
        if only and shop not in only:
            continue
        if not (RAW / f"r8-wall-{shop}.png").exists() or shop not in lows:
            print(f"  （{shop} の壁の絵はまだない）")
            continue
        ps = S.cut_sheet_chroma(RAW / f"r8-wall-{shop}.png", [1, 1], "blue")
        tall = {"dirty": ps[0], "clean": ps[1]}
        for st in ("dirty", "clean"):
            src = tall[st].crop(tall[st].getbbox())
            # 奥の壁（gx 方向）。右の店は入口の2マス（3,4）をあける
            # 右の店の奥の壁は通りに面しているので、店先が隠れないよう腰の高さにする
            segs = [(0, SW)] if side == "L" else [(0, 3), (5, 3)]
            bh = HT if side == "L" else HL
            bsrc = src if side == "L" else lows[shop][st].crop(lows[shop][st].getbbox())
            full = strip(bsrc, SW + TH, bh)
            for a, n in segs:
                x0 = int(full.width * a / (SW + TH))
                x1 = int(full.width * (a + n + (TH if a + n == SW else 0)) / (SW + TH))
                cv, o = render_wall(full.crop((x0, 0, x1, full.height)), "gx", n + (TH if a + n == SW else 0), bh, -1, (True, False), 0.97)
                slices(cv, o, "gx", a, n, f"sw_{shop}_gx_{st}", meta)
            # 右の壁（gy 方向、gx = SW-0.5 の線）。厚みは +gx 側
            # 右どなりにお店がある店（パン屋・揚げ物屋）は、となりの店の中が隠れないよう腰の高さの仕切り壁にする
            if shop in LOW_RIGHT:
                ls = lows[shop][st].crop(lows[shop][st].getbbox())
                rs = strip(ls.crop((0, 0, int(ls.width * SD / SW), ls.height)), SD, HL)
                cv, o = render_wall(rs, "gy", SD, HL, -1, (True, True), 0.8)
            else:
                rs = strip(src.crop((0, 0, int(src.width * SD / SW), src.height)), SD, HT)
                cv, o = render_wall(rs, "gy", SD, HT, -1, (False, True), 0.8)
            slices(cv, o, "gy", 0, SD, f"sw_{shop}_gy_{st}", meta)
            # 手前の腰壁（gx 方向）。左の店は入口の2マスをあける。厚みは外（+gy）側
            lsrc = lows[shop][st].crop(lows[shop][st].getbbox())
            lfull = strip(lsrc, SW + TH, HL)
            segs = [(0, 3), (5, 3)] if side == "L" else [(0, SW)]
            for a, n in segs:
                x0 = int(lfull.width * a / (SW + TH))
                x1 = int(lfull.width * (a + n + (TH if a + n == SW else 0)) / (SW + TH))
                cv, o = render_wall(lfull.crop((x0, 0, x1, lfull.height)), "gx", n + (TH if a + n == SW else 0), HL, 1, (True, False), 0.97)
                slices(cv, o, "gx", a, n, f"sw_{shop}_low_{st}", meta)
        print(f"✓ {shop}")
    S.META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")


if __name__ == "__main__":
    main()
