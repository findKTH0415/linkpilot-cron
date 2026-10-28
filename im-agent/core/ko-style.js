'use strict';
/**
 * ko-style.js — 한국어 AI 표현 점검 (사업제안서·IM·보고서) 〈2026-10-27 · CLAUDE.md §29〉
 *   원문: docs/운영지침-한국어AI표현교정-v1.0.md (im-not-ai 취지 참고 · 별도 작성판)
 *
 * ★ 고치지 않고 «찾기만» 한다. 지침 §2·§7.3 — 표현을 줄이다 조건·예외가 사라지면 안 되므로 교정은 사람(또는 06 의 지시문)이 한다.
 * ★ 낱말을 일괄 금지하지 않는다(지침 §3 끝). 그래서 «근거 없는 과장»은 MINOR(알림)이고,
 *   판단을 바꾸는 «불확실성 격상»(목표→보장 · 협의→확보)만 MAJOR 다 (지침 §4).
 * ★ 문맥을 못 보는 검사라 «원문에 그 근거가 있는가»는 모른다 — 걸린 줄은 사람이 확인한다. 통과로도 실패로도 단정하지 않는다.
 */

/* 근거 없이 쓰면 과장이 되는 수식어 (지침 §3 「과도한 수식」 · §8 예시) */
const HYPE = ['최고의', '최상의', '혁신적인', '혁신적으로', '획기적인', '압도적인', '독보적인', '완벽한', '새로운 지평', '게임체인저', '세계 최초', '국내 최초'];
/* 판단을 바꾸는 격상 표현 (지침 §4 — 목표 수익률을 보장 수익률로 · 협의 중을 확보로) */
const UPGRADE = [
  { re: /(수익률?|수익|원금|이자)\s*(을|를|이|가)?\s*보장/, why: '«보장»은 계약상 보장이 있을 때만 쓴다 — 목표·예상 수익을 보장으로 적지 않는다' },
  { re: /보장\s*(수익률|수익|금리)/, why: '«보장 수익률»은 계약 근거가 있을 때만 쓴다' },
  { re: /(승인|허가|인가)\s*(이|가)?\s*(확정|완료)\s*(되었|됐|된|됨)/, why: '«승인 확정»은 승인서가 있을 때만 쓴다 — 신청·협의 단계를 확정으로 적지 않는다' },
  { re: /(투자|자금|대출|PF)\s*(을|를|이|가)?\s*확보(했|하였|됨|된|되었)/, why: '«확보»는 약정·확약서가 있을 때만 쓴다 — 협의 중을 확보로 적지 않는다' },
  { re: /무조건|반드시\s*(성공|수익|회수)|리스크\s*(가|는)?\s*없(다|습니다|음)/, why: '불확실성을 지우는 단정 — 남는 위험을 함께 적는다' },
];
/* 본문에 들어가면 안 되는 작성 과정·AI 역할 설명 (지침 §3 「불필요한 자체 설명」 · §10-8) */
const SELF = /(AI|인공지능|챗봇|언어\s*모델|GPT|Claude|Gemini)\s*(가|이|로|를|에\s*의해)?\s*(작성|생성|분석|정리)|본\s*(문서|보고서|자료)는\s*.{0,20}(작성|생성)되었|자동\s*생성된\s*(문서|보고서)/;
/* 연결어 (지침 §3 「연결어 과다」) — 한 문단에 셋 넘게 쓰면 알린다 */
const CONNECT = /(^|[\s(])(또한|아울러|더불어|나아가|뿐만\s*아니라|한편)(?=[\s,])/g;

function stripMarkdown(line) {
  return line.replace(/`[^`]*`/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '');
}

/** 본문 줄만 — 표·제목·인용(출처표)·코드는 뺀다 (표·요약은 «검토 필요» 같은 간결형을 쓸 수 있다 · 지침 §5) */
function bodyLines(text) {
  const out = [];
  let code = false;
  String(text || '').split('\n').forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { code = !code; return; }
    if (code) return;
    const s = raw.trim();
    if (!s || /^[#|>]/.test(s) || /^[-*]\s*$/.test(s) || /^---+$/.test(s)) return;
    out.push({ line: i + 1, text: stripMarkdown(s) });
  });
  return out;
}

/** 문장 끝 형식 — 한다체 / 합니다체 (지침 §5 「한 형식을 선택한다」) */
function endings(text) {
  let han = 0, hap = 0;
  for (const { text: s } of bodyLines(text)) {
    for (const sent of s.split(/(?<=[.!?])\s+/)) {
      const t = sent.trim().replace(/[)"'」』\]]+$/, '');
      if (/(습니다|입니다|됩니다|십시오|합니다)\.$/.test(t)) hap++;
      else if (/(다)\.$/.test(t)) han++;
    }
  }
  return { han, hap };
}

/**
 * @param {string} text  IM·보고서 본문(마크다운)
 * @returns {{findings: Array<{code,severity,line,match,why}>, endings:{han,hap}}}
 */
function lint(text) {
  const findings = [];
  const add = (code, severity, line, match, why) => findings.push({ code, severity, line, match, why });
  const lines = bodyLines(text);
  for (const { line, text: s } of lines) {
    for (const w of HYPE) if (s.includes(w)) add('STYLE_HYPE', 'MINOR', line, w, '근거 없는 과장 수식 — 실제 내용으로 바꾸거나 근거를 붙인다 (지침 §3)');
    for (const u of UPGRADE) { const m = s.match(u.re); if (m) add('STYLE_UNCERTAINTY_UPGRADE', 'MAJOR', line, m[0], u.why + ' (지침 §4)'); }
    const sm = s.match(SELF); if (sm) add('STYLE_SELF_DESC', 'MINOR', line, sm[0], '작성 과정·AI 역할 설명은 본문 밖에 둔다 (지침 §3 · §7.5)');
    const cn = s.match(CONNECT) || [];
    if (cn.length > 3) add('STYLE_CONNECTOR', 'MINOR', line, `연결어 ${cn.length}개`, '또한·아울러·더불어는 필요한 자리에만 (지침 §3)');
  }
  const e = endings(text);
  const minor = Math.min(e.han, e.hap);
  if (minor >= 2 && minor / (e.han + e.hap) >= 0.15) add('STYLE_MIXED_ENDING', 'MINOR', null, `한다체 ${e.han} · 합니다체 ${e.hap}`, '본문은 «한다» 또는 «합니다» 한 형식으로 (지침 §5)');
  return { findings, endings: e };
}

module.exports = { lint, HYPE, UPGRADE, bodyLines, endings };
