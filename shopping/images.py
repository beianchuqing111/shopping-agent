"""本地生成的商品示意图（SVG），不依赖网络、不使用他人商品照片。

每个商品有 3 个视角：0 正面 / 1 四分之三视图 / 2 细节特写。
颜色由商品 id 稳定推导，所以同一件商品每次渲染完全一致。
"""

import hashlib

VIEWS = 3


def _palette(seed: str):
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    hue = digest[0] * 360 // 256
    hue2 = (hue + 34) % 360
    return (
        f"hsl({hue} 62% 46%)",
        f"hsl({hue} 34% 92%)",
        f"hsl({hue2} 70% 58%)",
        f"hsl({hue} 40% 22%)",
    )


def _headphones(line, fill, accent):
    return f"""
  <path d="M108 252 C108 148 150 104 200 104 C250 104 292 148 292 252" fill="none" stroke="{line}" stroke-width="18" stroke-linecap="round"/>
  <rect x="78" y="234" width="62" height="96" rx="30" fill="{fill}" stroke="{line}" stroke-width="7"/>
  <rect x="260" y="234" width="62" height="96" rx="30" fill="{fill}" stroke="{line}" stroke-width="7"/>
  <rect x="96" y="252" width="26" height="60" rx="13" fill="{accent}" opacity="0.75"/>
  <rect x="278" y="252" width="26" height="60" rx="13" fill="{accent}" opacity="0.75"/>
  <circle cx="200" cy="104" r="6" fill="{accent}"/>"""


def _speaker(line, fill, accent):
    return f"""
  <rect x="102" y="132" width="196" height="176" rx="26" fill="{fill}" stroke="{line}" stroke-width="7"/>
  <circle cx="200" cy="196" r="40" fill="none" stroke="{line}" stroke-width="7"/>
  <circle cx="200" cy="196" r="15" fill="{accent}" opacity="0.8"/>
  <circle cx="200" cy="272" r="21" fill="none" stroke="{line}" stroke-width="6"/>
  <rect x="176" y="112" width="48" height="8" rx="4" fill="{accent}" opacity="0.7"/>"""


def _keyboard(line, fill, accent):
    keys = []
    for row in range(4):
        for col in range(11):
            if row == 3 and col > 6:
                continue
            keys.append(
                f'<rect x="{82 + col * 22}" y="{196 + row * 22}" width="18" height="18" rx="4" '
                f'fill="{accent}" opacity="{0.35 + (0.1 * ((row + col) % 3))}"/>'
            )
    return f"""
  <rect x="72" y="182" width="256" height="104" rx="16" fill="{fill}" stroke="{line}" stroke-width="7"/>
  {''.join(keys)}
  <rect x="72" y="182" width="256" height="14" rx="7" fill="{accent}" opacity="0.5"/>"""


def _mouse(line, fill, accent):
    return f"""
  <path d="M200 116 C258 116 286 158 286 216 C286 274 252 300 200 300 C148 300 114 274 114 216 C114 158 142 116 200 116 Z" fill="{fill}" stroke="{line}" stroke-width="7"/>
  <path d="M200 116 L200 200" stroke="{line}" stroke-width="6"/>
  <rect x="192" y="136" width="16" height="40" rx="8" fill="{accent}" opacity="0.85"/>
  <path d="M114 210 L286 210" stroke="{line}" stroke-width="5" opacity="0.5"/>"""


def _monitor(line, fill, accent):
    return f"""
  <rect x="66" y="112" width="268" height="164" rx="14" fill="{fill}" stroke="{line}" stroke-width="7"/>
  <rect x="84" y="130" width="232" height="128" rx="6" fill="{accent}" opacity="0.28"/>
  <path d="M126 226 L176 172 L212 208 L246 168 L282 226 Z" fill="{accent}" opacity="0.55"/>
  <path d="M182 276 L182 306 M218 276 L218 306" stroke="{line}" stroke-width="9" stroke-linecap="round"/>
  <rect x="150" y="300" width="100" height="12" rx="6" fill="{line}"/>"""


def _microphone(line, fill, accent):
    grille = "".join(
        f'<path d="M{172 + i * 14} 118 L{172 + i * 14} 176" stroke="{line}" stroke-width="3" opacity="0.45"/>'
        for i in range(5)
    )
    return f"""
  <rect x="166" y="96" width="68" height="140" rx="34" fill="{fill}" stroke="{line}" stroke-width="7"/>
  {grille}
  <path d="M138 190 C138 244 168 268 200 268 C232 268 262 244 262 190" fill="none" stroke="{line}" stroke-width="7"/>
  <path d="M200 268 L200 306" stroke="{line}" stroke-width="8" stroke-linecap="round"/>
  <rect x="156" y="302" width="88" height="12" rx="6" fill="{line}"/>
  <circle cx="200" cy="126" r="10" fill="{accent}" opacity="0.8"/>"""


def _accessory(line, fill, accent):
    return f"""
  <rect x="86" y="168" width="228" height="140" rx="20" fill="{fill}" stroke="{line}" stroke-width="7"/>
  <path d="M86 208 L314 208" stroke="{line}" stroke-width="5" opacity="0.5"/>
  <path d="M126 244 C158 214 186 274 218 244 C244 220 262 258 282 240" fill="none" stroke="{accent}" stroke-width="8" stroke-linecap="round"/>
  <circle cx="126" cy="188" r="10" fill="{accent}" opacity="0.8"/>
  <circle cx="162" cy="188" r="10" fill="{accent}" opacity="0.55"/>"""


ART = {
    "headphones": _headphones,
    "speaker": _speaker,
    "keyboard": _keyboard,
    "mouse": _mouse,
    "monitor": _monitor,
    "microphone": _microphone,
    "accessory": _accessory,
}

VIEW_TRANSFORM = (
    'translate(0 0)',
    'rotate(-9 200 210) translate(14 4) scale(0.93) translate(16 14)',
    'scale(1.55) translate(-76 -66) rotate(6 200 210)',
)


def _esc(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render(product, view=0):
    """Return an SVG string for one product view (0..2)."""
    view = max(0, min(VIEWS - 1, int(view)))
    line, fill, accent, dark = _palette(product["id"] + str(view))
    art = ART.get(product.get("category", ""), _accessory)(line, fill, accent)
    brand = _esc(product.get("brand", ""))
    sku = _esc(product.get("sku") or product.get("id", ""))
    label = ("正面", "四分之三视图", "细节特写")[view]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="{_esc(product.get('title',''))} {label}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{fill}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="62%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="{fill}" stop-opacity="0.25"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <rect width="400" height="400" fill="url(#glow)"/>
  <ellipse cx="200" cy="322" rx="118" ry="18" fill="{dark}" opacity="0.10"/>
  <g transform="{VIEW_TRANSFORM[view]}">{art}
  </g>
  <text x="26" y="46" font-family="Helvetica,Arial,sans-serif" font-size="15" font-weight="600" fill="{dark}" opacity="0.55">{brand}</text>
  <text x="26" y="70" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="{dark}" opacity="0.38">{sku} · {label}</text>
  <text x="374" y="378" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="{dark}" opacity="0.32">自建示意图</text>
</svg>
"""
