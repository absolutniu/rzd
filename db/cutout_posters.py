"""Вырезать вагоны из «журнальных» постеров (вагон на бумаге) -> PNG с прозрачным фоном.

Фон — тёплая бумага с зерном, поэтому без нейросети: модель бумаги (размытие бумаги вокруг, вагон
исключён), отличие пикселя от бумаги в Lab -> мягкая альфа; дырки внутри силуэта заливаются; тонкие
штрихи «земли» под колёсами убираются; цвет на краях очищается от бумаги (без светлого ореола).

python cutout_posters.py [папка_постеров] [папка_результата]
по умолчанию exports/editorial_posters -> exports/editorial_posters/cutout/ (имена — как в exports/posters_refs)
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "exports" / "editorial_posters"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else SRC / "cutout"
T0, T1 = 7.0, 16.0   # ΔE от бумаги: ниже T0 — фон, выше T1 — вагон, между — полупрозрачный край
MARGIN = 24          # поля вокруг вагона в вырезке, px


def paper_model(lab, fg):
    """Бумага в каждой точке: нормированное размытие лишь по пикселям фона (вагон не «протекает»)."""
    w = (~fg).astype(np.float32)
    num = np.stack([cv2.GaussianBlur(lab[..., c] * w, (0, 0), 35) for c in range(3)], -1)
    den = cv2.GaussianBlur(w, (0, 0), 35)[..., None]
    glob = np.median(lab[~fg], axis=0)
    return np.where(den > 0.05, num / np.maximum(den, 1e-6), glob)


def cutout(path):
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab)
    # зерно бумаги гасим лёгким размытием только для оценки отличия
    lab_s = cv2.cvtColor(cv2.GaussianBlur(rgb, (0, 0), 1.2), cv2.COLOR_RGB2Lab)

    fg = np.zeros(lab.shape[:2], bool)
    for _ in range(2):  # бумага -> отличие -> уточнённая бумага
        de = np.linalg.norm(lab_s - paper_model(lab_s, ndi.binary_dilation(fg, iterations=12)), axis=-1)
        fg = de > T1
    alpha = np.clip((de - T0) / (T1 - T0), 0, 1)

    core = de > (T0 + T1) / 2
    core = ndi.binary_closing(core, structure=np.ones((5, 5)), iterations=2)
    lab_cc, n = ndi.label(core)
    if not n:
        raise ValueError("вагон не найден")
    sizes = ndi.sum(core, lab_cc, range(1, n + 1))
    main = np.isin(lab_cc, 1 + np.flatnonzero(sizes >= 0.02 * sizes.max()))
    near = ndi.binary_dilation(main, iterations=18)
    keep = np.isin(lab_cc, np.unique(lab_cc[near & core])) & core

    # «земля» — светлая полоса мазков с тонкими линиями рельсов прямо под колёсами. Колёса — тёмный графит
    # с вертикальными частями обода/спиц. Низ считаем по каждому столбцу: нижний тёмный вертикальный штрих рядом
    # (+ толщина обода), между тележками — по прямой от колеса к колесу (вагон в ракурсе: колёса на разной высоте)
    Hh, Ww = keep.shape
    dark = (lab[..., 0] < 42) & keep
    tall_dark = ndi.binary_opening(dark, structure=np.ones((11, 1)))
    low_dark = np.where(tall_dark.any(0), Hh - 1 - np.argmax(tall_dark[::-1], axis=0), -1)
    ky = np.nonzero(keep.any(1))[0]
    # только штрихи у самого низа (колёса), а не тёмные детали кузова — двери, поручни, надписи
    low_dark[low_dark < low_dark.max() - 0.25 * (ky.max() - ky.min())] = -1
    if (low_dark >= 0).sum() >= 10:
        win = ndi.maximum_filter1d(low_dark, 51)          # ±25 px: весь обод колеса
        cols = np.nonzero(win >= 0)[0]
        bottom_x = np.interp(np.arange(Ww), cols, win[cols]) + 7
    else:  # запасной вариант: нижняя строка «высокого» (не тонкие горизонтальные штрихи)
        tall = ndi.binary_opening(keep, structure=np.ones((17, 1)))
        rows = np.nonzero(tall.any(1))[0]
        bottom_x = np.full(Ww, rows.max() + 2 if len(rows) else Hh)
    yy = np.arange(Hh)[:, None]
    above = yy < bottom_x[None, :]
    bottom = int(bottom_x.max())

    # GrabCut: уверенный вагон — сильное отличие от бумаги, вероятный — внутри силуэта и всё, что хоть чуть
    # отличается от бумаги (бледные цистерны с еле заметным контуром), бумага — вне рамки объекта
    ys, xs = np.nonzero(keep & above)
    y0, y1, x0, x1 = max(ys.min() - 30, 0), min(bottom, Hh), max(xs.min() - 30, 0), min(xs.max() + 31, Ww)
    m = np.full(keep.shape, cv2.GC_BGD, np.uint8)
    m[y0:y1, x0:x1] = cv2.GC_PR_BGD
    closed = ndi.binary_closing(keep, structure=cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)).astype(bool))
    filled = ndi.binary_fill_holes(closed | keep)
    m[(filled | (de > 3.5)) & above & (m == cv2.GC_PR_BGD)] = cv2.GC_PR_FGD
    m[ndi.binary_erosion(de > T1 + 6, iterations=1) & keep & above] = cv2.GC_FGD
    k = 0.5
    small = cv2.resize(bgr, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    ms = cv2.resize(m, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(small, ms, None, bgd, fgd, 8, cv2.GC_INIT_WITH_MASK)
    gc = cv2.resize(((ms == cv2.GC_FGD) | (ms == cv2.GC_PR_FGD)).astype(np.uint8), (Ww, Hh),
                    interpolation=cv2.INTER_LINEAR) > 0
    gc = ndi.binary_opening(gc, iterations=1)
    lab_g, ng = ndi.label(gc)
    if ng:
        sz = ndi.sum(gc, lab_g, range(1, ng + 1))
        gc = np.isin(lab_g, 1 + np.flatnonzero(sz >= 0.01 * sz.max()))
    obj = (gc | (keep & ndi.binary_dilation(gc, iterations=6))) & above
    # у самого низа оставляем только «высокое» (колёса, сцепки), тонкие штрихи земли между колёсами — нет
    low = yy >= (bottom_x[None, :] - 28)
    obj &= ~low | ndi.binary_dilation(ndi.binary_opening(obj, structure=np.ones((17, 1))), iterations=3)
    # под рамой между тележками GrabCut иногда забирает бумагу: в нижней трети вагона убираем участки цвета
    # бумаги, связанные с внешним фоном (корпус сверху не трогаем — у белых цистерн он почти цвета бумаги)
    ky = np.nonzero(obj.any(1))[0]
    band = yy >= (bottom_x[None, :] - 0.33 * (ky.max() - ky.min()))
    paperish = (de < 5.5) & band
    lbl, _ = ndi.label(paperish | ~obj)
    outside = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
    obj &= ~(np.isin(lbl, outside[outside > 0]) & paperish)
    obj = ndi.binary_opening(obj, iterations=1) | (obj & (de > T1))
    holes = ndi.binary_fill_holes(obj) & ~obj           # мелкие точки бумаги внутри — заливаем, просветы стоек — нет
    hl, nh = ndi.label(holes)
    if nh:
        hs = ndi.sum(holes, hl, range(1, nh + 1))
        obj |= np.isin(hl, 1 + np.flatnonzero(hs < 300))

    region = ndi.binary_dilation(obj, iterations=2)
    a = np.where(ndi.binary_erosion(obj, iterations=2), 1.0, np.maximum(alpha, obj * 0.85)) * region
    a = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 0.7) * region
    filled = obj

    # цвет краёв без примеси бумаги: C = (I - (1-a)·бумага) / a
    paper_rgb = cv2.cvtColor(paper_model(lab, ndi.binary_dilation(filled, iterations=12)).astype(np.float32), cv2.COLOR_Lab2RGB)
    aa = np.clip(a, 1e-3, 1)[..., None]
    col = np.clip((rgb - (1 - aa) * paper_rgb) / aa, 0, 1)
    col = np.where(a[..., None] > 0.98, rgb, col)

    ys, xs = np.nonzero(a > 0.02)
    y0, y1 = max(ys.min() - MARGIN, 0), min(ys.max() + MARGIN + 1, a.shape[0])
    x0, x1 = max(xs.min() - MARGIN, 0), min(xs.max() + MARGIN + 1, a.shape[1])
    rgba = np.dstack([col, a])[y0:y1, x0:x1]
    out = cv2.cvtColor((rgba * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGBA2BGRA)
    return out, (x0, y0, x1, y1)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(SRC.glob("poster_*.png"))
    # имена как в наборе референсов (exports/posters_refs: «07_Полувагон_НПК_УВЗ_12-132»), номер постера = номер референса
    refs = {p.name[:2]: p.stem for p in (ROOT / "exports" / "posters_refs").glob("*.jpg")}
    for f in files:
        img, box = cutout(f)
        name = refs.get(f.stem[-2:], f.stem) + ".png"
        ok, buf = cv2.imencode(".png", img)  # imwrite не умеет кириллицу в пути на Windows
        (OUT / name).write_bytes(buf.tobytes())
        print(f"{f.name}: {img.shape[1]}×{img.shape[0]} (рамка {box})", flush=True)
    print(f"-> {len(files)} файлов в {OUT}")
