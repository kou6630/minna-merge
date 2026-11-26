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
    "drink": 7, "snack": 8, "fruit": 9,
    "pizza": 30, "coffee": 31, "tea": 32, "shellfish": 33, "cookware": 34,
    "waterserver": 16, "coffeemaker": 17, "snackbasket": 18, "cakeoven": 19,
    "oven": 10, "crate": 11, "bucket": 12, "fishbox": 13, "shelf": 14, "toolbox": 15,
}
# 部品シート（jobs.mjs の PART_SHEETS と同じ順。defs.ts の発生器の並び）
GEN_PART_SHEETS = [
    ["oven", "waterserver", "coffeemaker", "snackbasket"],
    ["crate", "cakeoven", "bucket", "fishbox"],
    ["shelf", "toolbox"],
]

CUSTOMERS = ["boy", "student", "mother", "salaryman", "grandma", "grandpa"]
OWNERS = ["bread", "veg", "flower", "fish", "goods", "tools"]
ICONS = ["coin", "energy", "xp", "storage", "order", "sell"]
# 注文カードの絵（assets/orders/<key>.png）
ORDER_SHEETS = {
    "order-chars-1": ["momo", "gorou", "takumi", "misaki"],
    "order-chars-2": ["yuri", "haruto", "kiyo", "daigo"],
}
STORY_SHEETS = {
    "story-chars-reina": ([2, 2], ["reina_lazy", "reina_angry", "reina_smug", "reina_smile"], 600, "green"),
    "story-chars-cast": ([2, 2], ["momo_smile", "momo_angry", "ryoji_smug", "gorou_smile"], 600, "green"),
    "story-cloud": ([2, 2], ["cloud_0", "cloud_1", "cloud_2", "cloud_3"], 520, "green"),
}

ISO_SHEETS = {
    "iso-props-garbage": ([3, 3], ["garbage_0", "garbage_1", "garbage_2", "garbage_3", "garbage_4", "garbage_5"], 280, "blue"),
    "iso-props-walls": ([2, 2], ["wall_dirty", "wall_clean", "bush_dirty", "bush_clean"], 360, "blue"),
    "iso-walls-1u": ([3, 3], ["wall_gx_dirty", "wall_gx_clean", "pillar_dirty", "wall_gy_dirty", "wall_gy_clean", "pillar_clean"], 260, "blue"),
    "iso-bakery-walls": ([3, 3], ["bwall_gx_dirty", "bwall_gx_clean", "bwall_gy_dirty", "bwall_gy_clean", "blow_gx_dirty", "blow_gx_clean"], 340, "blue"),
    "iso-gates": ([2, 2], ["gate_dirty", "gate_0", "gate_1", "gate_2"], 640, "blue"),
    "iso-shops": ([2, 2], ["shop_bakery_dirty", "shop_veg_dirty", "shop_flower_dirty", "tree_sakura"], 560, "blue"),
    "iso-shops-extra": ([2, 2], ["shop_book_dirty", "shop_cafe_dirty", "shop_candy_dirty", "shop_clock_dirty"], 560, "blue"),
    "iso-street-before-after": ([3, 3], ["lamp_dirty", "bench_dirty", "fence_dirty", "lamp_clean", "bench_clean", "fence_clean"], 360, "blue"),
    "iso-street-props": ([3, 3], ["prop_vending", "prop_bikes", "prop_post", "prop_manhole", "prop_board", "edge_roof"], 420, "blue"),
    "iso-street-decor": ([2, 2], ["street_flags", "tree_grove", "park_fountain", "mini_cat"], 520, "blue"),
    "iso-mini-chars": ([2, 2], ["mini_reina", "mini_momo", "mini_gorou", "mini_ryoji"], 320, "green"),
    "iso-bakery-ext": ([2, 2], ["shop_bakery_clean", "terrace_0", "terrace_1", "terrace_2"], 560, "blue"),
    "iso-bakery-ovens": ([3], ["oven_0", "oven_1", "oven_2"], 420, "blue"),
    "iso-bakery-counters": ([3], ["counter_0", "counter_1", "counter_2"], 420, "blue"),
    "iso-city-edge": ([2, 2], ["city_house_a", "city_house_b", "city_house_c", "city_pole"], 560, "blue"),
    "iso-garbage-piles": ([2, 2], ["pile_rubble", "pile_wood", "pile_bags", "plaza_fountain"], 480, "blue"),
    "iso-cake-walls": ([2, 2], ["cwall_gx_dirty", "cwall_gy_dirty", "clow_gx_dirty", "clow_gy_dirty"], 340, "blue"),
    "iso-right-modular": ([3, 3], ["vfront_gx_dirty", "vside_gy_dirty", "vback_gx_dirty", "ffront_gx_dirty", "fside_gy_dirty", "fback_gx_dirty"], 340, "blue"),
    "iso-right-shops-far": ([2, 2], ["rshop_0_dirty", "rshop_1_dirty", "rshop_2_dirty", "rshop_3_dirty"], 560, "blue"),
    "iso-street-bench-set": ([2, 2], ["street_deco_dirty", "street_deco_0", "street_deco_1", "street_deco_2"], 460, "blue"),
}

WALK_SHEETS = {
    "iso-walk-reina-dr": ("walk_reina_dr", 6, 220, 260),
    "iso-walk-reina-ur": ("walk_reina_ur", 6, 220, 260),
    "iso-walk-momo-dr": ("walk_momo_dr", 6, 200, 230),
    "iso-walk-momo-ur": ("walk_momo_ur", 6, 200, 230),
    "iso-walk-visitor-dr": ("walk_visitor_dr", 6, 220, 260),
    "iso-walk-visitor-ur": ("walk_visitor_ur", 6, 220, 260),
}


def align_axis_slope(im: Image.Image, target_slope: float) -> Image.Image:
    """細長い1軸オブジェクトの足元ラインを 2:1 ダイメトリック（±0.5 = ±26.6°）へ垂直シアー補正（縦柱は完全垂直保持）"""
    a = np.asarray(im)[:, :, 3] > 128
    h, w = a.shape
    pts = np.array([(x, np.where(a[:, x])[0].max()) for x in range(w) if a[:, x].any()])
    if len(pts) < 10:
        return im
    left = pts[: max(1, len(pts) // 4)]
    right = pts[int(len(pts) * 0.75) :]
    lx, ly = left[np.argmax(left[:, 1])]
    rx, ry = right[np.argmax(right[:, 1])]
    cur = (ry - ly) / max(1, (rx - lx))
    ds = target_slope - cur
    if abs(ds) <= 0.005:
        return im
    extra = int(np.ceil(abs(ds) * w)) + 4
    y_shift = extra if ds < 0 else 0
    out = im.transform(
        (w, h + extra),
        Image.Transform.AFFINE,
        (1, 0, 0, -ds, 1, -y_shift),
        resample=Image.BICUBIC,
    )
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def _bottom_profile(im: Image.Image) -> np.ndarray:
    a = np.asarray(im)[:, :, 3] > 128
    return np.array([(x, np.where(a[:, x])[0].max()) for x in range(a.shape[1]) if a[:, x].any()], dtype=float)


def _corner(P: np.ndarray) -> tuple[float, float]:
    ymax = P[:, 1].max()
    xs = P[P[:, 1] >= ymax - 1.0][:, 0]
    return float(np.median(xs)), float(ymax)


def _lower_hull(P: np.ndarray) -> np.ndarray:
    H: list = []
    for p in P:
        while len(H) >= 2 and ((H[-1][0] - H[-2][0]) * (p[1] - H[-2][1]) - (H[-1][1] - H[-2][1]) * (p[0] - H[-2][0])) >= 0:
            H.pop()
        H.append(p)
    return np.array(H, float)


def hull_angles(im: Image.Image) -> tuple:
    """確認用: 足元の凸包の左右の角度（度）。正しければ (26.6, -26.6)"""
    H = _lower_hull(_bottom_profile(im))
    k = int(H[:, 1].argmax())
    out = []
    for seg in (H[: k + 1], H[k:]):
        L = [(np.hypot(*(b - a)), (b[1] - a[1]) / (b[0] - a[0] + 1e-9)) for a, b in zip(seg[:-1], seg[1:])]
        L = [t for t in L if abs(t[1]) < 1.2 and t[0] > 8]
        out.append(round(float(np.degrees(np.arctan(max(L)[1]))), 1) if L else None)
    return tuple(out)


def align_box(im: Image.Image) -> Image.Image:
    """箱形の物（建物・家具・小物）の左右2本の足元ラインを、手前の角を中心に ±26.6° へ折れ線状に垂直シアー補正する（縦線は垂直のまま）"""
    P = _bottom_profile(im)
    if len(P) < 20:
        return im
    xc, yc = _corner(P)
    xmin, xmax = P[:, 0].min(), P[:, 0].max()

    # 脚のある家具でも測れるよう、足元の下側の凸包（脚の先を結んだ線）で左右の傾きを測る
    H = _lower_hull(P)
    k = int(H[:, 1].argmax())
    xc, yc = float(H[k, 0]), float(H[k, 1])

    def fit(seg):
        L = [(np.hypot(*(b - a)), (b[1] - a[1]) / (b[0] - a[0] + 1e-9)) for a, b in zip(seg[:-1], seg[1:])]
        L = [t for t in L if abs(t[1]) < 1.2 and t[0] > 8]
        return max(L)[1] if L else None

    kL = fit(H[: k + 1])
    kR = fit(H[k:])
    dl = 0.0 if kL is None else 0.5 - kL
    dr = 0.0 if kR is None else -0.5 - kR
    arr = np.asarray(im.convert("RGBA")).astype(np.float32)
    h, w = arr.shape[:2]
    xs = np.arange(w, dtype=np.float32)
    dy = np.where(xs < xc, dl * (xs - xc), dr * (xs - xc))
    pad = int(np.ceil(np.abs(dy).max())) + 4
    out = np.zeros((h + 2 * pad, w, 4), np.float32)
    yy = np.arange(h + 2 * pad, dtype=np.float32)
    for x in range(w):
        src = yy - pad - dy[x]
        for c in range(4):
            out[:, x, c] = np.interp(src, np.arange(h), arr[:, x, c], left=0, right=0)
    res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
    bb = res.getbbox()
    return res.crop(bb) if bb else res


def shear_to_template(im: Image.Image, xc: float, yc: float, max_deg: float = 3.0) -> tuple[Image.Image, float]:
    """足元の左右の線を、型紙の手前の角 (xc, yc) を中心に縦にずらして ±26.6° にそろえる。ずれが max_deg より大きければそのまま"""
    H = _lower_hull(_bottom_profile(im))
    if len(H) < 3:
        return im, yc
    k = int(H[:, 1].argmax())

    def fit(seg):
        L = [(np.hypot(*(b - a)), (b[1] - a[1]) / (b[0] - a[0] + 1e-9)) for a, b in zip(seg[:-1], seg[1:])]
        L = [t for t in L if abs(t[1]) < 1.2 and t[0] > 8]
        return max(L)[1] if L else None

    kL, kR = fit(H[: k + 1]), fit(H[k:])
    if kL is None or kR is None:
        return im, yc
    tgt = float(np.degrees(np.arctan(0.5)))
    if abs(np.degrees(np.arctan(kL)) - tgt) > max_deg or abs(np.degrees(np.arctan(kR)) + tgt) > max_deg:
        return im, yc
    dl, dr = 0.5 - kL, -0.5 - kR
    arr = np.asarray(im.convert("RGBA")).astype(np.float32)
    h, w = arr.shape[:2]
    xs = np.arange(w, dtype=np.float32)
    dy = np.where(xs < xc, dl * (xs - xc), dr * (xs - xc))
    pad = int(np.ceil(np.abs(dy).max())) + 2
    out = np.zeros((h + 2 * pad, w, 4), np.float32)
    yy = np.arange(h + 2 * pad, dtype=np.float32)
    for x in range(w):
        src = yy - pad - dy[x]
        for c in range(4):
            out[:, x, c] = np.interp(src, np.arange(h), arr[:, x, c], left=0, right=0)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA"), yc + pad


def fix_ratio(im: Image.Image, W: float, D: float) -> Image.Image:
    """左右の面の幅の比を D:W に合わせる（手前の角より左と右を別々に横へ伸び縮み。縦線は縦のまま）"""
    H = _lower_hull(_bottom_profile(im))
    k = int(H[:, 1].argmax())
    xc, xl, xr = H[k, 0], H[0, 0], H[-1, 0]
    span = xr - xl
    if span < 20 or xc - xl < 5 or xr - xc < 5:
        return im
    nl = span * D / (W + D)
    fl, fr = nl / (xc - xl), (span - nl) / (xr - xc)
    a = np.asarray(im.convert("RGBA"))
    left = Image.fromarray(a[:, : int(round(xc))]).resize((max(1, int(round(xc * fl))), a.shape[0]), Image.LANCZOS)
    right = Image.fromarray(a[:, int(round(xc)):]).resize((max(1, int(round((a.shape[1] - xc) * fr))), a.shape[0]), Image.LANCZOS)
    out = Image.new("RGBA", (left.width + right.width, a.shape[0]), (0, 0, 0, 0))
    out.paste(left, (0, 0)); out.paste(right, (left.width, 0))
    bb = out.getbbox()
    return out.crop(bb) if bb else out


def box_meta(im: Image.Image, W: float, D: float) -> dict:
    """手前の角（足元）の位置と、足元の幅（左の角〜右の角）を測る。置くときの拡大率 = 64*(W+D)/span"""
    P = _bottom_profile(im)
    xc, yc = _corner(P)
    dev_l = np.abs(P[:, 1] - (yc + 0.5 * (P[:, 0] - xc)))
    dev_r = np.abs(P[:, 1] - (yc - 0.5 * (P[:, 0] - xc)))
    left = P[(P[:, 0] <= xc) & (dev_l < 5)]
    right = P[(P[:, 0] >= xc) & (dev_r < 5)]
    xl = left[:, 0].min() if len(left) else P[:, 0].min()
    xr = right[:, 0].max() if len(right) else P[:, 0].max()
    span = max(1.0, xr - xl)
    # 足元の左右比が W:D と大きく違うときは、幅の長い側から逆算する
    exp_l = D / (W + D)
    if abs((xc - xl) / span - exp_l) > 0.12:
        span = max((xc - xl) / exp_l if exp_l > 0 else 0, (xr - xc) / (1 - exp_l) if exp_l < 1 else 0)
    return {"ax": round(xc / im.width, 4), "ay": round(yc / im.height, 4), "s": round(64 * (W + D) / span, 5), "W": W, "D": D}


# 第4回: 型紙の箱で作った素材（名前, W=gx方向マス, D=gy方向マス）。足元補正＋配置用メタを出す
BOX_SHEETS = {
    "r4-town-front": ([2, 2], [("town_f0", 4, 3), ("town_f1", 4, 3), ("town_f2", 4, 3), ("town_f3", 4, 3)], 520),
    "r4-town-front2": ([2, 2], [("town_f4", 4, 3), ("town_f5", 4, 3), ("town_f6", 4, 3), ("town_f7", 4, 3)], 520),
    "r4-town-back": ([2, 2], [("town_b0", 4, 3), ("town_b1", 4, 3), ("town_b2", 4, 3), ("town_b3", 4, 3)], 520),
    "r4-props": ([3, 3], [("bench_dirty", 2, 0.8), ("bench_clean", 2, 0.8), ("vending", 1, 0.8), ("post", 0.6, 0.6), ("planter_dirty", 1, 1), ("planter_clean", 1, 1)], 360),
    "r4-fry-furn": ([3, 3], [(f"fry_{k}_{i}", 2, 1) for k in ("counter", "seat") for i in range(3)], 420),
    "r4-cake-furn": ([3, 3], [(f"cake_{k}_{i}", 2, 1) for k in ("case", "seat") for i in range(3)], 420),
    "r4-cloth-furn": ([3, 3], [(f"cloth_{k}_{i}", 2, 1) for k in ("rack", "fit") for i in range(3)], 420),
}
_R5 = json.loads((Path(__file__).parent / "r5_spec.json").read_text("utf-8"))
for _n, _it in _R5["sheets"].items():
    BOX_SHEETS[_n] = ([2, 2], [(a[0], a[1], a[2]) for a in _it], 420)
# 町の建物は build_town.py で作るので、r5-town-* は切り出さない
for _n, _it in _R5.get("plates", {}).items():
    BOX_SHEETS[_n] = ([2, 2], [(a[0], a[1], a[2]) for a in _it], 420)
# 第13回: 看板（薄い板の型紙）
_SIGNS = [f"{p}_sign_{i}" for p in ("bk", "fr", "ck", "cl") for i in range(3)]
for _k in range(3):
    BOX_SHEETS[f"r13-sign{_k + 1}"] = ([2, 2], [(n, 0.76, 0.12) for n in _SIGNS[_k * 4:_k * 4 + 4]], 420)
NO_ALIGN = {"jk_plant"}
# 床板の型紙で作った丸い物（植木・マネキン）は、箱の型紙版で上書きしない
KEEP: set = set()
# 角度テスト（check_angles.py）に合格した物は、シートを作り直しても上書きしない（angle_loop.py が書く）
_KEEP_PATH = Path(__file__).parent / "angle_keep.json"
if _KEEP_PATH.exists():
    KEEP |= set(json.loads(_KEEP_PATH.read_text("utf-8")))
PART_SHEETS = {
    "r4-fry-walls": "fry", "r4-cake-walls": "cake", "r4-cloth-walls": "cloth",
}
DECOR_SHEETS = {
    "r4-bakery-decor": "street_deco", "r4-fry-decor": "fry_deco", "r4-cake-decor": "cake_deco", "r4-cloth-decor": "cloth_deco",
}
META_PATH = OUT / "story" / "iso" / "box-meta.json"


def align_gate_slope(im: Image.Image) -> Image.Image:
    return align_axis_slope(im, 0.5)


def despill_green_rgba(im: Image.Image) -> Image.Image:
    """リサイズ後にも残るわずかな緑かぶり（G>R+3 かつ G>B+3）を完全に除去する"""
    arr = np.asarray(im.convert("RGBA"), dtype=np.uint8).copy()
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    a = arr[:, :, 3]
    mask = (a > 0) & (g > r + 3) & (g > b + 3)
    if mask.any():
        cap = np.maximum(r, b)
        arr[:, :, 1] = np.where(mask, cap, g).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def normalize_walk_frames(pieces: list[Image.Image], cw: int, ch: int) -> list[Image.Image]:
    """歩行コマ全員の身長と足元Yを統一サイズキャンバスにそろえる（ブレ防止）"""
    target_h = int(ch * 0.86)
    foot_y = ch - 10
    out: list[Image.Image] = []
    for p in pieces:
        scale = min((cw - 16) / max(1, p.width), target_h / max(1, p.height))
        nw = max(1, int(round(p.width * scale)))
        nh = max(1, int(round(p.height * scale)))
        q = p.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        canvas.alpha_composite(q, ((cw - nw) // 2, foot_y - nh))
        out.append(despill_green_rgba(canvas))
    return out


def make_iso_diamond_tile(square_im: Image.Image, tile_w: int = 256, tile_h: int = 128) -> Image.Image:
    """正方形のシームレス床テクスチャを、数学的に完全な 2:1 アイソメトリックひし形タイルに変換する"""
    # 端のわずかな縁をトリミングして完全シームレス領域を使う
    w, h = square_im.size
    m = int(min(w, h) * 0.04)
    sq = square_im.crop((m, m, w - m, h - m)).resize((256, 256), Image.LANCZOS)
    # 45度回転（expand=True）して正方形をひし形にし、縦をちょうど半分に圧縮
    rot = sq.convert("RGBA").rotate(45, resample=Image.BICUBIC, expand=True)
    rw, rh = rot.size
    # 内接ひし形の中央領域をクロップ
    crop_s = int(rw * 0.72)
    x0 = (rw - crop_s) // 2
    y0 = (rh - crop_s) // 2
    diam = rot.crop((x0, y0, x0 + crop_s, y0 + crop_s)).resize((tile_w, tile_h), Image.LANCZOS)

    # 厳密な 2:1 ダイヤモンドマスク（1px 余裕を持たせてタイル間の隙間をゼロに）
    yy, xx = np.mgrid[0:tile_h, 0:tile_w].astype(np.float32)
    nx = np.abs((xx + 0.5) - tile_w / 2.0) / (tile_w / 2.0)
    ny = np.abs((yy + 0.5) - tile_h / 2.0) / (tile_h / 2.0)
    d = nx + ny
    alpha = np.clip((1.015 - d) / 0.03, 0.0, 1.0)
    arr = np.asarray(diam, dtype=np.uint8).copy()
    arr[:, :, 3] = (alpha * 255.0).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")

# 各スポットのおおよその許容領域 (x0, y0, x1, y1) 0..1 比率（遠方の微細な光揺らぎをカット）
PATCH_ROI: dict[str, tuple[float, float, float, float]] = {
    "arch": (0.42, 0.00, 0.88, 0.44),
    "bakery": (0.04, 0.18, 0.54, 0.76),
    "bench": (0.64, 0.19, 1.00, 0.88),
    "flower": (0.30, 0.42, 0.72, 1.00),
}


def extract_map_patch(base_path: Path, var_path: Path, spot: str) -> tuple[Image.Image, Image.Image]:
    """story-bg-clean と色調補正つき差分比較し、オブジェクト＋接地影だけをタイトに抽出する"""
    base_im = Image.open(base_path).convert("RGB")
    var_im = Image.open(var_path).convert("RGB")
    if var_im.size != base_im.size:
        var_im = var_im.resize(base_im.size, Image.LANCZOS)
    b = np.asarray(base_im, dtype=np.float32)
    v = np.asarray(var_im, dtype=np.float32)
    h, w, _ = b.shape

    x0f, y0f, x1f, y1f = PATCH_ROI.get(spot, (0.0, 0.0, 1.0, 1.0))
    roi = np.zeros((h, w), dtype=bool)
    roi[int(h * y0f):int(h * y1f), int(w * x0f):int(w * x1f)] = True

    # ROI 外の共通領域を使って全体の色味・明るさのわずかなブレを補正
    outside = ~roi
    v_corr = v.copy()
    if outside.any():
        for c in range(3):
            b_med = float(np.median(b[:, :, c][outside]))
            v_med = float(np.median(v[:, :, c][outside]))
            v_corr[:, :, c] = np.clip(v[:, :, c] + (b_med - v_med), 0.0, 255.0)

    # ピクセルごとの色差（ユークリッド距離）
    diff = np.sqrt(np.sum((v_corr - b) ** 2, axis=2))

    # くっきり変わったオブジェクト本体のみを抽出（アーチは淡い色も残すよう少し低め）
    core_th = 28.0 if spot == "arch" else 36.0
    core = (diff >= core_th) & roi
    core = ndimage.binary_closing(core, iterations=3)
    labels, n = ndimage.label(core)
    if n > 0:
        sizes = ndimage.sum(np.ones_like(labels), labels, index=range(1, n + 1))
        biggest = sizes.max()
        keep = np.zeros_like(core)
        for k, s in enumerate(sizes, start=1):
            if s >= max(220, biggest * 0.01):
                keep |= (labels == k)
        core = keep

    # オブジェクトのすぐそばにある接地影（diff >= 20）だけを拾う
    near = ndimage.binary_dilation(core, iterations=12) & roi
    shadow = (diff >= 20.0) & near
    mask = ndimage.binary_dilation(core | shadow, iterations=3)

    # 小さな内部の穴だけ埋める（アーチの大きな通り抜け空間は絶対に埋めない！）
    inv_labels, inv_n = ndimage.label(~mask)
    if inv_n > 0:
        inv_sizes = ndimage.sum(np.ones_like(inv_labels), inv_labels, index=range(1, inv_n + 1))
        for k, s in enumerate(inv_sizes, start=1):
            if s < 1200:
                mask[inv_labels == k] = True

    # 境界をソフトフェザリング（ベースマップに滑らかに溶け込む）
    alpha = ndimage.gaussian_filter(mask.astype(np.float32), sigma=2.5)
    alpha = np.clip((alpha - 0.12) / 0.72, 0.0, 1.0)
    alpha[core] = 1.0

    rgba = np.dstack([v_corr.astype(np.uint8), (alpha * 255.0).astype(np.uint8)])
    full = Image.fromarray(rgba, "RGBA")

    # 丸サムネ用に変化領域をクロップ
    ys, xs = np.nonzero(core)
    if len(xs) > 0:
        pad = 24
        cy0, cy1 = max(0, int(ys.min()) - pad), min(h, int(ys.max()) + pad)
        cx0, cx1 = max(0, int(xs.min()) - pad), min(w, int(xs.max()) + pad)
        cw, ch = cx1 - cx0, cy1 - cy0
        side = max(cw, ch)
        mx, my = (cx0 + cx1) // 2, (cy0 + cy1) // 2
        tx0 = max(0, min(w - side, mx - side // 2))
        ty0 = max(0, min(h - side, my - side // 2))
        thumb = var_im.crop((tx0, ty0, min(w, tx0 + side), min(h, ty0 + side))).resize((220, 220), Image.LANCZOS)
    else:
        thumb = var_im.resize((220, 220), Image.LANCZOS)

    full_small = full.resize((1200, 800), Image.LANCZOS)
    return full_small, thumb


def chroma_excess(a: np.ndarray, mode: str) -> np.ndarray:
    """クロマキー色の強さ（緑または青の他チャンネル超過量）"""
    r = a[:, :, 0].astype(np.float32)
    g = a[:, :, 1].astype(np.float32)
    b = a[:, :, 2].astype(np.float32)
    if mode == "green":
        return g - np.maximum(r, b)
    if mode == "magenta":
        return np.minimum(r, b) - g
    return b - np.maximum(r, g)


def cutout_chroma(a: np.ndarray, mode: str, inner_hi: float | None = None, offset: list | None = None) -> Image.Image:
    """クロマキー背景（内部の閉じた穴含む）を完全透過し、フチの色かぶり（スピル）も除去する"""
    ex = chroma_excess(a, mode)
    lo_th, hi_th = (14.0, 52.0) if mode == "green" else (18.0, 58.0)

    # 強いクロマキー色は内外問わず透過（内部の青い旗・緑の葉柄を誤抜しないようデフォルト高めに設定）
    bg = ex >= (inner_hi if inner_hi is not None else 150.0)
    # 境界近くのやや弱いクロマキーも外周からフラッドフィルで背景扱い
    bg_soft = ex >= lo_th

    labels, _ = ndimage.label(bg_soft)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    border = border[border > 0]
    outer_bg = np.isin(labels, border)

    # 外周背景および内部クロマ穴に接する境界だけアルファを滑らかに抜く
    bg_all = bg | outer_bg
    # 小さな孤立ゴミを消す
    fg_labels, n = ndimage.label(~bg_all)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(fg_labels), fg_labels, index=range(1, n + 1))
        biggest = sizes.max()
        for k, s in enumerate(sizes, start=1):
            if s < biggest * 0.002:
                bg_all[fg_labels == k] = True

    # 滑らかなアルファ（アンチエイリアス）
    alpha = np.clip((hi_th - ex) / (hi_th - lo_th), 0.0, 1.0)
    alpha[bg_all] = 0.0
    # 完全に不透明な内側の少し外だけ半透明を許し、本体内部の色抜けを防ぐ
    near_bg = ndimage.binary_dilation(bg_all, iterations=4)
    alpha[~near_bg] = 1.0

    # デスピル（緑背景の場合はキャラ全体に染みた弱い緑寄り画素まで徹底除去）
    out = a.astype(np.float32).copy()
    if mode == "green":
        # G > R+3 かつ G > B+3 のくすんだ緑寄りは本体縁・髪の間を含めすべて周囲色へなじませる
        r1, g1, b1 = out[:, :, 0], out[:, :, 1], out[:, :, 2]
        greenish = (g1 > r1 + 3.0) & (g1 > b1 + 3.0)
        # 緑かぶりの強い部分は、RとBの最大値（さらに少し低め）に抑えて完全に緑を消す
        cap = np.maximum(r1, b1)
        out[:, :, 1] = np.where(greenish | (near_bg & (ex > 0.0)), np.minimum(g1, cap), g1)
    elif mode == "magenta":
        spill_zone = near_bg & (ex > 2.0)
        k = np.where(spill_zone, np.maximum(ex, 0.0), 0.0)
        out[:, :, 0] -= k
        out[:, :, 2] -= k
    else:
        spill_zone = near_bg & (ex > 2.0)
        cap = np.maximum(out[:, :, 0], out[:, :, 1])
        out[:, :, 2] = np.where(spill_zone, np.minimum(out[:, :, 2], cap), out[:, :, 2])

    rgba = np.dstack([np.clip(out, 0, 255).astype(np.uint8), (alpha * 255.0).astype(np.uint8)])
    ys, xs = np.nonzero(rgba[:, :, 3] > 8)
    if len(xs) == 0:
        raise ValueError("クロマキー切り抜きで絵が見つからない")
    pad = 4
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
    if offset is not None:
        offset[:] = [int(x0), int(y0)]
    return Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")


def cut_sheet_chroma(path: Path, rows: list[int], mode: str, inner_hi: float | None = None) -> list[Image.Image]:
    a = np.asarray(Image.open(path).convert("RGB"))
    fg = chroma_excess(a, mode) < 42.0
    try:
        pieces = []
        for (y0, y1), ncols in zip(split_runs(fg.sum(axis=1), len(rows)), rows):
            for (x0, x1) in split_runs(fg[y0:y1].sum(axis=0), ncols):
                pieces.append(cutout_chroma(a[y0:y1, x0:x1], mode, inner_hi=inner_hi))
        return pieces
    except ValueError:
        # 斜めアイソメトリック等で水平・垂直投影が重なる場合は、連結成分で直接各オブジェクトを切り出す
        total = sum(rows)
        closed = ndimage.binary_dilation(fg, iterations=4)
        labels, n = ndimage.label(closed)
        sizes = ndimage.sum(np.ones_like(labels), labels, index=range(1, n + 1))
        top = sorted(range(1, n + 1), key=lambda k: sizes[k - 1], reverse=True)[:total]
        items = []
        for k in top:
            ys, xs = np.nonzero(labels == k)
            y0, y1 = max(0, int(ys.min()) - 4), min(a.shape[0], int(ys.max()) + 5)
            x0, x1 = max(0, int(xs.min()) - 4), min(a.shape[1], int(xs.max()) + 5)
            # この塊以外を背景色でマスクして単体切り出し
            sub = a[y0:y1, x0:x1].copy()
            sub_mask = labels[y0:y1, x0:x1] != k
            bg_col = (0, 255, 0) if mode == "green" else (255, 0, 255) if mode == "magenta" else (0, 0, 255)
            sub[sub_mask] = bg_col
            items.append(((y0 + y1) / 2, (x0 + x1) / 2, cutout_chroma(sub, mode, inner_hi=inner_hi)))
        # 行ごと（上段→下段）にグルーピングして左→右へソート
        items.sort(key=lambda t: t[0])
        out: list[Image.Image] = []
        idx = 0
        for ncols in rows:
            row = sorted(items[idx:idx + ncols], key=lambda t: t[1])
            out.extend(t[2] for t in row)
            idx += ncols
        return out


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
        # 絵どうしがくっついていて空白の帯が足りないとき: 等分した位置の近くで、いちばん塗りの少ない列で切る
        nz = np.nonzero(counts > 2)[0]
        if len(nz) == 0:
            raise ValueError(f"区切りが足りない: {len(runs)} < {n - 1}")
        a0, a1 = int(nz[0]), int(nz[-1]) + 1
        step = (a1 - a0) / n
        cuts = []
        for k in range(1, n):
            c = a0 + step * k
            w0, w1 = int(c - step * 0.3), int(c + step * 0.3)
            cuts.append(w0 + int(np.argmin(counts[w0:w1])))
        edges = [a0, *cuts, a1]
        print(f"  （区切りが足りないので、塗りの少ない列で切った: {cuts}）")
        return [(edges[k], edges[k + 1]) for k in range(n)]
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
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    for path in sorted(RAW.glob("*.png")):
        name = path.stem
        if only and not any(name.startswith(o) for o in only):
            continue
        try:
            if name.startswith("items-") or name.startswith("gen-"):
                key = name.split("-", 1)[1]
                # 発生器のシートは動く 7 段階（3〜9 段目。上の段に4個、下の段に3個）。1〜2 段目は parts-*
                rows = [4, 4] if name.startswith("items-") else [4, 3]
                pieces = cut_sheet(path, rows)
                (OUT / "items").mkdir(parents=True, exist_ok=True)
                for t, p in enumerate(pieces, start=1 if name.startswith("items-") else 3):
                    kind = CHAIN_INDEX[key] * 100 + t
                    fit(p, 192).save(OUT / "items" / f"{kind}.png", optimize=True)
                    manifest["items"][kind] = f"assets/items/{kind}.png"
            elif name.startswith("parts-"):
                # 発生器の部品: 1つの発生器につき 1 段目・2 段目の2個ずつ（jobs.mjs の PART_SHEETS と同じ順）
                gens = GEN_PART_SHEETS[int(name.split("-")[1]) - 1]
                pieces = cut_sheet(path, [4, 4] if len(gens) > 2 else [4])
                (OUT / "items").mkdir(parents=True, exist_ok=True)
                for n, p in enumerate(pieces):
                    kind = CHAIN_INDEX[gens[n // 2]] * 100 + n % 2 + 1
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
            elif name == "gift-boxes":
                # プレゼント箱（白・青・赤・紫）。kind = 40 * 100 + 段階
                pieces = cut_sheet(path, [4])
                (OUT / "items").mkdir(parents=True, exist_ok=True)
                for t, p in enumerate(pieces, start=1):
                    fit(p, 192).save(OUT / "items" / f"{4000 + t}.png", optimize=True)
                    manifest["items"][4000 + t] = f"assets/items/{4000 + t}.png"
            elif name == "ui-maxstar":
                a = np.asarray(Image.open(path).convert("RGB"))
                pieces = [cutout(a)]
                (OUT / "ui").mkdir(parents=True, exist_ok=True)
                fit(pieces[0], 96).save(OUT / "ui" / "maxstar.png", optimize=True)
                manifest["icons"]["maxstar"] = "assets/ui/maxstar.png"
            elif name == "ui-gift50":
                a = np.asarray(Image.open(path).convert("RGB"))
                pieces = [cutout(a)]
                (OUT / "ui").mkdir(parents=True, exist_ok=True)
                fit(pieces[0], 160).save(OUT / "ui" / "gift50.png", optimize=True)
                manifest["icons"]["gift50"] = "assets/ui/gift50.png"
            elif name == "ui-gem":
                a = np.asarray(Image.open(path).convert("RGB"))
                pieces = [cutout(a)]
                (OUT / "ui").mkdir(parents=True, exist_ok=True)
                fit(pieces[0], 128).save(OUT / "ui" / "gem.png", optimize=True)
                manifest["icons"]["gem"] = "assets/ui/gem.png"
            elif name == "iso-tiles-tex":
                raw = Image.open(path).convert("RGB")
                rw, rh = raw.size
                hw, hh = rw // 2, rh // 2
                quads = [
                    ("tile_dirty", raw.crop((0, 0, hw, hh))),
                    ("tile_clean", raw.crop((hw, 0, rw, hh))),
                    ("tile_grass", raw.crop((0, hh, hw, rh))),
                    ("tile_walk", raw.crop((hw, hh, rw, rh))),
                ]
                (OUT / "story" / "iso").mkdir(parents=True, exist_ok=True)
                pieces = []
                for tn, qim in quads:
                    tile = make_iso_diamond_tile(qim, 256, 128)
                    tile.save(OUT / "story" / "iso" / f"{tn}.png", optimize=True)
                    pieces.append(tile)
            elif name == "iso-city-tiles":
                raw = Image.open(path).convert("RGB")
                rw, rh = raw.size
                hw, hh = rw // 2, rh // 2
                quads = [
                    ("tile_asphalt", raw.crop((0, 0, hw, hh))),
                    ("tile_concrete", raw.crop((hw, 0, rw, hh))),
                    ("tile_alley", raw.crop((0, hh, hw, rh))),
                    ("tile_plaza_stone", raw.crop((hw, hh, rw, rh))),
                ]
                (OUT / "story" / "iso").mkdir(parents=True, exist_ok=True)
                pieces = []
                for tn, qim in quads:
                    tile = make_iso_diamond_tile(qim, 256, 128)
                    tile.save(OUT / "story" / "iso" / f"{tn}.png", optimize=True)
                    pieces.append(tile)
            elif name == "iso-bakery-floors":
                raw = Image.open(path).convert("RGB")
                rw, rh = raw.size
                hw = rw // 2
                (OUT / "story" / "iso").mkdir(parents=True, exist_ok=True)
                pieces = []
                for tn, qim in [("bfloor_dirty", raw.crop((0, 0, hw, rh))), ("bfloor_clean", raw.crop((hw, 0, rw, rh)))]:
                    tile = make_iso_diamond_tile(qim, 256, 128)
                    tile.save(OUT / "story" / "iso" / f"{tn}.png", optimize=True)
                    pieces.append(tile)
            elif name in ("r9-fountain", "r11-fountain"):
                # 丸い噴水: 水盤の楕円のいちばん広い横幅と、いちばん下の点を測る（半径 2 マスの円 → 横幅 2*2*90.51px）
                pieces = cut_sheet_chroma(path, [2, 2], "magenta")
                meta = json.loads(META_PATH.read_text("utf-8")) if META_PATH.exists() else {}
                for n, p in zip(["fountain_dirty", "fountain_0", "fountain_1", "fountain_2"], pieces):
                    q = fit(p, 900)
                    al = np.asarray(q)[:, :, 3] > 40
                    rows = np.nonzero(al.any(axis=1))[0]
                    bot = int(rows.max())
                    best = (0, 0, 0)
                    for y in range(int(rows.min() + (bot - rows.min()) * 0.4), bot + 1):
                        xs = np.nonzero(al[y])[0]
                        if len(xs) and xs.max() - xs.min() > best[0]:
                            best = (int(xs.max() - xs.min()), int(xs.min()), int(xs.max()))
                    w, x0, x1 = best
                    q.save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
                    meta[n] = {"ax": round(((x0 + x1) / 2) / q.width, 4), "ay": round((bot + 1) / q.height, 4), "s": round(4 * 90.51 / max(1, w), 5), "W": 4, "D": 4, "round": 2}
                    print(f"  {n}: 幅 {w}px 下 {bot}")
                META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
            elif name == "r10-signs":
                # 道しるべ: 柱の根元を足元にし、高さ 165px で置く（床の真ん中に柱が立つ）
                pieces = cut_sheet_chroma(path, [2, 2], "blue")
                meta = json.loads(META_PATH.read_text("utf-8")) if META_PATH.exists() else {}
                for n, p in zip(["sign_dirty", "sign_0", "sign_1", "sign_2"], pieces):
                    q = fit(p, 420)
                    al = np.asarray(q)[:, :, 3] > 40
                    ys, xs = np.nonzero(al)
                    bot = int(ys.max())
                    bx = float(xs[ys >= bot - 3].mean())
                    q.save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
                    meta[n] = {"ax": round(bx / q.width, 4), "ay": round((bot + 1) / q.height, 4), "s": round(165 / (bot - int(ys.min()) + 1), 5), "W": 0.6, "D": 0.6, "fixed": 1, "center": 1}
                META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
            elif name.startswith("r21-rug-") or name.startswith("r21-art-"):
                # 11〜20章のお店のラグと壁の絵（4枚目は予備）
                k, kind = name.split("-")[2], name.split("-")[1]
                pieces = cut_sheet_chroma(path, [2, 2], "blue")
                for i, p in enumerate(pieces):
                    fit(p, 640).save(OUT / "story" / "iso" / f"{k}_{kind}_{i}.png", optimize=True)
            elif name.startswith("r21-floors-"):
                # 11〜20章のお店の床（r21_spec.json の floors の順に4枚ずつ）
                r21 = json.loads((Path(__file__).parent / "r21_spec.json").read_text("utf-8"))
                k = int(name.split("-")[-1]) - 1
                four = [n for n, _ in r21["floors"][k * 4:k * 4 + 4]]
                raw = Image.open(path).convert("RGB")
                rw, rh = raw.size
                hw, hh = rw // 2, rh // 2
                pieces = []
                for tn, box in zip(four, [(0, 0, hw, hh), (hw, 0, rw, hh), (0, hh, hw, rh), (hw, hh, rw, rh)]):
                    tile = make_iso_diamond_tile(raw.crop(box), 256, 128)
                    tile.save(OUT / "story" / "iso" / f"{tn}.png", optimize=True)
                    pieces.append(tile)
            elif name.startswith("r21-chars-") or name.startswith("r21-minis-"):
                # 11〜20章の店主: 立ち絵と、マップに立つ全身のミニキャラ（r21_spec.json の chars の順に3人ずつ）
                r21 = json.loads((Path(__file__).parent / "r21_spec.json").read_text("utf-8"))
                k = int(name.split("-")[-1]) - 1
                who = [n for n, _ in r21["chars"][k * 3:k * 3 + 3]]
                pieces = cut_sheet_chroma(path, [3], "green")
                mini = name.startswith("r21-minis-")
                for n, p in zip(who, pieces):
                    if mini:
                        despill_green_rgba(fit(p, 320)).save(OUT / "story" / "iso" / f"mini_{n}.png", optimize=True)
                    else:
                        despill_green_rgba(fit(p, 600)).save(OUT / "story" / f"{n}_smile.png", optimize=True)
            elif name.startswith("r21-low-") or name.startswith("r21-face-"):
                continue  # build_shops.py / build_signs.py で使う
            elif name.startswith("r12-rug-") or name.startswith("r12-art-"):
                # ラグ（真上から）と壁の絵（真正面）。ゲームで床・壁の面に変形して貼るので、切り出すだけ
                k, kind = name.split("-")[2], name.split("-")[1]
                pieces = cut_sheet_chroma(path, [2, 2], "blue")
                for i, p in enumerate(pieces):
                    fit(p, 640).save(OUT / "story" / "iso" / f"{k}_{kind}_{i}.png", optimize=True)
            elif name in ("r9-floor-dirty", "r9-floor-clean"):
                # 真上から見た円形広場の床。円の外は透明にし、正方形のまま保存（ゲームで 2:1 に変形して貼る）
                im = cutout_chroma(np.asarray(Image.open(path).convert("RGB")), "blue")
                im = im.resize((1024, 1024), Image.LANCZOS)
                im.save(OUT / "story" / "iso" / f"plaza_{name.split('-')[-1]}.png", optimize=True)
                pieces = [im]
            elif name.startswith("r21-") and name in BOX_SHEETS:
                # 11〜20章: 型紙の箱・床板の位置（make_refs.py と同じ計算）から、置き方（足元の手前の角と拡大率）を決める。
                # 絵の下の線を測って決めない（テーブルと椅子のような組でも、型紙の場所にぴったり置ける）。
                # 絵が型紙からずれていれば check_angles.py で不合格になり、作り直す
                rows, items, sz = BOX_SHEETS[name]
                is_plate = name in _R5.get("plates", {})
                spec_items = (_R5["plates"] if is_plate else _R5["sheets"])[name]
                unit0 = _R5.get("units", {}).get(name, _R5["unit"])
                img = Image.open(path).convert("RGB")
                a = np.asarray(img)
                sx, sy = img.width / 1536, img.height / 1024
                hw, hh = img.width // 2, img.height // 2
                meta = json.loads(META_PATH.read_text("utf-8")) if META_PATH.exists() else {}
                pieces = []
                for i, (n, W, D, H, _d) in enumerate(spec_items):
                    r, c = divmod(i, 2)
                    h = 8 if is_plate else H
                    cx = 768 * (c + 0.5) - (W - D) * unit0 * 0.5
                    cy = 512 * r + 256 + h * 0.5 + 6
                    # 足元の手前の角（gx = -W/2, gy = +D/2）。シートの座標
                    fx = (cx + (-W / 2 + D / 2) * unit0) * sx
                    fy = (cy + (D / 2 + W / 2) * unit0 * 0.5) * sy
                    off: list = []
                    try:
                        # 指示で青を使わせていないので、すき間に閉じこめられた青（背景）もしっかり抜く
                        p = cutout_chroma(a[r * hh:(r + 1) * hh, c * hw:(c + 1) * hw], "blue", inner_hi=80.0, offset=off)
                    except ValueError:
                        problems.append(f"{n}: 絵が見つからない")
                        continue
                    pieces.append(p)
                    if n in KEEP:
                        continue
                    q = fit(p, sz)
                    k = q.width / p.width
                    fxq = (fx - c * hw - off[0]) * k
                    fyq = (fy - r * hh - off[1]) * k
                    if not is_plate:
                        # 箱形の物（面が平らなので、縦にずらすと面ごと正しい向きになる）: 足元の左右の線の角度のずれが 10° までなら、型紙の手前の角を中心に縦にずらして
                        # ぴったり ±26.6° にする（縦の線は縦のまま。手前の角の位置は変わらない）。それより大きいずれは直さない（作り直す）
                        q, fyq = shear_to_template(q, fxq, fyq, max_deg=10.0)
                    ax = fxq / q.width
                    ay = fyq / q.height
                    q.save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
                    meta[n] = {"ax": round(ax, 4), "ay": round(ay, 4), "s": round(64 / (unit0 * sx * k), 5), "W": W, "D": D}
                    if not is_plate:
                        # 箱形の物: 足元の左右の線がぴったり ±26.6° なら、絵の足元の角そのもので置く
                        # （型紙の場所から少しずれて描かれていても、角度が合っていればマスにぴったり置ける）
                        a0 = hull_angles(q)
                        if a0[0] is not None and a0[1] is not None and abs(a0[0] - 26.57) <= 1.0 and abs(a0[1] + 26.57) <= 1.0:
                            meta[n] = box_meta(q, W, D)
                    print(f"  {n}: 型紙の位置で置く")
                META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
            elif name in BOX_SHEETS:
                rows, items, sz = BOX_SHEETS[name]
                pieces = cut_sheet_chroma(path, rows, "blue")
                meta = json.loads(META_PATH.read_text("utf-8")) if META_PATH.exists() else {}
                (OUT / "story" / "iso").mkdir(parents=True, exist_ok=True)
                for (n, W, D), p in zip(items, pieces):
                    if n in KEEP:
                        continue
                    # 形をゆがめないため、変形は「ずれが小さいときの1回の小さな補正」だけ。ずれが大きい物は使わず作り直す
                    a0 = hull_angles(p)
                    err = max(abs(a0[0] - 26.6) if a0[0] else 9, abs(a0[1] + 26.6) if a0[1] else 9)
                    if n not in NO_ALIGN and err > 2.5:
                        problems.append(f"{n}: 角度のずれが大きい {a0}")
                    q = fit(p, sz) if n in NO_ALIGN or err > 2.5 else fit(align_box(p), sz)
                    q.save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
                    meta[n] = box_meta(q, W, D)
                    a0, a1 = hull_angles(p), hull_angles(q)
                    print(f"  {n}: 角度 {a0} → {a1}")
                META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
            elif name in PART_SHEETS:
                pre = PART_SHEETS[name]
                pieces = cut_sheet_chroma(path, [3, 3], "blue")
                names = [f"{pre}_wall_gx_dirty", f"{pre}_wall_gx_clean", f"{pre}_wall_gy_dirty", f"{pre}_wall_gy_clean", f"{pre}_low_gx_dirty", f"{pre}_low_gx_clean"]
                for n, p in zip(names, pieces):
                    p = align_axis_slope(p, 0.5 if "_gy_" in n else -0.5)
                    fit(p, 340).save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
            elif name in DECOR_SHEETS:
                pre = DECOR_SHEETS[name]
                pieces = cut_sheet_chroma(path, [2, 2], "blue")
                meta = json.loads(META_PATH.read_text("utf-8")) if META_PATH.exists() else {}
                for n, p in zip([f"{pre}_dirty", f"{pre}_0", f"{pre}_1", f"{pre}_2"], pieces):
                    q = fit(align_box(p), 460)
                    q.save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
                    meta[n] = box_meta(q, 2, 0.7)
                META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
            elif name == "r4-floors":
                raw = Image.open(path).convert("RGB")
                rw, rh = raw.size
                hw, hh = rw // 2, rh // 2
                pieces = []
                for tn, box in [("fry_floor_clean", (0, 0, hw, hh)), ("cake_floor_clean", (hw, 0, rw, hh)),
                                ("cloth_floor_clean", (0, hh, hw, rh)), ("old_floor_dirty", (hw, hh, rw, rh))]:
                    tile = make_iso_diamond_tile(raw.crop(box), 256, 128)
                    tile.save(OUT / "story" / "iso" / f"{tn}.png", optimize=True)
                    pieces.append(tile)
            elif name == "r4-story-chars":
                pieces = cut_sheet_chroma(path, [3], "green")
                for n, p in zip(["takumi_smile", "misaki_smile", "yuri_smile"], pieces):
                    despill_green_rgba(fit(p, 600)).save(OUT / "story" / f"{n}.png", optimize=True)
            elif name == "r7-yuri":
                pieces = cut_sheet_chroma(path, [2], "blue")
                fit(pieces[0], 320).save(OUT / "story" / "iso" / "mini_yuri.png", optimize=True)
                fit(pieces[1], 600).save(OUT / "story" / "yuri_smile.png", optimize=True)
            elif name == "r4-mini-chars":
                pieces = cut_sheet_chroma(path, [3], "green")
                for n, p in zip(["mini_takumi", "mini_misaki", "mini_yuri"], pieces):
                    despill_green_rgba(fit(p, 320)).save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
            elif name == "r16-floors":
                # 神社の参道のお店の床（カフェ・駄菓子屋・ジム・予備の大理石）
                raw = Image.open(path).convert("RGB")
                rw, rh = raw.size
                hw, hh = rw // 2, rh // 2
                pieces = []
                for tn, box in [("cafe_floor_clean", (0, 0, hw, hh)), ("dagashi_floor_clean", (hw, 0, rw, hh)),
                                ("gym_floor_clean", (0, hh, hw, rh)), ("marble_floor_clean", (hw, hh, rw, rh))]:
                    tile = make_iso_diamond_tile(raw.crop(box), 256, 128)
                    tile.save(OUT / "story" / "iso" / f"{tn}.png", optimize=True)
                    pieces.append(tile)
            elif name in ("r16-chars", "r16-minis"):
                # 参道のお店の店主: 立ち絵と、マップに立つ全身のミニキャラ
                pieces = cut_sheet_chroma(path, [3], "green")
                mini = name == "r16-minis"
                for n, p in zip(["haruto", "kiyo", "daigo"], pieces):
                    if mini:
                        despill_green_rgba(fit(p, 320)).save(OUT / "story" / "iso" / f"mini_{n}.png", optimize=True)
                    else:
                        despill_green_rgba(fit(p, 600)).save(OUT / "story" / f"{n}_smile.png", optimize=True)
            elif name in WALK_SHEETS:
                prefix, nframes, cw, ch = WALK_SHEETS[name]
                raw_pieces = cut_sheet_chroma(path, [nframes], "green")
                pieces = normalize_walk_frames(raw_pieces, cw, ch)
                (OUT / "story" / "iso").mkdir(parents=True, exist_ok=True)
                for idx, p in enumerate(pieces):
                    p.save(OUT / "story" / "iso" / f"{prefix}_{idx}.png", optimize=True)
            elif name in ISO_SHEETS:
                rows, names, sz, mode = ISO_SHEETS[name]
                # 門の鉄骨トラス内部の細かい穴は低め閾値で確実に抜く
                inner_hi = 58.0 if name == "iso-gates" else None
                pieces = cut_sheet_chroma(path, rows, mode, inner_hi=inner_hi)
                (OUT / "story" / "iso").mkdir(parents=True, exist_ok=True)
                for n, p in zip(names, pieces):
                    if name == "iso-gates" or n == "edge_roof":
                        p = align_axis_slope(p, 0.5)
                    elif n in ("bench_dirty", "bench_clean", "fence_dirty", "fence_clean", "street_flags"):
                        p = align_axis_slope(p, -0.5)
                    out_im = fit(p, sz)
                    if mode == "green":
                        out_im = despill_green_rgba(out_im)
                    out_im.save(OUT / "story" / "iso" / f"{n}.png", optimize=True)
            elif name in ORDER_SHEETS:
                pieces = cut_sheet_chroma(path, [2, 2], "green")
                (OUT / "orders").mkdir(parents=True, exist_ok=True)
                for n, p in zip(ORDER_SHEETS[name], pieces):
                    fit(p, 320).save(OUT / "orders" / f"{n}.png", optimize=True)
            elif name in STORY_SHEETS:
                rows, names, sz, mode = STORY_SHEETS[name]
                pieces = cut_sheet_chroma(path, rows, mode)
                (OUT / "story").mkdir(parents=True, exist_ok=True)
                for n, p in zip(names, pieces):
                    fit(p, sz).save(OUT / "story" / f"{n}.png", optimize=True)
            elif name.startswith("iso-stage"):
                (OUT / "story").mkdir(parents=True, exist_ok=True)
                im = Image.open(path).convert("RGB").resize((1200, 800), Image.LANCZOS)
                out_map = {
                    "iso-stage0-dirty": "iso_stage0.jpg",
                    "iso-stage1-nogarbage": "iso_stage1.jpg",
                    "iso-stage2-polished": "iso_stage2.jpg",
                    "iso-stage3-gate-0": "iso_stage3_0.jpg",
                    "iso-stage3-gate-1": "iso_stage3_1.jpg",
                    "iso-stage3-gate-2": "iso_stage3_2.jpg",
                }
                fname = out_map.get(name)
                if not fname:
                    continue
                im.save(OUT / "story" / fname, quality=90)
                if name.startswith("iso-stage3-gate-"):
                    idx = name.rsplit("-", 1)[1]
                    # 門エリア（左下中央 x:24%..48%, y:51%..81%）を丸サムネ用に綺麗にクロップ
                    raw = Image.open(path).convert("RGB")
                    rw, rh = raw.size
                    box = (int(rw * 0.24), int(rh * 0.51), int(rw * 0.48), int(rh * 0.81))
                    raw.crop(box).resize((220, 220), Image.LANCZOS).save(OUT / "story" / f"thumb_gate_{idx}.jpg", quality=88)
                print(f"✓ {name}: {fname}")
                continue
            elif name.startswith("story-bg-"):
                key = name[len("story-bg-"):]
                (OUT / "story").mkdir(parents=True, exist_ok=True)
                im = Image.open(path).convert("RGB").resize((1200, 800), Image.LANCZOS)
                im.save(OUT / "story" / f"bg-{key}.jpg", quality=90)
                print(f"✓ {name}: bg-{key}.jpg")
                continue
            elif name.startswith("story-patch-"):
                rest = name[len("story-patch-"):]  # e.g. arch-0
                spot, idx = rest.rsplit("-", 1)
                base_path = RAW / "story-bg-clean.png"
                if not base_path.exists():
                    continue
                (OUT / "story").mkdir(parents=True, exist_ok=True)
                patch, thumb = extract_map_patch(base_path, path, spot)
                patch.save(OUT / "story" / f"patch_{spot}_{idx}.png", optimize=True)
                thumb.save(OUT / "story" / f"thumb_{spot}_{idx}.jpg", quality=88)
                print(f"✓ {name}: patch_{spot}_{idx}.png + thumb")
                continue
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
    # 一部だけ切り出したときは、今の manifest に足す（ほかの項目を消さない）
    mp = OUT / "manifest.json"
    if only and mp.exists():
        old = json.loads(mp.read_text("utf-8"))
        for k, v in manifest.items():
            if isinstance(v, dict):
                old.setdefault(k, {}).update(v)
            elif v:
                old[k] = v
        manifest = old
    mp.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
