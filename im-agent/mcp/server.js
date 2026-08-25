'use strict';
/**
 * mcp/server.js — LinkPilot 을 **MCP 서버로 내보내는** 길 (D-83).
 *
 * 무엇인가: MCP(Model Context Protocol)는 대화하는 쪽(Claude Desktop·Claude Code 등)이
 * 바깥 프로그램의 「도구」를 부를 수 있게 하는 규약이다. 이 파일은 그 규약을
 * **표준입출력(stdin/stdout)** 으로 말한다 — 포트를 열지 않는다.
 *
 * ★★★ **stdout 은 규약의 통로다. 여기에 사람 말을 적으면 대화가 끊긴다.**
 *   `console.log` 를 쓰지 않는다. 알릴 것은 전부 `stderr` 로 간다.
 *   (이 한 줄을 어기면 증상은 「서버가 안 뜬다」로만 보이고 원인은 안 보인다)
 *
 * ★★ **포트를 열지 않는다.** 부를 수 있는 사람 = 이 프로세스를 띄울 수 있는 사람
 *   = 이미 그 디스크를 읽을 수 있는 사람이다. 남을 대신해 띄울 때만
 *   `LINKPILOT_MCP_PROJECTS` 로 보이는 프로젝트를 좁힌다 (D-83).
 *
 * ★ **읽기 전용이다.** 도구 표(`tools.js`)가 `ui/api-router.cjs` 의 GET 라우트
 *   위에만 서고, 검사가 그것을 고정한다. 값을 만들지도 고치지도 않는다.
 *
 * ★ 시크릿을 만지지 않는다 (§2). 커넥터를 부르지 않으므로 키가 이 길에 없다.
 *
 * 쓰는 법:
 *   IM_AGENT_ROOT=/volume1/linkpilot/im-projects node im-agent/mcp/server.js
 *   (붙이는 절차는 `docs/MCP-붙이는-법.md`)
 *
 * 의존성 0건 — SDK 를 들이지 않는다 (§5). 규약이 JSON-RPC 2.0 줄바꿈 구분이라
 * 순수 Node 로 충분하다.
 */

const readline = require('readline');
const tools = require('./tools.js');

const NAME = 'linkpilot';
const VERSION = '0.1.0';

/**
 * 우리가 아는 규약 판. **모르는 판이 오면 우리 판을 말해 준다** —
 * 거절하지 않는다(규약이 그렇게 정한다). 부르는 쪽이 맞출 수 있게 하는 것이 목적이다.
 */
const PROTOCOL = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = PROTOCOL[0];

const RPC = {
  PARSE: -32700, REQUEST: -32600, NO_METHOD: -32601, PARAMS: -32602, INTERNAL: -32603,
};

/** 사람에게 알리는 말은 **전부 여기로**. stdout 으로 새면 대화가 끊긴다 */
function note(msg) {
  process.stderr.write(`[linkpilot-mcp] ${msg}\n`);
}

/**
 * 규약을 말하는 부분. 전송(stdin/stdout)과 갈라 둔다 —
 * 그래야 검사가 **진짜 서버를 그대로** 부를 수 있다 (파이프를 흉내 내지 않는다).
 */
function createServer(deps) {
  const d = deps || {};
  const dispatch = tools.createDispatch(d);
  let initialized = false;

  return {
    /**
     * 요청 하나를 처리한다. 알림(id 가 없는 것)이면 `null` 을 돌려준다 —
     * **알림에 답을 보내면 규약 위반이다.**
     */
    async handle(msg) {
      const isNotification = msg.id === undefined || msg.id === null;
      const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
      const fail = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } });

      if (msg.jsonrpc !== '2.0') return fail(RPC.REQUEST, 'jsonrpc 는 "2.0" 이어야 합니다');

      switch (msg.method) {
        case 'initialize': {
          const want = (msg.params && msg.params.protocolVersion) || DEFAULT_PROTOCOL;
          initialized = true;
          return reply({
            protocolVersion: PROTOCOL.includes(want) ? want : DEFAULT_PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: NAME, title: 'LinkPilot IM 엔진', version: VERSION },
            instructions:
              'LinkPilot IM 엔진이 이미 가진 것을 꺼내 주는 읽기 전용 서버입니다. '
              + '값을 만들지 않습니다. 답에는 사람이 읽는 요약과 원본 JSON 이 함께 들어 있으니, '
              + '숫자를 옮길 때는 **출처(source · sourceDate · page)를 함께** 옮기십시오. '
              + '출처 없는 숫자는 이 시스템에서 값이 아닙니다.',
          });
        }

        case 'notifications/initialized':
          return null;

        case 'ping':
          return reply({});

        case 'tools/list':
          // ★ 초기화 전에도 답한다. 막으면 부르는 쪽 구현 차이로 「도구가 없다」가 되는데,
          //   그 증상은 「서버가 고장」과 구분되지 않는다
          return reply({ tools: tools.listForMcp() });

        case 'tools/call': {
          const p = msg.params || {};
          if (!p.name) return fail(RPC.PARAMS, 'params.name 이 없습니다');
          return reply(await dispatch(p.name, p.arguments || {}));
        }

        // 우리가 안 여는 기능들 — 규약대로 「그런 방법 없음」으로 답한다.
        // 조용히 빈 값을 주면 부르는 쪽이 목록이 비었다고 오해한다
        default:
          return fail(RPC.NO_METHOD, `모르는 method: ${msg.method}`);
      }
    },
    get initialized() { return initialized; },
  };
}

/** 표준입출력에 물린다 */
function main() {
  const server = createServer({ env: process.env });
  const allow = tools.allowedProjects(process.env);

  note(`도구 ${tools.TOOLS.length}개 · 읽기 전용 · 포트 안 엽니다`);
  note(`IM_AGENT_ROOT = ${process.env.IM_AGENT_ROOT || '(미설정 — cwd/im-projects 를 봅니다)'}`);
  note(allow ? `볼 수 있는 프로젝트 ${allow.length}건으로 좁혀져 있습니다` : '프로젝트 제한 없음 (LINKPILOT_MCP_PROJECTS 미설정)');

  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (raw) => {
    const text = raw.trim();
    if (!text) return;

    let msg;
    try {
      msg = JSON.parse(text);
    } catch (_) {
      // ★ id 를 모르므로 null 로 답한다 (JSON-RPC 규정)
      return write({ jsonrpc: '2.0', id: null, error: { code: RPC.PARSE, message: '읽을 수 없는 JSON' } });
    }

    // 묶음 요청도 받는다 — 안 받으면 어떤 클라이언트에서 통째로 조용히 실패한다
    if (Array.isArray(msg)) {
      const out = [];
      for (const one of msg) {
        const r = await safeHandle(server, one);
        if (r) out.push(r);
      }
      return out.length ? write(out) : undefined;
    }

    const res = await safeHandle(server, msg);
    if (res) write(res);
  });

  rl.on('close', () => process.exit(0));
}

/**
 * 한 건이 죽어도 서버를 죽이지 않는다 (§4.6 과 같은 태도).
 * 죽으면 대화가 통째로 끊기고, 무엇 때문인지가 사라진다.
 */
async function safeHandle(server, msg) {
  try {
    return await server.handle(msg);
  } catch (e) {
    note(`처리 중 오류: ${e && e.stack ? e.stack : e}`);
    if (msg && msg.id !== undefined && msg.id !== null) {
      return { jsonrpc: '2.0', id: msg.id, error: { code: RPC.INTERNAL, message: String(e && e.message ? e.message : e) } };
    }
    return null;
  }
}

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

if (require.main === module) main();

module.exports = { createServer, PROTOCOL, DEFAULT_PROTOCOL, NAME, VERSION, RPC };
