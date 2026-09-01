name: 건축물대장 조회

on:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 조회
        env:
          DATA_GO_KR_KEY: ${{ secrets.DATA_GO_KR_KEY }}
        run: node scripts/bldrgst-fetch.mjs

      - name: 결과 커밋
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/bldrgst
          git diff --staged --quiet || git commit -m "건축물대장 조회 ($(date +%Y-%m-%d))"
          git push

      - name: 아티팩트 업로드
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: bldrgst-data
          path: data/bldrgst
