"""Validate configured providers without sending email or invoking AI."""
import json
import urllib.request
from cloudflare_check import local_env

def get(url, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as response:
            return json.load(response)
    except Exception as error:
        print('Provider check failed:', type(error).__name__, getattr(error, 'code', 'network'))
        return {}

env = local_env()
models = get('https://api.anthropic.com/v1/models', {'x-api-key': env['ANTHROPIC_API_KEY'], 'anthropic-version': '2023-06-01'})
ids = [model['id'] for model in models.get('data', [])]
print('Configured AI model:', env.get('ANTHROPIC_MODEL'), 'listed:', env.get('ANTHROPIC_MODEL') in ids)
print('Available model IDs:', ids[:8])
if env.get('RESEND_API_KEY'):
    domains = get('https://api.resend.com/domains', {'Authorization': 'Bearer ' + env['RESEND_API_KEY']})
    print('Email domain statuses:', [{ 'name': domain['name'], 'status': domain['status'] } for domain in domains.get('data', [])])
