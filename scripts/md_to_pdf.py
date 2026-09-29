"""Render a Markdown document to a compact A4 PDF with a local headless browser (dev tool).

Usage:  python scripts/md_to_pdf.py docs/ARCHITECTURE.md docs/ARCHITECTURE.pdf
Needs:  pip install markdown ; Edge or Chrome installed.
"""

import subprocess
import sys
from pathlib import Path

import markdown

CSS = """
@page { size: A4; margin: 11mm 12mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8.6pt; line-height: 1.32; color: #111; }
h1 { font-size: 14pt; margin: 0 0 3px; } h2 { font-size: 10.5pt; margin: 8px 0 3px; border-bottom: 1px solid #999; }
p { margin: 3px 0; } ul, ol { margin: 2px 0 2px 16px; padding: 0; } li { margin: 1px 0; }
table { border-collapse: collapse; width: 100%; margin: 3px 0; }
td, th { border: 1px solid #bbb; padding: 2px 4px; vertical-align: top; text-align: left; }
th { background: #eee; }
pre { font-family: Consolas, monospace; font-size: 6.2pt; line-height: 1.15; background: #f4f6f8; padding: 4px; margin: 3px 0; }
code { font-family: Consolas, monospace; font-size: 8pt; }
"""

BROWSERS = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe"]


def main(src: str, dst: str):
    html = markdown.markdown(Path(src).read_text(encoding="utf-8"), extensions=["tables", "fenced_code"])
    tmp = Path(dst).with_suffix(".html")
    tmp.write_text(f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{html}</body></html>",
                   encoding="utf-8")
    exe = next(b for b in BROWSERS if Path(b).exists())
    subprocess.run([exe, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={Path(dst).resolve()}", tmp.resolve().as_uri()], check=True, timeout=120)
    tmp.unlink()
    print("wrote", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
