/**
 * preflight.js
 * 발송 스크립트 공통 — 시작 전에 필수 시크릿을 한 번에 점검한다.
 *
 * 기존에는 누락된 항목을 만나는 순간 하나씩 죽어서, 로그만 봐서는
 * "무엇을 더 등록해야 하는지" 알 수 없었다(수신자 없음 → 등록 → 다음날 SOLAPI_PFID 없음 → …).
 * 여기서 부족한 항목을 전부 모아 한 번에 보여준다.
 */
'use strict';

// 수신자는 ONLY_TO / FRIENDS_URL / RECIPIENTS 중 하나만 있으면 된다.
const RECIPIENT_VARS = ['ONLY_TO', 'FRIENDS_URL', 'RECIPIENTS'];

function env(name) {
  return String(process.env[name] || '').trim();
}

/** NAS 루트 URL. NAS_BASE_URL 우선, 없으면 FRIENDS_URL 에서 역산. 끝 슬래시 제거. */
function nasBase() {
  const raw = env('NAS_BASE_URL') || env('FRIENDS_URL').replace(/\/friends\.php.*$/, '');
  return raw.replace(/\/$/, '');
}

/**
 * 앱 친구명단 URL.
 * FRIENDS_URL 이 없어도 NAS_BASE_URL 이 있으면 같은 NAS 의 friends.php 로 추론한다
 * (두 값은 항상 같은 호스트를 가리키므로 시크릿을 하나 더 등록할 이유가 없다).
 * @returns {string} 없으면 빈 문자열
 */
function friendsUrl() {
  const explicit = env('FRIENDS_URL');
  if (explicit) return explicit;
  const base = nasBase();
  return base ? base + '/friends.php' : '';
}

/** 발송 없이 본문·카드 생성까지만 검증하는 모드 (Solapi 자격증명 불필요). */
function isDryRun() {
  return /^(1|true|yes|on)$/i.test(env('DRY_RUN'));
}

const HINTS = {
  GEMINI_API_KEY: 'Google AI Studio(aistudio.google.com) 무료 키',
  SOLAPI_API_KEY: 'Solapi 대시보드 → 개발/연동 → API Key',
  SOLAPI_API_SECRET: 'Solapi 대시보드 → 개발/연동 → API Secret',
  SOLAPI_PFID: '카카오 발신프로필 ID (예: KA01PF...)',
  NAS_BASE_URL: '예: https://synologynas.tail43fc79.ts.net',
};

function isSet(name) {
  return env(name) !== '';
}

// FRIENDS_URL 은 NAS_BASE_URL 로부터 추론될 수 있으므로 직접 등록 여부만 보면 안 된다.
function hasRecipientSource() {
  return isSet('ONLY_TO') || isSet('RECIPIENTS') || friendsUrl() !== '';
}

/**
 * @param {string[]} required 반드시 있어야 하는 환경변수 이름
 * @param {object}  [opts]
 * @param {boolean} [opts.needRecipients=true] 수신자 3종 중 최소 1개 필요 여부
 * @throws {Error} 누락 항목이 있으면 전체 목록을 담은 에러
 */
function preflight(required, opts) {
  const needRecipients = !opts || opts.needRecipients !== false;
  const missing = required.filter(name => !isSet(name));
  const noRecipient = needRecipients && !hasRecipientSource();

  if (!missing.length && !noRecipient) return;

  const lines = ['GitHub Secrets 설정이 누락되어 발송을 중단합니다.', ''];
  for (const name of missing) {
    lines.push('  · ' + name + (HINTS[name] ? '  — ' + HINTS[name] : ''));
  }
  if (noRecipient) {
    lines.push('  · 수신자 미지정 — ' + RECIPIENT_VARS.join(' / ') + ' 중 최소 1개 필요');
    lines.push('      ONLY_TO    테스트용, 특정 번호에만 발송 (예: 01012345678)');
    lines.push('      FRIENDS_URL 앱 친구명단 자동연동 (권장). NAS_BASE_URL 이 있으면 자동 추론되므로 보통 불필요');
    lines.push('      RECIPIENTS  수동 명단 JSON 배열 (예: ["01012345678"])');
  }
  lines.push('');
  lines.push('등록: 레포 → Settings → Secrets and variables → Actions → New repository secret');
  lines.push('시크릿 없이 본문·카드만 확인하려면 Run workflow 의 dry_run 을 true 로 두고 실행하세요.');

  throw new Error(lines.join('\n'));
}

module.exports = { preflight, nasBase, friendsUrl, isDryRun };
