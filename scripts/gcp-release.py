"""Image-only Cloud Run release with readiness, traffic guard and rollback."""
import json,os,subprocess,time,urllib.request,urllib.error,urllib.parse,ipaddress

def gcloud(*args):
    result=subprocess.run(['gcloud',*args,'--quiet','--format=json'],capture_output=True,text=True)
    if result.returncode: raise RuntimeError('gcloud command failed: '+result.stderr[-2000:])
    return json.loads(result.stdout) if result.stdout.strip() else {}

def traffic(service):
    return {t['revisionName']:t['percent'] for t in service['status'].get('traffic',[]) if t.get('percent',0)}

def valid_response(code,location=None):
    if 200<=code<300:return True
    if code not in [301,302,303,307,308] or not location:return False
    target=urllib.parse.urlparse(location)
    if any(k in urllib.parse.parse_qs(target.query,keep_blank_values=True) for k in ['error','error_description']):return False
    if target.path.rstrip('/').lower().endswith(('/auth/error','/api/auth/error')):return False
    if location.startswith('/') and not location.startswith('//'):return True
    if target.scheme!='https' or not target.hostname:return False
    host=target.hostname.lower()
    if host=='localhost' or host.endswith('.localhost') or host.endswith('.local'):return False
    try:
        if not ipaddress.ip_address(host).is_global:return False
    except ValueError:pass
    return True

def probe(url):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    opener=urllib.request.build_opener(NoRedirect)
    for attempt in range(6):
        try:
            response=opener.open(urllib.request.Request(url,headers={'User-Agent':'AXXES-GCP-release-probe'}),timeout=20)
            code=response.status;location=response.headers.get('Location')
        except urllib.error.HTTPError as error:code=error.code;location=error.headers.get('Location')
        except (urllib.error.URLError,TimeoutError):code=0;location=None
        if valid_response(code,location):return
        time.sleep(5)
    raise RuntimeError('Application readiness probe failed (HTTP '+str(code)+')')

def restore(service,revision):
    for attempt in range(3):
        try:
            gcloud('run','services','update-traffic',service,'--region=us-west1','--to-revisions='+revision+'=100')
            print('Restored previous production revision:',service,revision)
            return
        except Exception:
            if attempt==2:raise RuntimeError('Rollback failed for '+service+'; manual recovery required')
            time.sleep(2*(attempt+1))

def release(service,image,build_id):
    region='us-west1';tag='ci-'+build_id.replace('-','')[:20]
    before=gcloud('run','services','describe',service,'--region='+region)
    previous=traffic(before)
    if len(previous)!=1 or next(iter(previous.values()))!=100:
        raise RuntimeError('Production has a traffic split; release requires an explicit rollout policy')
    original=next(iter(previous));staged=False;promotion_attempted=False
    try:
        gcloud('run','deploy',service,'--region='+region,'--image='+image,'--no-traffic','--tag='+tag)
        staged=True
        current=gcloud('run','services','describe',service,'--region='+region)
        revision=current['status']['latestReadyRevisionName']
        entry=next(t for t in current['status']['traffic'] if t.get('tag')==tag)
        if before['metadata'].get('annotations',{}).get('run.googleapis.com/ingress','all')=='all':
            probe(entry['url']+os.environ.get('CI_HEALTH_PATH','/'))
        else:
            if not any(c.get('type')=='Ready' and c.get('status')=='True' for c in current['status'].get('conditions',[])):
                raise RuntimeError('Restricted-ingress revision is not Ready')
            if not os.environ.get('CI_PUBLIC_HEALTH_URL') and os.environ.get('CI_READY_ONLY')!='true':
                raise RuntimeError('Restricted ingress requires a public load-balancer health URL')
        guard=gcloud('run','services','describe',service,'--region='+region)
        if traffic(guard)!=previous or guard['status']['latestReadyRevisionName']!=revision:
            raise RuntimeError('Production changed while the release was staged')
        # Set this before the RPC: an error/timeout can arrive after the server applies promotion.
        promotion_attempted=True
        gcloud('run','services','update-traffic',service,'--region='+region,'--to-revisions='+revision+'=100')
        if os.environ.get('CI_READY_ONLY')=='true':
            health=gcloud('run','services','describe',service,'--region='+region)
            if not any(c.get('type')=='Ready' and c.get('status')=='True' for c in health['status'].get('conditions',[])):
                raise RuntimeError('Internal service is not Ready after promotion')
        else:
            probe(os.environ.get('CI_PUBLIC_HEALTH_URL') or before['status']['url']+os.environ.get('CI_HEALTH_PATH','/'))
        print('Release healthy:',service,revision)
        return {'service':service,'previous':original,'revision':revision}
    except Exception:
        if promotion_attempted:restore(service,original)
        raise
    finally:
        if staged:gcloud('run','services','update-traffic',service,'--region='+region,'--remove-tags='+tag)

def release_bundle(services,image,build_id):
    completed=[];saved={k:os.environ.get(k) for k in ['CI_READY_ONLY','CI_PUBLIC_HEALTH_URL']}
    try:
        for service in services:
            if service=='webmaster-worker':
                os.environ['CI_READY_ONLY']='true';os.environ.pop('CI_PUBLIC_HEALTH_URL',None)
            elif service=='webmaster':
                os.environ.pop('CI_READY_ONLY',None);os.environ['CI_PUBLIC_HEALTH_URL']='https://wm.axxes.app/api/healthz'
            completed.append(release(service,image,build_id))
    except Exception:
        failures=[]
        for deployed in reversed(completed):
            try:restore(deployed['service'],deployed['previous'])
            except Exception:failures.append(deployed['service'])
        if failures:raise RuntimeError('Bundle rollback failed for '+','.join(failures)+'; manual recovery required')
        raise
    finally:
        for key,value in saved.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value

if __name__=='__main__':
    if os.environ.get('CI_SERVICES'):release_bundle(os.environ['CI_SERVICES'].split(','),os.environ['CI_IMAGE'],os.environ['CI_BUILD_ID'])
    else:release(os.environ['CI_SERVICE'],os.environ['CI_IMAGE'],os.environ['CI_BUILD_ID'])
