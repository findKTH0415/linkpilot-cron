'use strict';
/**
 * evidence.js — 근거 기여도·품질 셈의 **엔진 쪽 문패** 〈2026-08-27 · D-152〉.
 *
 * ★★★ 실물은 `ui/platform/evidence-core.js` 에 있다. **두 벌로 만들지 않는다** —
 *   화면과 엔진이 서로 다른 수를 말하는 순간 이 측정은 아무 뜻이 없어진다.
 *   (`fields-core.js` 와 같은 자리다: 브라우저가 읽어야 하므로 화면 폴더에 두고,
 *   엔진은 여기서 그대로 받아 쓴다.)
 *
 * ★ 왜 화면 폴더여야 하나: 배포가 올리는 화면 묶음은 `build-embed.js` 의
 *   `required()` 한 곳에서 나온다. 그 밖에 있는 파일은 **브라우저가 못 받는다.**
 */
module.exports = require('../ui/platform/evidence-core.js');
