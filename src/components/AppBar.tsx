import Link from "next/link";

/** The header from every artboard: mark, wordmark, English gloss. */
export function AppBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3.5">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="size-[22px] rounded-md bg-accent" aria-hidden />
        <span className="text-[14.5px] font-semibold tracking-[-0.01em]">
          댓글독해
        </span>
        <span className="border-l border-line pl-2 text-[11px] text-muted-2">
          YouTube comment reader
        </span>
      </Link>
      {right}
    </header>
  );
}
