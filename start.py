"""Check prerequisites, then start the local studio. No downloads or login reads."""
import argparse
import re
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Start AI Outfit Studio locally')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('port must be 1024..65535')
    missing = []
    if sys.version_info < (3, 10):
        missing.append('Python 3.10+')
    for command in ('node', 'curl'):
        if not shutil.which(command):
            missing.append(command)
    if 'node' not in missing:
        version = subprocess.run(['node', '--version'], capture_output=True, text=True, check=True).stdout
        if int(re.search(r'v(\d+)', version).group(1)) < 20:
            missing.append('Node.js 20+')
    if missing:
        print('Missing requirements: ' + ', '.join(missing), file=sys.stderr)
        return 1
    print('Environment ready: Python, Node.js and curl', flush=True)
    if args.check:
        return 0
    import importlib.util
    source = Path(__file__).resolve().parent / 'prototype/server.py'
    spec = importlib.util.spec_from_file_location('outfit_server', source)
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    try:
        httpd = server.ThreadingHTTPServer(('127.0.0.1', args.port), server.Handler)
    except OSError:
        print(f'Port {args.port} unavailable. Keep existing services running; choose --port <free-port>.', file=sys.stderr)
        return 1
    url = f'http://127.0.0.1:{args.port}/'
    print('AI Outfit Studio: ' + url, flush=True)
    print('Connect ChatGPT manually in Settings. Ctrl+C to stop.', flush=True)
    if not args.no_open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
