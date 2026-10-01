#!/usr/bin/env python3
"""Builds the drawing sheets (inline SVG) and writes ../index.html.

Edit the copy in index.src.html, edit the drawings here, then run:

    python3 _source/build.py

Every sheet is 960 x 640 user units. Classes are styled in assets/home.css:

    k   ink line            k2  thin ink          ks  soft dashed line
    r   red line, draws on as you land on the sheet (pathLength=1, --o start, --d duration)
    rd  red dot, fades in with the same timing
    t   label               ts  soft label        tr  red label (draws on)

The red layer starts undrawn and draws once per visit; ink is always present.

Labels are written with text() like any other mark, but they are published as
HTML on the sheet, not as SVG text (see labels() below).
"""
import math
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

W, H = 960, 640
PIERCE = (140, 140)  # where the assembly axis passes through every sheet

# True: labels leave the SVG and ride on the sheet as HTML. False keeps SVG
# text, which is only used for the stand-alone inspection copies in plates/.
LABELS_AS_HTML = True


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def path(d, cls="k", o=None, dur=None, extra=""):
    if cls in ("r", "r r--thick", "r r--route") or cls.startswith("r"):
        style = f' style="--o:{o if o is not None else 0};--d:{dur if dur is not None else 0.3}"'
        return f'<path class="{cls}" pathLength="1" d="{d}"{style}{extra}/>'
    return f'<path class="{cls}" d="{d}"{extra}/>'


def line(x1, y1, x2, y2, cls="k", o=None, dur=None):
    return path(f"M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}", cls, o, dur)


def rect(x, y, w, h, cls="k", rx=0):
    r = f' rx="{rx}"' if rx else ""
    return f'<rect class="{cls}" x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}"{r}/>'


def circle(cx, cy, r, cls="k", o=None, dur=None):
    if cls.startswith("rd") or cls.startswith("rr"):
        return (f'<circle class="{cls}" cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" '
                f'style="--o:{o if o is not None else 0};--d:{dur if dur is not None else 0.1}"/>')
    return f'<circle class="{cls}" cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}"/>'


def text(x, y, s, cls="t", anchor="start", o=None, dur=None, size=None):
    a = "" if anchor == "start" else f' text-anchor="{anchor}"'
    st = ""
    if cls.startswith("tr"):
        st = f' style="--o:{o if o is not None else 0};--d:{dur if dur is not None else 0.1}"'
    sz = f' font-size="{size}"' if size else ""
    return f'<text class="{cls}" x="{f(x)}" y="{f(y)}"{a}{sz}{st}>{s}</text>'


def arrow_head(x, y, ang, size=9):
    """Open chevron at (x, y) pointing along ang (radians)."""
    a1, a2 = ang + math.pi - 0.42, ang + math.pi + 0.42
    return (f"M{f(x + size * math.cos(a1))} {f(y + size * math.sin(a1))}"
            f"L{f(x)} {f(y)}L{f(x + size * math.cos(a2))} {f(y + size * math.sin(a2))}")


def arrow(pts, cls="k", o=None, dur=None, head=True):
    """Polyline with an arrowhead on the last segment."""
    d = "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts)
    out = [path(d, cls, o, dur)]
    if head:
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        ang = math.atan2(y2 - y1, x2 - x1)
        hc = cls if not cls.startswith("r") else cls
        ho = None if o is None else round(o + (dur or 0.3) * 0.85, 3)
        out.append(path(arrow_head(x2, y2, ang), hc, ho, 0.06))
    return "".join(out)


def frame(name, sub):
    """Sheet border, corner ticks, the pierce mark and a small title cartouche."""
    g = [
        rect(0.75, 0.75, W - 1.5, H - 1.5, "fr0"),
        rect(20, 20, W - 40, H - 40, "fr1"),
    ]
    # edge ticks: a drafting sheet's border is divided, not numbered
    for i in range(1, 8):
        x = 20 + i * (W - 40) / 8
        g.append(line(x, 20, x, 28, "fr1"))
        g.append(line(x, H - 20, x, H - 28, "fr1"))
    for i in range(1, 6):
        y = 20 + i * (H - 40) / 6
        g.append(line(20, y, 28, y, "fr1"))
        g.append(line(W - 20, y, W - 28, y, "fr1"))
    # cartouche
    cx, cy, cw, ch = W - 20 - 232, H - 20 - 46, 232, 46
    g.append(rect(cx, cy, cw, ch, "fr1"))
    g.append(line(cx, cy + 22, cx + cw, cy + 22, "fr1"))
    g.append(text(cx + 12, cy + 16, name, "t t--cart"))
    g.append(text(cx + 12, cy + 38, sub, "ts t--cart2"))
    # pierce mark: centre mark where the assembly axis passes through the sheet
    px, py = PIERCE
    g.append(line(px - 16, py, px + 16, py, "k2"))
    g.append(line(px, py - 16, px, py + 16, "k2"))
    g.append(circle(px, py, 6, "k2 pierce"))
    return "".join(g)


TEXT_RE = re.compile(r'<text class="([^"]*)" x="([^"]*)" y="([^"]*)"((?: [a-z-]+="[^"]*")*)>(.*?)</text>')


def labels(markup):
    """Take every label out of the SVG and return (svg, html_labels).

    The camera rescales the whole stack on every frame, and the browser lays
    SVG text out again whenever the scale above it changes: ninety labels
    re-shaped and re-drawn on every frame was most of the lag on the way in.
    HTML text on the same sheet is not laid out again under a transform. One
    SVG user unit is one CSS pixel (the sheet is 960 x 640), so x and y carry
    over unchanged; home.css puts each label's baseline on y."""
    spans = []

    def take(m):
        cls, x, y, rest, s = m.groups()
        anchor = re.search(r'text-anchor="(\w+)"', rest)
        style = re.search(r'style="([^"]*)"', rest)
        size = re.search(r'font-size="([^"]*)"', rest)
        a = {"middle": " lbl--m", "end": " lbl--e"}.get(anchor.group(1) if anchor else "", "")
        st = f"left:{x}px;top:{y}px"
        if size:
            st += f";font-size:{size.group(1)}px"
        if style:
            st += ";" + style.group(1)
        spans.append(f'<span class="lbl {cls}{a}" style="{st}">{s}</span>')
        return ""

    out = TEXT_RE.sub(take, markup)
    if "<text" in out:
        raise SystemExit("a label did not match TEXT_RE")
    return out, "".join(spans)


def svg(slug, name, sub, body):
    out = (f'<svg class="sheet-svg sheet-svg--{slug}" viewBox="0 0 {W} {H}" '
           f'aria-hidden="true" focusable="false">{frame(name, sub)}{body}</svg>')
    if not LABELS_AS_HTML:
        return out
    out, spans = labels(out)
    return out + f'<div class="sheet-lbls">{spans}</div>'


# --------------------------------------------------------------- SIGNAL --
def plate_signal():
    g = []
    ax_y = 340
    # axes
    g.append(arrow([(140, 548), (140, 168)], "k"))
    g.append(arrow([(122, ax_y), (884, ax_y)], "k"))
    g.append(text(154, 178, "x(t)", "t t--math"))
    g.append(text(872, ax_y + 26, "t", "t t--math"))

    def x_of(t):
        u = t - 150
        return 118 * (0.62 * math.sin(2 * math.pi * u / 360)
                      + 0.27 * math.sin(2 * math.pi * u / 128 + 0.9)
                      + 0.11 * math.sin(2 * math.pi * u / 61 + 0.3))

    pts = [(t, ax_y - x_of(t)) for t in range(150, 864, 3)]
    g.append(path("M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts), "k k--wave"))

    T = 40
    samples = [(160 + T * n, ax_y - x_of(160 + T * n)) for n in range(18)]
    # stems (ink) then dots (red, left to right)
    for i, (x, y) in enumerate(samples):
        g.append(line(x, ax_y, x, y, "k2"))
    for i, (x, y) in enumerate(samples):
        g.append(circle(x, y, 4.2, "rd", o=round(0.04 + i * 0.022, 3), dur=0.05))
    # zero-order hold: the digital version of the same signal
    d = f"M{f(samples[0][0])} {f(samples[0][1])}"
    for i in range(1, len(samples)):
        d += f"H{f(samples[i][0])}V{f(samples[i][1])}"
    d += f"H{f(samples[-1][0] + T)}"
    g.append(path(d, "r", o=0.42, dur=0.38))

    # sampling interval dimension
    xa, xb = samples[4][0], samples[5][0]
    dy = 520
    g.append(line(xa, ax_y + 10, xa, dy + 8, "ks"))
    g.append(line(xb, ax_y + 10, xb, dy + 8, "ks"))
    g.append(path(f"M{f(xa)} {dy}L{f(xb)} {dy}", "r", o=0.62, dur=0.12))
    g.append(path(arrow_head(xa, dy, math.pi, 7), "r", o=0.7, dur=0.04))
    g.append(path(arrow_head(xb, dy, 0, 7), "r", o=0.7, dur=0.04))
    g.append(text((xa + xb) / 2, dy - 9, "T", "tr t--math", "middle", o=0.72, dur=0.08))

    # callout on one sample
    sx, sy = samples[11]
    g.append(path(f"M{f(sx)} {f(sy - 8)}L{f(sx + 34)} 196H{f(sx + 196)}", "r", o=0.78, dur=0.14))
    g.append(text(sx + 40, 186, "x[n] = x(nT)", "tr t--math", o=0.86, dur=0.08))

    # spectrum inset: the same three components, seen as frequencies
    bx, by = 596, 556
    g.append(arrow([(bx - 6, by), (bx + 112, by)], "k2"))
    g.append(arrow([(bx, by + 4), (bx, by - 86)], "k2"))
    for k, (fx, h) in enumerate([(20, 0.62), (52, 0.27), (90, 0.11)]):
        g.append(line(bx + fx, by, bx + fx, by - 70 * h, "k"))
        g.append(circle(bx + fx, by - 70 * h, 2.6, "k dot"))
    g.append(text(bx + 8, by - 78, "|X(f)|", "ts t--math"))
    g.append(text(bx + 120, by + 4, "f", "ts t--math"))
    return svg("signal", "SIGNAL", "B.TECH ECE · 2017–2021", "".join(g))


# ----------------------------------------------------------- ENTERPRISE --
def doc_glyph(x, y, w=64, h=82):
    c = 16
    d = (f"M{x} {y}H{x + w - c}L{x + w} {y + c}V{y + h}H{x}Z"
         f"M{x + w - c} {y}V{y + c}H{x + w}")
    lines = "".join(line(x + 12, y + 32 + i * 12, x + w - 14 - (i % 2) * 10, y + 32 + i * 12, "k2")
                    for i in range(3))
    return path(d, "k") + lines


def cylinder(cx, cy, rx, h, cls="k"):
    ry = rx * 0.28
    d = (f"M{f(cx - rx)} {f(cy)}A{f(rx)} {f(ry)} 0 0 1 {f(cx + rx)} {f(cy)}"
         f"A{f(rx)} {f(ry)} 0 0 1 {f(cx - rx)} {f(cy)}"
         f"M{f(cx - rx)} {f(cy)}V{f(cy + h)}A{f(rx)} {f(ry)} 0 0 0 {f(cx + rx)} {f(cy + h)}V{f(cy)}")
    return path(d, cls)


def plate_enterprise():
    g = []
    forms = [(150, 168), (150, 290), (150, 412)]
    for x, y in forms:
        g.append(doc_glyph(x, y))
    g.append(text(150, 520, "REQUESTS", "ts"))
    # gateway
    gx, gy, gs = 366, 330, 40
    g.append(path(f"M{gx - gs} {gy}L{gx} {gy - gs}L{gx + gs} {gy}L{gx} {gy + gs}Z", "k"))
    g.append(text(gx, gy + 5, "?", "t t--math", "middle"))
    g.append(text(gx, gy - gs - 12, "APPROVE", "ts", "middle"))
    # task
    tx, ty, tw, th = 452, 298, 132, 64
    g.append(rect(tx, ty, tw, th, "k", rx=10))
    g.append(text(tx + tw / 2, ty + 28, "AUTOMATED", "t", "middle"))
    g.append(text(tx + tw / 2, ty + 46, "FLOW", "t", "middle"))
    # records
    g.append(cylinder(690, 300, 42, 62))
    g.append(text(690, 280, "RECORDS", "ts", "middle"))
    # dashboards
    for (dx, dy, kind) in [(800, 178, "bars"), (800, 402, "line")]:
        g.append(rect(dx, dy, 112, 84, "k", rx=4))
        g.append(line(dx, dy + 18, dx + 112, dy + 18, "k2"))
        if kind == "bars":
            for i, hgt in enumerate([26, 40, 33, 50]):
                g.append(rect(dx + 16 + i * 22, dy + 76 - hgt, 12, hgt, "k2"))
        else:
            g.append(path(f"M{dx + 12} {dy + 70}L{dx + 34} {dy + 52}L{dx + 56} {dy + 60}L{dx + 78} {dy + 36}L{dx + 100} {dy + 42}", "k"))
    g.append(text(856, 286, "DASHBOARDS", "ts", "middle"))
    g.append(text(856, 506, "REPORTS", "ts", "middle"))
    # legacy migration
    g.append(cylinder(520, 470, 36, 50, "ks"))
    g.append(text(520, 552, "LEGACY", "ts", "middle"))
    g.append(arrow([(556, 498), (690, 498), (690, 382)], "k2"))
    g.append(text(610, 488, "MIGRATED", "ts"))
    # rejected loop
    g.append(arrow([(gx, gy + gs), (gx, 560), (120, 560), (120, 452), (146, 452)], "ks"))
    g.append(text(240, 552, "RETURNED", "ts"))

    # red: the happy path, in order
    o = 0.06
    for (x, y) in forms:
        g.append(path(f"M{x + 64} {y + 41}H290", "r", o=o, dur=0.08))
        o += 0.04
    g.append(path(f"M290 {forms[0][1] + 41}V{forms[-1][1] + 41}", "r", o=0.14, dur=0.1))
    g.append(arrow([(290, gy), (gx - gs - 2, gy)], "r", o=0.22, dur=0.06))
    g.append(arrow([(gx + gs, gy), (tx - 2, gy)], "r", o=0.3, dur=0.08))
    g.append(path(f"M{gx + gs + 10} {gy - 14}l5 6l11 -14", "r", o=0.34, dur=0.06))
    g.append(arrow([(tx + tw, gy), (646, gy)], "r", o=0.4, dur=0.08))
    g.append(arrow([(732, 330), (764, 330), (764, 220), (798, 220)], "r", o=0.5, dur=0.14))
    g.append(arrow([(764, 330), (764, 444), (798, 444)], "r", o=0.56, dur=0.12))
    return svg("enterprise", "ENTERPRISE", "COGNIZANT · 2021–2024", "".join(g))


# --------------------------------------------------------- ARCHITECTURE --
def entity(x, y, w, name, rows, red_rows=(), o=0.3):
    rh = 26
    h = 30 + rh * len(rows)
    g = [rect(x, y, w, h, "k", rx=3), line(x, y + 30, x + w, y + 30, "k"),
         text(x + 12, y + 20, name, "t")]
    for i, (a, b) in enumerate(rows):
        yy = y + 30 + rh * i
        if i:
            g.append(line(x, yy, x + w, yy, "k2"))
        g.append(text(x + 12, yy + 18, a, "t t--attr"))
        if b:
            g.append(text(x + w - 12, yy + 18, b, "ts", "end"))
        if a in red_rows:
            g.append(path(f"M{x + 6} {yy + rh - 4}H{x + w - 6}", "r", o=o, dur=0.1))
            o += 0.06
    return "".join(g), h


def crow(x, y, direction):
    """Crow's foot (many) at (x, y), opening toward direction (+1 right / -1 left / 'down')."""
    if direction == "down":
        return path(f"M{x - 9} {y}L{x} {y - 14}L{x + 9} {y}M{x} {y}V{y - 14}", "k")
    s = direction
    return path(f"M{x} {y - 9}L{x - 14 * s} {y}L{x} {y + 9}M{x} {y}H{x - 14 * s}", "k")


def plate_architecture():
    g = []
    e1, h1 = entity(96, 176, 176, "DEVICE", [("device_id", "PK"), ("model", "")])
    e2, h2 = entity(372, 150, 216, "DEVICE_LOCATION",
                    [("device_id", "FK"), ("location_id", "FK"), ("valid_from", ""), ("valid_to", "")],
                    red_rows=("valid_from", "valid_to"), o=0.12)
    e3, h3 = entity(688, 176, 176, "LOCATION", [("location_id", "PK"), ("name", "")])
    e4, h4 = entity(372, 330, 216, "READING", [("device_id", "FK"), ("taken_at", ""), ("value", "")])
    g += [e1, e2, e3, e4]
    # relationships
    g.append(line(272, 218, 372, 218, "k"))
    g.append(line(272, 210, 272, 226, "k"))
    g.append(crow(372, 218, 1))
    g.append(line(588, 218, 688, 218, "k"))
    g.append(line(688, 210, 688, 226, "k"))
    g.append(crow(588, 218, -1))
    g.append(path("M184 258V378H372", "k"))
    g.append(line(176, 258, 192, 258, "k"))
    g.append(crow(372, 378, 1))

    # history timeline
    ty = 512
    g.append(arrow([(96, ty), (720, ty)], "k2"))
    g.append(text(96, ty + 30, "TIME", "ts"))
    segs = [(120, 330, "LOCATION A"), (330, 520, "LOCATION B"), (520, 700, "LOCATION A")]
    o = 0.34
    for (a, b, name) in segs:
        g.append(line(a, ty - 26, a, ty + 6, "k2"))
        g.append(path(f"M{a + 3} {ty - 14}H{b - 3}", "r r--thick", o=o, dur=0.12))
        g.append(text((a + b) / 2, ty - 26, name, "ts", "middle"))
        o += 0.1
    g.append(line(700, ty - 26, 700, ty + 6, "k2"))
    for x in (160, 214, 262, 300, 372, 418, 480, 556, 612, 668):
        g.append(circle(x, ty, 3.2, "k dot"))
    # one reading, joined to the location that was valid when it was taken
    rx = 480
    g.append(circle(rx, ty, 8, "rr", o=0.68, dur=0.06))
    g.append(path(f"M{rx} {ty - 9}V{ty - 44}H{rx + 18}V448H600", "r", o=0.72, dur=0.16))
    g.append(text(606, 452, "A READING KEEPS", "tr", o=0.84, dur=0.06))
    g.append(text(606, 470, "ITS LOCATION", "tr", o=0.88, dur=0.06))
    return svg("architecture", "ARCHITECTURE", "ILLUSTRATIVE PATTERN", "".join(g))


# --------------------------------------------------------------- MODELS --
def box3d(x, y, w, h, dz=14, cls="k"):
    d = (f"M{x} {y}H{x + w}V{y + h}H{x}Z"
         f"M{x} {y}L{x + dz} {y - dz}H{x + w + dz}L{x + w} {y}"
         f"M{x + w + dz} {y - dz}V{y + h - dz}L{x + w} {y + h}")
    return path(d, cls)


def vector(x, y, h, cls="k"):
    g = [rect(x, y, 16, h, cls)]
    n = int(h // 20)
    for i in range(1, n):
        g.append(line(x, y + i * h / n, x + 16, y + i * h / n, "k2"))
    return "".join(g)


def plate_models():
    g = []
    vy, ay = 186, 444  # stream centre lines
    x0 = 172
    # video: frame stack
    for i in range(4):
        g.append(rect(x0 + i * 10, vy - 36 - i * 10, 92, 64, "k" if i == 3 else "k2", rx=2))
    g.append(text(x0, vy + 52, "VIDEO", "ts"))
    # audio: waveform
    pts = []
    for t in range(0, 124, 2):
        a = 20 * math.sin(t * 0.33) * math.exp(-((t - 60) / 46) ** 2) + 6 * math.sin(t * 1.1)
        pts.append((x0 + t, ay + a))
    g.append(path("M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts), "k"))
    g.append(text(x0, ay + 52, "AUDIO", "ts"))
    # mel spectrogram: hatch density instead of fills
    sx, sy, cw, chh = 318, ay - 46, 14, 18
    dens = [[0, 1, 2, 3, 2, 1, 0], [1, 2, 3, 3, 2, 1, 1], [0, 1, 1, 2, 3, 2, 1], [0, 0, 1, 1, 2, 3, 2], [0, 0, 0, 1, 1, 2, 3]]
    for r_, row in enumerate(dens):
        for c_, k in enumerate(row):
            cx0, cy0 = sx + c_ * cw, sy + r_ * chh
            for j in range(k):
                off = (j + 1) * cw / (k + 1)
                g.append(line(cx0 + off - 4, cy0 + chh - 2, cx0 + off + 4, cy0 + 2, "k2"))
    g.append(rect(sx, sy, cw * 7, chh * 5, "k"))
    g.append(text(sx, ay + 66, "MEL SPECTROGRAM", "ts"))
    # backbones
    bx, bw = 446, 106
    g.append(box3d(bx, vy - 34, bw, 66))
    g.append(text(bx + bw / 2, vy + 6, "R3D-18", "t", "middle"))
    g.append(box3d(bx, ay - 34, bw, 66))
    g.append(text(bx + bw / 2, ay + 6, "RESNET-18", "t", "middle"))
    # 512 vectors
    vx = 600
    g.append(vector(vx, vy - 60, 120))
    g.append(text(vx + 8, vy - 70, "512", "ts", "middle"))
    g.append(vector(vx, ay - 60, 120))
    g.append(text(vx + 8, ay - 70, "512", "ts", "middle"))
    # concat, 1024, FC, outputs
    cx, cy = 680, 315
    g.append(circle(cx, cy, 17, "k"))
    g.append(line(cx - 4, cy - 8, cx - 4, cy + 8, "k"))
    g.append(line(cx + 4, cy - 8, cx + 4, cy + 8, "k"))
    g.append(vector(722, cy - 90, 180))
    g.append(text(730, cy - 100, "1024", "ts", "middle"))
    g.append(rect(774, cy - 30, 62, 60, "k", rx=6))
    g.append(text(805, cy + 5, "FC", "t", "middle"))
    for (oy, lab) in [(cy - 34, "REAL"), (cy + 34, "FAKE")]:
        g.append(circle(874, oy, 10, "k"))
        g.append(text(891, oy + 5, lab, "t"))
    # red: two streams converging into one verdict
    g.append(arrow([(x0 + 126, vy - 4), (bx - 6, vy - 4)], "r", o=0.06, dur=0.12))
    g.append(arrow([(x0 + 128, ay), (sx - 4, ay)], "r", o=0.06, dur=0.05))
    g.append(arrow([(sx + 102, ay), (bx - 6, ay)], "r", o=0.14, dur=0.05))
    g.append(arrow([(bx + bw + 16, vy), (vx - 4, vy)], "r", o=0.22, dur=0.05))
    g.append(arrow([(bx + bw + 16, ay), (vx - 4, ay)], "r", o=0.22, dur=0.05))
    g.append(path(f"M{vx + 16} {vy}C{vx + 52} {vy} {vx + 52} {cy - 22} {cx - 12} {cy - 12}", "r", o=0.3, dur=0.12))
    g.append(path(f"M{vx + 16} {ay}C{vx + 52} {ay} {vx + 52} {cy + 22} {cx - 12} {cy + 12}", "r", o=0.3, dur=0.12))
    g.append(arrow([(cx + 17, cy), (718, cy)], "r", o=0.44, dur=0.04))
    g.append(arrow([(738, cy), (770, cy)], "r", o=0.5, dur=0.04))
    g.append(path(f"M836 {cy}H846L864 {cy - 28}", "r", o=0.56, dur=0.06))
    g.append(path(f"M846 {cy}L864 {cy + 28}", "r", o=0.56, dur=0.06))
    g.append(path(f"M926 {cy - 52}h8v104h-8", "r", o=0.64, dur=0.08))
    g.append(text(934, cy + 76, "ONE VERDICT", "tr", "end", o=0.7, dur=0.06))
    return svg("models", "MODELS", "M.S. DATA SCIENCE · UAB", "".join(g))


# ------------------------------------------------------------ DECISIONS --
def receipt_glyph(x, y, w, h):
    zz = ""
    n = 6
    for i in range(n):
        zz += f"L{f(x + w - (i + 0.5) * w / n)} {f(y + h - 6)}L{f(x + w - (i + 1) * w / n)} {f(y + h)}"
    d = f"M{x} {y}H{x + w}V{y + h}" + zz + "Z"
    g = [path(d, "k")]
    for i in range(4):
        g.append(line(x + 10, y + 16 + i * 14, x + w - 10 - (i % 2) * 18, y + 16 + i * 14, "k2"))
    return "".join(g)


def plate_decisions():
    g = []
    # request
    g.append(path("M104 286H210V344H138L118 362V344H104Z", "k"))
    g.append(text(157, 320, "REQUEST", "t", "middle"))
    # route map
    mx, my = 256, 276
    for i in range(5):
        g.append(line(mx, my + i * 18, mx + 72, my + i * 18, "k2"))
        g.append(line(mx + i * 18, my, mx + i * 18, my + 72, "k2"))
    for (cx_, cy_) in [(0, 1), (1, 3), (2, 0), (3, 2)]:
        g.append(path(f"M{mx + cx_ * 18 + 4} {my + cy_ * 18 + 9}l4 5l7 -9", "k2"))
    g.append(text(mx + 36, my + 96, "ROUTE MAP", "ts", "middle"))
    # pool
    g.append(rect(400, 120, 196, 300, "ks", rx=14))
    g.append(text(414, 142, "LOW-COST POOL", "ts"))
    tiers = [(170, "CHEAPEST"), (262, "STRONGER"), (354, "TOP OF POOL")]
    for (ty, lab) in tiers:
        g.append(rect(424, ty - 24, 148, 48, "k", rx=8))
        g.append(text(498, ty + 5, lab, "t", "middle"))
    g.append(line(498, 194, 498, 238, "k2"))
    g.append(line(498, 286, 498, 330, "k2"))
    # frontier, outside the pool
    g.append(rect(424, 478, 148, 48, "ks", rx=8))
    g.append(text(498, 507, "FRONTIER", "t", "middle"))
    g.append(arrow([(498, 378), (498, 474)], "ks"))
    g.append(text(510, 452, "FLAGGED", "ts"))
    # check
    kx, ky, ks = 690, 262, 38
    g.append(path(f"M{kx - ks} {ky}L{kx} {ky - ks}L{kx + ks} {ky}L{kx} {ky + ks}Z", "k"))
    g.append(text(kx, ky + 5, "CHECK", "t", "middle"))
    # receipt + billing
    g.append(receipt_glyph(806, 132, 94, 104))
    g.append(text(853, 120, "RECEIPT", "ts", "middle"))
    g.append(rect(806, 352, 94, 84, "k", rx=3))
    for i in range(1, 4):
        g.append(line(806, 352 + i * 21, 900, 352 + i * 21, "k2"))
    g.append(line(846, 352, 846, 436, "k2"))
    g.append(text(853, 458, "BILLING", "ts", "middle"))
    # red: one request, start to finish
    g.append(arrow([(210, 315), (252, 315)], "r", o=0.04, dur=0.06))
    g.append(arrow([(330, 312), (370, 312), (370, 170), (420, 170)], "r", o=0.1, dur=0.12))
    # first attempt enters the check from the top
    g.append(arrow([(572, 170), (kx, 170), (kx, ky - ks - 3)], "r", o=0.22, dur=0.1))
    # the check fails: climb to a stronger model in the pool
    g.append(path(f"M{kx} {ky + ks + 2}C{kx} 336 612 304 578 276", "r", o=0.34, dur=0.1))
    g.append(path(arrow_head(578, 276, math.atan2(276 - 304, 578 - 612)), "r", o=0.43, dur=0.03))
    g.append(text(kx - 8, ky + ks + 40, "FAIL: CLIMB", "tr", "end", o=0.36, dur=0.05))
    # second attempt enters from the left
    g.append(arrow([(574, 248), (624, 248), (624, ky), (kx - ks - 3, ky)], "r", o=0.46, dur=0.08))
    # pass: out the right side to the receipt
    g.append(arrow([(kx + ks, ky), (760, ky), (760, 184), (802, 184)], "r", o=0.56, dur=0.1))
    g.append(text(kx + 46, ky - 10, "PASS", "tr", o=0.62, dur=0.05))
    g.append(path("M853 244V346M845 256l8 -12l8 12M845 334l8 12l8 -12", "r", o=0.7, dur=0.1))
    g.append(text(843, 300, "RECONCILED", "tr", "end", o=0.78, dur=0.06))
    return svg("decisions", "DECISIONS", "AGENTIC ROUTER", "".join(g))


# --------------------------------------------------------------- ROUTES --
ROUTES = [
    ("router", "AI SYSTEMS", 150),
    ("medicare", "DATA &amp; ANALYTICS", 270),
    ("deepfake", "ML &amp; VISION", 390),
    ("secure", "CLOUD &amp; SECURITY", 510),
]
CLASSIFY_ROWS = ["SIGNAL", "ENTERPRISE", "ARCHITECTURE", "MODELS", "DECISIONS"]


def plate_routes():
    g = []
    # incoming thread from the axis
    g.append(path(f"M{PIERCE[0]} {PIERCE[1] + 6}V236", "r", o=0.0, dur=0.12))
    # classifier
    x, y, w, h = 92, 238, 268, 236
    g.append(rect(x, y, w, h, "k", rx=12))
    g.append(line(x, y + 34, x + w, y + 34, "k"))
    g.append(text(x + 14, y + 23, "CLASSIFIER", "t"))
    g.append(text(x + w - 14, y + 23, "DWELL", "ts", "end"))
    for i, lab in enumerate(CLASSIFY_ROWS):
        ry = y + 66 + i * 36
        g.append(text(x + 14, ry + 4, lab, "ts t--row"))
        g.append(line(x + 132, ry, x + w - 16, ry, "k2 track"))
        # live bar: length set from the visitor's own reading time
        g.append(f'<line class="dwell-bar" data-row="{i}" x1="{x + 132}" y1="{ry}" '
                 f'x2="{x + 132}" y2="{ry}"/>')
    ox, oy = x + w, y + h / 2
    g.append(circle(ox, oy, 5, "k dot"))
    for slug, lab, py in ROUTES:
        d = f"M{ox + 6} {oy}H420C470 {oy} 470 {py} 520 {py}H{PORT_X - 12}"
        g.append(path(d, "ks route-base"))
        g.append(f'<path class="r r--route" data-route="{slug}" pathLength="1" d="{d}"/>')
        g.append(text(530, py - 12, lab, "t t--port"))
        g.append(circle(PORT_X, py, 9, "k port"))
        g.append(f'<circle class="port-ring" data-route="{slug}" cx="{PORT_X}" cy="{py}" r="17"/>')
    return svg("routes", "ROUTES", "FOUR PROJECTS", "".join(g))


PORT_X = 700  # the project links sit just right of these terminals (see home.js)


PLATES = {
    "signal": plate_signal,
    "enterprise": plate_enterprise,
    "architecture": plate_architecture,
    "models": plate_models,
    "decisions": plate_decisions,
    "routes": plate_routes,
}


def audio_path():
    pts = []
    for i in range(0, 1001, 4):
        t = i / 1000
        env = 0.35 + 0.65 * abs(math.sin(t * 9.5)) * (0.6 + 0.4 * math.sin(t * 31))
        a = 18 * env * math.sin(i * 0.9) + 3 * math.sin(i * 2.7)
        pts.append((i, 23 + a))
    return "M" + "L".join(f"{x} {y:.1f}" for x, y in pts)


def build_projects():
    """Deepfake Defender and Secure File-Sharing are assembled from _source;
    the other two project pages are edited directly."""
    df = (HERE / "deepfake.src.html").read_text(encoding="utf-8")
    strip = (HERE / "strip.svg").read_text(encoding="utf-8")
    # tools that copy SVG files may embed provenance metadata; it does not belong inline
    strip = re.sub(r"<metadata>.*?</metadata>", "", strip, flags=re.S)
    strip = re.sub(r'\s+xmlns:c2pa="[^"]*"', "", strip)
    df = (df.replace("<!--@strip-->", strip)
            .replace("<!--@wave-->", (HERE / "wave.txt").read_text(encoding="utf-8"))
            .replace("<!--@audio-->", audio_path()))
    sf = (HERE / "secure.src.html").read_text(encoding="utf-8")
    cells = []
    for r in range(6):
        for c in range(8):
            if (r, c) == (2, 3):
                cells.append('<div class="box box--open"><div class="box__inside"><i class="doc"></i></div>'
                             '<div class="door door--swing"><i class="key"></i><i class="hinge"></i></div></div>')
            else:
                cells.append('<div class="box"><div class="door"><i class="key"></i><i class="hinge"></i></div></div>')
    sf = sf.replace("<!--@vault-->", "".join(cells))
    for name, html in (("deepfake-defender", df), ("secure-file-sharing", sf)):
        if "<!--@" in html:
            raise SystemExit(f"unreplaced marker in {name}")
        (ROOT / "projects" / name / "index.html").write_text(html, encoding="utf-8")


def main():
    build_projects()
    src = (HERE / "index.src.html").read_text(encoding="utf-8")

    def sub(m):
        return PLATES[m.group(1)]()

    out = re.sub(r"<!--@plate:(\w+)-->", sub, src)
    if "<!--@plate:" in out:
        raise SystemExit("unreplaced plate marker")
    (ROOT / "index.html").write_text(out, encoding="utf-8")
    # also emit each plate on its own for inspection (with its labels as SVG text)
    global LABELS_AS_HTML
    LABELS_AS_HTML = False
    dbg = HERE / "plates"
    dbg.mkdir(exist_ok=True)
    for k, fn in PLATES.items():
        (dbg / f"{k}.svg").write_text(fn(), encoding="utf-8")
    print("wrote", ROOT / "index.html")


if __name__ == "__main__":
    main()
