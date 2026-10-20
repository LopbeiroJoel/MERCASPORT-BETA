"""PostgreSQL jetable : migrations réversibles et SSE entre deux processus HTTP.
Ne charge aucun .env et n'utilise jamais Neon.
"""
import os
from pathlib import Path
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
pg = Path(os.environ['PG_BIN']) if os.environ.get('PG_BIN') else Path(subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
hidden = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
with tempfile.TemporaryDirectory(prefix='mercasport-messaging-') as scratch:
    root = Path(scratch)
    data, socket = root / 'data', root / 'socket'
    socket.mkdir()
    subprocess.run([str(pg/'initdb'), '-D', str(data), '-A', 'trust', '-U', 'mercasport_test', '--no-locale', '--encoding=UTF8'], check=True, stdout=subprocess.DEVNULL, **hidden)
    subprocess.run([str(pg/'pg_ctl'), '-D', str(data), '-l', str(root/'pg.log'), '-o', f'-p 15439 -c listen_addresses=127.0.0.1' + (f' -k {socket}' if os.name != 'nt' else ''), '-w', 'start'], check=True, stdout=subprocess.DEVNULL, **hidden)
    env = os.environ.copy()
    for key in ['DATABASE_URL', 'MESSAGING_DATABASE_URL', 'AUTH_SECRET', 'APP_ORIGIN', 'VERCEL']:
        env.pop(key, None)
    env.update(PGHOST='127.0.0.1', PGPORT='15439', PGDATABASE='postgres', PGUSER='mercasport_test', MESSAGING_ISOLATED_TEST='1')
    try:
        for name in ['schema.sql','seed.sql','registration.sql','player-positions.sql','admin.sql','profile.sql','profile-fields.sql','positions.sql','divisions.sql','ads-recruitment.sql','ads-applications.sql','migrations/20261019-messaging-up.sql','migrations/20261019-messaging-up.sql','migrations/20261019-messaging-reports.sql','migrations/20261020-player-ad-fields-up.sql','migrations/20261020-player-ad-fields-up.sql','migrations/20261020-player-ad-fields-down.sql','migrations/20261019-messaging-down.sql','migrations/20261019-messaging-up.sql','migrations/20261019-messaging-reports.sql','migrations/20261020-player-ad-fields-up.sql']:
            with (repo/'database'/name).open() as source:
                result=subprocess.run([str(pg/'psql'), '-X', '-v', 'ON_ERROR_STOP=1'], env=env, stdin=source, text=True, capture_output=True, **hidden)
            if result.returncode:
                raise RuntimeError(result.stderr)
        target=['node','tests/messaging-browser-server.js'] if env.get('MESSAGING_BROWSER_STATE') else ['node','--test','tests/messaging-live.test.js']
        result=subprocess.run(target,cwd=repo,env=env,text=True,encoding='utf-8',capture_output=True, **hidden)
        print(result.stdout)
        if result.returncode:
            raise RuntimeError(result.stderr)
    finally:
        subprocess.run([str(pg/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL, **hidden)
