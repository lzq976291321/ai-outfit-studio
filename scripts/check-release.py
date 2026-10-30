from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
files=[p for p in root.rglob('*') if p.is_file() and not any(x in p.relative_to(root).parts for x in ('.git','.vercel','dist','__pycache__'))]
for p in files:
 rel=str(p.relative_to(root))
 assert not any(x in rel for x in ('auth.json','.env','costumes-source','poses-source','validation/','thumb-cache')), rel
 if p.suffix not in ('.png', '.zip'):
  text=p.read_text()
  assert ('/'+'Users/') not in text, rel
  assert not re.search(r'sk-[A-Za-z0-9]{20,}|Bearer eyJ[A-Za-z0-9_-]+',text), rel
for f in ('site/index.html','site/style.css','site/assets/outfit.png','prototype/data/catalog.json','prototype/data/poses.json'):
 assert (root/f).is_file(), f
print(f'Release scan passed: {len(files)} files')
