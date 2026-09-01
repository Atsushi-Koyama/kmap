// サイトの公開URL。独自ドメインに変更する場合はここだけ直す。
// robots.txt は静的ファイルなので別途 static/robots.txt も更新すること。
export const SITE_URL = 'https://kmap-5tu.pages.dev';
export const SITE_NAME = 'クママップ';

/** パスから絶対URLを作る（canonical / og:url 用） */
export const absUrl = (pathname: string) =>
  `${SITE_URL}${pathname.endsWith('/') || pathname.includes('.') ? pathname : pathname + '/'}`;
