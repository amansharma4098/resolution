"""Run deployment tooling with Cloudflare credentials without printing .env values."""
import os
import subprocess
import sys
from pathlib import Path
from cloudflare_check import local_env
root = Path(__file__).resolve().parents[1]
config = local_env()
env = dict(os.environ)
for name in ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']:
    env[name] = config[name]
env['WRANGLER_SEND_METRICS'] = 'false'
if sys.argv[1] == 'sync-email':
    if not config.get('RESEND_API_KEY') or not config.get('EMAIL_FROM'):
        raise SystemExit('Email settings are incomplete')
    subprocess.run([str(root / 'apps/api/node_modules/.bin/wrangler'), 'secret', 'put', 'RESEND_API_KEY'], input=config['RESEND_API_KEY'], text=True, env=env, cwd=root / 'apps/api', check=True)
elif sys.argv[1] == 'pages':
    subprocess.run([str(root / 'apps/api/node_modules/.bin/wrangler'), 'pages', 'deploy', 'apps/web/out', '--project-name', config['CLOUDFLARE_PAGES_PROJECT'], '--branch', 'main', '--commit-dirty=true'], env=env, cwd=root, check=True)
else:
    subprocess.run([str(root / 'apps/api/node_modules/.bin/wrangler'), *sys.argv[1:]], env=env, cwd=root / 'apps/api', check=True)
