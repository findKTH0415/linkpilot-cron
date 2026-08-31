name: DART 기업조회

# Actions Secrets 의 DART_API_KEY 로 전자공시를 조회해 data/dart/ 에 커밋한다.
# 키는 저장소 밖으로 나가지 않는다. 결과 파일만 남는다.

on:
  workflow_dispatch:
    inputs:
      companies:
        description: '조회할 회사명 (쉼표 구분)'
        required: true
        default: '서영엔지니어링, 엔와이컴퓨터, 케이원정보통신, 키예노, 월드케이팝센터, 에듀포레, 솔리덴, 미주건설'

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

      - name: DART 조회
        env:
          DART_API_KEY: ${{ secrets.DART_API_KEY }}
        run: |
          IFS=',' read -ra ARR <<< "${{ inputs.companies }}"
          ARGS=()
          for c in "${ARR[@]}"; do ARGS+=("$(echo "$c" | xargs)"); done
          node scripts/dart-fetch.mjs "${ARGS[@]}"

      - name: 결과 커밋
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/dart
          git diff --staged --quiet || git commit -m "DART 조회 결과 갱신 ($(date +%Y-%m-%d))"
          git push

      - name: 아티팩트 업로드
        uses: actions/upload-artifact@v4
        with:
          name: dart-data
          path: data/dart
