import urllib.request
import re
import os

FONTS_DIR = os.path.abspath('apps/web/public/fonts')
os.makedirs(FONTS_DIR, exist_ok=True)

url = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Onest:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})

with urllib.request.urlopen(req) as resp:
    css = resp.read().decode('utf-8')

# Only keep cyrillic, cyrillic-ext, latin, latin-ext
wanted_subsets = {'cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'}

# Parse @font-face blocks
pattern = re.compile(r'/\* ([^*]+) \*/\s*@font-face\s*\{([^}]+)\}', re.MULTILINE)
blocks = pattern.findall(css)

local_css_rules = []
downloaded = 0

for subset, body in blocks:
    subset = subset.strip()
    if subset not in wanted_subsets:
        continue
    
    # Extract url(...)
    url_match = re.search(r'url\((https://[^)]+\.woff2)\)', body)
    if not url_match:
        continue
    
    remote_url = url_match.group(1)
    
    # Extract family, weight, style
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
        with urllib.request.urlopen(req_f) as fresp:
            with open(filepath, 'wb') as out_f:
                out_f.write(fresp.read())
        downloaded += 1
    
    # Replace remote url with relative path
    # In fonts.css, path will be /fonts/<filename> or ./fonts/<filename>
    new_body = re.sub(r'url\(https://[^)]+\.woff2\)', f'url("/fonts/{filename}")', body)
    local_css_rules.append(f"/* {subset} */\n@font-face {{\n{new_body.strip()}\n}}")

fonts_css_path = os.path.abspath('apps/web/src/fonts.css')
with open(fonts_css_path, 'w', encoding='utf-8') as f:
    f.write("/* Offline Self-Hosted Typography Engine for AI NetController */\n\n" + "\n\n".join(local_css_rules) + "\n")

print(f"SUCCESS: Downloaded {downloaded} font files into {FONTS_DIR} and created {fonts_css_path}")
