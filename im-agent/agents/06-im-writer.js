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
const a4 = require('../design/a4');
const contentJson = require('../design/content');
const designCheck = require('../design/check');
const { grade: confGrade, BODY_MARK } = require('../core/confidence');
const designState = require('../core/design-state');
const layouts = require('../design/layouts');

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    docType: { type: 'string', nullable: true },
    theme: { type: 'object', nullable: true },
    financial: { type: 'object', nullable: true },
    research: { type: 'object', nullable: true },
    validation: { type: 'object', nullable: true },
    geo: { type: 'object', nullable: true },
    appraisal: { type: 'object', nullable: true },
    massing: { type: 'object', nullable: true },
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
    html: { type: 'string' },
    content: { type: 'object' },
    designViolations: { type: 'array' },
    theme: { type: 'object' },
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
  if (unit === '원/㎡') return `${fmt(v, 0)}원/㎡`;
  if (unit === 'm') return `${fmt(v, 1)}m`;
  if (unit === '층') return `${fmt(v, 0)}층`;
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
      source: f.source, confidence: f.confidence, note: f.note,
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
      citations.push({ key, label: labelFor(key), value: displayValue(key, f), citation: f.citation(), verified: f.verified, source: f.source, confidence: f.confidence, note: f.note });
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
  const assumedCount = (financial.assumed || []).length;
  return [head, sep, body, '',
    `자료출처: 본 자료 재무모델(04_financial) 산출치. 문서 확인값 ${(financial.sourcedFields || []).length}건 · 통상치 가정 ${assumedCount}건 기준.`,
  ].join('\n');
}

function sensitivityTable(financial) {
  const s = financial && financial.sensitivity;
  if (!s) return '(민감도 미산출)';
  const head = `| ${s.rowLabel} \\ ${s.colLabel} | ${s.cols.map(c => fmt(c, 2)).join(' | ')} |`;
  const sep = `|---|${s.cols.map(() => '---:').join('|')}|`;
  const body = s.rows.map(r =>
    `| ${fmt(r.a, 2)} | ${r.cells.map(c => (c === null ? '-' : pct(c, 1))).join(' | ')} |`).join('\n');
  return [`지표: ${s.metric}`, '', head, sep, body, '',
    '자료출처: 본 자료 재무모델 민감도 산출치. Base 시나리오 입력을 축별로 변동시킨 결과.'].join('\n');
}

function flagsTable(validation) {
  if (!validation || !validation.flags) return '(검증 미실행)';
  const icon = { RED: '[RED]', YELLOW: '[YELLOW]', GREEN: '[GREEN]', INFO: '[안내]' };
  const rows = validation.flags
    .filter(f => f.severity !== 'GREEN')
    .map(f => `| ${icon[f.severity] || `[${f.severity}]`} | ${f.type} | ${f.message} |`);
  if (!rows.length) return ['중대 위험요인 미검출 (RED/YELLOW 없음)', '',
    '자료출처: 본 자료 교차검증(05_validation) 결과.'].join('\n');
  return ['| 구분 | 유형 | 내용 |', '|---|---|---|', ...rows, '',
    '자료출처: 본 자료 교차검증(05_validation) 결과. 원본자료 간 값 불일치·법정한도 초과·정합성 위반을 자동 검출한 것이다.'].join('\n');
}

/** 입지·지적 표. 인증키가 들어간 이미지 URL은 절대 넣지 않는다(공개 지도 링크만). */
function geoTable(geo) {
  if (!geo || !geo.geo) return '_공공데이터 입지조회 미실행 (VWORLD_KEY 미설정 또는 소재지 미확인)_';
  const rows = [
    ['좌표', `${geo.geo.lat}, ${geo.geo.lon}`, 'VWorld 지오코딩'],
    ['지도', geo.geo.mapLink ? `[지도에서 보기](${geo.geo.mapLink})` : '-', 'VWorld'],
  ];
  if (geo.parcel) {
    rows.push(['필지고유번호(PNU)', geo.parcel.pnu || '-', 'VWorld 연속지적도']);
    rows.push(['공부상 대지면적', geo.parcel.officialAreaSqm ? `${fmt(geo.parcel.officialAreaSqm, 0)}㎡` : '-', '지적공부']);
    if (geo.parcel.polygonAreaSqm) rows.push(['지적도 실측 면적', `${fmt(geo.parcel.polygonAreaSqm, 0)}㎡`, '지적도 폴리곤 계산']);
  }
  if (geo.landUse) {
    rows.push(['용도지역', geo.landUse.zone, 'VWorld 토지이용계획']);
    if (geo.landUse.limits) {
      rows.push(['법정 용적률 상한', `${geo.landUse.limits.far}%`, geo.landUse.limitsSource]);
      rows.push(['법정 건폐율 상한', `${geo.landUse.limits.bcr}%`, geo.landUse.limitsSource]);
    }
  }
  if (geo.building) {
    rows.push(['기존 건축물 연면적', geo.building.totalAreaSqm ? `${fmt(geo.building.totalAreaSqm, 0)}㎡` : '-', '건축물대장']);
    rows.push(['사용승인일', geo.building.approvalDate || '-', '건축물대장']);
  }
  if (geo.geo.satelliteImage) rows.push(['위성영상', `\`${geo.geo.satelliteImage}\``, 'VWorld 위성영상']);

  return ['| 항목 | 내용 | 출처 |', '|---|---|---|', ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`), '',
    '자료출처: 국토교통부 공간정보 오픈플랫폼(VWorld) 지오코딩·연속지적도·토지이용계획, 국토교통부 건축물대장. 조회 시점 기준.'].join('\n');
}

/** 매스 검토표 + 3D 산출물 안내 */
function massingTable(massing) {
  if (!massing || !massing.inputs || !massing.inputs.landAreaSqm) return '_매스 검토 미실행 (대지면적 미확인)_';
  const i = massing.inputs;
  const rows = [
    ['대지면적', `${fmt(i.landAreaSqm, 0)}㎡`],
    ['계획 연면적', i.gfaSqm ? `${fmt(i.gfaSqm, 0)}㎡` : '미확인'],
    ['법정 허용 연면적', i.gfaAllowedSqm ? `${fmt(i.gfaAllowedSqm, 0)}㎡ (용적률 ${i.farLimit}%)` : '용도지역 미확인'],
    ['계획 용적률', i.farPlanned !== null ? `${i.farPlanned}%` : '-'],
    ['계획 건폐율', i.bcrPlanned !== null ? `${i.bcrPlanned}%` : '-'],
    ['지상 층수', `${i.floors}층`],
  ];
  if (massing.model) rows.push(['매스 높이', `${massing.model.heightM}m (층고 ${massing.model.floorHeight}m 가정)`]);
  if (i.limitSource) rows.push(['법정 한도 근거', i.limitSource]);

  const table = ['| 항목 | 값 |', '|---|---:|', ...rows.map(r => `| ${r[0]} | ${r[1]} |`), '',
    `자료출처: 대지·연면적은 원본자료 및 지적공부, 법정 한도는 ${i.limitSource || '용도지역 미확인'}. 계획 용적률·건폐율은 본 자료 산출치.`].join('\n');
  const files = (massing.files || []).length
    ? `\n\n3D 매스 산출물: ${massing.files.map(f => `\`${f}\``).join(' · ')}\n\n> ${massing.model ? massing.model.footprintBasis : ''} — 용적률·건폐율 검토용 매스이며 설계안이 아니다.`
    : '';
  return table + files;
}

/** 감정평가 3방식 요약표 (법적 고지 포함) */
function appraisalTable(appraisal) {
  if (!appraisal || !appraisal.methods || !Object.keys(appraisal.methods).length) {
    return '_감정평가 미실행 (공시지가·실거래·재무모델 중 확보된 자료 없음)_';
  }
  const rows = Object.values(appraisal.methods).map(m =>
    `| ${m.label} | ${m.valueEok !== null && m.valueEok !== undefined ? formatEok(m.valueEok) : '-'} | ${m.basis} |`);

  const out = ['| 평가방식 | 토지가치 | 산정근거 |', '|---|---:|---|', ...rows];
  if (appraisal.concluded) {
    out.push(`| **결론(가중평균)** | **${formatEok(appraisal.concluded.valueEok)}** | ${Object.entries(appraisal.concluded.weights).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')} |`);
  }
  out.push('', `> ${appraisal.disclaimer}`);
  out.push('', '자료출처: 개별공시지가·국토교통부 실거래가(공공데이터) 및 본 자료 재무모델. 3방식 가중평균은 본 자료 산출치.');

  const assumptions = Object.values(appraisal.methods).filter(m => m.assumption);
  if (assumptions.length) {
    out.push('', '적용 가정:', ...assumptions.map(m => `- ${m.label}: ${m.assumption}`));
  }
  if ((appraisal.comparables || []).length) {
    out.push('', `비교 거래사례 ${appraisal.comparables.length}건 (최근순 5건):`, '', '| 계약일 | 법정동 | 면적 | 거래금액 | 단가(원/㎡) |', '|---|---|---:|---:|---:|');
    for (const c of appraisal.comparables.slice(0, 5)) {
      out.push(`| ${c.dealDate || c.ym} | ${c.dong || '-'} | ${c.areaSqm ? fmt(c.areaSqm, 0) + '㎡' : '-'} | ${c.dealAmountEok !== null ? formatEok(c.dealAmountEok) : '-'} | ${c.pricePerSqm ? fmt(c.pricePerSqm, 0) : '-'} |`);
    }
    out.push('', '자료출처: 국토교통부 실거래가 공개시스템(공공데이터포털 API).');
  }
  return out.join('\n');
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

  const { financial, research, validation, geo, appraisal, massing } = input;
  // 서식 적용 구간 이탈 안내 (PDI SOLAR REPORT SPEC §10)
  const scaleNotice = (financial && financial.scaleNotice) || '';
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
    scaleNotice ? `>` : '',
    scaleNotice ? `> 서식 적용 구간 안내: ${scaleNotice}` : '',
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
          if (!citations.find(c => c.key === f.key)) citations.push({ key: f.key, label: f.label, value: f.display, citation: f.citation, verified: f.verified, source: f.source, confidence: f.confidence, note: f.note });
        });
      }
    }

    // 표 삽입 (전부 계산 결과 — LLM 무관)
    if (section.table === 'financial') text += `\n\n${financialTable(financial)}`;
    if (section.table === 'sensitivity') text = sensitivityTable(financial);
    if (section.table === 'flags') text += `\n\n${flagsTable(validation)}`;
    if (section.table === 'geo') text += `\n\n${geoTable(geo)}`;
    if (section.table === 'massing') text += `\n\n${massingTable(massing)}`;

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
    body.push('자료출처: 본 자료 자산유형별 재무 템플릿의 시장 통상치. 원본자료에서 확인되지 않아 적용된 가정값이다.');
    body.push('');
  }

  // 감정평가 부록 (부동산개발 프로젝트에서만 생성된다)
  if (appraisal && appraisal.concluded) {
    body.push('## 부록 C. 감정평가 요약 (참고용 간이 평가)\n');
    body.push(appraisalTable(appraisal));
    body.push('');
  }

  // 출처표
  body.push('## 부록 B. 수치 출처표\n');
  body.push('| 항목 | 값 | 출처 | 검증 |', '|---|---:|---|:--:|');
  for (const c of citations.sort((a, b) => a.key.localeCompare(b.key))) {
    body.push(`| ${c.label} | ${c.value} | ${c.citation} | ${c.verified ? 'O' : 'X'} |`);
  }
  body.push('');
  body.push('자료출처: 각 행에 표기된 원본자료·공공데이터 및 본 자료 산출치. 검증 O = 독립 출처 2건 이상 일치.');
  body.push('');
  body.push(`_${HOUSE_STYLE.footer}_`);

  const im = `${header}\n${body.join('\n')}`;

  // ── Teaser ──
  const teaserRows = TEASER_ITEMS.map(item => {
    const f = ds.get(item.key);
    if (!f) return `| ${item.label} | 자료 확인 필요 | - |`;
    if (!citations.find(c => c.key === item.key)) {
      citations.push({ key: item.key, label: item.label, value: displayValue(item.key, f), citation: f.citation(), verified: f.verified, source: f.source, confidence: f.confidence, note: f.note });
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

  // Confidence 등급(A~E)은 기존 값에서 파생한다 — 이중 관리하지 않는다
  for (const c of citations) c.grade = confGrade({ source: c.source || c.citation, confidence: c.confidence, verified: c.verified, note: c.note });

  const verifiedRatio = citations.length
    ? citations.filter(c => c.verified).length / citations.length
    : 0;
  const confidence = round(Math.max(0, verifiedRatio - unsourced.length * 0.05), 3);

  if (unsourced.length) {
    ctx.warn(`출처 없는 숫자 총 ${unsourced.length}건 — 승인 게이트에서 배포가 차단된다`);
  }

  // ── 디자인 산출물 (PDI 핸드오프 규격) ──────────────────────
  const docMeta = {
    projectId: input.projectId,
    projectName: name ? String(name.value) : input.projectId,
    assetType: ds.get('project.assetType') ? String(ds.get('project.assetType').value) : null,
    location: ds.get('project.location') ? String(ds.get('project.location').value) : null,
    scaleNotice,
    sections,
    citations,
    unsourcedNumbers: unsourced,
    validation,
    generatedAt: kstStamp(),
    valueRange: financial && financial.scenarios
      ? `${formatEok(financial.scenarios.downside.metrics.exitValue)} ~ ${formatEok(financial.scenarios.upside.metrics.exitValue)}`
      : null,
    kpis: buildKpis(financial, ds),
    disclaimers: buildDisclaimers(appraisal, massing, financial),
    assets: (massing && massing.files) || [],
  };

  // 사용자가 고른 디자인 테마 (없으면 기본). Content 와 Design 은 완전히 분리되어 있으므로
  // 테마를 바꿔 다시 렌더해도 위에서 만든 내용·수치는 그대로다.
  const theme = input.theme || designState.currentTheme(input.projectId, input.docType || 'im');
  docMeta.docType = theme.docType;

  let html = '';
  let designViolations = [];
  try {
    html = a4.render(docMeta, theme);
    const check = designCheck.checkHtml(html, { chapterCount: sections.length });
    const themeCheck = designCheck.checkThemeConsistency(html, theme);
    designViolations = [...check.violations, ...themeCheck.violations];
    for (const v of designViolations.filter(x => x.severity === 'RED')) {
      ctx.warn(`디자인 규칙 위반 [${v.rule}] ${v.message}`);
    }
  } catch (e) {
    ctx.warn(`A4 HTML 생성 실패: ${e.message}`);
  }

  const mdCheck = designCheck.checkMarkdown(im);
  for (const v of mdCheck.violations.filter(x => x.severity === 'RED')) {
    ctx.warn(`디자인 규칙 위반 [${v.rule}] ${v.message}`);
    designViolations.push(v);
  }

  return {
    im, teaser, sections, citations,
    unsourcedNumbers: unsourced,
    html,
    content: contentJson.build({ ...docMeta, theme }),
    designViolations,
    theme,
    layouts: layouts.assign(sections, theme).map(s => ({ no: s.no, id: s.id, layout: s.layout.id, reason: s.layout.reason })),
    generatedAt: docMeta.generatedAt,
    confidence,
  };
}

/** 표지 KPI 4개 — 전부 계산 결과이거나 출처 있는 값 */
function buildKpis(financial, ds) {
  const kpis = [];
  if (financial && financial.scenarios) {
    const m = financial.scenarios.base.metrics;
    kpis.push({ value: formatEok(m.totalProjectCost), label: 'Total Project Cost' });
    kpis.push({ value: pct(m.equityIRR), label: 'Equity IRR (Base)' });
    kpis.push({ value: m.minDSCR === null ? '-' : `${fmt(m.minDSCR, 2)}x`, label: 'Min DSCR' });
  }
  const gfa = ds.num('building.gfa_sqm');
  if (gfa) kpis.push({ value: `${fmt(gfa, 0)}㎡`, label: 'Gross Floor Area' });
  return kpis;
}

/** 중요 고지 문단 — 산출물 성격에 따라 자동 구성 */
function buildDisclaimers(appraisal, massing, financial) {
  const out = [
    '본 문서의 수치는 제출된 자료와 공공데이터에서 추출·계산된 값이며, 출처가 확인되지 않은 값은 본문에 사용되지 않았다. 투자수익 지표는 전부 결정적 재무모델의 계산 결과이며 생성형 모델이 만들어낸 값이 아니다.',
  ];
  if (appraisal && appraisal.disclaimer) out.push(appraisal.disclaimer);
  if (massing && massing.model) {
    out.push('본 문서에 포함된 3D 매스는 용적률·건폐율 검토용 볼륨이며 건축 설계안이 아니다. 실시설계·인허가 도서와 다를 수 있다.');
  }
  if (financial && (financial.assumed || []).length) {
    out.push(`재무모델 입력 중 ${financial.assumed.length}건은 문서에서 확인되지 않아 시장 통상치를 적용한 가정값이다. 해당 항목은 부록 A에 전량 명시했다.`);
  }
  out.push('본 자료는 최종 투자판단 자료가 아니며, 교차검증(Cross Validation)과 사람의 승인을 거치지 않은 상태에서 배포될 수 없다.');
  return out;
}

module.exports = {
  id: '06_im_writer', label: 'IM Writer Agent',
  inputSchema, outputSchema, run,
  findUnsourcedNumbers, substitute, displayValue, financialTable, geoTable, massingTable, appraisalTable, buildKpis, buildDisclaimers,
};
