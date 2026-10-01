"""Inspect every immutable image layer without printing credential bytes."""
import io,json,os,re,shlex,sys,tarfile

def credentials(path):
    if not os.path.exists(path):return []
    tokens=set()
    with open(path,encoding='utf-8') as file:
        lines=file.readlines()
    for line in lines:
        match=re.match(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)',line)
        if not match:continue
        key,value=match.groups()
        if key.startswith('NEXT_PUBLIC_') or not re.search(r'SECRET|TOKEN|PASSWORD|DATABASE_URL|PRIVATE_KEY|CREDENTIAL|API_KEY|ACCESS_KEY',key,re.I):continue
        variants=[value.strip().strip('\"\'')]
        try:
            parsed=shlex.split(value,comments=True)
            if len(parsed)==1:variants.append(parsed[0])
        except ValueError:pass
        for text in variants:
            if len(text)>=8:
                tokens.add(text.encode());tokens.add(json.dumps(text)[1:-1].encode())
    return list(tokens)

def has_credentials(file,tokens):
    overlap=max([len(t) for t in tokens] or [1])-1;tail=b''
    while True:
        block=file.read(1024*1024)
        if not block:return False
        data=tail+block
        if any(t in data for t in tokens):return True
        tail=data[-overlap:] if overlap else b''

def scan(path,secret_path='.env.production'):
    tokens=credentials(secret_path);files=0;leaked=False;dotenv=False
    with tarfile.open(path,'r:*') as image:
        manifest=json.load(image.extractfile('manifest.json'))
        layers={name for item in manifest for name in item['Layers']}
        for entry in image:
            if not entry.isfile():continue
            contents=image.extractfile(entry)
            if entry.name in layers:
                with tarfile.open(fileobj=contents,mode='r|*') as layer:
                    for member in layer:
                        if not member.isfile():continue
                        files+=1;name=member.name.rsplit('/',1)[-1]
                        if re.match(r'^\.env(?:$|\.)',name) and name not in ['.env.example','.env.sample','.env.template']:dotenv=True
                        if has_credentials(layer.extractfile(member),tokens):leaked=True
            elif has_credentials(contents,tokens):leaked=True
    result={'passed':not(leaked or dotenv),'credentialValueMatch':leaked,'dotenvFileInAnyLayer':dotenv,'scannedFileCount':files,'checkedSecretValueCount':len(tokens)}
    print(json.dumps(result))
    return result

if __name__=='__main__':
    result=scan(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else '.env.production')
    sys.exit(0 if result['passed'] else 1)
