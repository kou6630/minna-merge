"""第14回: 店先の立て看板を、真正面の看板の絵から正確な 2:1 の形に組み立てる。

AI に斜めの看板を描かせると板が正面向きになってしまうので、看板の面だけを平らな絵で作り、
床の線（gx 方向、26.6°）に沿った薄い板と2本の脚の形に、ここで正確に変形して貼る。
使い方: python -P tools/assets/build_signs.py   （assets-src/raw/r14-face1..3.png から作る）
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
import slice as S  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets-src" / "raw"
OUT = ROOT / "apps" / "client" / "public" / "assets" / "story" / "iso"
META = OUT / "box-meta.json"

K = 2.0           # 画像はゲームの2倍の細かさで作る
W_T = 0.76        # 板の幅（マス、gx 方向）
D_T = 0.12        # 板の厚み（マス、gy 方向）
HB = 100 * K      # 板の高さ
LEG = 24 * K      # 脚の高さ
PAD = 6


def build(face: Image.Image) -> tuple[Image.Image, dict]:
    face = face.crop(face.getbbox())
    dx, dy = 64 * W_T * K, -32 * W_T * K
    tx, ty = -64 * D_T * K, -32 * D_T * K
    w = int(PAD * 2 + abs(tx) + dx) + 1
    h = int(PAD * 2 + abs(ty) + abs(dy) + HB + LEG) + 1
    F0 = (PAD + abs(tx), h - PAD - LEG)
    F1 = (F0[0] + dx, F0[1] + dy)
    F3 = (F0[0], F0[1] - HB)
    F2 = (F1[0], F1[1] - HB)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    a = np.asarray(face.convert("RGBA")).astype(float)
    edge = np.concatenate([a[:4].reshape(-1, 4), a[-4:].reshape(-1, 4), a[:, :4].reshape(-1, 4), a[:, -4:].reshape(-1, 4)])
    edge = edge[edge[:, 3] > 200][:, :3]
    base = edge.mean(axis=0) if len(edge) else np.array([140, 100, 60])
    col = lambda k: tuple(int(max(0, min(255, c * k))) for c in base) + (255,)
    d = ImageDraw.Draw(im)
    # 脚（板の両端の少し内側から下へ）
    for f in (0.1, 0.9):
        x = F0[0] + dx * f
        y = F0[1] + dy * f
        d.polygon([(x - 3.5 * K, y - 2), (x + 3.5 * K, y - 2 - 3.5 * K), (x + 3.5 * K, y + LEG - 3.5 * K), (x - 3.5 * K, y + LEG)], fill=col(0.55))
    # 板の厚み: 左の端の面（暗い）と上の面（明るい）
    d.polygon([F0, F3, (F3[0] + tx, F3[1] + ty), (F0[0] + tx, F0[1] + ty)], fill=col(0.62))
    d.polygon([F3, F2, (F2[0] + tx, F2[1] + ty), (F3[0] + tx, F3[1] + ty)], fill=col(1.08))
    # 正面の絵を平行四辺形に貼る（出力 (x, y) → 絵の (u, v)）
    fw, fh = face.size
    A = fw / dx
    Dv = fh / HB
    coef = (A, 0, -A * F3[0], -Dv * dy / dx, Dv, -Dv * (F3[1] - dy / dx * F3[0]))
    warped = face.convert("RGBA").transform((w, h), Image.AFFINE, coef, resample=Image.BICUBIC)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon([F0, F1, F2, F3], fill=255)
    wa = np.asarray(warped).copy()
    wa[:, :, 3] = np.minimum(wa[:, :, 3], np.asarray(mask))
    im.alpha_composite(Image.fromarray(wa, "RGBA"))
    meta = {"ax": round(F0[0] / w, 4), "ay": round((F0[1] + LEG) / h, 4), "s": round(1 / K, 5), "W": W_T, "D": D_T, "fixed": 1}
    return im, meta


def main():
    names: list[str] = []
    faces = []
    if "--new" not in sys.argv:
        names = [f"{p}_sign_{i}" for p in ("bk", "fr", "ck", "cl") for i in range(3)]
        for k in (1, 2, 3):
            faces += S.cut_sheet_chroma(RAW / f"r14-face{k}.png", [2, 2], "blue")
    # 神社の参道のお店（カフェ・駄菓子屋・ジム）: 1枚のシートに4つ。前の3つを使う
    for k, p in ((1, "cf"), (2, "dg"), (3, "gm")):
        names += [f"{p}_sign_{i}" for i in range(3)]
        faces += S.cut_sheet_chroma(RAW / f"r16-face{k}.png", [2, 2], "blue")[:3]
    # 11〜20章のお店（r21-face-<店>。4枚目は予備）
    for p in ("fw", "bo", "rm", "ya", "ph", "se", "ty", "tk", "wg"):
        f = RAW / f"r21-face-{p}.png"
        if not f.exists():
            continue
        names += [f"{p}_sign_{i}" for i in range(3)]
        faces += S.cut_sheet_chroma(f, [2, 2], "blue")[:3]
    meta = json.loads(META.read_text("utf-8"))
    for n, f in zip(names, faces):
        im, m = build(f)
        im.save(OUT / f"{n}.png", optimize=True)
        meta[n] = m
        print("✓", n, im.size)
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")


if __name__ == "__main__":
    main()
