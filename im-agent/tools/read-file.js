#!/usr/bin/env node
'use strict';
/**
 * read-file.js — 자료 파일 하나를 **어떻게 읽는지** 그 자리에서 확인한다.
 *
 *   npm run im:read -- ~/사업계획서.pdf ~/감정평가서.hwp
 *
 * 왜 있는가: 문서 파서를 규격서대로 만들었지만 **실무 파일로 검증하지 못했다**
 * (등록부 D-31). 실무 파일에는 규격 밖 구현이 흔하다. 파이프라인을 통째로 돌려
 * 보면 어디서 깨졌는지 알기 어렵고, 딜 자료를 이 저장소로 가져올 수도 없다.
 * 그래서 **사용자 PC 에서 돌려 결과만 보내면 되는** 최소 도구를 둔다.
 *
 * ★ 값은 찍지 않는다. 읽힌 글자 수와 앞부분만 보여 준다 — 이 출력을 그대로
 *   붙여 넣어도 딜 정보가 새지 않도록. (`--full` 을 주면 전문을 찍는다)
 *
 * ★ OCR 은 부르지 않는다. 키를 쓰고 돈이 드는 경로라 확인 도구가 몰래 부르면 안 된다.
 *   대신 "OCR 로 넘어갈 파일이다"라고 알려 준다.
 */

const fs = require('fs');
const path = require('path');
const ex = require('../agents/02-extraction');
const ocr = require('../core/ocr');
const llm = require('../core/llm');

const PREVIEW = 200;

function human(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

function one(file, full) {
  const name = path.basename(file);
  const ext = path.extname(name).toLowerCase();
  const how = ex.FORMATS[ext] || '(모르는 형식)';

  console.log(`\n── ${name}`);
  if (!fs.existsSync(file)) { console.log('   ✗ 파일이 없다'); return false; }
  console.log(`   크기 ${human(fs.statSync(file).size)} · 읽는 방법 ${how}`);

  const r = ex.toText({ name, path: file, ext });

  if (r.text) {
    const lines = r.text.split('\n');
    const facts = [];
    lines.forEach((l, i) => ex.extractFromLine(l).forEach(f => facts.push({ ...f, line: i + 1 })));
    console.log(`   ✓ ${r.text.length.toLocaleString()}자 · ${lines.length}줄 · 규칙 추출 ${facts.length}건 (via ${r.via})`);
    if (facts.length) {
      const keys = [...new Set(facts.map(f => f.key))].slice(0, 8);
      console.log(`   뽑힌 항목: ${keys.join(', ')}${facts.length > 8 ? ' …' : ''}`);
    }
    console.log('   ┌─ 앞부분');
    (full ? r.text : r.text.slice(0, PREVIEW)).split('\n').slice(0, full ? 1e9 : 6)
      .forEach(l => console.log(`   │ ${l}`));
    console.log('   └─');
    return true;
  }

  console.log(`   ✗ ${r.error}`);
  if (r.ocr) {
    const can = ocr.isSupported(name);
    const ready = !llm.isOffline();
    console.log(`   → 실제 실행에서는 ${can ? (ready ? 'OCR 로 넘어간다' : 'OCR 로 넘어가지만 GEMINI_API_KEY 가 없어 멈춘다') : 'OCR 도 못 받는 형식이다'}`);
  }
  return false;
}

function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const files = args.filter(a => a !== '--full');

  if (!files.length) {
    console.log('사용법: npm run im:read -- <파일…> [--full]');
    console.log('예:     npm run im:read -- ~/Downloads/사업계획서.pdf');
    process.exit(2);
  }

  let ok = 0;
  for (const f of files) if (one(path.resolve(f), full)) ok++;
  console.log(`\n${ok}/${files.length} 읽음`);
  process.exit(ok === files.length ? 0 : 1);
}

if (require.main === module) main();
module.exports = { one };
