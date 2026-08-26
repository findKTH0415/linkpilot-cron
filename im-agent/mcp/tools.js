'use strict';
/**
 * mcp/tools.js — LinkPilot 을 **내보내는** 길의 도구 표 (D-83).
 *
 * ★★★ **MCP 는 값을 들여오는 길이 아니다.** 들여오는 길은 `connectors/` 의 REST
 *   커넥터 그대로다. 여기서 MCP 가 하는 일은 **엔진이 이미 가진 것을 꺼내 주는
 *   것뿐**이고, 그래서 출처가 그대로 따라온다 (D-83 권고).
 *
 * ★★ **이 표는 `ui/api-router.cjs` 의 읽기 라우트 위에만 선다.**
 *   그 파일은 처음부터 읽기 전용이고, 인증 의존성도 시크릿도 없다.
 *   쓰기 표(`ui/report-api.cjs`)는 **일부러 붙이지 않았다** — 붙이는 순간
 *   대화가 남의 프로젝트를 고칠 수 있게 된다.
 *
 *   ★ 핸들러를 손으로 옮겨 적지 않는다. 라우트 표에서 찾아 부른다 —
 *     베껴 적으면 라우트가 바뀐 날 이쪽만 옛말을 한다 (`routes.cjs` 머리말).
 *     `mcp.test.js` 가 「표의 모든 도구가 실제 GET 라우트인가」를 고정한다.
 *
 * ★ 값을 만들지 않는다. 계산·요약·추정을 여기서 하지 않는다 (§4.8).
 *   숫자가 필요하면 엔진이 낸 것을 **출처째** 옮긴다.
 *
 * 의존성 0건.
 */

const path = require('path');
const api = require('../ui/api-router.cjs');
const routes = require('../ui/routes.cjs');

/** 한 번에 실어 보내는 원본 JSON 의 상한. 넘으면 **잘랐다고 적는다** */
const MAX_JSON_CHARS = 20000;

/**
 * 도구 하나 = 읽기 라우트 하나.
 *
 *   handler  `api-router.cjs` 의 핸들러 이름 — 그쪽이 단일 출처다
 *   args     MCP 가 받는 인자 → 핸들러 인자 순서로 푸는 법
 *   render   본문을 사람이 읽는 글로. **숫자에는 출처를 붙인다**
 */
const TOOLS = [
  {
    name: 'linkpilot_projects',
    handler: 'projects',
    title: '프로젝트 목록',
    description:
      'LinkPilot IM 엔진이 들고 있는 프로젝트 목록을 낸다. 딜 내용(금액·수익률·검증결과)은 '
      + '들어 있지 않다 — 그것은 linkpilot_progress 로 따로 받는다. 인자 없음.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    call: (h) => h.projects(),
    render: renderProjects,
  },
  {
    name: 'linkpilot_progress',
    handler: 'controlTower',
    title: '보고서 생성 진행 상황',
    description:
      '한 프로젝트의 생성이 몇 단계까지 갔는지, 어디서 막혀 있는지, 검증 상태가 어떤지를 낸다. '
      + '실행 기록이 없는 프로젝트는 404 로 답한다 — 「0%」가 아니라 「돌린 적이 없다」다.',
    schema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: '예: LP-DC-2026-001' } },
      required: ['projectId'], additionalProperties: false,
    },
    call: (h, a) => h.controlTower(a.projectId),
    project: (a) => a.projectId,
    render: renderProgress,
  },
  {
    name: 'linkpilot_lineage',
    handler: 'lineage',
    title: '값의 출처 계보',
    description:
      '값 하나가 어느 자료의 몇 페이지에서 나와, 어떤 후보와 겨루어 채택되고, 어느 문서 어느 절에 '
      + '실렸는지를 낸다. 채택되지 않은 후보도 함께 낸다 — 값이 갈리고 있으면 그것이 답이다. '
      + 'key 는 데이터 사전의 항목(예: property.site_area). 목록은 linkpilot_fields.',
    schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '예: LP-DC-2026-001' },
        key: { type: 'string', description: '데이터 사전 key. 예: property.site_area' },
      },
      required: ['projectId', 'key'], additionalProperties: false,
    },
    call: (h, a) => h.lineage(a.projectId, a.key),
    project: (a) => a.projectId,
    render: renderLineage,
  },
  {
    name: 'linkpilot_impact',
    handler: 'impact',
    title: '값을 고치면 무엇이 흔들리는가',
    description:
      '값 하나를 고쳤을 때 다시 만들어야 하는 산출물과 다시 계산되는 지표를 낸다. '
      + '고치기 전에 부르는 도구다.',
    schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '예: LP-DC-2026-001' },
        key: { type: 'string', description: '데이터 사전 key. 예: financial.total_cost' },
      },
      required: ['projectId', 'key'], additionalProperties: false,
    },
    call: (h, a) => h.impact(a.projectId, a.key),
    project: (a) => a.projectId,
    render: renderImpact,
  },
  {
    name: 'linkpilot_fields',
    handler: 'fields',
    title: '데이터 사전 — 어떤 항목이 있는가',
    description:
      '엔진이 아는 항목(key)과 그 뜻·단위·자산군별 필수 여부를 낸다. query 를 주면 key·이름에 '
      + '그 글자가 든 것만 추린다. 사전 전체는 크므로 query 없이 부르면 요약과 분류만 낸다.',
    schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '항목 이름·key 의 일부. 예: 면적' } },
      additionalProperties: false,
    },
    call: (h) => h.fields(),
    render: renderFields,
  },
  {
    name: 'linkpilot_intake',
    handler: 'intake',
    title: '무엇을 올릴 수 있는가',
    description:
      '읽을 수 있는 파일 형식, 파일 하나·한 번에 올릴 수 있는 크기, 자산군 목록, 지금 설정된 '
      + '발행 주체를 낸다. 올리기 전에 부르면 「올리고 나서야 안 된다는 걸 아는」 일이 없다.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    call: (h) => h.intake(),
    render: renderIntake,
  },
];

/* ───────────────────────── 볼 수 있는 프로젝트를 좁힌다 ───────────────────────── */

/**
 * `LINKPILOT_MCP_PROJECTS` — 쉼표로 나눈 프로젝트 ID 목록.
 *
 * ★ 안 주면 **제한하지 않는다.** 이 서버는 표준입출력으로만 말하므로 부를 수 있는
 *   사람은 이미 그 디스크를 읽을 수 있는 사람이다 — 거기서 더 잠가도 얻는 것이 없다.
 *
 * ★ 남을 대신해 띄울 때만 쓴다. 그때는 **적힌 것만** 보인다 (D-83 「누가 부를 수 있는가」).
 */
function allowedProjects(env) {
  const raw = String((env || process.env).LINKPILOT_MCP_PROJECTS || '').trim();
  if (!raw) return null;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

/* ───────────────────────────── 부르는 쪽 ───────────────────────────── */

/**
 * 도구를 부른다. 결과는 **MCP 의 tools/call 본문**이다.
 *
 * ★ 실패를 예외로 던지지 않는다 — `isError` 를 붙여 돌려준다. 던지면 대화가
 *   통째로 끊기고, 무엇이 왜 안 됐는지가 사라진다 (§4.6 과 같은 태도).
 */
function createDispatch(deps) {
  const d = deps || {};
  const handlers = api.createHandlers({
    agentRoot: d.agentRoot,
    agentModulePath: d.agentModulePath || path.join(__dirname, '..'),
  });
  const allow = allowedProjects(d.env);

  return async function dispatch(name, args) {
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) return errorResult(`모르는 도구입니다: ${name}`);

    const a = args || {};
    if (tool.project && allow) {
      const id = tool.project(a);
      if (!allow.includes(id)) {
        return errorResult(
          `이 서버는 ${allow.length}건만 봅니다 — ${id} 는 목록에 없습니다 `
          + '(LINKPILOT_MCP_PROJECTS).',
        );
      }
    }

    let res;
    try {
      res = await tool.call(handlers, a);
    } catch (e) {
      return errorResult(`엔진이 답하지 못했습니다: ${e && e.message ? e.message : e}`);
    }

    const status = (res && res.status) || 500;
    const body = (res && res.body) || {};
    if (status >= 400) {
      return errorResult(`${status} — ${body.error || '알 수 없는 오류'}`);
    }

    let filtered = body;
    if (name === 'linkpilot_projects' && allow) {
      filtered = { projects: (body.projects || []).filter(p => allow.includes(p.id)) };
    }

    return {
      content: [{ type: 'text', text: tool.render(filtered, a) + '\n\n' + jsonBlock(filtered) }],
    };
  };
}

function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * 원본을 그대로 함께 싣는다.
 *
 * ★★ 사람이 읽는 글만 주면 **기관·기준시점·모수가 문장 속으로 녹는다** (§4.7).
 *   원본을 같은 답 안에 넣어 두면 출처를 다시 꺼낼 수 있다.
 *
 * ★ 너무 크면 자르되 **잘랐다고 적는다.** 조용히 자르면 「그만큼이 전부」로 읽힌다.
 */
const FENCE = '```';

function jsonBlock(body) {
  const raw = JSON.stringify(body, null, 2);
  if (raw.length <= MAX_JSON_CHARS) return FENCE + 'json\n' + raw + '\n' + FENCE;
  return FENCE + 'json\n' + raw.slice(0, MAX_JSON_CHARS) + '\n' + FENCE
    + '\n(원본이 ' + raw.length.toLocaleString() + '자라 '
    + MAX_JSON_CHARS.toLocaleString() + '자에서 잘랐습니다. 좁혀서 다시 부르십시오.)';
}

/* ───────────────────────────── 사람이 읽는 글 ───────────────────────────── */

function line(label, value) {
  return `- ${label}: ${value === null || value === undefined || value === '' ? '(없음)' : value}`;
}

function renderProjects(body) {
  const rows = body.projects || [];
  if (!rows.length) return '프로젝트가 0건입니다. (IM_AGENT_ROOT 가 가리키는 폴더에 아무것도 없습니다)';
  const head = `프로젝트 ${rows.length}건`;
  const list = rows.map(p => `- ${p.id} · ${p.name || '(이름 없음)'} · ${p.assetType || '자산유형 미정'} · ${p.status || '상태 미정'}`
    + (p.externalId ? ` · 앱 딜키 ${p.externalId}` : ''));
  return [head, ...list].join('\n');
}

function renderProgress(body) {
  const t = body.tracks || {};
  const out = [
    `${body.project.id} · ${body.project.name} — 전체 ${body.overall}%`,
    line('상태', body.health || '(모름)'),
    line('지금 도는 단계', body.currentAgent),
    line('막힌 곳', body.bottleneck ? JSON.stringify(body.bottleneck) : null),
  ];
  Object.keys(t).forEach((k) => {
    out.push(line(t[k].label || k, `${t[k].pct}% (가중치 ${t[k].weight})`));
  });
  if (body.timing) {
    out.push(line('시작', body.timing.startedAt), line('끝', body.timing.finishedAt));
    out.push(`- 남은 시간 예상: ${body.timing.estimatedRemainingMs === null ? '(모름)' : Math.round(body.timing.estimatedRemainingMs / 1000) + '초'} — ${body.timing.note}`);
  }
  return out.join('\n');
}

/**
 * 계보 — **채택되지 않은 후보를 지우지 않는다.**
 *
 * ★ 이긴 값만 보여주면 화면에서는 멀쩡해 보이고, 값이 갈리고 있다는 사실이
 *   검증 단계에 가서야 드러난다 (`report-api.cjs` 의 같은 주석).
 */
function renderLineage(body, args) {
  if (!body.found) {
    return `${args.projectId} · ${body.label || args.key} — 값이 없습니다. 이유: ${body.reason}`;
  }
  // 사전에 없는 key 는 label 이 key 그대로 온다. 그때 「a (a)」로 두 번 적지 않는다
  const head = body.label && body.label !== args.key ? `${body.label} (${args.key})` : args.key;
  const out = [`${args.projectId} · ${head}`];
  (body.chain || []).forEach((c) => {
    const mark = c.adopted ? '채택' : '후보(탈락)';
    const v = c.value === null || c.value === undefined ? '' : ` = ${c.value}`;
    out.push(`- [${c.stage}] ${c.label}${v} · ${mark}${c.detail ? ' · ' + c.detail : ''}`);
  });
  if ((body.consumers || []).length) {
    out.push('쓰이는 곳:');
    body.consumers.forEach(c => out.push(`- ${c.stage} ${c.label} → ${(c.affects || []).join(', ')}`));
  }
  return out.join('\n');
}

function renderImpact(body, args) {
  const out = [`${args.projectId} · ${body.label || args.key} 를 고치면`];
  const keys = Object.keys(body).filter(k => k !== 'key' && k !== 'label');
  keys.forEach((k) => {
    const v = body[k];
    out.push(line(k, Array.isArray(v) ? (v.length ? v.join(', ') : '(없음)') : (typeof v === 'object' ? JSON.stringify(v) : v)));
  });
  return out.join('\n');
}

function renderFields(body, args) {
  const fields = body.fields || {};
  const all = Object.keys(fields);
  const q = String((args && args.query) || '').trim();

  if (!q) {
    return [
      `데이터 사전 — 입력 항목 ${all.length}개 · 계산 항목 ${(body.computedKeys || []).length}개`,
      `자산군 ${(body.assetClasses || []).length}종 · 재무 템플릿 ${(body.industries || []).length}종`,
      '분류: ' + Object.values(body.categories || {}).join(', '),
      '자산군: ' + (body.assetClasses || []).map(c => `${c.id}(${c.label})`).join(', '),
      '',
      '★ 항목을 찾으려면 query 를 주십시오 — 전체를 실으면 답이 너무 커집니다.',
    ].join('\n');
  }

  const hit = all.filter(k => k.includes(q) || String((fields[k] || {}).label || '').includes(q));
  if (!hit.length) return `「${q}」 로 찾은 항목이 없습니다 (전체 ${all.length}개).`;
  return [`「${q}」 — ${hit.length}개`].concat(hit.slice(0, 40).map((k) => {
    const f = fields[k] || {};
    return `- ${k} · ${f.label || ''}${f.unit ? ' (' + f.unit + ')' : ''}${f.note ? ' — ' + f.note : ''}`;
  })).join('\n');
}

function renderIntake(body) {
  const s = body.supported || {};
  return [
    '읽을 수 있는 형식',
    ...(body.formats || []).map(g => `- ${g.label}: ${(g.ext || []).join(' ')}`),
    line('못 읽는 형식', (body.unsupported || []).join(' ')),
    line('파일 하나 한도', mb(body.maxBytesPerFile)),
    line('한 번에 한도', mb(body.maxBytesPerRequest)),
    line('스캔·사진을 글자로 옮기기', body.ocrReady ? '켜져 있습니다' : '꺼져 있습니다 (키가 없습니다)'),
    line('발행 주체', body.issuer && body.issuer.name ? body.issuer.name : '(미설정)'),
    body.issuerError ? `- 발행 주체 설정 오류: ${body.issuerError}` : null,
    line('자산군', (body.assetTypes || []).map(a => a.label).join(', ')),
    // text·office 는 formats 와 같은 것을 다르게 묶은 값이라 개수만 적는다
    `- (형식 원본: 글자 ${(s.text || []).length}종 · 오피스 ${(s.office || []).length}종)`,
  ].filter(Boolean).join('\n');
}

function mb(bytes) {
  if (!bytes) return '(모름)';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** MCP 가 내보내는 모양 — `tools/list` 가 그대로 쓴다 */
function listForMcp() {
  return TOOLS.map(t => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.schema,
    // ★ 전부 읽기다. 부르는 쪽이 「이 도구가 뭘 고치나」를 묻지 않아도 되게 적는다
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

/** 표의 도구가 진짜 읽기 라우트인지 — 검사가 쓴다 (베껴 적기 방지) */
function backingRoute(toolName) {
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) return null;
  return api.ROUTES.find(r => r.handler === tool.handler) || null;
}

module.exports = {
  TOOLS, createDispatch, listForMcp, backingRoute, allowedProjects,
  MAX_JSON_CHARS, routesKind: routes.KIND,
};
