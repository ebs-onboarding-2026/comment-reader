import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "댓글독해",
  description: "유튜브 영상 주소 하나로 댓글 전체를 읽고 정리합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard carries the Korean text in the mockups; the stack in
            globals.css covers the load failing. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
