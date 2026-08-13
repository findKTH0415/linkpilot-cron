'use strict';
/**
 * 06 IM Writer Agent
 *
 * ★ 환각 방지 장치 (이 저장소에서 가장 중요한 부분)
 *   1) Writer는 Dataset의 '검증된 값'과 '계산된 지표'만 볼 수 있다.
 *   2) 본문에 숫자를 직접 쓰는 것을 금지하고, 반드시 {{key}} 자리표시자로만 쓰게 한다.
 *   3) 생성된 원문(치환 전)에 남아 있는 숫자는 전부 '출처 없는 숫자'로 검출한다.
 *   4) 검출된 숫자는 unsourcedNumbers 에 기록되고, 승인 게이트가 배포를 차단한다.
 *
 * 오프라인(LLM 없음)에서도 데이터 기반 IM 골격 + 수치표 + 출처표는 생성된다.
 */

const { FIELDS, field: dictField, labelFor } = require('../core/dictionary');
const { formatEok, fmt, pct, round } = require('../core/numeric');
const { kstDate, kstStamp } = require('../core/kst');
const { IM_SECTIONS, TEASER_ITEMS, HOUSE_STYLE } = require('../templates/im-outline');
const llm = require('../core/llm');

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    financial: { type: 'object', nullable: true },
    research: { type: 'object', nullable: true },
    validation: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['im', 'teaser', 'unsourcedNumbers'],
  properties: {
    im: { type: 'string', minLength: 50 },
    teaser: { type: 'string', minLength: 20 },
    unsourcedNumbers: { type: 'array' },
    citations: { type: 'array' },
    sections: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

/** 본문에 써도 되는 숫자 패턴 (절 번호, 연도 등) */
const ALLOWED_NUMERIC = [
  /^\d{4}년$/,          // 연도
  /^\d{1,2}$/,          // 한두 자리 (순번/목록)
];

/**
 * 치환 전 텍스트에서 출처 없는 숫자를 찾는다.
 * {{key}} 안의 내용은 제외한다.
 */
function findUnsourcedNumbers(text) {
  const stripped = String(text).replace(/\{\{[^}]+\}\}/g, ' ');
  const hits = [];
  for (const m of stripped.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(%|억원|조원|㎡|MW|kW|배|년|x)?/g)) {
    const token = m[0].trim();
    if (!token) continue;
    if (ALLOWED_NUMERIC.some(re => re.test(token))) continue;
    hits.push({ token, index: m.index });
  }
  return hits;
}

/** Fact/지표를 표시 문자열로 */
function displayValue(key, fact) {
  const field = dictField(key);
  const unit = fact.unit || (field ? field.unit : null);
  const v = fact.value;
  if (typeof v !== 'number') return String(v);
  if (unit === '억원') return formatEok(v);
  if (unit === '%') return pct(v, 2);
  if (unit === 'x') return `${fmt(v, 2)}x`;
  if (unit === '㎡') return `${fmt(v, 0)}㎡`;
  if (unit === 'MW') return `${fmt(v, 1)}MW`;
  if (unit === 'kW') return `${fmt(v, 0)}kW`;
  if (unit === '년') return `${fmt(v, 1)}년`;
  return fmt(v, 2);
}

/**
 * Writer에게 노출할 Fact 목록.
 * 미검증 값도 노출하되 '미검증' 표시를 달아 본문에 그대로 반영되게 한다.
 */
function buildFactSheet(dataset, keys) {
  const sheet = [];
  for (const key of keys) {
    const f = dataset.get(key);
    if (!f) continue;
    sheet.push({
      key, label: labelFor(key),
      display: displayValue(key, f),
      citation: f.citation(),
      verified: f.verified,
    });
  }
  return sheet;
}

function substitute(text, dataset, citations) {
  return String(text).replace(/\{\{([^}]+)\}\}/g, (whole, rawKey) => {
    const key = rawKey.trim();
    const f = dataset.get(key);
    if (!f) return '[미확인]';
    if (!citations.find(c => c.key === key)) {
      citations.push({ key, label: labelFor(key), value: displayValue(key, f), citation: f.citation(), verified: f.verified });
    }
    return displayValue(key, f) + (f.verified ? '' : ' [미검증]');
  });
}

/** 재무 요약표 (숫자는 전부 계산 결과 — LLM 무관) */
function financialTable(financial) {
  if (!financial || !financial.scenarios) return '(재무모델 미생성)';
  const rows = [
    ['총사업비', m => formatEok(m.totalProjectCost)],
    ['차입금', m => formatEok(m.debtAmount)],
    ['자기자본', m => formatEok(m.equityAmount)],
    ['안정화 NOI', m => formatEok(m.noiStabilized)],
    ['Project IRR', m => pct(m.projectIRR)],
    ['Equity IRR', m => pct(m.equityIRR)],
    ['Equity MOIC', m => (m.equityMOIC === null ? '-' : `${fmt(m.equityMOIC, 2)}x`)],
    ['NPV', m => formatEok(m.npv)],
    ['최소 DSCR', m => (m.minDSCR === null ? '-' : `${fmt(m.minDSCR, 2)}x`)],
    ['Exit Value', m => formatEok(m.exitValue)],
  ];
  const scenarios = ['base', 'upside', 'downside'].filter(k => financial.scenarios[k]);
  const head = `| 항목 | ${scenarios.map(k => financial.scenarios[k].label).join(' | ')} |`;
  const sep = `|---|${scenarios.map(() => '---:').join('|')}|`;
  const body = rows.map(([label, f]) =>
    `| ${label} | ${scenarios.map(k => f(financial.scenarios[k].metrics)).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

function sensitivityTable(financial) {
  const s = financial && financial.sensitivity;
  if (!s) return '(민감도 미산출)';
  const head = `| ${s.rowLabel} \\ ${s.colLabel} | ${s.cols.map(c => fmt(c, 2)).join(' | ')} |`;
  const sep = `|---|${s.cols.map(() => '---:').join('|')}|`;
  const body = s.rows.map(r =>
    `| ${fmt(r.a, 2)} | ${r.cells.map(c => (c === null ? '-' : pct(c, 1))).join(' | ')} |`).join('\n');
  return [`지표: ${s.metric}`, '', head, sep, body].join('\n');
}

function flagsTable(validation) {
  if (!validation || !validation.flags) return '(검증 미실행)';
  const icon = { RED: '[RED]', YELLOW: '[YELLOW]', GREEN: '[GREEN]' };
  const rows = validation.flags
    .filter(f => f.severity !== 'GREEN')
    .map(f => `| ${icon[f.severity]} | ${f.type} | ${f.message} |`);
  if (!rows.length) return '중대 위험요인 미검출 (RED/YELLOW 없음)';
  return ['| 구분 | 유형 | 내용 |', '|---|---|---|', ...rows].join('\n');
}

async function writeNarrative(section, factSheet, researchText, ctx) {
  if (llm.isOffline()) return null;

  const factLines = factSheet.length
    ? factSheet.map(f => `- {{${f.key}}} = ${f.label}: ${f.display}${f.verified ? '' : ' (미검증)'} [출처: ${f.citation}]`).join('\n')
    : '(이 절에 사용 가능한 확정 수치 없음)';

  return llm.generate({
    system: [
      '너는 투자은행 IM 작성자다. PDI 하우스 스타일을 따른다: 이모지 금지, 개인 성명 미표기, 단정적 과장 금지.',
      '절대 규칙: 본문에 숫자를 직접 쓰지 않는다. 모든 수치는 제공된 {{key}} 자리표시자를 그대로 옮겨 쓴다.',
      '제공되지 않은 수치는 언급하지 않는다. 모르는 것은 "자료 확인 필요"로 쓴다.',
    ].join('\n'),
    prompt: `[절] ${section.no} ${section.title}

[이 절에서 쓸 수 있는 수치 — 이것 외의 숫자는 쓰지 마라]
${factLines}

${researchText ? `[참고 시장자료 — 수치 인용 금지, 서술 근거로만]\n${researchText}\n` : ''}
[작성 요구]
- 3~6문장, 한국어, 서술형.
- 숫자가 필요하면 반드시 {{key}} 형태로만 쓴다. 예: 총사업비는 {{investment.total}} 규모다.
- 자리표시자 목록에 없는 수치는 절대 만들지 마라.
- 제목·머리기호 없이 본문만 출력한다.`,
    temperature: 0.25,
    maxOutputTokens: 800,
  });
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const { financial, research, validation } = input;
  const citations = [];
  const unsourced = [];
  const sections = [];

  const name = ds.get('project.name');
  const header = [
    HOUSE_STYLE.header,
    '',
    `# Investment Memorandum`,
    '',
    `- Project: ${name ? name.value : input.projectId}`,
    `- Project ID: ${input.projectId}`,
    `- Date: ${kstDate()} (KST)`,
    validation ? `- QC: ${validation.verdict} (Total ${validation.score.total}/100)` : '',
    '',
    '> 본 문서의 모든 수치에는 출처가 표기되어 있으며, [미검증] 표기는 단일 출처로만 확인된 값이다.',
    '> 최종 배포 전 반드시 사람의 승인이 필요하다.',
    '',
  ].filter(Boolean).join('\n');

  const body = [];

  for (const section of IM_SECTIONS) {
    const factSheet = buildFactSheet(ds, section.dataKeys);
    let text = '';

    if (section.narrative) {
      let raw = null;
      try {
        raw = await writeNarrative(
          section, factSheet,
          section.research && research ? (research.sections || []).find(s => s.id === section.research)?.text : null,
          ctx,
        );
      } catch (e) {
        ctx.warn(`${section.no} ${section.title} 서술 생성 실패: ${e.message}`);
      }

      if (raw) {
        // ★ 치환 전 원문에서 출처 없는 숫자 검출
        const hits = findUnsourcedNumbers(raw);
        for (const h of hits) {
          unsourced.push({ section: `${section.no} ${section.title}`, token: h.token });
        }
        if (hits.length) {
          ctx.warn(`${section.no} ${section.title}: 출처 없는 숫자 ${hits.length}건 검출 — ${hits.slice(0, 3).map(h => h.token).join(', ')}`);
        }
        text = substitute(raw, ds, citations);
      } else {
        // 오프라인/실패 시: 데이터만으로 구성 (서술 없음)
        text = factSheet.length
          ? factSheet.map(f => `- ${f.label}: ${f.display}${f.verified ? '' : ' [미검증]'} (출처: ${f.citation})`).join('\n')
          : (section.table ? '' : '_자료 미확보 — 원본자료 보완 필요_'); // 표가 붙는 절에는 자리표시 문구를 넣지 않는다
        factSheet.forEach(f => {
          if (!citations.find(c => c.key === f.key)) citations.push({ key: f.key, label: f.label, value: f.display, citation: f.citation, verified: f.verified });
        });
      }
    }

    // 표 삽입 (전부 계산 결과 — LLM 무관)
    if (section.table === 'financial') text += `\n\n${financialTable(financial)}`;
    if (section.table === 'sensitivity') text = sensitivityTable(financial);
    if (section.table === 'flags') text += `\n\n${flagsTable(validation)}`;

    // 데이터 요약을 서술 아래에 항상 덧붙인다 (숫자의 출처 추적성 확보)
    if (section.narrative && factSheet.length && text && !text.startsWith('- ')) {
      text += '\n\n' + factSheet.map(f => `- ${f.label}: ${f.display}${f.verified ? '' : ' [미검증]'} (출처: ${f.citation})`).join('\n');
    }

    sections.push({ no: section.no, id: section.id, title: section.title, text });
    body.push(`## ${section.no}. ${section.title}\n\n${text || '_해당 자료 없음_'}\n`);
  }

  // 가정표
  if (financial && (financial.assumed || []).length) {
    body.push('## 부록 A. 가정치 (문서 미확인 · 시장 통상치 적용)\n');
    body.push('| 항목 | 적용값 | 근거 |', '|---|---:|---|');
    body.push(...financial.assumed.map(a => `| ${a.field} | ${fmt(a.value, 2)} | ${a.reason} |`));
    body.push('');
  }

  // 출처표
  body.push('## 부록 B. 수치 출처표\n');
  body.push('| 항목 | 값 | 출처 | 검증 |', '|---|---:|---|:--:|');
  for (const c of citations.sort((a, b) => a.key.localeCompare(b.key))) {
    body.push(`| ${c.label} | ${c.value} | ${c.citation} | ${c.verified ? 'O' : 'X'} |`);
  }
  body.push('');
  body.push(`_${HOUSE_STYLE.footer}_`);

  const im = `${header}\n${body.join('\n')}`;

  // ── Teaser ──
  const teaserRows = TEASER_ITEMS.map(item => {
    const f = ds.get(item.key);
    if (!f) return `| ${item.label} | 자료 확인 필요 | - |`;
    if (!citations.find(c => c.key === item.key)) {
      citations.push({ key: item.key, label: item.label, value: displayValue(item.key, f), citation: f.citation(), verified: f.verified });
    }
    return `| ${item.label} | ${displayValue(item.key, f)}${f.verified ? '' : ' [미검증]'} | ${f.citation()} |`;
  });

  const teaser = [
    HOUSE_STYLE.header, '',
    `# Project Teaser — ${name ? name.value : input.projectId}`,
    `Date: ${kstDate()} (KST)`, '',
    '| 항목 | 내용 | 출처 |', '|---|---|---|',
    ...teaserRows, '',
    '## Key Risks', '',
    flagsTable(validation), '',
    `_${HOUSE_STYLE.footer}_`,
  ].join('\n');

  const verifiedRatio = citations.length
    ? citations.filter(c => c.verified).length / citations.length
    : 0;
  const confidence = round(Math.max(0, verifiedRatio - unsourced.length * 0.05), 3);

  if (unsourced.length) {
    ctx.warn(`출처 없는 숫자 총 ${unsourced.length}건 — 승인 게이트에서 배포가 차단된다`);
  }

  return {
    im, teaser, sections, citations,
    unsourcedNumbers: unsourced,
    generatedAt: kstStamp(),
    confidence,
  };
}

module.exports = {
  id: '06_im_writer', label: 'IM Writer Agent',
  inputSchema, outputSchema, run,
  findUnsourcedNumbers, substitute, displayValue, financialTable,
};
