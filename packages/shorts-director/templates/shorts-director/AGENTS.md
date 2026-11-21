# 숏폼 총감독 프로젝트

이 프로젝트는 세로 숏폼 영상을 만드는 작업 폴더다. 영상을 기획·제작·수정하는 모든 요청은
`.claude/skills/shorts-director/SKILL.md` 를 먼저 읽고 그 단계대로 진행한다.

- 도구: `node tools/sd.mjs <command>` (도움말은 인자 없이 실행)
- 상태: `status.md`, `plan.json`, `jobs/` — 대화가 바뀌어도 여기서 이어 간다
- 비밀: `.env`(GEMINI_API_KEY)와 `knowledge/`(비공개 원문)는 커밋·출력하지 않는다
- 테스트: `node --test tools/test/`
