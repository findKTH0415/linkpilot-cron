// DART 전자공시 조회 — 의존성 없음. Node 20+ 내장 fetch / zlib 만 쓴다.

import { mkdir, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const KEY = process.env.DART_API_KEY;
if (!KEY) { console.error('DART_API_KEY 없음'); process.exit(1); }

const OUT = 'data/dart';
const API = 'https://opendart.fss.or.kr/api';
const YEARS = [2024, 2023, 2022];

const names = process.argv.slice(2);
if (!names.length) { console.error('회사명을 인자로 넘겨라'); process.exit(1); }

function unzip(buf) {
  const files = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('ZIP EOCD 없음');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    files[name] = method === 0 ? raw : inflateRawSync(raw);
    p += 46 + nlen + elen + clen;
  }
  return files;
}

async function getJson(path, params) {
  const u = new URL(`${API}/${path}`);
  u.searchParams.set('crtfc_key', KEY);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) return { status: `HTTP ${r.status}` };
  return r.json();
}

async function getBuf(path, params) {
  const u = new URL(`${API}/${path}`);
  u.searchParams.set('crtfc_key', KEY);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

console.log('고유번호 목록 내려받는 중…');
const zip = unzip(await getBuf('corpCode.xml'));
const xml = Object.values(zip)[0].toString('utf8');
const corps = [];
for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
  const g = (t) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [, ''])[1].trim();
  corps.push({ code: g('corp_code'), name: g('corp_name'), stock: g('stock_code') });
}
console.log(`  ${corps.length.toLocaleString()}개 법인`);

const norm = (s) => s.replace(/[㈜()주식회사\s·]/g, '');
await mkdir(OUT, { recursive: true });
const summary = ['# DART 조회 결과', '', `조회일 ${new Date().toISOString().slice(0, 10)}`, ''];

for (const q of names) {
  const nq = norm(q);
  const exact = corps.filter((c) => norm(c.name) === nq);
  const loose = exact.length ? exact : corps.filter((c) => norm(c.name).includes(nq));
  console.log(`\n■ ${q} — 후보 ${loose.length}건`);
  summary.push(`## ${q}`, '');

  if (!loose.length) { summary.push('DART 등록 법인 없음 (외감 대상 아님 또는 상호 상이)', ''); continue; }
  if (loose.length > 8) {
    summary.push(`동명 후보 ${loose.length}건 — 상호 특정 필요`, '');
    summary.push(loose.slice(0, 20).map((c) => `- ${c.name} (${c.code})`).join('\n'), '');
    continue;
  }

  const bundle = { query: q, candidates: loose, detail: {} };
  for (const c of loose) {
    const d = { corp: c };
    d.company = await getJson('company.json', { corp_code: c.code });
     d.filings = await getJson('list.json', {
      corp_code: c.code, bgn_de: '20180101',
      end_de: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      page_count: '100',
    });
    d.financials = {};
    for (const y of YEARS) {
      const r = await getJson('fnlttSinglAcntAll.json', {
        corp_code: c.code, bsns_year: String(y), reprt_code: '11011', fs_div: 'OFS',
      });
      if (r.status === '000') d.financials[y] = r;
    }
    bundle.detail[c.code] = d;

    const fl = d.filings?.list || [];
    const audit = fl.filter((x) => /감사보고서|사업보고서/.test(x.report_nm));
    summary.push(
      `**${d.company?.corp_name || c.name}** · 고유번호 ${c.code}${c.stock ? ` · 상장 ${c.stock}` : ''}`,
      `- 대표자 ${d.company?.ceo_nm || '—'} · 설립 ${d.company?.est_dt || '—'} · 사업자번호 ${d.company?.bizr_no || '—'}`,
      `- 주소 ${d.company?.adres || '—'}`,
      `- 정기공시 ${fl.length}건 (2020~) · 감사·사업보고서 ${audit.length}건`,
      audit.slice(0, 6).map((x) => `  - ${x.rcept_dt} ${x.report_nm} (rcept_no ${x.rcept_no})`).join('\n'),
      `- 재무제표 API 수신 연도 : ${Object.keys(d.financials).join(', ') || '없음'}`,
      '',
    );

    if (audit[0]) {
      try {
        const doc = unzip(await getBuf('document.xml', { rcept_no: audit[0].rcept_no }));
        for (const [fn, b] of Object.entries(doc)) {
          await writeFile(`${OUT}/${c.code}_${audit[0].rcept_no}_${fn}`, b);
        }
        summary.push(`- 원문 저장 : ${audit[0].rcept_no}`, '');
      } catch (e) { summary.push(`- 원문 저장 실패 : ${e.message}`, ''); }
    }
  }
  await writeFile(`${OUT}/${q.replace(/[^가-힣A-Za-z0-9]/g, '')}.json`, JSON.stringify(bundle, null, 2));
}

await writeFile(`${OUT}/_summary.md`, summary.join('\n'));
console.log('\n완료 — data/dart/');
