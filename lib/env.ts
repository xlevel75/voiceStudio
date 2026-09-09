/**
 * 환경 변수 누락 안내 문구.
 * 로컬과 Vercel은 설정하는 곳이 다르므로 실행 환경에 맞는 안내를 준다.
 */
export function missingEnvMessage(...names: string[]): string {
  const label = names.join(" / ");
  return process.env.VERCEL
    ? `${label}가 설정되지 않았습니다. Vercel 프로젝트의 Settings → Environment Variables에 추가한 뒤 재배포(Redeploy)하세요.`
    : `${label}가 설정되지 않았습니다. .env.local에 값을 넣고 개발 서버를 재시작하세요.`;
}
