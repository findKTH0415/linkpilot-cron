'use strict';
/**
 * try-linked.js — **「폴더를 연결해서」가 실제로 어디까지 도는지 눈으로 본다** (2026-08-22).
 *
 *   npm run im:try-linked
 *
 * ★★ 왜 만들었나: 「외부 클라우드 폴더를 지정해서 자료 스캔이 되느냐」는 물음에
 *   말로만 답하면 확인할 방법이 없다. 그런데 **제공자 콘솔 등록(사람 작업)이
 *   끝나기 전에는 진짜 Dropbox·구글 드라이브로 시험할 수 없다.**
 *
 *   그래서 제공자 자리에 **우리가 띄운 HTTPS 서버**를 놓는다. 엔진 쪽에서 보면
 *   달라지는 것이 없다 — 연결은 「참조(어느 파일의 어느 판인가) + 짧게 사는
 *   내려받기 주소」로 이뤄지고, 그 주소가 어디서 왔는지는 엔진이 모른다.
 *   **그래서 이 시험이 통과하면 엔진 쪽은 준비된 것이고, 남은 것은 그 주소를
 *   만들어 주는 쪽(앱 피커 + 콘솔 등록)뿐이다.**
 *
 * ★ 가짜 서버로 바꿔치기하지 않는다. `fetchLinked` 를 주입하면 훨씬 쉽지만
 *   그러면 **실제로 도는 길을 한 줄도 안 밟는다** — handoff·https·크기 한도·
 *   지문 계산이 전부 건너뛰어진다. 여기서는 기본 구현을 그대로 쓴다.
 *
 * ★ 스스로 서명한 인증서를 쓰므로 **자식 프로세스로 한 번 다시 뜬다** —
 *   `NODE_EXTRA_CA_CERTS` 는 프로세스가 시작할 때만 읽힌다.
 *
 * ★ 새 라이브러리를 들이지 않는다 (CLAUDE.md §5). 전부 stdlib + openssl 이다.
 * ★ 끝나면 임시 폴더를 지운다. 인증서·열쇠가 남지 않는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync, spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');

const line = (s) => console.log(s);
const ok = (s) => line('  ✓ ' + s);
const no = (s) => line('  ✗ ' + s);

/* ── 예시 자료. **실제 딜 자료는 이 저장소에 두지 않는다** (public · D-10) ── */
const DEMO_FILE = {
  name: '사업개요_v2.txt',
  body: [
    '사업명: 예시 데이터센터',
    '대지면적 2,644 m2',
    '총사업비 1,200억원',
  ].join('\n'),
};

/* ══════════════ 1단계 — 인증서를 만들고 다시 뜬다 ══════════════ */

function parentPhase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-try-linked-'));
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');

  line('');
  line('「폴더를 연결해서」 — 엔진 쪽이 실제로 도는지 끝까지 밟아 본다');
  line('─'.repeat(64));
  line('');
  line('0) 제공자 자리에 놓을 HTTPS 서버의 인증서를 만든다 (임시 · 끝나면 지운다)');

  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', key, '-out', cert, '-days', '1', '-nodes',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
    { stdio: 'ignore' });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    line('');
    no('openssl 을 찾지 못했습니다 — 이 시험은 인증서가 있어야 돌아갑니다.');
    line('    (엔진 코드 문제가 아니라 이 시험 도구의 준비물입니다)');
    process.exit(2);
  }
  ok('인증서 준비');

  /* ★ `NODE_EXTRA_CA_CERTS` 는 **시작할 때만** 읽힌다. 그래서 다시 뜬다.
   *   ★ `NO_PROXY` 도 함께 준다 — 이 환경은 바깥으로 나갈 때 프록시를 쓰는데,
   *     127.0.0.1 까지 프록시로 보내면 우리 서버에 못 닿는다. */
  const r = spawnSync(process.execPath, [__filename], {
    stdio: 'inherit',
    env: {
      ...process.env,
      LP_TRY_DIR: dir,
      NODE_EXTRA_CA_CERTS: cert,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(r.status === null ? 1 : r.status);
}

/* ══════════════ 2단계 — 실제로 연결하고 스캔한다 ══════════════ */

async function childPhase(dir) {
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');

  /* ── 제공자 자리 — 짧게 사는 내려받기 주소를 내주는 서버 ──
     실제로는 Dropbox·Box·구글·원드라이브가 이 자리에 선다. 엔진에게는
     **주소 하나**로 보일 뿐이라, 여기서 통과하면 그쪽도 통과한다. */
  let served = 0;
  const srv = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    (q, s) => {
      served++;
      const buf = Buffer.from(DEMO_FILE.body, 'utf8');
      s.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': buf.length });
      if (q.method === 'HEAD') return s.end();     // verify() 가 HEAD 로 묻는다
      s.end(buf);
    });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const url = `https://127.0.0.1:${port}/${encodeURIComponent(DEMO_FILE.name)}`;

  line('');
  line(`1) 제공자 자리에 HTTPS 서버를 띄웠다 (127.0.0.1:${port})`);
  ok('여기서부터는 엔진이 진짜 길로 간다 — 가짜 함수를 끼우지 않는다');

  /* ── 엔진 ── */
  const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-try-proj-'));
  process.env.IM_AGENT_ROOT = agentRoot;
  process.env.IM_AGENT_OFFLINE = '1';

  const api = require(path.join(ROOT, 'ui/report-api.cjs'));
  const pipeline = require(path.join(ROOT, 'pipeline.js'));
  const h = api.createHandlers({
    agentRoot,
    agentModulePath: ROOT,
    authenticate: () => ({ name: '시험', planId: 'pro', status: 'active' }),
    /* ★ 읽는 함수는 **본체가 주는 것**이라 여기서도 준다 — 실제 서버가 주는
     *   것과 같은 것을 가리킨다 (`pipeline.extractInto`). LLM 은 끈다 */
    extractFiles: (pid, files) => pipeline.extractInto(pid, files, { useLlm: false }),
    // ★ `fetchLinked` 는 **주지 않는다.** 엔진 기본 구현(core/linked-fetch.js)이
    //   실제로 도는지가 이 시험의 전부다
  });

  let failed = 0;

  line('');
  line('2) 프로젝트를 만든다');
  const made = await h.createProject({}, {
    request: '예시 데이터센터 투자 검토', projectName: '예시 데이터센터',
  });
  const id = made.body.projectId;
  ok(`프로젝트 ${id}`);

  line('');
  line('3) 자료를 **연결한다** — 파일을 가져오지 않는다. 참조 + 접근권만 맡긴다');
  const link = await h.linkSource({}, id, {
    ref: {
      provider: 'gdrive',            // 어느 제공자든 같은 길이다
      fileId: 'demo-file-0001',
      name: DEMO_FILE.name,
      rev: 'r2',                     // ★ 판이 없으면 엔진이 거절한다
      path: '/예시 프로젝트/01_원본자료/' + DEMO_FILE.name,
    },
    access: { url },                 // 짧게 사는 주소 — 장부에는 안 들어간다
  });
  if (link.status !== 200) { no(`HTTP ${link.status} — ${link.body && link.body.error}`); failed++; }
  else {
    ok(`장부에 올랐다 · key=${link.body.item.key}`);
    ok(`접근권은 ${new Date(link.body.access.expiresAt).toISOString().slice(11, 16)} UTC 까지만 산다`);
  }

  line('');
  line('4) 장부에 열쇠가 섞여 들어갔는지 본다 (§2 · 절대 규칙)');
  /* ★ 장부 자리를 손으로 적지 않는다 — `core/linked.js` 가 정한다. 여기 적었다가
   *   그쪽이 바뀌면 이 시험만 조용히 엉뚱한 파일을 보게 된다 */
  const store = require(path.join(ROOT, 'core/store.js'));
  const linkedMod = require(path.join(ROOT, 'core/linked.js'));
  const ledPath = linkedMod.ledgerPath
    ? linkedMod.ledgerPath(store.projectDir(id))
    : path.join(store.projectDir(id), '01_Project', 'linked.json');
  const led = fs.readFileSync(ledPath, 'utf8');
  if (/accessToken|refreshToken|"token"|secret|127\.0\.0\.1/.test(led)) {
    no('장부에 접근 정보가 남았다 — 오래 남는 곳에 열쇠를 두면 안 된다'); failed++;
  } else ok('장부에는 참조만 있다 (주소·토큰 없음)');

  line('');
  line('5) **자료 스캔** — 잠깐 가져와 읽고, 읽고 나서 지운다');
  const sc = await h.scanSources({}, id, {});
  if (sc.status !== 200) { no(`HTTP ${sc.status} — ${sc.body && sc.body.error}`); failed++; }
  else {
    ok(`읽은 파일 ${(sc.body.scanned || []).length}건 · 값 ${sc.body.facts}개`);
    (sc.body.unread || []).forEach((u) => no(`못 읽음: ${u.name} — ${u.why}`));
    if (sc.body.note) line('    화면에 뜨는 말: ' + sc.body.note);
  }

  line('');
  line('6) 원본이 **그때 그대로인가** 물어본다 (§9 변경 감지)');
  /* ★★ **읽기 전에는 물어볼 수가 없다.** 지문이 있어야 비교할 것이 생긴다 —
   *   그래서 스캔 뒤에 둔다. 앞에 두면 늘 「확인 못 함」만 나오는데, 그것을
   *   결함으로 오해하기 딱 좋다 (처음에 그렇게 읽었다) */
  const ver = await h.verifyLinked({}, id);
  if (ver.status !== 200) { no(`HTTP ${ver.status}`); failed++; }
  else {
    /* 네 갈래로 답이 온다. **한 갈래도 뭉치지 않는다** — 사용자가 할 일이 다르다 */
    const b = ver.body;
    (b.ok_ || []).forEach((it) => ok(`${it.name} — 그대로다`));
    (b.changed || []).forEach((it) => { no(`${it.name} — 바뀌었다 (${it.was} → ${it.now})`); });
    (b.missing || []).forEach((it) => { no(`${it.name} — 사라졌다`); });
    (b.errors || []).forEach((it) => { no(`${it.name} — ${it.reason}`); });
    /* ★ 「확인 못 함」은 **결함이 아니다.** 임시 내려받기 주소는 판(rev)을 안 알려
     *   준다 — 그래서 비교할 것이 없다. 이것을 「바뀌었다」로 내면 거짓 경보가 된다
     *   (2026-08-22 에 실제로 그렇게 나오던 것을 고쳤다) */
    (b.unread || []).forEach((it) => line(`  · ${it.name} — 확인 못 함: ${it.reason || '사유 없음'}`));
    if (!(b.ok_ || []).length && !(b.unread || []).length && !(b.changed || []).length) {
      no('아무 답도 안 왔다 — ' + JSON.stringify(b).slice(0, 200)); failed++;
    }
  }

  line('');
  line('7) 값이 실제로 들어갔는가 · **출처에 무엇이 적혔는가** (CLAUDE.md §4.7)');
  const f = await h.getFacts({}, id);
  const vals = (f.body && f.body.values) || {};
  const keys = Object.keys(vals);
  if (!keys.length) { no('값이 하나도 안 들어갔다'); failed++; }
  keys.slice(0, 6).forEach((k) => {
    const v = vals[k];
    const src = (v && (v.source || v.sourceText || (v.sources && v.sources[0]))) || null;
    ok(`${k} = ${v && (v.value !== undefined ? v.value : JSON.stringify(v))}`);
    if (src) line('      출처: ' + (typeof src === 'string' ? src : JSON.stringify(src)));
  });

  line('');
  line('8) 작업 사본이 **지워졌는가** — 「우리는 보관하지 않습니다」의 근거');
  const tmpLeft = fs.existsSync(path.join(agentRoot, 'projects', id))
    ? fs.readdirSync(path.join(agentRoot, 'projects', id)).filter(n => /linked-mat|materialize/.test(n))
    : [];
  if (tmpLeft.length) { no('작업 사본이 남아 있다: ' + tmpLeft.join(' · ')); failed++; }
  else ok('남은 사본 없음');

  line('');
  line('─'.repeat(64));
  line(`제공자 서버가 받은 요청: ${served}회 (HEAD 1 + GET 1 이 정상)`);
  line(failed ? `결과: 막힌 곳 ${failed}군데` : '결과: 연결 → 스캔 → 값 → 출처 까지 **끝까지 돌았다**');
  line('');
  line('여기까지가 엔진이다. 실제 클라우드로 바꾸려면 남은 것은 둘이다:');
  line('  ① 앱이 제공자 피커를 열어 `pickFrom` 을 넘긴다 (화면은 이미 그것을 기다린다)');
  line('  ② 제공자 콘솔 4곳에 앱을 등록해 그 피커가 주소를 받아 오게 한다');
  line('');

  srv.close();
  fs.rmSync(agentRoot, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

if (process.env.LP_TRY_DIR) {
  childPhase(process.env.LP_TRY_DIR).catch((e) => {
    line('');
    no('던졌다: ' + e.message);
    line(e.stack.split('\n').slice(1, 5).join('\n'));
    process.exit(1);
  });
} else {
  parentPhase();
}
