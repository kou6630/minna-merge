"""ch11_20.py（11〜20章の中身）から、絵の指示とゲームのデータを作る。

使い方: python -P tools/assets/build_ch11_20.py
  - tools/assets/r5_spec.json に、型紙の家具（r21-*）・壁・形を書き足す（前の r21-* は消してから）
  - tools/assets/r21_spec.json に、ラグ・壁の絵・看板の板・床・人の絵の指示を書く
  - packages/shared/src/story-ch11.ts に、11〜20章のデータを書く
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ch11_20 as C  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = Path(__file__).parent / "r5_spec.json"
R21_PATH = Path(__file__).parent / "r21_spec.json"
TS_PATH = ROOT / "packages" / "shared" / "src" / "story-ch11.ts"
NO_BLUE = "。青色は使わない"

# 章ごとの値段（1つめのタスク）と、1つ進むごとの増え方。章クリアの経験値・スタミナ・ジェム
COST0 = {11: 500, 12: 520, 13: 545, 14: 570, 15: 595, 16: 620, 17: 645, 18: 670, 19: 700, 20: 1200}
STEP = 7
REWARD = {11: (730, 160, 140), 12: (815, 170, 150), 13: (900, 180, 160), 14: (990, 190, 170), 15: (1075, 200, 180),
          16: (1145, 210, 190), 17: (1240, 220, 200), 18: (1310, 230, 210), 19: (1380, 240, 220), 20: (1430, 300, 300)}


def chunk(lst, n):
    return [lst[i:i + n] for i in range(0, len(lst), n)]


def build_spec():
    spec = json.loads(SPEC_PATH.read_text("utf-8"))
    for sec in ("sheets", "plates"):
        spec[sec] = {k: v for k, v in spec[sec].items() if not k.startswith("r21-")}
    spec.setdefault("units", {})
    spec["units"] = {k: v for k, v in spec["units"].items() if not k.startswith("r21-")}
    spec.setdefault("shapes", {})
    keys = [s["key"] for s in C.SHOPS]
    for k in keys:
        spec["walls"].pop(k, None)
        spec["lows"].pop(k, None)
    shapes: dict[str, str] = {}
    sides: list = []
    plates: list = []
    for s in C.SHOPS:
        key, p = s["key"], s["p"]
        box: list = []
        for part in ("A", "B"):
            slot, _t, _d, choices = s[part]
            W, D, H = C.SIZE[part]
            for i, (_lab, _short, prompt) in enumerate(choices):
                box.append([f"{key}_{slot}_{i}", W, D, H, prompt + NO_BLUE])
        for what in ("shelf", "corner"):
            W, D, H = C.SIZE[what]
            for i, (_lab, _short, prompt) in enumerate(s[what]):
                box.append([f"{p}_{what}_{i}", W, D, H, prompt + NO_BLUE])
        for n, items in enumerate(chunk(box, 4), start=1):
            spec["sheets"][f"r21-{key}-{n}"] = items
        W, D, H = C.SIZE["side"]
        for i, (_lab, _short, prompt) in enumerate(s["side"]):
            sides.append([f"{p}_side_{i}", W, D, H, prompt + NO_BLUE])
        # 床板の型紙で作る物: 店先の飾り（改装前＋3択）・テーブルと椅子・植物
        W, D, H = C.SIZE["deco"]
        dirty, decos = s["deco"]
        plates.append([f"{key}_deco_dirty", W, D, H, dirty + "（汚れて古びた感じ）" + NO_BLUE])
        shapes[f"{key}_deco_dirty"] = "set"
        for i, (_lab, _short, prompt) in enumerate(decos):
            plates.append([f"{key}_deco_{i}", W, D, H, prompt + NO_BLUE])
            shapes[f"{key}_deco_{i}"] = "set"
        for what in ("table", "plant"):
            W, D, H = C.SIZE[what]
            for i, (_lab, _short, prompt) in enumerate(s[what]):
                plates.append([f"{p}_{what}_{i}", W, D, H, prompt + "。床・台・壁・箱の囲いは描かない" + NO_BLUE])
                # 椅子を置かない丸いテーブルは、向きのない丸い物として見る
                shapes[f"{p}_{what}_{i}"] = "round" if "椅子やスツールは置かない" in prompt or "座布団や椅子は置かない" in prompt else C.SHAPE[what]
        spec["walls"][key] = list(s["wall"])
        spec["lows"][key] = list(s["low"])
    for n, items in enumerate(chunk(sides, 4), start=1):
        spec["sheets"][f"r21-side{n}"] = items
    for n, items in enumerate(chunk(plates, 4), start=1):
        spec["plates"][f"r21-p{n}"] = items
    # 夏祭り: やぐら（2×2）・ちょうちんの柱・屋台（3×1）・入口のゲート（道をまたぐ 0.5×6）
    F = C.FESTIVAL
    spec["sheets"]["r21-fest1"] = [[f"fest_yagura_{i}", 2, 2, 240, pr + NO_BLUE] for i, (_l, _s, pr) in enumerate(F["yagura"])] + \
        [["fest_lamp", 0.4, 0.4, 200, "赤いちょうちんを3つつるした木の柱" + NO_BLUE]]
    spec["sheets"]["r21-fest2"] = [[f"fest_stall_{i}", 3, 1, 170, pr + NO_BLUE] for i, (_l, _s, pr) in enumerate(F["stall"])]
    spec["sheets"]["r21-fest3"] = [[f"fest_mikoshi_{i}", 2, 1, 200, pr + NO_BLUE] for i, (_l, _s, pr) in enumerate(F["mikoshi"])]
    spec["units"]["r21-fest1"] = 100
    spec["units"]["r21-fest2"] = 100
    for k in list(spec["shapes"]):
        if any(k.startswith(f"{s['key']}_") or k.startswith(f"{s['p']}_") for s in C.SHOPS):
            del spec["shapes"][k]
    spec["shapes"].update(shapes)
    SPEC_PATH.write_text(json.dumps(spec, ensure_ascii=False, indent=1), "utf-8")
    n_box = sum(len(v) for k, v in spec["sheets"].items() if k.startswith("r21-"))
    n_plate = sum(len(v) for k, v in spec["plates"].items() if k.startswith("r21-"))
    print(f"型紙の家具: 箱 {n_box} 個・床板 {n_plate} 個")


def build_r21():
    out = {"rugs": {}, "arts": {}, "faces": {}, "floors": [], "chars": [], "minis": []}
    for s in C.SHOPS:
        p = s["p"]
        out["rugs"][p] = [r[2] for r in s["rug"][:3]] + [s["rug"][4]]
        out["arts"][p] = [r[2] for r in s["art"][:3]] + [s["art"][4]]
        out["faces"][p] = [r[2] for r in s["sign"][:3]] + [s["sign"][4]]
        out["floors"].append([f"{s['key']}_floor_clean", s["floor"]])
    for k, c in C.CHARS.items():
        out["chars"].append([k, c["look"]])
        out["minis"].append([k, c["mini"]])
    R21_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")
    print(f"ラグ・絵・看板 {len(out['rugs'])} 店ぶん、床 {len(out['floors'])}、人 {len(out['chars'])}")


# ---------- ゲームのデータ（TypeScript） ----------

def q(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def line(spec: tuple, owner: str | None, near: tuple = (), seat: dict | None = None) -> str:
    """near: 会話の前後の人（話している相手の立ち絵にする）"""
    who, text = spec[0], spec[1]
    sp, _, expr = who.partition(":")
    expr = expr or ("smile" if sp != "ryoji" else "smug")
    other = spec[2] if len(spec) > 2 else next((n for n in near if n != sp), None) or (owner if sp == "reina" and owner else "reina")
    if other == sp:
        other = "momo" if sp != "momo" else "reina"
    # レイナはいつも左。モモはレイナと話すときだけ右（話す人が変わるたびに、立ち絵が左右に入れ替わらないように）
    if sp == "reina":
        side = "left"
    elif sp == "momo":
        side = "right" if other == "reina" else "left"
    elif other in ("reina", "momo") or seat is None:
        side = "right"
    else:
        # レイナとモモがいない会話: 先に立った側を覚えておき、話す人が変わっても入れ替えない
        side = seat.get(sp) or ("left" if seat.get(other) == "right" else "right")
        seat[sp] = side
        seat.setdefault(other, "left" if side == "right" else "right")
    return f"{{ speaker: {q(sp)}, expr: {q(expr)}, side: {q(side)}, other: {{ speaker: {q(other)}, expr: 'smile' }}, text: {q(text)} }}"


def lines(seq, owner: str | None) -> str:
    """会話の流れ。話している相手は、前（なければ次）に話す人"""
    who = [x[0].partition(":")[0] for x in seq]
    seat: dict = {}
    return ",\n      ".join(line(x, owner, tuple(who[j] for j in (i - 1, i + 1) if 0 <= j < len(seq)), seat) for i, x in enumerate(seq))


def choice_list(prefix: str, choices) -> str:
    out = []
    for i, (lab, short, _pr) in enumerate(choices):
        img = f"assets/story/iso/{prefix}_{i}.png"
        out.append(f"{{ id: {i}, label: {q(lab)}, desc: {q(short)}, stageImg: {q(img)}, thumb: {q(img)} }}")
    return "[\n        " + ",\n        ".join(out) + ",\n      ]"


def task(tid: str, title: str, desc: str, cost: int, after: str, choices: str | None = None) -> str:
    ch = f"\n      choices: {choices}," if choices else ""
    return (f"    {{\n      id: {q(tid)}, title: {q(title)},\n      desc: {q(desc)}, cost: {cost},\n"
            f"      pin: {{ x: 50, y: 50, zoom: 1.4 }},{ch}\n      after: [{after}],\n    }}")


def shop_chapter(s: dict) -> str:
    ch, key, p, owner = s["ch"], s["key"], s["p"], s["owner"]
    a = s["after"]
    cost = COST0[ch]
    tasks = []
    n = 0

    def nxt():
        nonlocal n
        c = cost + STEP * n
        n += 1
        return c
    tasks.append(task(f"ch{ch}_clean", "道のガレキを片付ける", "お店の前の道にたまったガレキの山を片付けて、石畳を磨こう！", nxt(), line(a["clean"], owner)))
    tasks.append(task(f"ch{ch}_repair", "壁と床を直す", "ぼろぼろの壁と古い床を、お店らしく直そう！", nxt(), line(a["repair"], owner)))
    for part in ("A", "B"):
        slot, title, desc, choices = s[part]
        tasks.append(task(f"ch{ch}_{slot}", title, desc + "3択から選べるよ。", nxt(), line(a[part], owner), choice_list(f"{key}_{slot}", choices)))
    for what in C.ITEMS:
        title, desc = C.ITEM_TASK[what]
        choices = s[what][:3]
        tasks.append(task(f"ch{ch}_{what}", title, desc + "3択から選べるよ。", nxt(), line(a[what], owner), choice_list(f"{p}_{what}", choices)))
    _dirty, decos = s["deco"]
    tasks.append(task(f"ch{ch}_front", "店先にベンチと飾りを置く", "お店の前に、ベンチと飾りを置こう！3択から選べるよ。", nxt(), line(a["front"], owner), choice_list(f"{key}_deco", decos)))
    xp, en, gem = REWARD[ch]
    intro = lines(s["intro"], owner)
    outro = lines(s["outro"], owner)
    return (f"  {{\n    id: {ch},\n    title: {q(f'ストーリー{ch}')},\n    areaName: {q(s['area'])},\n    subtitle: {q(s['sub'])},\n"
            f"    baseImg: {q(f'assets/story/iso/{key}_deco_dirty.png')},\n    clouds: [],\n    intro: [\n      {intro},\n    ],\n"
            f"    tasks: [\n" + ",\n".join(tasks) + f",\n    ],\n    outro: [\n      {outro},\n    ],\n"
            f"    reward: {{ xp: {xp}, energy: {en}, gems: {gem} }},\n  }}")


def festival_chapter() -> str:
    F = C.FESTIVAL
    ch = F["ch"]
    cost = COST0[ch]
    tasks = []
    for i, (what, title, desc, aft) in enumerate(F["tasks"]):
        choices = choice_list(f"fest_{what}", F[what]) if what in ("yagura", "stall", "mikoshi") else None
        tasks.append(task(f"ch{ch}_{what}", title, desc, cost + 100 * i, line(aft, None), choices))
    xp, en, gem = REWARD[ch]
    intro = lines(F["intro"], None)
    outro = lines(F["outro"], None)
    return (f"  {{\n    id: {ch},\n    title: {q(f'ストーリー{ch}')},\n    areaName: {q(F['area'])},\n    subtitle: {q(F['sub'])},\n"
            f"    baseImg: {q('assets/story/iso/fest_yagura_0.png')},\n    clouds: [],\n    intro: [\n      {intro},\n    ],\n"
            f"    tasks: [\n" + ",\n".join(tasks) + f",\n    ],\n    outro: [\n      {outro},\n    ],\n"
            f"    reward: {{ xp: {xp}, energy: {en}, gems: {gem} }},\n  }}")


def build_ts():
    chars = ",\n  ".join(f"{k}: {{ name: {q(c['name'])}, role: {q(c['role'])}, color: {q(c['color'])} }}" for k, c in C.CHARS.items())
    ids = " | ".join(q(k).replace('"', "'") for k in C.CHARS)
    body = ",\n".join([shop_chapter(s) for s in C.SHOPS] + [festival_chapter()])
    shops = ",\n  ".join(
        f"{{ ch: {s['ch']}, key: {q(s['key'])}, p: {q(s['p'])}, road: {q(s['road'])}, side: {q(s['lr'])}, "
        + (f"ox: {s['ox']}, " if "ox" in s else f"mx: {s['mx']}, my: {s['my']}, ")
        + f"a: {q(s['A'][0])}, b: {q(s['B'][0])}, owner: {q(s['owner'])} }}"
        for s in C.SHOPS)
    ts = f"""// このファイルは tools/assets/build_ch11_20.py が tools/assets/ch11_20.py から作る（手で直さない）
// ストーリー11〜20章: 北の道（花屋・本屋・ラーメン屋・おもちゃ屋・時計屋・和菓子屋・夏祭り）と西の道（八百屋・写真館・銭湯）
import type {{ StoryChapter }} from './story.ts';

export type SpeakerId11 = {ids};

export const SPEAKERS_11: Record<SpeakerId11, {{ name: string; role: string; color: string }}> = {{
  {chars},
}};

/** マップに置くお店（北の道は通りのお店と同じ向き、西の道は参道のお店と同じ反転した向き） */
export const SHOPS_11 = [
  {shops},
] as const;

export const CHAPTERS_11: StoryChapter[] = [
{body},
];
"""
    TS_PATH.write_text(ts, "utf-8")
    print(f"章のデータ: {TS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    build_spec()
    build_r21()
    build_ts()
