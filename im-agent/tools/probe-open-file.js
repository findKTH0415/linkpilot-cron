'use strict';
/**
 * probe-open-file.js — **[열기]로 연 것이 실제로 읽히는가.**
 *
 * ★★★ 왜 만들었나 〈2026-08-25 · M-35 · 사장님: 「결과물은 오류·버그 투성이」〉.
 *
 *   IM 본문을 열었더니 `蹂묒뿭` 로 깨져 나왔다. **문서는 멀쩡했고 보는 길만
 *   틀렸다.** 하루 전에 내가 [열기] 인증을 고치며 `r.blob()` 으로 바꿨는데,
 *   blob 으로 열면 **브라우저가 응답의 글자표(charset)를 무시할 수 있다.**
 *
 * ★★ **안 열리는 것보다 나쁘다.** 안 열리면 「못 열었다」로 읽지만, 깨져서
 *   열리면 **「만들어진 것이 잘못됐다」**로 읽는다 — 멀쩡한 엔진을 뒤지게 된다.
 *
 * ★★★ **§8 은 「헤드리스로 실제 렌더를 확인한다」인데 파일 여는 길에는 그
 *   검사가 없었다.** 있었으면 그 자리에서 잡혔다. 여기가 그 자리다.
 *
 * ★ 재는 방식 — **화면의 코드를 베끼지 않는다.** `reports.html` 에서 실제
 *   함수를 잘라 내 브라우저에서 돌린다. 베끼면 화면이 바뀐 날부터 검사만
 *   옛말을 하고, 그때는 아무도 눈치채지 못한다 (§8).
 *
 * ★ 서버가 실제로 무엇을 보내는지도 함께 쓴다 — 응답을 흉내내지 않고
 *   진짜 핸들러(`getFile`)가 정한 딱지와 진짜 파일 바이트를 그대로 replay 한다.
 *
 * 되돌아오는 값: 0 다 읽힌다 · 1 깨지거나 안 열린다 · 2 못 쟀다
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = path.join(ROOT, 'ui', 'platform');

/** 깨지면 바로 보이는 글자들 — 받침·한자·기호를 섞는다 */
const KO = '보고서 목적 · 연면적 52,822㎡ · 총사업비 3,200억원 · 「출처 없는 숫자」';

/** 화면에서 함수 하나를 글자 그대로 잘라 온다 (베끼지 않는다) */
function fromScreen(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error(`reports.html 에서 ${name}() 을 못 찾았다`);
  let i = src.indexOf('{', at);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error(`${name}() 의 끝을 못 찾았다`);
}

/** 진짜 PDF 로 보이는 최소 바이트 — 글자로 바꾸면 깨진다 */
function pdfBytes() {
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'),
    Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x81, 0x0a]),   // 이진 그대로여야 하는 자리
    Buffer.from('\n%%EOF\n', 'latin1'),
  ]);
}

async function probe() {
  const B = require(path.join(P, 'build-static.js'));
  const browser = B.findBrowser();
  if (!browser) return { measured: false, why: '크로미움이 없다' };

  const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-open-'));
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = agentRoot;

  let cases;
  try {
    const store = require(path.join(ROOT, 'core/store'));
    const api = require(path.join(ROOT, 'ui/report-api.cjs'));
    const id = store.nextProjectId('datacenter');
    store.createProjectDirs(id);

    const dir = store.projectDir(id);
    const put = (rel, buf) => {
      const f = path.join(dir, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, buf);
    };
    put('09_IM/im.md', Buffer.from(`# ${KO}\n`, 'utf8'));
    put('12_Final/im-a4.html', Buffer.from(
      `<!doctype html><meta charset="utf-8"><body>${KO}</body>`, 'utf8'));
    put('12_Final/im-a4.pdf', pdfBytes());

    const h = api.createHandlers({
      agentRoot,
      agentModulePath: ROOT,
      authenticate: () => ({ name: '검증', planId: 'pro', status: 'active' }),
    });

    /* ★ 서버가 **실제로** 정한 딱지와 바이트를 그대로 들고 간다 */
    cases = await Promise.all(['09_IM/im.md', '12_Final/im-a4.html', '12_Final/im-a4.pdf']
      .map(async (rel) => {
        const r = await h.getFile({}, id, rel);
        if (!r || !r.file) throw new Error(`${rel}: 서버가 파일을 안 준다 — ${JSON.stringify(r && r.body)}`);
        return {
          rel,
          type: r.contentType,
          b64: fs.readFileSync(r.file).toString('base64'),
          want: /\.pdf$/.test(rel) ? '%PDF' : KO,
        };
      }));
  } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = before;
  }

  const src = fs.readFileSync(path.join(P, 'reports.html'), 'utf8');
  const lifted = ['textTypeFor', 'fetchAsBlob'].map((n) => fromScreen(src, n)).join('\n\n');

  const page = [
    '<!doctype html><html><head><meta charset="utf-8"></head><body>',
    '<scr' + 'ipt>window.LP_PROBE = '
      + JSON.stringify({ cases, want: KO }).replace(/</g, '\\u003C') + ';</scr' + 'ipt>',
    /* ★ 화면의 진짜 함수를 잘라 넣는다 (베끼지 않는다) */
    '<scr' + 'ipt>' + lifted.replace(/<\/(script)/gi, '<\\/$1') + '</scr' + 'ipt>',
    /* ★ 재는 쪽은 **진짜 파일**이다. 문자열에 넣으면 역슬래시가 먹혀 정규식이 깨진다 */
    '<scr' + 'ipt>' + fs.readFileSync(path.join(__dirname, 'probe-open-file.browser.js'), 'utf8')
      .replace(/<\/(script)/gi, '<\\/$1') + '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');

  const tmp = process.env.LP_PROBE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'open-probe-'));
  fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, 'probe.html');
  fs.writeFileSync(file, page, 'utf8');

  const dom = B.renderDom(browser, file, 12000, 900);
  const m = dom.match(/data-lp-open="([^"]*)"/);
  if (!m) return { measured: false, why: '재고 나서 결과를 못 남겼다' };
  try {
    return { measured: true, rows: JSON.parse(m[1].replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) };
  } catch (e) { return { measured: false, why: '결과를 못 읽었다: ' + e.message }; }
}

function verdict(r) {
  if (!r.measured) return { code: 2, line: `못 쟀다 — ${r.why}` };
  const rows = r.rows || [];
  if (rows.length !== 3) return { code: 2, line: `${rows.length}개만 쟀다 — 셋이어야 한다` };
  const bad = rows.filter((x) => !x.ok);
  if (bad.length) {
    return { code: 1, line: bad.map((x) => `${x.rel}: ${x.why}`).join(' · ') };
  }
  return { code: 0, line: `${rows.length}개 다 열어서 읽힌다 (${rows.map(x => x.rel.split('/').pop()).join(' · ')})` };
}

module.exports = { probe, verdict, KO };

if (require.main === module) {
  probe().then((r) => {
    const v = verdict(r);
    process.stdout.write(`[열기] 열어서 읽히는가: ${v.line}\n`);
    if (process.argv.includes('--verbose')) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(v.code);
  }).catch((e) => {
    process.stdout.write(`[열기] 열어서 읽히는가: 재다가 죽었다 — ${e.message}\n`);
    process.exit(2);
  });
}
