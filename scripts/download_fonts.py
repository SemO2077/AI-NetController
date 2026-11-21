#!/usr/bin/env python3
"""
AI NetController - Offline Typography Downloader
Downloads self-hosted WOFF2 fonts and generates apps/web font stylesheets.
"""

import os
import re
import urllib.request

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(ROOT_DIR, 'apps', 'web', 'public', 'fonts')
FONT_CSS_URL = (
    'https://fonts.googleapis.com/css2?'
    'family=JetBrains+Mono:wght@400;600;700&'
    'family=Onest:wght@400;500;600;700;800&'
    'family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap'
)
WANTED_SUBSETS = {'cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'}
HTTP_TIMEOUT_S = 30


def main() -> None:
    os.makedirs(FONTS_DIR, exist_ok=True)

    req = urllib.request.Request(
        FONT_CSS_URL,
        headers={
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            )
        },
    )

    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
        css = resp.read().decode('utf-8')

    pattern = re.compile(r'/\* ([^*]+) \*/\s*@font-face\s*\{([^}]+)\}', re.MULTILINE)
    blocks = pattern.findall(css)

    local_css_rules = []
    downloaded = 0

    for subset, body in blocks:
        subset = subset.strip()
        if subset not in WANTED_SUBSETS:
            continue

        url_match = re.search(r'url\((https://[^)]+\.woff2)\)', body)
        if not url_match:
            continue

        remote_url = url_match.group(1)

        fam_match = re.search(r"font-family:\s*['\"]?([^'\";]+)['\"]?", body)
        weight_match = re.search(r"font-weight:\s*([^;]+);", body)
        style_match = re.search(r"font-style:\s*([^;]+);", body)

        family = fam_match.group(1).replace(' ', '_') if fam_match else 'Font'
        weight = weight_match.group(1).strip() if weight_match else '400'
        style = style_match.group(1).strip() if style_match else 'normal'

        filename = f"{family}_{subset}_{weight}_{style}.woff2"
        filepath = os.path.join(FONTS_DIR, filename)

        if not os.path.exists(filepath):
            print(f"Downloading {filename} from {remote_url}...")
            req_f = urllib.request.Request(remote_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req_f, timeout=HTTP_TIMEOUT_S) as fresp:
                with open(filepath, 'wb') as out_f:
                    out_f.write(fresp.read())
            downloaded += 1

        # Replace remote url with relative path matching Vite base: './'
        new_body = re.sub(r'url\(https://[^)]+\.woff2\)', f'url("./fonts/{filename}")', body)
        local_css_rules.append(f"/* {subset} */\n@font-face {{\n{new_body.strip()}\n}}")

    css_content = (
        "/* Offline Self-Hosted Typography Engine for AI NetController */\n\n"
        + "\n\n".join(local_css_rules)
        + "\n"
    )
    public_fonts_css_path = os.path.join(ROOT_DIR, 'apps', 'web', 'public', 'fonts.css')
    os.makedirs(os.path.dirname(public_fonts_css_path), exist_ok=True)
    with open(public_fonts_css_path, 'w', encoding='utf-8') as f:
        f.write(css_content)

    print(
        f"SUCCESS: Downloaded {downloaded} font files into {FONTS_DIR} "
        f"and created {public_fonts_css_path}"
    )


if __name__ == '__main__':
    main()
