import sys, asyncio
from playwright.sync_api import sync_playwright
def render_many(jobs):
    """jobs: list of (svg_text, out_png, width, height)"""
    with sync_playwright() as p:
        b=p.chromium.launch()
        pg=b.new_page(device_scale_factor=1)
        for svg, out, W, H in jobs:
            pg.set_viewport_size({'width':W,'height':H})
            html=f'<!doctype html><html><head><style>html,body{{margin:0;padding:0;background:transparent;overflow:hidden}}svg{{display:block;width:{W}px;height:{H}px}}</style></head><body>{svg}</body></html>'
            pg.set_content(html)
            pg.screenshot(path=out, omit_background=True, clip={'x':0,'y':0,'width':W,'height':H})
        b.close()
if __name__=='__main__':
    svg=open(sys.argv[1]).read(); W=int(sys.argv[3]); H=int(sys.argv[4])
    render_many([(svg, sys.argv[2], W, H)])
