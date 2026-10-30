from pathlib import Path
import subprocess
import sys
import zipfile
root=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,'-B',str(root/'scripts/check-release.py')],check=True)
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
out=root/'dist/ai-outfit-studio.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for f in files:
  if f and (root/f).is_file() and not f.startswith(('.github/','dist/','.git/')):
   z.write(root/f,'ai-outfit-studio/'+f)
print(out)
