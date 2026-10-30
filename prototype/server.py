"""Ephemeral localhost image-to-image demo; Python standard library only."""
import base64
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GENERATIONS = threading.BoundedSemaphore(2)


GALLERIES = ('ai-costume-gallery.pages.dev', 'ai-pose-gallery.pages.dev')


def remote_bytes(url):
    result = subprocess.run(['curl', '-sS', '--max-time', '45', '--max-filesize', '12000000', '--proto', '=https', '--config', '-', '-w', '\n%{http_code}'], input=('url = ' + json.dumps(url) + '\n').encode(), capture_output=True, timeout=50)
    raw, _, status = result.stdout.rpartition(b'\n')
    if result.returncode or status != b'200' or len(raw) > 12_000_000:
        raise ValueError('在线图库暂不可用，请稍后重试')
    return raw


def online_catalog(kind):
    if kind == 'catalog':
        html = remote_bytes('https://ai-costume-gallery.pages.dev/').decode()
        match = re.search(r'const\s+D\s*=\s*', html)
        if not match:
            raise ValueError('在线穿搭库结构已变化')
        data, _ = json.JSONDecoder().raw_decode(html[match.end():])
    else:
        data = json.loads(remote_bytes('https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/pose-zh.json'))
        data = [p for p in data if p.get('体系') == '全身单人・标准系']
    if not isinstance(data, list) or not data:
        raise ValueError('在线图库数据无效')
    return json.dumps(data, ensure_ascii=False).encode()


def reference_image(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc not in GALLERIES or parsed.query or parsed.fragment or not re.fullmatch(r'/img/[A-Za-z0-9_-]+\.(png|webp)', parsed.path):
        raise ValueError('仅支持所选在线图库原图')
    raw = remote_bytes(url)
    mime = 'image/png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else 'image/webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None
    if not mime or len(raw) > 8_000_000:
        raise ValueError('图库图片格式或大小不支持')
    return {'image': 'data:' + mime + ';base64,' + base64.b64encode(raw).decode()}


class LocalGenerationError(ValueError):
    def __init__(self, output):
        super().__init__(output.get('error', '本机生成失败'))
        self.output = output


def local_chatgpt(data):
    try:
        result = subprocess.run(['node', str(ROOT / 'local-chatgpt.mjs')], input=json.dumps(data), text=True, capture_output=True, timeout=260)
    except FileNotFoundError:
        raise ValueError('本机连接需要 Node.js 20 或以上版本')
    except subprocess.TimeoutExpired:
        raise ValueError('生成等待超时，请先核对上游结果，不会自动重试')
    try:
        output = json.loads(result.stdout)
    except ValueError:
        raise ValueError('本机连接未返回有效结果')
    if result.returncode or output.get('error'):
        raise LocalGenerationError(output)
    return output


def generate(data):
    if any(field in data for field in ('protocol', 'endpoint', 'model', 'key')):
        raise ValueError('仅支持本机 ChatGPT，不接受接口配置')
    refs = data.get('references', [])
    if not isinstance(refs, list) or not 1 <= len(refs) <= 3:
        raise ValueError('请选择穿搭图')
    images = []
    for ref in refs:
        if not isinstance(ref, str) or not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+', ref):
            raise ValueError('仅支持 PNG、JPEG、WebP')
        raw = base64.b64decode(ref.split(',', 1)[1], validate=True)
        if not 0 < len(raw) <= 8_000_000:
            raise ValueError('每张图片最多 8 MB')
        mime = 'image/png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if raw.startswith(b'\xff\xd8') else 'image/webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None
        if not mime:
            raise ValueError('无效图片内容')
        images.append((mime, raw))
    pose = str(data.get('pose', '自然站立'))[:100]
    style = str(data.get('style', '自然手机感'))[:100]
    extra = str(data.get('extra', ''))[:1500]
    styles = json.loads((ROOT / 'photography_styles.json').read_text(encoding='utf-8'))
    if style not in styles:
        raise ValueError('请选择支持的摄影风格')
    photography = '\n'.join(f'【{section}】{text}' for section, text in styles[style].items())
    prompt = ('根据图片1的整套穿搭，生成成年人物全身穿搭照片。保持衣物款式、颜色、材质及鞋袜配件；不要带入平铺背景。'
              + ('图片2仅用于人物身份及体型参考，保持其人脸与体型。' if data.get('hasPerson') else '人物为虚构成年人。')
              + (f'图片{len(images)}仅用于姿势与构图参考，不复制其人物身份、衣着或背景。' if data.get('hasPose') else '')
              + '姿势：' + pose + '。摄影风格：' + style + '。9:16手机竖图，头顶和鞋底完整留边。'
              + '\n【摄影风格细则】\n' + photography
              + '\n【共同约束】衣物款式与参考人物身份优先，所选姿势优先于风格建议。肢体结构、接触关系与透视可信。无文字、水印、相机界面或拼图。'
              + '\n【用户补充要求】' + extra)
    return local_chatgpt({'action': 'generate', 'prompt': prompt, 'references': refs})


SAVE_DIR = Path.home() / 'Downloads' / '衣见成片'


def save_generated_result(result, target, name='穿搭照'):
    """Only final outputs from this generation request may be auto-saved."""
    if target != 'desktop-local':
        return result
    image = result.get('image', '')
    match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', image)
    if not match:
        return {**result, 'saveError': '自动保存失败，请手动下载这张成片'}
    output = None
    created = False
    try:
        raw = base64.b64decode(match[2], validate=True)
        if not 0 < len(raw) <= 25_000_000:
            raise ValueError('invalid output')
        mime = 'png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else 'jpeg' if raw.startswith(b'\xff\xd8') else 'webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None
        if mime != match[1]:
            raise ValueError('invalid image')
        safe = re.sub(r'[^\w\u4e00-\u9fff-]+', '-', str(name), flags=re.UNICODE).strip('-_')[:45] or '穿搭照'
        filename = time.strftime('%Y%m%d-%H%M%S') + '-' + safe + '-' + secrets.token_hex(6) + '.' + ('jpg' if mime == 'jpeg' else mime)
        SAVE_DIR.mkdir(parents=True, exist_ok=True)
        output = SAVE_DIR / filename
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        with os.fdopen(fd, 'wb') as file:
            file.write(raw)
        return {**result, 'savedTo': str(output), 'savedName': filename}
    except (OSError, ValueError):
        if created and output is not None:
            try:
                output.unlink(missing_ok=True)
            except OSError:
                pass
        # The image remains usable even if disk saving fails. Never repeat generation.
        return {**result, 'saveError': '图片已生成，自动保存失败，请手动下载'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body, mime='application/json; charset=utf-8'):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/prototype/': ('index.html', 'text/html; charset=utf-8'), '/prototype/index.html': ('index.html', 'text/html; charset=utf-8'), '/prototype/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/prototype/style.css': ('style.css', 'text/css; charset=utf-8'), '/prototype/vendor/anime-4.5.0.min.js': ('vendor/anime-4.5.0.min.js', 'text/javascript; charset=utf-8')}
        entry = files.get(urllib.parse.urlsplit(self.path).path)
        path = urllib.parse.urlsplit(self.path).path
        if path in ('/prototype/data/catalog.json', '/prototype/data/poses.json'):
            try:
                return self.send(200, online_catalog('catalog' if path.endswith('catalog.json') else 'poses'))
            except Exception:
                return self.send(502, {'error': '在线图库加载失败，请稍后重试'})
        if not entry:
            return self.send(404, {'error': 'Not found'})
        self.send(200, (ROOT / entry[0]).read_bytes(), entry[1])

    def do_POST(self):
        if self.path not in ('/api/generate', '/api/local-chatgpt/connect', '/api/reference'):
            return self.send(404, {'error': 'Not found'})
        if self.headers.get('Host') not in (f'localhost:{self.server.server_port}', f'127.0.0.1:{self.server.server_port}') or self.headers.get('Origin') not in (f'http://localhost:{self.server.server_port}', f'http://127.0.0.1:{self.server.server_port}'):
            return self.send(403, {'error': '仅允许本机页面请求'})
        slot = self.path == '/api/generate'
        if slot and not GENERATIONS.acquire(blocking=False):
            return self.send(429, {'error': '已有两个生成任务处理中，请稍后手动提交'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 34_000_000:
                raise ValueError('请求大小不允许')
            data = json.loads(self.rfile.read(size))
            if self.path == '/api/reference':
                result = reference_image(data.get('url', ''))
            elif self.path == '/api/local-chatgpt/connect':
                result = local_chatgpt({'action': 'connect'})
            else:
                result = save_generated_result(generate(data), data.get('saveTarget'), data.get('outfitName', '穿搭照'))
            self.send(200, result)
        except LocalGenerationError as exc:
            self.send(400 if exc.output.get('errorCode') == 'CONTENT_REJECTED' else 502, {key: exc.output[key] for key in ('error', 'errorCode', 'diagnostics') if key in exc.output})
        except (ValueError, TypeError, AttributeError) as exc:
            # Only locally authored messages are exposed; never echo upstream content.
            message = str(exc) if type(exc) is ValueError and not isinstance(exc, json.JSONDecodeError) else '输入或返回格式无效'
            self.send(400, {'error': message[:180]})
        except Exception:
            self.send(502, {'error': '请求中断或上游响应异常，执行与计费结果待核对；请勿直接重复提交'})
        finally:
            if slot:
                GENERATIONS.release()


if __name__ == '__main__':
    print('Local demo: http://127.0.0.1:8765/prototype/ | desktop output auto-save', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
