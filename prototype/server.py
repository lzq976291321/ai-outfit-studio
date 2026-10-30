"""Ephemeral localhost image-to-image demo; Python standard library only."""
import base64
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GENERATIONS = threading.BoundedSemaphore(2)


def request(url, key='', payload=None, content_type='application/json'):
    if not key and payload is None:
        # Read public reference/result bytes into memory; curl handles these hosts' TLS/CDN policy.
        result = subprocess.run(['curl', '-sS', '--max-time', '60', '--max-filesize', '32000000', '--config', '-', '-w', '\n%{http_code}'], input=('url = ' + json.dumps(url) + '\n').encode(), capture_output=True)
        raw, _, status = result.stdout.rpartition(b'\n')
        if result.returncode or status != b'200' or len(raw) > 32_000_000:
            raise ValueError('图片读取失败，请稍后再试或选择本地图片')
        return raw
    headers = {'Content-Type': content_type}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    req = urllib.request.Request(url, data=payload, headers=headers)
    # Do not forward credentials through redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=180) as response:
        raw = response.read(32_000_001)
        if len(raw) > 32_000_000:
            raise ValueError('上游返回过大')
        return raw


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
    local = data.get('protocol') == 'codex-local'
    key = data.get('key', '').strip()
    endpoint = data.get('endpoint', '').strip()
    parsed = urllib.parse.urlsplit(endpoint)
    if not local and parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('接口须为 HTTPS 或本机 HTTP 地址')
    if not local and (parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname):
        raise ValueError('请填写不含凭据或查询参数的完整接口地址')
    model = data.get('model', '').strip()
    if not local and (not key or len(key) > 4096 or '\n' in key or '\r' in key or not model or len(model) > 200):
        raise ValueError('请填写 API Key 和图生图模型')
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
    prompt = ('根据图片1的整套穿搭，生成成年人物全身穿搭照片。保持衣物款式、颜色、材质及鞋袜配件；不要带入平铺背景。'
              + ('图片2仅用于人物身份及体型参考，保持其人脸与体型。' if data.get('hasPerson') else '人物为虚构成年人。')
              + (f'图片{len(images)}仅用于姿势与构图参考，不复制其人物身份、衣着或背景。' if data.get('hasPose') else '')
              + '姿势：' + pose + '。摄影风格：' + style + '。9:16手机竖图，头顶和鞋底完整留边。'
              '按摄影风格选择合理环境与现场光，光影、接触关系和透视可信，保留自然皮肤与衣料细节。人物放松，背景可辨。'
              '避免过度磨皮、美颜瘦身、塑料皮肤、HDR光晕、强虚化、肢体畸形、文字及拼图；不靠模糊和噪点伪装真实。补充：' + extra)
    protocol = data.get('protocol')
    if protocol == 'codex-local':
        return local_chatgpt({'action': 'generate', 'prompt': prompt, 'references': refs})
    if protocol == 'globalrouter':
        payload = json.dumps({'model': model, 'prompt': prompt, 'input_references': [{'type': 'image_url', 'image_url': {'url': ref}} for ref in refs], 'size': '864x1536', 'n': 1, 'response_format': 'url', 'stream': False}).encode()
        result = json.loads(request(endpoint, key, payload))
        if isinstance(result.get('data'), dict):
            result = result['data']
        task = result.get('task_id') or result.get('id')
        deadline = time.monotonic() + 480
        while task and not result.get('output') and not isinstance(result.get('data'), list):
            if result.get('status') in ('failed', 'canceled', 'cancelled'):
                raise ValueError('上游任务失败，请在供应商处核对详情')
            if time.monotonic() > deadline:
                raise ValueError('上游任务未完成，请先核对供应商状态，避免重复付费')
            time.sleep(2)
            result = json.loads(request(f'{parsed.scheme}://{parsed.netloc}/v1/tasks/{urllib.parse.quote(str(task), safe="")}?wait=10', key))
            if isinstance(result.get('data'), dict):
                result = result['data']
    elif protocol == 'doubao':
        payload = json.dumps({'model': model, 'prompt': prompt, 'image': refs if len(refs) > 1 else refs[0], 'size': '1440x2560', 'response_format': 'b64_json', 'stream': False}).encode()
        result = json.loads(request(endpoint, key, payload))
    elif protocol == 'openai-edits':
        boundary = secrets.token_hex(24)
        parts = []
        for name, value in [('model', model), ('prompt', prompt), ('n', '1'), ('size', '864x1536')]:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        for i, (mime, raw) in enumerate(images):
            field = 'image[]' if len(images) > 1 else 'image'
            ext = mime.split('/')[1]
            parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="reference-{i+1}.{ext}"\r\nContent-Type: {mime}\r\n\r\n'.encode(), raw, b'\r\n'])
        parts.append(f'--{boundary}--\r\n'.encode())
        result = json.loads(request(endpoint, key, b''.join(parts), 'multipart/form-data; boundary=' + boundary))
    else:
        raise ValueError('不支持的图生图协议')
    outputs = result.get('output') or result.get('data')
    if not isinstance(outputs, list) or not outputs:
        raise ValueError('接口未返回图片；请核对上游任务，不会自动重试')
    item = outputs[0]
    if item.get('b64_json'):
        raw = base64.b64decode(item['b64_json'], validate=True)
    else:
        url = item.get('url') or item.get('image_url')
        if isinstance(url, dict):
            url = url.get('url')
        if not isinstance(url, str) or urllib.parse.urlsplit(url).scheme != 'https':
            raise ValueError('上游没有返回可读取的 HTTPS 图片')
        raw = request(url)  # Never send the API key to image hosts.
    mime = 'image/png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if raw.startswith(b'\xff\xd8') else 'image/webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None
    if not mime or len(raw) > 25_000_000:
        raise ValueError('返回图片格式或大小不支持')
    return {'image': 'data:' + mime + ';base64,' + base64.b64encode(raw).decode()}


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
            return self.send(200, (ROOT / 'data' / path.rsplit('/', 1)[1]).read_bytes())
        if re.fullmatch(r'/prototype/data/(examples/(01-cream-khaki|02-burgundy-black|03-grey-blue)\.png|poses/pose-0[1-6]\.svg)', path):
            file = ROOT / path.removeprefix('/prototype/')
            if file.is_file():
                return self.send(200, file.read_bytes(), 'image/svg+xml' if file.suffix == '.svg' else 'image/png')
        if not entry:
            return self.send(404, {'error': 'Not found'})
        self.send(200, (ROOT / entry[0]).read_bytes(), entry[1])

    def do_POST(self):
        if self.path not in ('/api/generate', '/api/local-chatgpt/connect'):
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
            if self.path == '/api/local-chatgpt/connect':
                result = local_chatgpt({'action': 'connect'})
            else:
                result = save_generated_result(generate(data), data.get('saveTarget'), data.get('outfitName', '穿搭照'))
            self.send(200, result)
        except LocalGenerationError as exc:
            self.send(400 if exc.output.get('errorCode') == 'CONTENT_REJECTED' else 502, {key: exc.output[key] for key in ('error', 'errorCode', 'diagnostics') if key in exc.output})
        except urllib.error.HTTPError as exc:
            self.send(502, {'error': f'供应商返回 HTTP {exc.code}，请核对接口、Key、模型及尺寸支持；不会自动重试'})
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
