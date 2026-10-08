import importlib.util, pathlib, unittest, os
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
def load():
 path=ROOT/'scripts/gcp-release.py'; spec=importlib.util.spec_from_file_location('release',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
class ReleaseSecurity(unittest.TestCase):
 def test_restricted_api_health_uses_public_load_balancer(self):
  m=load()
  with patch.dict(os.environ,{},clear=True):self.assertEqual(m.public_health_url('api'),'https://api.axxes.club/health')
 def test_staging_has_its_own_public_health_host(self):
  m=load()
  with patch.dict(os.environ,{},clear=True):self.assertEqual(m.public_health_url('lanes-v2'),'https://lanes.v2.axxes.app/')
 def test_missing_public_mapping_is_rejected(self):
  m=load()
  with patch.dict(os.environ,{},clear=True):
   with self.assertRaises(RuntimeError):m.public_health_url('unregistered-public-app')
 def test_configured_health_rejects_http_or_run_origin(self):
  m=load()
  for url in ['http://api.axxes.club/health','https://api-123.run.app/health']:
   with patch.dict(os.environ,{'CI_PUBLIC_HEALTH_URL':url},clear=True):
    with self.assertRaises(RuntimeError):m.public_health_url('api')
 def test_cloud_run_ready_failure_does_not_promote(self):
  m=load(); original={'metadata':{'annotations':{'run.googleapis.com/ingress':'internal-and-cloud-load-balancing'}},'status':{'traffic':[{'revisionName':'old','percent':100}],'url':'https://api.run.app'}}
  staged={'metadata':{'annotations':{'run.googleapis.com/ingress':'internal-and-cloud-load-balancing'}},'status':{'latestReadyRevisionName':'new','traffic':[{'tag':'ci-build','url':'https://tag-api.run.app'}],'conditions':[{'type':'Ready','status':'False'}]}}
  calls=[]
  def gc(*args):
   calls.append(args)
   if args[:3]==('run','services','describe'):return original if len([c for c in calls if c[:3]==args[:3]])==1 else staged
   return {}
  with patch.object(m,'gcloud',side_effect=gc),patch.dict(os.environ,{},clear=True),patch.object(m,'probe') as probe:
   with self.assertRaises(RuntimeError):m.release('api','image','build')
   self.assertFalse(any('--to-revisions=new=100' in c for c in calls));probe.assert_not_called()
if __name__=='__main__':unittest.main()
