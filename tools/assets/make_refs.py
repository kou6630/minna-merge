"""2:1 ダイメトリック（26.6°）の正確な角度型紙画像を assets-src/ref/ に作る。

使い方: python -P tools/assets/make_refs.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "assets-src" / "ref"
BLUE = (0, 0, 255)


def iso_pt(cx: float, cy: float, gx: float, gy: float, unit: float) -> tuple[float, float]:
    """2:1 ダイメトリック射影（横2進むと縦1、傾き 26.6°）
    gx: 左下→右上 (+x, -y/2), gy: 左上→右下 (+x, +y/2)
    """
    return (
        cx + (gx + gy) * unit,
        cy + (gy - gx) * (unit * 0.5),
    )


def draw_box(
    d: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    h: float,
    unit: float,
    col=(255, 255, 255),
    w=3,
):
    """3D直方体ワイヤーフレーム（縦線は完全垂直、底辺は厳密26.6°）"""
    b00 = iso_pt(cx, cy, x0, y0, unit)
    b10 = iso_pt(cx, cy, x1, y0, unit)
    b11 = iso_pt(cx, cy, x1, y1, unit)
    b01 = iso_pt(cx, cy, x0, y1, unit)
    t00 = (b00[0], b00[1] - h)
    t10 = (b10[0], b10[1] - h)
    t11 = (b11[0], b11[1] - h)
    t01 = (b01[0], b01[1] - h)
    d.polygon([b00, b10, b11, b01], outline=(255, 255, 0), width=w)
    for b, t in [(b00, t00), (b10, t10), (b11, t11), (b01, t01)]:
        d.line([b, t], fill=col, width=w)
    d.polygon([t00, t10, t11, t01], outline=col, width=w)


def make_gate_ref():
    """2×2 シート用：gy方向に6マス幅・横長比率（幅:高 ≒ 1.4:1）の商店街アーチ門型紙（厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    # 6マス幅 = 6 * unit ≒ 336px、アーチ頂上までの高さ ≒ 235px (幅:高 ≒ 1.43:1 の堂々とした横長アーチ)
    unit = 56.0
    for row in range(2):
        for col in range(2):
            cx = 384 + col * 768
            cy = 325 + row * 505
            # 床の6マスガイド（gy = -3..+3, gx = -0.35..+0.35）
            for gy in range(-3, 3):
                p0 = iso_pt(cx, cy, -0.35, gy, unit)
                p1 = iso_pt(cx, cy, 0.35, gy, unit)
                p2 = iso_pt(cx, cy, 0.35, gy + 1, unit)
                p3 = iso_pt(cx, cy, -0.35, gy + 1, unit)
                d.polygon([p0, p1, p2, p3], outline=(120, 220, 255), width=2)
            # 左柱（gy=-3.0..-2.35）と右柱（gy=2.35..+3.0）: 外側面が 6マスに一致
            draw_box(d, cx, cy, -0.35, -3.0, 0.35, -2.35, 165, unit, col=(255, 255, 255), w=3)
            draw_box(d, cx, cy, -0.35, 2.35, 0.35, 3.0, 165, unit, col=(255, 255, 255), w=3)
            # 上のアーチ梁（gy=-2.7..+2.7 を 26.6° 平行で結ぶ横長アーチ）
            a0 = iso_pt(cx, cy, 0, -2.7, unit)
            a1 = iso_pt(cx, cy, 0, 2.7, unit)
            d.line([(a0[0], a0[1] - 155), (a1[0], a1[1] - 155)], fill=(255, 255, 255), width=4)
            d.line([(a0[0], a0[1] - 220), (a1[0], a1[1] - 220)], fill=(255, 255, 255), width=3)
    im.save(REF / "ref-gate.png")


def make_wall_ref():
    """2×3 シート用：1マス幅の低い塀（gx向き2種・gy向き2種・角柱2種、厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 150.0
    for row in range(2):
        for col in range(3):
            cx = 256 + col * 512
            cy = 310 + row * 512
            if col < 2 and row == 0:
                draw_box(d, cx, cy, -0.5, -0.18, 0.5, 0.18, 125, unit, w=3)
            elif col < 2 and row == 1:
                draw_box(d, cx, cy, -0.18, -0.5, 0.18, 0.5, 125, unit, w=3)
            else:
                draw_box(d, cx, cy, -0.22, -0.22, 0.22, 0.22, 165, unit, w=3)
    im.save(REF / "ref-wall.png")


def make_bakery_walls_ref():
    """2×3 シート用：パン屋組み立て用の1マス幅壁・腰壁（厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 145.0
    for row in range(2):
        for col in range(3):
            cx = 256 + col * 512
            cy = 350 + row * 512
            if row == 0 and col in (0, 1):
                draw_box(d, cx, cy, -0.5, -0.14, 0.5, 0.14, 240, unit, w=3)
            elif (row == 0 and col == 2) or (row == 1 and col == 0):
                draw_box(d, cx, cy, -0.14, -0.5, 0.14, 0.5, 240, unit, w=3)
            else:
                draw_box(d, cx, cy, -0.5, -0.14, 0.5, 0.14, 95, unit, w=3)
    im.save(REF / "ref-bakery-walls.png")


def make_shop_row_ref():
    """2×2 シート用：通り奥側に並べる古い商店4軒の型紙（正面が右下gy+向き、底面厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 92.0
    for row in range(2):
        for col in range(2):
            cx = 384 + col * 768
            cy = 365 + row * 500
            # 正面幅 2.2マス(gx)、奥行 1.8マス(gy)、高さ 215px
            draw_box(d, cx, cy, -1.1, -0.9, 1.1, 0.9, 215, unit, col=(255, 255, 255), w=3)
    im.save(REF / "ref-shop-row.png")


def make_city_edge_ref():
    """2×2 シート用：商店街の外周に並べる民家・ビル屋根3種＋電柱1本（厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 88.0
    for row in range(2):
        for col in range(2):
            cx = 384 + col * 768
            cy = 365 + row * 500
            if row == 1 and col == 1:
                # 電柱（垂直柱＋横腕木）
                draw_box(d, cx, cy + 50, -0.22, -0.22, 0.22, 0.22, 310, unit, col=(255, 255, 255), w=3)
            else:
                draw_box(d, cx, cy, -1.15, -0.95, 1.15, 0.95, 210, unit, col=(255, 255, 255), w=3)
    im.save(REF / "ref-city-edge.png")


def make_garbage_pile_ref():
    """2×2 シート用：2×2マス床ひし形ガイド＋大きなゴミ山3種＆円形噴水1種（厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 115.0
    for row in range(2):
        for col in range(2):
            cx = 384 + col * 768
            cy = 345 + row * 500
            # 2×2マスの床ひし形グリッド（4マス分）
            for gx in (-1, 0):
                for gy in (-1, 0):
                    p0 = iso_pt(cx, cy, gx, gy, unit)
                    p1 = iso_pt(cx, cy, gx + 1, gy, unit)
                    p2 = iso_pt(cx, cy, gx + 1, gy + 1, unit)
                    p3 = iso_pt(cx, cy, gx, gy + 1, unit)
                    d.polygon([p0, p1, p2, p3], outline=(120, 220, 255), width=2)
            # 外枠の2×2マス底面＆盛り上がり高さボックス
            draw_box(d, cx, cy, -0.95, -0.95, 0.95, 0.95, 130, unit, col=(255, 255, 255), w=3)
    im.save(REF / "ref-garbage-pile.png")


def make_cake_walls_ref():
    """2×2 シート用：ケーキ屋（左2軒目）のボロボロ1マス幅壁3種＋予備1枠（厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 145.0
    # 左上: 奥壁gx (-26.6°), 右上: 奥壁gy (+26.6°), 左下: 手前腰壁＆ひさしgx (-26.6°), 右下: 奥壁予備/花鉢付き壁
    draw_box(d, 384, 355, -0.5, -0.14, 0.5, 0.14, 240, unit, w=3)
    draw_box(d, 1152, 355, -0.14, -0.5, 0.14, 0.5, 240, unit, w=3)
    draw_box(d, 384, 865, -0.5, -0.14, 0.5, 0.14, 100, unit, w=3)
    draw_box(d, 1152, 865, -0.14, -0.5, 0.14, 0.5, 100, unit, w=3)
    im.save(REF / "ref-cake-walls.png")


def make_right_walls_ref():
    """2×3 シート用：通り右側（手前）に並べる店舗（空き家・服屋）の1マス幅部品（正面が左上gy-向き、厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 140.0
    for row in range(2):
        cy = 350 + row * 510
        # 列0: 通り向き正面壁＆ひさし（gx -26.6°、ひさしが左上 gy- へ張り出す）
        cx0 = 256
        draw_box(d, cx0, cy, -0.5, -0.16, 0.5, 0.16, 135, unit, w=3)
        # 左上（通り側 gy-）へ張り出すひさしガイド（水色）
        a0 = iso_pt(cx0, cy, -0.5, -0.16, unit)
        a1 = iso_pt(cx0, cy, 0.5, -0.16, unit)
        a2 = iso_pt(cx0, cy, 0.5, -0.65, unit)
        a3 = iso_pt(cx0, cy, -0.5, -0.65, unit)
        d.polygon([(a0[0], a0[1] - 120), (a1[0], a1[1] - 120), (a2[0], a2[1] - 95), (a3[0], a3[1] - 95)], outline=(120, 220, 255), width=3)
        # 列1: 右奥側壁（gy +26.6°、高さあり）
        draw_box(d, 768, cy, -0.14, -0.5, 0.14, 0.5, 220, unit, w=3)
        # 列2: 手前側の低い腰壁（gx -26.6°、上から中が見える低さ）
        draw_box(d, 1280, cy, -0.5, -0.14, 0.5, 0.14, 95, unit, w=3)
    im.save(REF / "ref-right-walls.png")


def make_right_shops_ref():
    """2×2 シート用：通り右側（手前）の奥区画に並べる古い商店4軒（正面が左上gy-向き、底面厳密26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 92.0
    for row in range(2):
        for col in range(2):
            cx = 384 + col * 768
            cy = 370 + row * 500
            draw_box(d, cx, cy, -1.1, -0.9, 1.1, 0.9, 210, unit, col=(255, 255, 255), w=3)
            # 左上面（gy=-0.9 側）に通り向きのひさし張り出しガイド（水色）
            f0 = iso_pt(cx, cy, -1.1, -0.9, unit)
            f1 = iso_pt(cx, cy, 1.1, -0.9, unit)
            f2 = iso_pt(cx, cy, 1.1, -1.35, unit)
            f3 = iso_pt(cx, cy, -1.1, -1.35, unit)
            d.polygon([(f0[0], f0[1] - 105), (f1[0], f1[1] - 105), (f2[0], f2[1] - 85), (f3[0], f3[1] - 85)], outline=(120, 220, 255), width=3)
    im.save(REF / "ref-right-shops.png")


def make_bench_set_ref():
    """2×2 シート用：パン屋前のベンチ＆街灯・飾りセット（ボロ1種＋3択3種、gx方向 -26.6°）"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    unit = 110.0
    for row in range(2):
        for col in range(2):
            cx = 384 + col * 768
            cy = 375 + row * 500
            # gx 方向 2マス幅のベースガイド（ベンチ＋プランター＋街灯）
            draw_box(d, cx, cy, -1.0, -0.35, 1.0, 0.35, 115, unit, col=(255, 255, 255), w=3)
            # 街灯・ポールの垂直ラインガイド（右端）
            draw_box(d, cx, cy, 0.72, -0.25, 1.0, 0.05, 240, unit, col=(120, 220, 255), w=2)
    im.save(REF / "ref-bench-set.png")


def make_box_grid_ref(name: str, cols: int, rows: int, boxes: list[tuple[float, float, float]], unit: float, floor=True):
    """汎用の箱型紙。boxes[i] = (W=gx方向マス数, D=gy方向マス数, 高さpx)。底面の床マスも水色で描く。"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    cw, ch = 1536 / cols, 1024 / rows
    for i, (W, D, h) in enumerate(boxes):
        r, c = divmod(i, cols)
        cx = cw * (c + 0.5) - (W - D) * unit * 0.5
        cy = ch * r + ch * 0.5 + h * 0.5 + 10
        if floor:
            for gx in range(int(W)):
                for gy in range(int(D)):
                    x0, y0 = -W / 2 + gx, -D / 2 + gy
                    p = [iso_pt(cx, cy, x0 + a, y0 + b, unit) for a, b in ((0, 0), (1, 0), (1, 1), (0, 1))]
                    d.polygon(p, outline=(120, 220, 255), width=2)
        draw_box(d, cx, cy, -W / 2, -D / 2, W / 2, D / 2, h, unit, w=3)
    im.save(REF / f"{name}.png")


def make_round4_refs():
    # 街の建物（4×3マス・2階建て相当）
    make_box_grid_ref("ref-town", 2, 2, [(4, 3, 230)] * 4, 58.0)
    # 店内家具（2×1マス）
    make_box_grid_ref("ref-furniture", 3, 2, [(2, 1, 170)] * 6, 112.0)
    # 通りの小物（ベンチ2・自販機・ポスト・プランター2）
    make_box_grid_ref("ref-props", 3, 2, [(2, 0.8, 95), (2, 0.8, 95), (1, 0.8, 230), (0.6, 0.6, 170), (1, 1, 85), (1, 1, 85)], 120.0, floor=False)


def main():
    REF.mkdir(parents=True, exist_ok=True)
    make_round4_refs()
    make_gate_ref()
    make_wall_ref()
    make_bakery_walls_ref()
    make_shop_row_ref()
    make_city_edge_ref()
    make_garbage_pile_ref()
    make_cake_walls_ref()
    make_right_walls_ref()
    make_right_shops_ref()
    make_bench_set_ref()
    print("✓ 型紙を assets-src/ref/ に生成しました")


def make_clay_ref(name: str, boxes: list, unit: float):
    """第5回: 影付きの立体（粘土の箱）の型紙。2×2。上面=明るい灰、右下の面=中間、左下の面=暗い灰。床マスは水色の線。"""
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    for i, b in enumerate(boxes):
        W, D, h = b[1], b[2], b[3]
        r, c = divmod(i, 2)
        cx = 768 * (c + 0.5) - (W - D) * unit * 0.5
        cy = 512 * r + 256 + h * 0.5 + 6
        P = lambda gx, gy, z=0: (iso_pt(cx, cy, gx, gy, unit)[0], iso_pt(cx, cy, gx, gy, unit)[1] - z)
        x0, y0, x1, y1 = -W / 2, -D / 2, W / 2, D / 2
        for gx in range(int(-(-W // 1))):
            for gy in range(int(-(-D // 1))):
                q = [P(x0 + min(W, gx + a), y0 + min(D, gy + e)) for a, e in ((0, 0), (1, 0), (1, 1), (0, 1))]
                d.polygon(q, outline=(120, 220, 255), width=2)
        d.polygon([P(x0, y1), P(x1, y1), P(x1, y1, h), P(x0, y1, h)], fill=(150, 150, 150))  # 右下の面（gy 最大）
        d.polygon([P(x0, y0), P(x0, y1), P(x0, y1, h), P(x0, y0, h)], fill=(105, 105, 105))  # 左下の面（gx 最小）
        d.polygon([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], fill=(205, 205, 205))  # 上面
    im.save(REF / f"{name}.png")


def make_r9_fountain_ref():
    """第9回: 噴水の床の板（4×4マス）を、各コマの下寄りに置く（上に噴水の高さぶんの余白）。"""
    unit = 70
    im = Image.new("RGB", (1536, 1024), (255, 0, 255))
    d = ImageDraw.Draw(im)
    for i in range(4):
        r, c = divmod(i, 2)
        cx = 768 * (c + 0.5)
        cy = 512 * (r + 1) - 16 - 2 * unit  # 板の中心（ひし形の高さ 4*unit の半分ぶん上）
        P = lambda gx, gy: iso_pt(cx, cy, gx, gy, unit)
        d.polygon([P(-2, -2), P(2, -2), P(2, 2), P(-2, 2)], fill=(170, 170, 170), outline=(120, 220, 255))
        for k in range(-1, 2):
            d.line([P(k, -2), P(k, 2)], fill=(120, 220, 255), width=2)
            d.line([P(-2, k), P(2, k)], fill=(120, 220, 255), width=2)
    im.save(REF / "ref-r9-fountain.png")


def _clay_box(d, cx, cy, unit, x0, x1, y0, y1, z0, z1):
    """灰色の箱（上=明るい・右下の面=中間・左下の面=暗い）。z は ref の px（上向き）"""
    P = lambda gx, gy, z: (iso_pt(cx, cy, gx, gy, unit)[0], iso_pt(cx, cy, gx, gy, unit)[1] - z)
    d.polygon([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], fill=(150, 150, 150))
    d.polygon([P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)], fill=(105, 105, 105))
    d.polygon([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], fill=(205, 205, 205))


def make_r10_sign_ref():
    """第10回: 道しるべの型紙。細い柱1本と、床の線の向き（gx 方向・gy 方向）の薄い矢印の板3枚。"""
    unit = 130
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    for i in range(4):
        r, c = divmod(i, 2)
        cx = 768 * (c + 0.5)
        cy = 512 * r + 470
        # 柱（0.12 マス角、高さ 300）
        _clay_box(d, cx, cy, unit, -0.06, 0.06, -0.06, 0.06, 0, 300)
        # 板: 上 = gx 方向（右上へのびる）、中 = gy 方向（右下へのびる）、下 = gx 方向（左下へのびる）
        _clay_box(d, cx, cy, unit, 0.06, 0.95, -0.03, 0.03, 225, 265)
        _clay_box(d, cx, cy, unit, -0.03, 0.03, 0.06, 0.95, 165, 205)
        _clay_box(d, cx, cy, unit, -0.95, -0.06, -0.03, 0.03, 105, 145)
    im.save(REF / "ref-r10-signs.png")


def _clay_cyl(d, cx, cy, unit, r, z0, z1, hollow=0.0):
    """灰色の円柱（2:1 の正確な楕円）。r はマス、z は ref の px。hollow>0 なら上面に内側の楕円（水盤の中）を描く"""
    rx = r * unit * 2 ** 0.5
    ry = rx / 2
    yb, yt = cy - z0, cy - z1
    d.rectangle([cx - rx, yt, cx + rx, yb], fill=(150, 150, 150))
    d.ellipse([cx - rx, yb - ry, cx + rx, yb + ry], fill=(150, 150, 150))
    d.ellipse([cx - rx, yt - ry, cx + rx, yt + ry], fill=(205, 205, 205))
    if hollow:
        hx, hy = rx * hollow, ry * hollow
        d.ellipse([cx - hx, yt - hy, cx + hx, yt + hy], fill=(120, 120, 120))


def make_r11_fountain_ref():
    """第11回: 噴水の型紙。半径2マスの水盤（正確な 2:1 の楕円の円柱）と、真ん中の柱と皿。"""
    unit = 70
    im = Image.new("RGB", (1536, 1024), (255, 0, 255))
    d = ImageDraw.Draw(im)
    for i in range(4):
        r, c = divmod(i, 2)
        cx = 768 * (c + 0.5)
        cy = 512 * (r + 1) - 16 - 99  # 水盤の底の楕円の中心（下端がコマの下から 16px）
        _clay_cyl(d, cx, cy, unit, 2.0, 0, 45, hollow=0.86)
        _clay_cyl(d, cx, cy, unit, 0.35, 30, 150)
        _clay_cyl(d, cx, cy, unit, 0.95, 95, 112)
        _clay_cyl(d, cx, cy, unit, 0.2, 112, 175)
        _clay_cyl(d, cx, cy, unit, 0.55, 160, 172)
    im.save(REF / "ref-r11-fountain.png")


def make_r13_sign_ref():
    """第13回: 看板の型紙。床の線（gx 方向）に沿った薄い板と、両端の短い脚。板の正面は手前右（右下の面）。"""
    unit = 130
    im = Image.new("RGB", (1536, 1024), BLUE)
    d = ImageDraw.Draw(im)
    for i in range(4):
        r, c = divmod(i, 2)
        cx = 768 * (c + 0.5)
        cy = 512 * r + 440
        for x0 in (-0.36, 0.28):
            _clay_box(d, cx, cy, unit, x0, x0 + 0.08, -0.06, 0.06, 0, 30)
        _clay_box(d, cx, cy, unit, -0.38, 0.38, -0.05, 0.05, 30, 230)
    im.save(REF / "ref-r13-signs.png")


def make_round5_refs():
    import json
    spec = json.loads((ROOT / "tools" / "assets" / "r5_spec.json").read_text("utf-8"))
    for n, boxes in spec["sheets"].items():
        make_clay_ref(f"ref-{n}", boxes, spec.get("units", {}).get(n, spec["unit"]))
    for n, boxes in spec["town"].items():
        make_clay_ref(f"ref-{n}", boxes, spec["town_unit"])
    for n, boxes in spec.get("plates", {}).items():
        make_clay_ref(f"ref-{n}", [[b[0], b[1], b[2], 8] for b in boxes], spec.get("units", {}).get(n, spec["unit"]))


if __name__ == "__main__":
    main()
