"""第6回: 街の建物を、立面図（正面・側面）と屋根の模様から、正確な 2:1 ダイメトリックの箱と屋根に組み立てる。

AI に建物そのものを描かせると、屋根や面の角度がどうしてもずれる。
ここでは平らな絵を計算で面に貼るので、足元・壁・屋根の線はすべて厳密に 26.6° になる。

使い方: python -P tools/assets/build_town.py   （assets-src/raw/r6-*.png から作る）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
import slice as S  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets-src" / "raw"
OUT = ROOT / "apps" / "client" / "public" / "assets" / "story" / "iso"
SPEC = json.loads((Path(__file__).parent / "r6_spec.json").read_text("utf-8"))

K = 1.25          # 出力の拡大率（ゲーム内の 1 マス = 64px に対して 64*K px）
T = 64 * K        # gx/gy 1 マスぶんの横の移動量
W, D = 4, 3       # 建物の床: gx 方向 4 マス、gy 方向 3 マス
OV = 0.18         # 屋根のひさしの出（マス）


def proj(gx: float, gy: float, z: float, o: tuple[float, float]) -> tuple[float, float]:
    """床の手前の角 (gx=0, gy=D, z=0) が原点 o に来る座標"""
    return (o[0] + (gx + (gy - D)) * T, o[1] + ((gy - D) - gx) * T / 2 - z * K)


def paste_quad(canvas: Image.Image, tex: Image.Image, p0, pu, pv, shade: float = 1.0, quad=None):
    """tex の左上→p0、右上→pu、左下→pv の平行四辺形に貼る（アフィン）。quad を渡すとその多角形で切り抜く"""
    tw, th = tex.size
    U = np.array(pu) - np.array(p0)
    V = np.array(pv) - np.array(p0)
    M = np.array([[U[0], V[0]], [U[1], V[1]]])
    Mi = np.linalg.inv(M)
    # 出力 (x, y) → 入力 (u, v): [u/tw, v/th] = Mi @ ([x, y] - p0)
    a, b = Mi[0] * tw
    d, e = Mi[1] * th
    c = -(a * p0[0] + b * p0[1])
    f = -(d * p0[0] + e * p0[1])
    t = tex.convert("RGBA")
    if shade != 1.0:
        arr = np.asarray(t).astype(np.float32)
        arr[:, :, :3] *= shade
        t = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    warped = t.transform(canvas.size, Image.AFFINE, (a, b, c, d, e, f), resample=Image.BICUBIC)
    mask = Image.new("L", canvas.size, 0)
    poly = quad or [tuple(p0), tuple(pu), tuple(np.array(pu) + V), tuple(pv)]
    ImageDraw.Draw(mask).polygon([tuple(map(float, q)) for q in poly], fill=255)
    mask = Image.fromarray(np.minimum(np.asarray(mask), np.asarray(warped)[:, :, 3]))
    canvas.paste(warped, (0, 0), mask)


def fill_poly(canvas: Image.Image, pts, color, alpha=255):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon([tuple(map(float, p)) for p in pts], fill=(*color, alpha))
    canvas.alpha_composite(layer)


def mean_color(im: Image.Image, top_frac=(0.0, 0.25)) -> tuple[int, int, int]:
    a = np.asarray(im.convert("RGBA")).astype(np.float32)
    h = a.shape[0]
    part = a[int(h * top_frac[0]): max(int(h * top_frac[0]) + 1, int(h * top_frac[1]))]
    m = part[:, :, 3] > 128
    c = part[:, :, :3][m].mean(0) if m.any() else np.array([180, 170, 150])
    return tuple(int(v) for v in c)


def tile_tex(tex: Image.Image, reps_u: float, reps_v: float, size=(512, 512)) -> Image.Image:
    """屋根の模様を、面の大きさに合わせて繰り返し並べた1枚にする"""
    w, h = size
    tw, th = max(1, int(w / reps_u)), max(1, int(h / reps_v))
    t = tex.convert("RGBA").resize((tw, th), Image.LANCZOS)
    out = Image.new("RGBA", size)
    for y in range(0, h, th):
        for x in range(0, w, tw):
            out.paste(t, (x, y))
    return out


def build(front: Image.Image, side: Image.Image, h: float, roof: str, roofs: dict) -> tuple[Image.Image, dict]:
    rise = {"kawara": 62, "blue": 62, "tin": 34, "flat": 0}[roof]
    top = h + rise + (14 if roof == "flat" else 0) + 70
    cw = int((W + D) * T + 2 * OV * T + 24)
    ch = int((W + D) * T / 2 + top * K + OV * T + 24)
    o = (D * T + OV * T + 12, ch - 12 - OV * T / 2)
    cv = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    P = lambda gx, gy, z: proj(gx, gy, z, o)  # noqa: E731

    wall_col = mean_color(side, (0.0, 0.2))
    # 左の面（gx=0、gy 0→D）と右の面（gy=D、gx 0→W）
    paste_quad(cv, side, P(0, 0, h), P(0, D, h), P(0, 0, 0), shade=0.74)
    paste_quad(cv, front, P(0, D, h), P(W, D, h), P(0, D, 0), shade=0.96)
    # 足元のうすい影（地面との境目）
    for gx0, gy0, gx1, gy1 in ((0, 0, 0, D), (0, D, W, D)):
        q = [P(gx0, gy0, 0), P(gx1, gy1, 0), P(gx1, gy1, 10), P(gx0, gy0, 10)]
        fill_poly(cv, q, (20, 14, 8), 50)

    if roof == "flat":
        par = 14
        # 手すり壁（壁の色）と屋上の床
        fill_poly(cv, [P(0, 0, h), P(0, D, h), P(0, D, h + par), P(0, 0, h + par)], tuple(int(c * 0.72) for c in wall_col))
        fill_poly(cv, [P(0, D, h), P(W, D, h), P(W, D, h + par), P(0, D, h + par)], tuple(int(c * 0.94) for c in wall_col))
        fill_poly(cv, [P(0, 0, h + par), P(W, 0, h + par), P(W, D, h + par), P(0, D, h + par)], tuple(min(255, int(c * 1.08)) for c in wall_col))
        e = 0.16
        floor = tile_tex(roofs["flat"], 2, 2)
        paste_quad(cv, floor, P(e, e, h + par), P(W - e, e, h + par), P(e, D - e, h + par), shade=0.92)
        # 内側の手すりの影
        fill_poly(cv, [P(e, e, h + par), P(W - e, e, h + par), P(W - e, e + 0.12, h + par), P(e, e + 0.12, h + par)], (0, 0, 0), 40)
        fill_poly(cv, [P(W - e, e, h + par), P(W - e, D - e, h + par), P(W - e - 0.1, D - e, h + par), P(W - e - 0.1, e, h + par)], (0, 0, 0), 30)
    else:
        tex = roofs[roof]
        he = h - 4
        zr = h + rise
        # うしろの屋根（左のはしだけ少し見える）
        paste_quad(cv, tile_tex(tex, 4, 2.2), P(-OV, -OV, he), P(W + OV, -OV, he), P(-OV, D / 2, zr), shade=0.78)
        # 妻側（左の面の上の三角）: 壁の色
        fill_poly(cv, [P(0, 0, h), P(0, D, h), P(0, D / 2, zr - 6)], tuple(int(c * 0.72) for c in wall_col))
        # 手前の屋根（gy+ 向き）。うしろの屋根は手前に隠れる
        slope = tile_tex(tex, 4, 2.2)
        paste_quad(cv, slope, P(-OV, D / 2, zr), P(W + OV, D / 2, zr), P(-OV, D + OV, he), shade=1.0)
        # 左の端（けらば）の厚み
        fill_poly(cv, [P(-OV, D / 2, zr), P(-OV, D + OV, he), P(-OV, D + OV, he - 7), P(-OV, D / 2, zr - 7)], (40, 34, 30))
        # 軒先の厚みと、壁に落ちる影
        fill_poly(cv, [P(-OV, D + OV, he), P(W + OV, D + OV, he), P(W + OV, D + OV, he - 7), P(-OV, D + OV, he - 7)], (40, 34, 30))
        fill_poly(cv, [P(0, D, h - 2), P(W, D, h - 2), P(W, D, h - 26), P(0, D, h - 26)], (0, 0, 0), 55)
        # 棟（てっぺんの線）
        ridge = (55, 52, 58) if roof != "tin" else (110, 80, 60)
        fill_poly(cv, [P(-OV, D / 2 - 0.08, zr + 7), P(W + OV, D / 2 - 0.08, zr + 7), P(W + OV, D / 2 + 0.12, zr - 2), P(-OV, D / 2 + 0.12, zr - 2)], ridge)
        fill_poly(cv, [P(-OV, D / 2 - 0.08, zr + 7), P(-OV, D / 2 + 0.12, zr - 2), P(-OV, D / 2 + 0.12, zr - 9), P(-OV, D / 2 - 0.08, zr)], tuple(int(c * 0.7) for c in ridge))

    bb = cv.getbbox()
    cv = cv.crop(bb)
    ax, ay = (o[0] - bb[0]) / cv.width, (o[1] - bb[1]) / cv.height
    return cv, {"ax": round(ax, 4), "ay": round(ay, 4), "s": round(1 / K, 5), "W": W, "D": D}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    pieces = S.cut_sheet_chroma(RAW / "r6-roofs.png", [2, 2], "blue")
    roofs = {}
    for k, p in zip(SPEC["roof"], pieces):
        bb = p.getbbox()
        p = p.crop(bb)
        # 端のゆがみを避けて内側だけ使う
        w, hh = p.size
        roofs[k] = p.crop((int(w * 0.04), int(hh * 0.04), int(w * 0.96), int(hh * 0.96)))
    # 青い瓦は背景の青と一緒に抜けてしまうので、黒い瓦を青く染めて使う
    arr = np.asarray(roofs["kawara"].convert("RGBA")).astype(np.float32)
    arr[:, :, :3] *= np.array([0.8, 0.9, 1.12])
    arr[:, :, :3] += np.array([0, 4, 12])
    roofs["blue"] = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    meta = json.loads(S.META_PATH.read_text("utf-8"))
    for sheet, items in SPEC["buildings"].items():
        path = RAW / f"{sheet}.png"
        if not path.exists():
            print(f"✗ {sheet} がない")
            continue
        ps = S.cut_sheet_chroma(path, [2, 2], "blue")
        for i, it in enumerate(items):
            name, h, roof = it[0], it[1], it[2]
            front = ps[i * 2].crop(ps[i * 2].getbbox()).resize((256, int(h)), Image.LANCZOS)
            side = ps[i * 2 + 1].crop(ps[i * 2 + 1].getbbox()).resize((192, int(h)), Image.LANCZOS)
            im, m = build(front, side, h, roof, roofs)
            im.save(OUT / f"{name}.png", optimize=True)
            meta[name] = m
            print(f"✓ {name} ({roof}, 高さ{h})")
    S.META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")


if __name__ == "__main__":
    main()
