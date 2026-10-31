# Draws Snake's pixel-art icon set into the given assets folder (needs Pillow).
# Usage: python3 scripts/make-snake-icons.py assets
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
LCD = (199, 217, 163, 255)
INK = (38, 51, 28, 255)

# 12x12 grid: S-shaped snake heading right, with an apple.
SNAKE = [(2,3),(3,3),(4,3),(5,3),(6,3),(7,3),(8,3),(8,4),(8,5),(7,5),(6,5),(5,5),(4,5),(3,5),
         (3,6),(3,7),(4,7),(5,7),(6,7),(7,7),(8,7)]
HEAD = (9,7)
FOOD = (9,3)

def draw(size, art_width, bg, ink, transparent=False):
    """Centres the art in a size x size image, art_width pixels wide."""
    img = Image.new('RGBA', (size, size), (0,0,0,0) if transparent else bg)
    d = ImageDraw.Draw(img)
    cells = SNAKE + [HEAD, FOOD]
    min_x = min(x for x, _ in cells); max_x = max(x for x, _ in cells)
    min_y = min(y for _, y in cells); max_y = max(y for _, y in cells)
    cell = art_width / (max_x - min_x + 1)
    ox = (size - cell * (max_x - min_x + 1)) / 2 - min_x * cell
    oy = (size - cell * (max_y - min_y + 1)) / 2 - min_y * cell
    gap = max(1, round(cell * 0.12))
    def box(x, y, shrink=0):
        x0 = ox + x * cell + gap + shrink
        y0 = oy + y * cell + gap + shrink
        return [x0, y0, x0 + cell - 2*gap - 2*shrink, y0 + cell - 2*gap - 2*shrink]
    for x, y in SNAKE:
        d.rectangle(box(x, y), fill=ink)
    hx, hy = HEAD
    d.rounded_rectangle(box(hx, hy), radius=cell*0.25, fill=ink)
    ex = ox + hx*cell + cell*0.55; ey = oy + hy*cell + cell*0.3
    d.ellipse([ex, ey, ex + cell*0.18, ey + cell*0.18], fill=(0,0,0,0) if transparent else bg)
    d.ellipse(box(*FOOD, shrink=cell*0.12), fill=ink)
    return img

# iOS / generic icon: full bleed, the art inset a little.
draw(1024, 760, LCD, INK).convert('RGB').save(f'{out}/icon.png')
# Android adaptive: background colour, foreground inside the 66% safe zone.
Image.new('RGBA', (512, 512), LCD).save(f'{out}/android-icon-background.png')
draw(512, 300, LCD, INK, transparent=True).save(f'{out}/android-icon-foreground.png')
draw(432, 254, LCD, (255,255,255,255), transparent=True).save(f'{out}/android-icon-monochrome.png')
draw(1024, 600, LCD, INK, transparent=True).save(f'{out}/splash-icon.png')
draw(48, 40, LCD, INK).save(f'{out}/favicon.png')
print('ok')
