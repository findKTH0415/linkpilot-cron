// 쇼츠 제작 엔진 시험 요약 — 워크플로가 그린 두 영상을 ffprobe 로 재서 data/_shorts/engines/_summary.md 에 적는다.
// 되돌아오는 값: 0 = 둘 다 1080×1920·30fps 로 그려짐 · 1 = 하나만 · 2 = 하나도 못 그림. 「그렸다」는 단계 결과가 아니라 파일을 재서 정한다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

const OUT = 'data/_shorts/engines';
const pkg = JSON.parse((await import('node:fs')).readFileSync('engines/package.json', 'utf8'));

export function probe(file) {
  if (!existsSync(file)) return { ok: false, why: '파일 없음' };
  try {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
    const s = j.streams?.[0] || {}; const dur = Number(j.format?.duration || 0);
    const ok = s.width === 1080 && s.height === 1920 && s.r_frame_rate === '30/1' && dur > 0;
    return { ok, why: `${s.width}×${s.height} · ${s.r_frame_rate} · ${dur.toFixed(2)}초` };
  } catch (e) { return { ok: false, why: 'ffprobe 가 못 읽음' }; }
}

const hf = probe('engines/out-hyperframes.mp4');
const rm = probe('engines/out-remotion.mp4');
const all = hf.ok && rm.ok;
const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const d = pkg.dependencies;
const verdict = all ? 0 : (hf.ok || rm.ok) ? 1 : 2;
const log = [
  '',
  `**잰 시각** ${kst} (KST) · **잰 곳** GitHub Actions`,
  '',
  '| 엔진 | 판 | 단계 | 잰 값 |',
  '|---|---|---|---|',
  `| HyperFrames (Apache-2.0) | ${d.hyperframes} | ${process.env.HF || '?'} | ${hf.ok ? '✅' : '✗'} ${hf.why} |`,
  `| Remotion | ${d.remotion} | ${process.env.RM || '?'} | ${rm.ok ? '✅' : '✗'} ${rm.why} |`,
  `| OpenMontage (설치 안 함) | ${process.env.OM_COMMIT || '못 받음'} | — | 사용권 첫 줄: ${process.env.OM_LIC || '못 읽음'} |`,
  '',
  '★ 시험판이다 — 운영 쇼츠는 FFmpeg 길(shorts-make.yml)이다. 운영에 쓰기 전에 사용권을 정한다 (D-460):',
  '  Remotion 은 사원 3명 넘는 회사는 유료 회사 사용권 · OpenMontage 는 AGPL-3.0.',
  '',
];
const head = `> 판정 ${verdict} — ${verdict === 0 ? '두 엔진 모두 이 러너에서 9:16 영상을 그렸다' : verdict === 1 ? '한 엔진만 그렸다 — 아래 표를 본다' : '두 엔진 다 못 그렸다 — 아래 표를 본다'}`;
log.unshift('# 쇼츠 제작 엔진 시험', '', head);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/_summary.md`, log.join('\n'));
rmSync(`${OUT}/.ok`, { force: true });
if (verdict === 0) writeFileSync(`${OUT}/.ok`, '');
console.log(head);
process.exit(verdict);
