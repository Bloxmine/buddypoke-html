# Extracts the data defined in the inner material SWF's document class
# (dog.as frame1) into assets/library.json.
#   python3 tools/build_library.py [path/to/dog.as]
import re, json, sys
src = open(sys.argv[1] if len(sys.argv) > 1 else 'extract/v2/pkg/chick_swf/scripts/dog.as').read()
body = src[src.index('internal function frame1()'):]

rects = {m.group(1): [int(v) for v in m.group(2, 3, 4, 5)] for m in re.finditer(r'(\w+ClipRect) = new Rectangle\((\d+),(\d+),(\d+),(\d+)\);', body)}
clip = {}
for m in re.finditer(r'"name":"([^"]+)",\s*"rect":(\w+)', body):
    clip[m.group(1)] = rects[m.group(2)]

filters = {m.group(1): [float(v) for v in m.group(2).split(',')] for m in re.finditer(r'(\w+) = new ColorMatrixFilter\(\[([^\]]+)\]\);', body)}
arrays = {}
for m in re.finditer(r'(select\w+) = \[([^\]]+)\];', body, re.S):
    arrays[m.group(1)] = [filters[n.strip()] for n in m.group(2).replace('\n', '').split(',') if n.strip()]
color_options = {}
for m in re.finditer(r'"name":"([^"]+)",\s*"colorMat":(\w+),\s*"palette":(\w+)', body):
    color_options[m.group(1)] = {'colorMat': arrays[m.group(2)], 'palette': m.group(3)}

mask_arrays = {m.group(1): json.loads('[' + m.group(2) + ']') for m in re.finditer(r'(Mask_\w+) = \[([^\]]*)\];', body)}
masks = {}
for m in re.finditer(r'"name":"(Mask_\w+)",\s*"mask":(Mask_\w+)', body):
    masks[m.group(1)] = mask_arrays[m.group(2)]
lightmaps = {m.group(1): m.group(2) for m in re.finditer(r'"name":"([^"]+Lightmap)",\s*"symbol":"(\w+)"', body)}

out = {'clipRects': clip, 'colorOptions': color_options, 'masks': masks, 'lightmaps': lightmaps, 'filters': filters}
json.dump(out, open('assets/library.json', 'w'), separators=(',', ':'))
print('clipRects', len(clip), 'colorOptions', {k: len(v['colorMat']) for k, v in color_options.items()}, 'masks', len(masks), 'lightmaps', lightmaps)
