#!/usr/bin/env python3
import argparse, json, os
import urllib.parse, urllib.request
from pathlib import Path

def env():
    for p in (Path.cwd()/'.env', Path(__file__).resolve().parents[1]/'.env'):
        if p.is_file():
            for line in p.read_text(encoding='utf-8').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k,v=line.split('=',1); os.environ.setdefault(k.strip(),v.strip().strip('"').strip("'"))
            break

def cfg():
    env(); base=os.getenv('SUBSTORE_BASE_URL','').rstrip('/'); fn=os.getenv('SUBSTORE_MIHOMO_FILE','')
    if not base or not fn: raise SystemExit('SUBSTORE_BASE_URL and SUBSTORE_MIHOMO_FILE are required')
    return base,fn

def call(method,path,data=None):
    base,_=cfg(); h={'Accept':'application/json','Content-Type':'application/json'}; key=os.getenv('SUBSTORE_API_KEY','')
    if key:
        name=os.getenv('SUBSTORE_AUTH_HEADER','Authorization'); scheme=os.getenv('SUBSTORE_AUTH_SCHEME','Bearer').strip(); h[name]=f'{scheme} {key}'.strip()
    body=None if data is None else json.dumps(data,ensure_ascii=False).encode()
    with urllib.request.urlopen(urllib.request.Request(base+path,data=body,headers=h,method=method),timeout=30) as r:
        raw=r.read().decode(); return json.loads(raw) if raw else None

def subs():
    x=call('GET','/api/subs'); x=x.get('data',x) if isinstance(x,dict) else x
    if isinstance(x,list): return x
    if isinstance(x,dict): return [dict(v,name=v.get('name',k)) for k,v in x.items() if isinstance(v,dict)]
    return []

def find(name): return next((x for x in subs() if x.get('name')==name),None)
def q(s): return urllib.parse.quote(s,safe='')

def link(landing=None,mode=None):
    base,fn=cfg(); u=f'{base}/api/file/{q(fn)}'; p=[]
    if landing is not None:p.append(('landing',landing))
    if mode:p.append(('mode',mode))
    return u+('?' + urllib.parse.urlencode(p) if p else '')

def main():
    p=argparse.ArgumentParser(); sp=p.add_subparsers(dest='cmd',required=True)
    sp.add_parser('list'); g=sp.add_parser('get'); g.add_argument('name')
    c=sp.add_parser('create'); c.add_argument('name'); c.add_argument('url')
    u=sp.add_parser('update'); u.add_argument('name'); u.add_argument('url')
    d=sp.add_parser('delete'); d.add_argument('name')
    l=sp.add_parser('links'); l.add_argument('name',nargs='?'); a=p.parse_args()
    if a.cmd=='list': out=subs()
    elif a.cmd=='get': out=find(a.name) or {'error':'not found'}
    elif a.cmd=='create':
        if find(a.name): raise SystemExit('subscription already exists')
        out=call('POST','/api/subs',{'name':a.name,'source':'remote','url':a.url})
    elif a.cmd=='update':
        old=find(a.name)
        if not old: raise SystemExit('subscription not found')
        old=dict(old); old['url']=a.url; out=call('PATCH','/api/sub/'+q(a.name),old)
    elif a.cmd=='delete':
        if not find(a.name): raise SystemExit('subscription not found')
        out=call('DELETE','/api/sub/'+q(a.name))
    else:
        names=[a.name] if a.name else [x.get('name') for x in subs() if x.get('name')]
        out={'default':link(),'none':{'rule':link('none'),'global':link('none','global')},'landings':{}}
        for n in names:
            if n!='none': out['landings'][n]={'rule':link(n),'global':link(n,'global')}
    print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
