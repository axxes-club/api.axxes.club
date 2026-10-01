"""Image-only Cloud Run release with staged probe, traffic guard and rollback."""
import json,os,subprocess,time,urllib.request,urllib.error

def gcloud(*args):
    result=subprocess.run(['gcloud',*args,'--quiet','--format=json'],capture_output=True,text=True)
    if result.returncode: raise RuntimeError('gcloud command failed: '+result.stderr[-2000:])
    return json.loads(result.stdout) if result.stdout.strip() else {}

def traffic(service):
    return {t['revisionName']:t['percent'] for t in service['status'].get('traffic',[]) if t.get('percent',0)}

def probe(url):
    # A login redirect proves the application answered; never follow it to another origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    opener=urllib.request.build_opener(NoRedirect)
    for attempt in range(6):
        try:
            response=opener.open(urllib.request.Request(url,headers={'User-Agent':'AXXES-GCP-release-probe'}),timeout=20)
            code=response.status
        except urllib.error.HTTPError as error: code=error.code
        except (urllib.error.URLError,TimeoutError): code=0
        if 200<=code<400:return
        time.sleep(5)
    raise RuntimeError('Application readiness probe failed (HTTP '+str(code)+')')

def release(service,image,build_id):
    region='us-west1'; tag='ci-'+build_id.replace('-','')[:20]
    before=gcloud('run','services','describe',service,'--region='+region)
    previous=traffic(before)
    # Preserve deliberate canary traffic: automatic release refuses to collapse a split.
    if len(previous)!=1 or next(iter(previous.values()))!=100:
        raise RuntimeError('Production has a traffic split; release requires an explicit rollout policy')
    original=next(iter(previous))
    staged=False; promoted=False
    try:
        gcloud('run','deploy',service,'--region='+region,'--image='+image,'--no-traffic','--tag='+tag)
        staged=True
        current=gcloud('run','services','describe',service,'--region='+region)
        revision=current['status']['latestReadyRevisionName']
        entry=next(t for t in current['status']['traffic'] if t.get('tag')==tag)
        if before['metadata'].get('annotations',{}).get('run.googleapis.com/ingress','all')=='all':
            probe(entry['url']+os.environ.get('CI_HEALTH_PATH','/'))
        else:
            conditions=current['status'].get('conditions',[])
            if not any(c.get('type')=='Ready' and c.get('status')=='True' for c in conditions):
                raise RuntimeError('Restricted-ingress revision is not Ready')
            if not os.environ.get('CI_PUBLIC_HEALTH_URL') and os.environ.get('CI_READY_ONLY')!='true':
                raise RuntimeError('Restricted ingress requires a public load-balancer health URL')
        guard=gcloud('run','services','describe',service,'--region='+region)
        if traffic(guard)!=previous or guard['status']['latestReadyRevisionName']!=revision:
            raise RuntimeError('Production changed while the release was staged')
        # Image-only deploy preserves env, secrets, networking, CPU, memory, concurrency and IAM.
        gcloud('run','services','update-traffic',service,'--region='+region,'--to-revisions='+revision+'=100')
        promoted=True
        if os.environ.get('CI_READY_ONLY')=='true':
            health=gcloud('run','services','describe',service,'--region='+region)
            if not any(c.get('type')=='Ready' and c.get('status')=='True' for c in health['status'].get('conditions',[])):
                raise RuntimeError('Internal service is not Ready after promotion')
        else:
            probe(os.environ.get('CI_PUBLIC_HEALTH_URL') or before['status']['url']+os.environ.get('CI_HEALTH_PATH','/'))
        print('Release healthy:',service,revision)
    except Exception:
        if promoted:
            gcloud('run','services','update-traffic',service,'--region='+region,'--to-revisions='+original+'=100')
            print('Restored previous production revision:',original)
        raise
    finally:
        if staged:gcloud('run','services','update-traffic',service,'--region='+region,'--remove-tags='+tag)

if __name__=='__main__':release(os.environ['CI_SERVICE'],os.environ['CI_IMAGE'],os.environ['CI_BUILD_ID'])
