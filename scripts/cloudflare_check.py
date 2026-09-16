"""Read-only Cloudflare readiness check. Never prints credential values."""
import json
import urllib.request
from pathlib import Path

def local_env():
    values = {}
    for line in (Path(__file__).resolve().parents[1] / '.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('\"\x27')
    return values

def main():
    env = local_env()
    paths = [
        '/user/tokens/verify',
        '/accounts/' + env['CLOUDFLARE_ACCOUNT_ID'] + '/workers/scripts/resolution-api/secrets',
        '/accounts/' + env['CLOUDFLARE_ACCOUNT_ID'] + '/pages/projects/' + env['CLOUDFLARE_PAGES_PROJECT'],
    ]
    for path in paths:
        request = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
            headers={'Authorization': 'Bearer ' + env['CLOUDFLARE_API_TOKEN']})
        result = json.load(urllib.request.urlopen(request, timeout=30))['result']
        if path.endswith('verify'):
            print('Cloudflare token:', result.get('status'))
        elif path.endswith('secrets'):
            print('Worker secret names:', [secret['name'] for secret in result])
        else:
            print('Pages:', json.dumps({k: result.get(k) for k in ['name', 'subdomain', 'production_branch']}))

if __name__ == '__main__':
    main()
