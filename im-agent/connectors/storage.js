'use strict';
/**
 * storage.js — 사용자의 클라우드 저장소(Dropbox·Box·Google Drive·OneDrive)를
 * **연결해서 쓴다. 우리 서버에 보관하지 않는다.**
 *
 * ★★ 「보관하지 않는다」가 「손대지 않는다」는 아니다.
 *   값을 뽑으려면 파일을 한 번은 읽어야 하고, 읽으려면 어딘가에 잠깐 놓인다.
 *   그래서 이 모듈은 **작업 사본을 만들되 그 수명을 코드가 책임진다**
 *   (`core/linked.js` 의 `materialize()` → `dispose()`).
 *   「우리는 보관하지 않습니다」를 말하려면 **지운다는 것이 코드로 보장되어야 한다.**
 *
 * ★★ 파일을 안 갖는 대신 **열쇠를 갖는다 — 이쪽이 더 위험할 수 있다.**
 *   토큰이 새면 자료 한 건이 아니라 **드라이브 전체**가 샌다. 그래서
 *   `SCOPE_NOTE` 에 제공자별로 **범위를 좁히는 방법**을 적어 두고,
 *   토큰을 아예 갖지 않는 길(`chooser`)을 먼저 권한다.
 *
 * ★ 제공자마다 지문 방식이 다르다 (Dropbox content_hash · Box sha1 ·
 *   Google md5 · OneDrive quickXor). **그대로 믿고 비교하지 않는다.**
 *   우리가 읽을 때 sha256 을 직접 계산해 장부에 남기고, 제공자 해시는
 *   「바뀌었는지 싸게 확인」하는 용도로만 쓴다.
 *
 * ★ 새 SDK 를 들이지 않는다 (CLAUDE.md §5). 전부 HTTPS REST 다.
 */

const { sha256 } = require('../core/vault');

/**
 * 제공자 정의.
 *
 * `versionField` 가 이 설계의 핵심이다 — 파일을 안 갖는 대신 **「그때 그 판」을
 * 가리키는 값**을 갖는다. 그것이 없으면 나중에 「이 숫자 어디서 나왔나」에
 * 답할 수 없다.
 */
const PROVIDERS = {
  dropbox: {
    id: 'dropbox', name: 'Dropbox',
    tokenEnv: 'DROPBOX_APP_KEY',
    auth: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropboxapi.com/oauth2/token',
    api: 'https://api.dropboxapi.com/2',
    content: 'https://content.dropboxapi.com/2',
    versionField: 'rev',
    hashKind: 'content_hash',       // 4MB 블록 SHA256 들의 SHA256 — 표준 해시가 아니다
    chooser: true,
    scopeNote: '앱 등록 때 **App folder** 를 고르면 그 앱 전용 폴더 밖은 보이지 않는다. '
      + 'Full Dropbox 로 등록하면 **드라이브 전체**에 접근하게 된다 — 되돌리려면 앱을 다시 만들어야 한다.',
  },
  box: {
    id: 'box', name: 'Box',
    tokenEnv: 'BOX_CLIENT_ID',
    auth: 'https://account.box.com/api/oauth2/authorize',
    token: 'https://api.box.com/oauth2/token',
    api: 'https://api.box.com/2.0',
    versionField: 'file_version.id',
    hashKind: 'sha1',               // Box 는 sha1 만 준다
    chooser: true,
    scopeNote: '기업 계정은 **관리자 승인**이 있어야 앱이 붙는다. 승인 범위를 폴더 단위로 좁힐 수 있다.',
  },
  gdrive: {
    id: 'gdrive', name: 'Google Drive',
    tokenEnv: 'GOOGLE_CLIENT_ID',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    api: 'https://www.googleapis.com/drive/v3',
    versionField: 'headRevisionId',
    hashKind: 'md5Checksum',        // 구글 문서(네이티브)에는 아예 없다
    chooser: true,
    scopeNote: '**`drive.file` 범위**를 쓰면 사용자가 피커로 고른 파일만 보인다. '
      + '`drive.readonly` 는 **드라이브 전체를 읽는다** — 자료 몇 건 때문에 그것까지 가져오지 않는다.',
  },
  onedrive: {
    id: 'onedrive', name: 'OneDrive · SharePoint',
    tokenEnv: 'MS_CLIENT_ID',
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    api: 'https://graph.microsoft.com/v1.0',
    versionField: 'cTag',
    hashKind: 'quickXorHash',       // 업무용 계정. 개인 계정은 sha256Hash 를 준다
    chooser: true,
    scopeNote: '`Files.Read.Selected` 는 사용자가 고른 것만 본다. '
      + '`Files.Read.All` 은 **조직 드라이브 전체**가 대상이 된다.',
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

/**
 * **앱이 내부로 넘기는 출처** 〈2026-08-21 · 본체 실측 보고〉.
 *
 * ★★ 왜 위 표에 안 넣는가: 위 넷은 **사용자가 고르기 창에서 고르는 남의 저장소**다.
 *   콘솔 등록·OAuth 범위·chooser 단추가 전부 거기 딸려 있다. 앱이 자기 딜의
 *   첨부를 넘겨 주는 것은 성격이 다르다 — 고를 창이 없고, 등록할 콘솔이 없고,
 *   넓어질 범위도 없다. 같은 표에 넣으면 **연결 단추에 「LinkPilot 앱」이 뜬다.**
 *
 * ★★ 그렇다고 `normalizeRef` 가 거절하면 안 된다. 실제로 그래서 한 번 막혔다:
 *   문서(§2-1-2)와 화면은 `linkpilot-app` 으로 정했는데 **검증기만 몰라서**
 *   「모르는 저장소입니다」로 전부 거절했고, 화면에는 「첨부 0개」가 떴다.
 *   같은 값이 세 곳에 따로 적혀 있어서 생긴 일이다 (2026-08-21 본체 실측).
 *
 * ★ 그래서 **아는 목록과 고르는 목록을 가른다.** `KNOWN` 은 참조를 받아들일 때,
 *   `PROVIDER_IDS` 는 단추를 그릴 때 쓴다.
 */
const INTERNAL = {
  'linkpilot-app': {
    id: 'linkpilot-app',
    name: 'LinkPilot 앱',
    internal: true,
    chooser: false,
    // 앱이 자기 판 번호를 준다. 우리가 정하지 않는다
    versionField: 'rev',
    // 제공자 해시가 없다. 지문은 **우리가 읽은 바이트로** 만든다 (fingerprint)
    hashKind: null,
    tokenEnv: null,
  },
};

const INTERNAL_IDS = Object.keys(INTERNAL);

/** 참조로 **받아들일 수 있는** 출처 전부. 단추 목록(`PROVIDER_IDS`)과 다르다 */
const KNOWN = Object.assign({}, PROVIDERS, INTERNAL);
const KNOWN_IDS = Object.keys(KNOWN);

/* ────────────────────────── 폴더까지만 ────────────────────────── */

/**
 * **범위는 폴더까지만 받는다** 〈2026-08-17 결정〉.
 *
 * 자료 몇 건 때문에 드라이브 전체를 읽는 권한을 받지 않는다. 넓게 받아도
 * **동작은 똑같아서** 잘못 등록한 것이 증상으로 드러나지 않는다 — 그래서
 * 받을 수 있는 것과 받으면 안 되는 것을 코드가 들고 있는다.
 *
 * ★ 토큰 응답의 `scope` 로 **막을 수 있는 것은 막는다.** 다만 넷 중 하나는
 *   스코프로 구분되지 않는다(아래 `verifiable:false`) — 그때는 **막을 수 없다고
 *   말한다.** 「검사했다」로 넘어가면 안 한 것보다 나쁘다.
 */
const SCOPES = {
  dropbox: {
    // Dropbox 는 **앱 타입**(App folder / Full Dropbox)이 범위를 정하는데,
    // 그 값이 토큰 응답에 실리지 않는다 — 같은 scope 문자열로 둘 다 나온다
    verifiable: false,
    allow: ['files.metadata.read', 'files.content.read'],
    deny: [],
    checklist: '앱 등록 화면에서 **Access type = App folder** 를 고른다. '
      + 'Full Dropbox 로 만들면 **되돌릴 수 없고** 앱을 다시 만들어야 한다.',
  },
  box: {
    // Box 도 폴더 제한은 「서비스 계정을 그 폴더의 협업자로 초대」로 하는 것이라
    // 스코프에 안 나타난다
    verifiable: false,
    allow: ['base_explorer', 'item_download'],
    deny: ['root_readwrite', 'root_readonly'],
    checklist: '서비스 계정을 **그 폴더에만 협업자(Viewer)** 로 초대한다. '
      + '기업 계정은 관리자 승인 범위도 폴더 단위로 좁힌다.',
  },
  gdrive: {
    verifiable: true,
    allow: ['https://www.googleapis.com/auth/drive.file'],
    // 이 둘은 **드라이브 전체**다. 하나라도 있으면 연결을 거절한다
    deny: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
    checklist: '`drive.file` 만 요청한다 — 사용자가 피커로 고른 것만 보인다.',
  },
  onedrive: {
    verifiable: true,
    allow: ['Files.Read.Selected', 'offline_access'],
    deny: ['Files.Read.All', 'Files.ReadWrite.All', 'Sites.Read.All', 'Sites.ReadWrite.All'],
    checklist: '`Files.Read.Selected` 만 요청한다. `Files.Read.All` 은 조직 드라이브 전체다.',
  },
};

/**
 * 토큰 응답의 범위가 「폴더까지만」인가.
 *
 * @param granted 공백 또는 쉼표로 갈린 scope 문자열, 또는 배열
 * @returns {{ok:boolean, verifiable:boolean, tooWide:string[], reason?:string}}
 *
 * ★ `verifiable:false` 는 **통과가 아니다.** 「코드로는 확인할 수 없으니
 *   등록 화면을 사람이 확인해야 한다」는 뜻이고, 화면이 그렇게 말해야 한다.
 */
function checkScope(providerId, granted) {
  // ★ 앱이 내부로 넘기는 출처는 **OAuth 범위 자체가 없다.** 넓어질 것이 없으니
  //   막을 것도 없다 — 「검사했다」가 아니라 「해당 없다」고 말한다
  if (INTERNAL[providerId]) {
    return { ok: true, verifiable: true, tooWide: [], internal: true,
      reason: '앱이 내부로 넘기는 출처라 범위 개념이 없습니다' };
  }
  const s = SCOPES[providerId];
  if (!s) return { ok: false, verifiable: false, tooWide: [], reason: '모르는 저장소입니다' };

  const list = Array.isArray(granted)
    ? granted.map(String)
    : String(granted || '').split(/[\s,]+/).filter(Boolean);

  const tooWide = list.filter(g => s.deny.includes(g));
  if (tooWide.length) {
    return {
      ok: false, verifiable: s.verifiable, tooWide,
      reason: `범위가 폴더를 넘습니다 (${tooWide.join(' · ')}) — 폴더까지만 받습니다`,
    };
  }
  if (!s.verifiable) {
    return {
      ok: true, verifiable: false, tooWide: [],
      reason: '범위를 코드로 확인할 수 없습니다 — 등록 화면에서 사람이 확인해야 합니다',
    };
  }
  if (!list.length) {
    return { ok: false, verifiable: true, tooWide: [], reason: '허용된 범위가 비어 있습니다' };
  }
  return { ok: true, verifiable: true, tooWide: [] };
}

/** 콘솔에서 사람이 확인해야 하는 것. 화면과 문서가 같은 문장을 쓴다 */
const REGISTRATION = PROVIDER_IDS.map(id => ({
  provider: id,
  name: PROVIDERS[id].name,
  checklist: SCOPES[id].checklist,
  verifiable: SCOPES[id].verifiable,
}));

/**
 * 붙이는 방법 둘. **먼저 권하는 쪽이 토큰을 안 갖는 쪽이다.**
 */
const MODES = {
  chooser: {
    id: 'chooser', name: '그때그때 고르기',
    keepsToken: false,
    how: '사용자가 제공자의 파일 선택 창에서 파일을 고른다. 우리는 **그 파일 하나에 대한 '
      + '단발 접근권**만 받는다.',
    good: '토큰을 보관하지 않는다. 새어 나갈 열쇠가 없다.',
    bad: '자료가 늘 때마다 사용자가 다시 골라야 한다. 폴더를 지켜보다가 새 파일을 자동으로 '
      + '가져오지 못한다.',
  },
  folder: {
    id: 'folder', name: '폴더 연결',
    keepsToken: true,
    how: '한 번 승인하면 그 폴더를 계속 읽을 수 있다 (refresh token 보관).',
    good: '자료가 늘어도 사용자가 다시 고르지 않는다.',
    bad: '**우리가 열쇠를 보관한다.** 새면 자료 한 건이 아니라 그 범위 전체가 샌다. '
      + '범위를 폴더로 좁히는 것이 유일한 방어다.',
  },
};

/* ────────────────────────── 참조 ────────────────────────── */

/**
 * 자료 하나를 가리키는 참조. **파일 내용은 여기 없다.**
 *
 * `rev` 를 필수로 받는 이유: 파일 ID 만 있으면 「그 파일」은 가리켜도
 * **「그때 그 판」은 못 가리킨다.** 사용자가 나중에 파일을 고치면 보고서의
 * 근거가 조용히 달라지는데, 문서에는 아무 표시도 안 남는다.
 */
function normalizeRef(raw) {
  const r = raw || {};
  const provider = String(r.provider || '').trim();
  // ★ **아는 목록**으로 본다 (고르는 목록이 아니다). 앱이 내부로 넘기는 출처는
  //   단추에 안 뜨지만 참조로는 받는다 — 둘을 같은 목록으로 보면 앱 자료가 막힌다
  if (!KNOWN[provider]) {
    return { ok: false, reason: `모르는 저장소입니다 (${KNOWN_IDS.join(' · ')} 중 하나)` };
  }
  const fileId = String(r.fileId || '').trim();
  if (!fileId) return { ok: false, reason: '파일 식별자가 없습니다' };
  if (fileId.length > 256) return { ok: false, reason: '파일 식별자가 너무 깁니다' };

  const name = String(r.name || '').trim();
  if (!name) return { ok: false, reason: '파일 이름이 없습니다' };

  const rev = String(r.rev || '').trim();
  if (!rev) {
    return {
      ok: false,
      reason: '판(rev/version)이 없습니다 — 파일만 가리키면 나중에 바뀌어도 알 수 없습니다',
    };
  }

  // ★ 토큰이 참조에 섞여 들어오면 장부에 그대로 저장된다. 여기서 끊는다
  for (const k of ['accessToken', 'refreshToken', 'token', 'authorization', 'secret']) {
    if (r[k]) return { ok: false, reason: '참조에 토큰을 넣지 않습니다' };
  }

  return {
    ok: true,
    value: {
      provider,
      fileId,
      name,
      rev,
      // 사용자가 자기 드라이브에서 찾을 수 있어야 한다. 없으면 없다고 둔다
      path: r.path ? String(r.path).slice(0, 1024) : null,
      bytes: Number.isFinite(r.bytes) ? r.bytes : null,
      // 제공자가 준 해시. **종류를 함께 적는다** — 종류를 모르면 비교가 불가능하다
      // ★ 종류를 모르는 해시는 **담지 않는다.** `kind: null` 로 적어 두면 비교할 수
      //   없는 값이 「있는 것」처럼 남는다. 지문은 어차피 우리가 읽은 바이트로 만든다
      providerHash: (r.providerHash && KNOWN[provider].hashKind)
        ? { kind: KNOWN[provider].hashKind, value: String(r.providerHash).slice(0, 200) }
        : null,
      // 구글 문서처럼 **원본 바이트가 없어 내보내야 하는** 경우
      exported: !!r.exported,
    },
  };
}

/** `dropbox:id:AAA` 꼴의 한 줄 식별자. 장부 키·중복 판정에 쓴다 */
function refKey(ref) {
  return `${ref.provider}:${ref.fileId}`;
}

/**
 * 우리가 읽은 바이트로 지문을 만든다.
 *
 * ★ **제공자 해시를 쓰지 않는다.** 넷이 서로 다른 방식이라 비교가 안 되고,
 *   구글 네이티브 문서는 아예 없다. 우리가 읽은 것으로 우리가 계산한다 —
 *   그래야 「우리가 읽은 그 내용」을 증명한다.
 */
function fingerprint(buf) {
  return { algo: 'sha256', value: sha256(buf), bytes: buf.length };
}

/* ────────────────────────── 안 하는 것 ────────────────────────── */

/**
 * **사본을 남기지 않는다.**
 *
 * 「빠르니까 캐시해 두자」는 곧바로 보관이 된다. 그 순간 사용자에게 한
 * 「보관하지 않습니다」가 거짓이 되고, 그 사실은 화면 어디에도 안 나타난다.
 */
function keepCopy() {
  return {
    ok: false,
    byDesign: true,
    reason: '연결된 자료는 보관하지 않습니다 — 읽을 때만 가져오고 끝나면 지웁니다',
    insteadDo: '다시 필요하면 그때 다시 가져옵니다. 원본이 사라졌다면 그 사실을 알아야 합니다.',
  };
}

/**
 * **남의 드라이브 파일을 우리가 재배포하지 않는다.**
 *
 * 「보고서에 원본을 첨부해 보내자」가 여기 걸린다. 우리는 그 파일을 배포할
 * 권한을 받은 적이 없고, 받은 것은 **읽을 권한**뿐이다.
 */
function shareOutward() {
  return {
    ok: false,
    byDesign: true,
    reason: '연결된 원본을 우리가 다시 배포하지 않습니다 — 읽을 권한만 받았습니다',
    insteadDo: '받는 사람에게는 저장소에서 직접 공유하도록 안내합니다.',
  };
}

/**
 * 구글 문서·스프레드시트처럼 **원본 바이트가 없는** 파일.
 *
 * 내보내기(export)를 하면 그때그때 바이트가 달라질 수 있어 **sha256 이 재현되지
 * 않는다.** 값을 못 뽑는 것은 아니지만, 출처에 그 사실을 적어야 한다.
 */
function exportedNote(ref) {
  if (!ref || !ref.exported) return null;
  return '원본 파일이 아니라 내보낸 사본에서 읽었습니다 — 같은 문서를 다시 내보내도 '
    + '바이트가 같다는 보장이 없어 지문이 재현되지 않습니다';
}

/** 제공자별 「범위를 좁히는 법」. 화면과 문서가 같은 문장을 쓴다 */
const SCOPE_NOTE = PROVIDER_IDS.reduce((a, id) => {
  a[id] = PROVIDERS[id].scopeNote; return a;
}, {});

module.exports = {
  PROVIDERS, PROVIDER_IDS, MODES, SCOPE_NOTE, SCOPES, REGISTRATION,
  INTERNAL, INTERNAL_IDS, KNOWN, KNOWN_IDS,
  normalizeRef, refKey, fingerprint, checkScope,
  keepCopy, shareOutward, exportedNote,
};
