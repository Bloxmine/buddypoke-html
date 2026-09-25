# Extracts the preset buddies from the Customization window SWF
# (PresetsWindow_presetsZ, a zlib-compressed XML list) into assets/presets.json.
#   python3 tools/build_presets.py [presetsZ.bin]
import sys, zlib, json
import xml.etree.ElementTree as ET
src = sys.argv[1] if len(sys.argv) > 1 else 'extract/v2/presetsZ.bin'
root = ET.fromstring(zlib.decompress(open(src, 'rb').read()))
presets = [{'name': p.get('name'), 'code': p.get('buddy')} for p in root.findall('preset')]
json.dump(presets, open('assets/presets.json', 'w'), indent=0)
print(len(presets), 'presets')
