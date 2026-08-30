'use strict';
/**
 * appview.js — **앱 자리 지도를 만든다** 〈2026-08-30 사장님 지시 · D-185〉.
 *
 * 사장님 지시: 「지금부터 (NAS 뿌리 주소) 여기로 보여지는 **앱환경의 기준으로
 * 대화가 되어야함** · 그것을 html url 로 링크하여 **항상 미리보기 창에 보여줘**」.
 *
 * ★★★ **왜 장치로 만드나.** 규칙을 문서에만 적으면 그 규칙은 **사람의 기억에
 *   얹힌다** — 이 저장소는 그것으로 하루 반 동안 여섯 번 빠뜨렸다 (M-31).
 *   그래서 「앱 기준으로 말한다」를 **한 줄로 도는 것**으로 바꾼다.
 *
 * ★ 여기서 만드는 것은 **지도**이지 앱 화면이 아니다. 미리보기는 tailnet 밖이라
 *   앱 화면 자체를 그릴 수 없다 — 그 사실을 판에 적어 둔다 (없는 것을 그리지 않는다).
 *
 * ★★ **주소는 여기 안 적는다** (D-10 — 이 저장소는 public). 주소는 `LP_APP_BASE`
 *   로 받고, 안 주면 자리를 비운 채 「주소를 안 받았다」로 그린다 —
 *   비어 있다는 사실이 판에 보이는 편이, 그럴듯한 가짜 주소보다 낫다.
 *
 *   npm run im:appview            판을 만든다
 *   npm run im:appview -- --check 지금 판이 지문·단계 수와 맞는지만 잰다
 */

const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..', 'ui', 'platform');
const SRC = path.join(HERE, 'appview-source.html');
const OUT = path.join(__dirname, '..', '..', '.appview', 'appview.html');

const FLOW = require(path.join(HERE, 'flow-core.js'));
const stamp = require(path.join(HERE, 'build-stamp.js'));

/** 앱 주소 — 받은 것만 쓴다. 없으면 없다고 그린다 (§2 · D-10) */
function appBase() {
  const v = String(process.env.LP_APP_BASE || '').trim();
  return v ? v.replace(/\/+$/, '') : null;
}

function build() {
  if (!fs.existsSync(SRC)) throw new Error(`판의 바탕이 없다: ${SRC}`);
  let html = fs.readFileSync(SRC, 'utf8');

  const want = stamp.bundleHash();
  const screens = stamp.pages().length;
  const steps = FLOW.SECTIONS.length;
  const base = appBase();

  /* ★ 숫자를 손으로 안 적는다 — 재서 넣는다. 손으로 적으면 코드가 바뀐 날부터
   *   화면만 옛말을 하고, 그때는 아무도 눈치채지 못한다 (M-05). */
  html = html
    .replace(/942097fb/g, want)
    .replace(/화면 7개 · 단계 6개/g, `화면 ${screens}개 · 단계 ${steps}개`);

  /* ★★★ **주소는 저장소에 없다** (§2 — NAS 접속정보). 바탕에는 자리만 있고,
   *   값은 `LP_APP_BASE` 로 들어온다. 안 받으면 **자리를 비운 채** 그린다 —
   *   비어 있다는 사실이 판에 보이는 편이 그럴듯한 가짜 주소보다 낫다. */
  const host = base ? base.replace(/^https?:\/\//, '') : '(앱 주소를 안 받았다)';
  html = html
    .replace(/\{\{APP_BASE\}\}/g, base || '#')
    .replace(/\{\{APP_HOST\}\}/g, host);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  return { out: OUT, want, screens, steps, base: !!base };
}

/** 지금 판이 지문과 맞는가. 안 맞으면 **옛 지도를 드리는 것**이라 더 나쁘다 */
function check() {
  if (!fs.existsSync(OUT)) return { ok: false, line: '아직 안 만들었다 — `npm run im:appview`' };
  const html = fs.readFileSync(OUT, 'utf8');
  const want = stamp.bundleHash();
  if (html.indexOf(want) === -1) {
    return { ok: false, line: `지도가 옛 지문을 말한다 — 지금은 ${want} 다. 다시 만든다` };
  }
  return { ok: true, line: `지도가 지금 판(${want})과 같다` };
}

if (require.main === module) {
  const wantCheck = process.argv.includes('--check');
  try {
    if (wantCheck) {
      const r = check();
      process.stdout.write(`\n  ${r.ok ? '●' : '✕'} 앱 자리 지도 — ${r.line}\n\n`);
      process.exit(r.ok ? 0 : 1);
    }
    const r = build();
    process.stdout.write(`\n  ● 앱 자리 지도 — ${path.relative(process.cwd(), r.out)}`
      + ` (지문 ${r.want} · 화면 ${r.screens}개 · 단계 ${r.steps}개`
      + `${r.base ? '' : ' · **앱 주소를 안 받았다** — LP_APP_BASE 로 준다'})\n`
      + '    ★ 이 판은 **지도**다. 앱 화면 자체는 tailnet 안에서만 보인다\n\n');
    process.exit(0);
  } catch (e) {
    process.stdout.write(`\n  ✕ 앱 자리 지도 — ${e.message}\n\n`);
    process.exit(1);
  }
}

module.exports = { build, check, SRC, OUT };
