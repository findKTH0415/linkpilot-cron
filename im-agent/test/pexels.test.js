'use strict';
/**
 * pexels.test.js — 무료 이미지 Connector (표지·간지의 참고 이미지).
 *
 * **이 커넥터의 위험은 이 저장소에서 유일한 종류다.**
 * 다른 커넥터는 「없는 값을 지어낼까」를 걱정한다. 이것은 반대다 —
 * **가져온 것이 진짜처럼 보이는 것**이 위험하다.
 *
 * IM 에 공장 사진 한 장이 실리면 읽는 사람은 그것을 **이 딜의 공장**으로 본다.
 * 아무도 「스톡 사진입니까」라고 묻지 않는다. 숫자는 출처를 따지지만
 * **사진은 아무도 출처를 안 따진다.**
 *
 * 그래서 여기서 못 박는 것은 셋이다.
 *   ① 캡션 없이 내려받히지 않는가
 *   ② 딜 자료·현장 그림과 다른 폴더에 가는가
 *   ③ 기계가 고르지 않는가
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pexels = require('../connectors/pexels');
const http = require('../connectors/http');

function withEnv(env, fn) {
  const saved = {};
  Object.keys(env).forEach((k) => { saved[k] = process.env[k]; });
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  const done = () => Object.keys(saved).forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  const r = fn();
  return (r && typeof r.then === 'function') ? r.finally(done) : (done(), r);
}

function withFake(responder, fn) {
  const real = http.request;
  const calls = [];
  http.request = async (url, opt) => { calls.push({ url, opt }); return responder(url, opt); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pexels-'));
  return withEnv({ PEXELS_API_KEY: 'P'.repeat(56), IM_AGENT_CACHE: path.join(tmp, 'cache') },
    () => fn(calls, tmp))
    .finally(() => {
      http.request = real;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
    });
}

const PHOTO = {
  id: 12345, photographer: '홍길동', photographer_url: 'https://www.pexels.com/@hong',
  url: 'https://www.pexels.com/photo/12345/', alt: 'factory exterior at dusk',
  width: 4000, height: 2500,
  src: { large2x: 'https://images.pexels.com/photos/12345/large2x.jpg', original: 'https://images.pexels.com/photos/12345/original.jpg' },
};

const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);

function responder(url) {
  if (/api\.pexels\.com/.test(url)) {
    return { ok: true, status: 200, attempts: 1, body: JSON.stringify({ total_results: 812, photos: [PHOTO] }) };
  }
  return { ok: true, status: 200, attempts: 1, body: JPEG };
}

/* ═════════ ① 표시가 떨어지지 않는다 ═════════ */

/**
 * ★ **이 파일에서 가장 중요한 검사다.** 캡션이 떨어지면 남의 공장 사진이
 *   이 딜의 현장이 된다.
 */
test('★ 캡션에 「이 사업의 현장이 아니다」가 반드시 들어간다', () => {
  const p = pexels.toPhoto(PHOTO);
  const c = pexels.caption(p);
  assert.match(c, /이 사업의 현장이 아니다/);
  assert.match(c, /참고 이미지/);
  // 촬영자도 함께 — 라이선스가 요구하지 않아도 남긴다 (§4.7)
  assert.match(c, /홍길동/);
  assert.match(c, /Pexels/);
});

test('★ 내려받은 결과에 캡션이 함께 온다 (따로 만들 여지를 두지 않는다)', async () => {
  await withFake(responder, async (calls, tmp) => {
    const r = await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: tmp, confirmedNoPeople: true });
    assert.strictEqual(r.ok, true, r.error);
    assert.match(r.value.caption, /이 사업의 현장이 아니다/);
    assert.ok(r.value.pageUrl && r.value.photographer, '출처가 빠졌다');
    assert.ok(calls.some(c => /images\.pexels\.com/.test(c.url)), '파일을 안 받았다');
  });
});

/**
 * ★ 파일만 남으면 **반년 뒤에 출처를 알 수 없다.** manifest 가 그 자리를 채운다.
 */
test('★ manifest 에 출처와 캡션이 남는다', async () => {
  await withFake(responder, async (calls, tmp) => {
    await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: tmp, note: '표지용', confirmedNoPeople: true });
    const m = pexels.readManifest(tmp);
    assert.strictEqual(m.images.length, 1);
    assert.match(m.images[0].caption, /표지용/);
    assert.match(m.images[0].license, /Pexels License/);
    assert.match(m.note, /이 사업의 현장이 아니다/, '폴더 자체에도 성격이 적혀야 한다');
    assert.match(m.note, /02_Source_Data/, '섞지 말라는 말이 있어야 한다');
  });
});

test('같은 사진을 다시 받아도 manifest 가 중복되지 않는다', async () => {
  await withFake(responder, async (calls, tmp) => {
    const p = pexels.toPhoto(PHOTO);
    await pexels.download({ photo: p, projectDir: tmp, confirmedNoPeople: true });
    await pexels.download({ photo: p, projectDir: tmp, confirmedNoPeople: true });
    assert.strictEqual(pexels.readManifest(tmp).images.length, 1);
  });
});

/**
 * ★ **인물 사진은 쓰지 않는다** (2026-08-16 결정 · D-50).
 *   API 는 사람이 찍혀 있는지 알려 주지 않는다. 그래서 기계가 판정하지 않고,
 *   **사람이 봤다고 명시해야 받아진다.** 경고만 띄우면 아무도 안 읽는다 —
 *   실제로 막아야 지켜진다.
 */
test('★ 확인 표시 없이는 내려받히지 않는다 (경고가 아니라 차단이다)', async () => {
  await withFake(responder, async (calls, tmp) => {
    const r = await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: tmp });
    assert.strictEqual(r.ok, false, '확인 없이 받아졌다 — 인물 사진이 들어갈 수 있다');
    assert.strictEqual(r.needsPersonCheck, true);
    assert.match(r.error, /눈으로 확인/);
    assert.ok(!calls.some(c => /images\.pexels\.com/.test(c.url)), '거부할 요청으로 파일을 받았다');
  });
});

test('★ 도구가 --no-people 을 요구한다 (기본값으로 통과시키지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'find-image.js'), 'utf8');
  assert.match(src, /--no-people/);
  assert.match(src, /confirmedNoPeople: noPeople/, '확인 표시를 그대로 넘겨야 한다');
  assert.ok(!/confirmedNoPeople: true/.test(src), '도구가 확인을 대신 해 주고 있다');
});

test('★ 인물 확인은 사람이 한 것으로 기록된다 (기계 판정이 아니다)', async () => {
  await withFake(responder, async (calls, tmp) => {
    const r = await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: tmp, confirmedNoPeople: true });
    assert.strictEqual(r.value.noPeople, 'confirmed-by-human',
      '기계가 판정한 것처럼 기록되면 나중에 무엇을 믿을지 알 수 없다');
    assert.match(r.value.check, /기계 판정이 아니다/);
  });
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'pexels.js'), 'utf8');
  assert.ok(!/hasPeople|detectFace|isPerson/.test(src), '기계가 인물을 판정하고 있다');
});

/* ═════════ 대외 배포본에서는 뺀다 (D-50) ═════════ */

/**
 * ★ **파일이 남아 있기만 해도 막는다.** 「문서에 안 넣었다」를 코드가 알 방법이
 *   없고, 사람이 「안 넣었다」고 믿는 것이 바로 사고가 나는 자리다.
 */
test('★ 참고 이미지가 남아 있으면 대외 배포를 막는다', async () => {
  await withFake(responder, async (calls, tmp) => {
    assert.deepStrictEqual(pexels.externalBlockers(tmp), [], '없을 때는 막지 않는다');
    await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: tmp, confirmedNoPeople: true });
    const blockers = pexels.externalBlockers(tmp);
    assert.strictEqual(blockers.length, 1, '남아 있는데 안 막았다');
    assert.match(blockers[0], /대외 배포본에서는 뺀다/);
    assert.match(blockers[0], /파일을 지우거나/, '무엇을 하면 되는지 말해야 한다');
  });
});

test('★ 승인 게이트가 그 판정을 부른다 (커넥터 안에만 있으면 아무도 안 본다)', () => {
  const gate = fs.readFileSync(path.join(__dirname, '..', 'core', 'gate.js'), 'utf8');
  assert.match(gate, /pexels\.externalBlockers/, '게이트에 안 걸려 있으면 그냥 나간다');
  assert.match(gate, /내부 검토본까지만/, '왜 막는지 적어야 한다');
});

test('★ manifest 와 항목에 「내부까지」가 박혀 있다', async () => {
  await withFake(responder, async (calls, tmp) => {
    const r = await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: tmp, confirmedNoPeople: true });
    assert.strictEqual(r.value.audience, 'internal');
    assert.strictEqual(r.value.externalUse, false);
    assert.match(pexels.readManifest(tmp).note, /대외 배포본에서는 뺀다/);
  });
});

/* ═════════ ② 딜 자료·현장 그림과 섞이지 않는다 ═════════ */

/**
 * ★ 폴더가 **유일한 구분선**이다. 파일 이름만 봐서는 스톡 사진인지
 *   이 딜의 현장 사진인지 구분이 안 된다.
 */
test('★ 스톡 폴더에만 들어간다', async () => {
  await withFake(responder, async (calls, tmp) => {
    const r = await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: tmp, confirmedNoPeople: true });
    assert.ok(r.value.file.startsWith('09_IM/images/stock/'), `엉뚱한 곳에 갔다: ${r.value.file}`);
    assert.ok(fs.existsSync(path.join(tmp, r.value.file)));
  });
});

test('★ 받은 자료·지적선 그림 폴더에는 절대 안 넣는다', async () => {
  await withFake(responder, async (calls, tmp) => {
    for (const bad of pexels.FORBIDDEN_DIRS) {
      const r = await pexels.download({ photo: pexels.toPhoto(PHOTO), projectDir: path.join(tmp, bad, 'x'), confirmedNoPeople: true });
      assert.strictEqual(r.ok, false, `${bad} 에 넣는 것을 막지 못했다`);
      assert.match(r.error, /두지 않는다/);
    }
  });
});

test('스톡 폴더 상수가 04_Property·02_Source_Data 와 겹치지 않는다', () => {
  assert.ok(!pexels.FORBIDDEN_DIRS.some(d => pexels.STOCK_DIR.includes(d)));
});

/* ═════════ ③ 기계가 고르지 않는다 (§4.9) ═════════ */

test('★ 검색은 후보만 돌려준다 (하나를 고르지 않는다)', async () => {
  await withFake(responder, async () => {
    const r = await pexels.search({ query: 'factory exterior' });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(Array.isArray(r.value.photos));
    assert.ok(!('chosen' in r.value) && !('best' in r.value), '기계가 하나를 골랐다');
  });
});

test('★ 사진을 지정하지 않으면 내려받지 않는다', async () => {
  await withFake(responder, async (calls, tmp) => {
    const r = await pexels.download({ projectDir: tmp });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /사람이 고른다/);
  });
});

test('검색어가 없으면 부르지 않는다', async () => {
  await withFake(responder, async (calls) => {
    const r = await pexels.search({});
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /기계가 정하지 않는다/);
    assert.strictEqual(calls.length, 0);
  });
});

test('★ 도구가 두 단계로 나뉘어 있다 (한 번에 받아 버리지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'find-image.js'), 'utf8');
  assert.match(src, /--pick/, '고르는 단계가 없다');
  assert.match(src, /기계가 고르지 않는다|기계가 고르지/, '왜 두 단계인지 적어야 한다');
  // --pick 없이 부르면 목록만 나오고 끝나야 한다
  assert.match(src, /if \(!pick\) \{[\s\S]*?return;\n  \}/, '고르기 전에 받아 버리는 길이 있다');
});

/* ═════════ 값이 아니다 ═════════ */

/** ★ 사진은 값이 아니다. fact 로 등록하면 IM 수치 옆에 나란히 선다 */
test('★ fact 를 만들지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'pexels.js'), 'utf8');
  assert.ok(!/facts?\.push|addMany|new Dataset/.test(src));
  assert.match(src, /사진은 값이 아니다/);
});

/* ═════════ 응답 해석 · 한도 · 시크릿 ═════════ */

test('사진 한 건에서 출처가 되는 값만 남긴다', () => {
  const p = pexels.toPhoto(PHOTO);
  assert.strictEqual(p.photographer, '홍길동');
  assert.strictEqual(p.pageUrl, 'https://www.pexels.com/photo/12345/');
  assert.strictEqual(p.orientation, 'landscape');
  assert.ok(p.files.large);
});

test('찾은 사진이 없으면 지어내지 않는다', async () => {
  await withFake(() => ({ ok: true, status: 200, attempts: 1, body: JSON.stringify({ total_results: 0, photos: [] }) }), async () => {
    const r = await pexels.search({ query: '없는것' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.notFound, true);
  });
});

test('JSON 이 아니면 키를 의심하라고 한다', async () => {
  await withFake(() => ({ ok: true, status: 200, attempts: 1, body: '<html>' }), async () => {
    const r = await pexels.search({ query: 'x' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /JSON/);
  });
});

/**
 * ★ 한도가 **시간당 200회**다 — data.go.kr 의 1/50. 같은 검색어를 두 번 부르면 안 된다.
 */
test('★ 캐시를 통과한다 (한도가 시간당 200회뿐이다)', async () => {
  await withFake(responder, async (calls) => {
    await pexels.search({ query: 'factory' });
    await pexels.search({ query: 'factory' });
    const api = calls.filter(c => /api\.pexels\.com/.test(c.url));
    assert.strictEqual(api.length, 1, '같은 검색을 두 번 불렀다');
    await pexels.search({ query: 'warehouse' });
    assert.strictEqual(calls.filter(c => /api\.pexels\.com/.test(c.url)).length, 2);
  });
});

/** ★ 키가 **헤더**로 나간다 — 쿼리 마스킹 규칙에 안 걸린다 */
test('★ 키를 헤더로 보내고, SECRET_ENV 에 등록되어 있다', async () => {
  await withFake(responder, async (calls) => {
    await pexels.search({ query: 'factory' });
    const api = calls.find(c => /api\.pexels\.com/.test(c.url));
    assert.ok(api.opt && api.opt.headers && api.opt.headers.Authorization, '헤더로 안 보냈다');
    assert.ok(!/authorization=/i.test(api.url), '키가 쿼리에 실렸다');
  });

  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  assert.match(src, /'PEXELS_API_KEY'/, 'SECRET_ENV 에 없으면 오류 메시지에 키가 남는다');
});

test('키가 로그에서 가려진다', () => {
  const key = 'P'.repeat(56);
  withEnv({ PEXELS_API_KEY: key }, () => {
    assert.ok(!pexels.mask(`요청 실패 Authorization: ${key}`).includes(key));
  });
});

test('키가 없으면 그 자리를 비운다 (지어내지 않는다)', async () => {
  await withEnv({ PEXELS_API_KEY: undefined }, async () => {
    const r = await pexels.search({ query: 'factory' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);
    assert.match(r.error, /그 자리를 비운다/);
  });
});

test('.env.example 과 npm 스크립트가 걸려 있다', () => {
  const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
  assert.match(env, /PEXELS_API_KEY=/);
  assert.match(env, /이 사업의 현장이 아니다/, '.env 만 봐도 성격을 알아야 한다');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['im:image']);
});

test('★ 미결정이 등록부에 있다 (인물·라이선스)', () => {
  const reg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');
  assert.match(reg, /D-50\./);
  assert.match(reg, /Pexels/);
});
