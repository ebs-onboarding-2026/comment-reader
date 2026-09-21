"""Collect YouTube comments into data/comments.{jsonl,csv}.

    python collect.py <video url or id> [more...]
    python collect.py --channel @handle --limit 20

Re-running skips videos already present in the JSONL, so an interrupted or
quota-capped run can just be started again the next day.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from youtube_api import (
    CommentsDisabled,
    QuotaExceeded,
    VideoUnavailable,
    YouTubeClient,
)

# Korean Windows consoles default to cp949 and die on emoji in comment text.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path("data")
CSV_FIELDS = [
    "comment_id",
    "video_id",
    "parent_id",
    "is_reply",
    "author",
    "author_channel_id",
    "text",
    "like_count",
    "reply_count",
    "published_at",
    "updated_at",
]


def flatten(snippet: dict, comment_id: str, video_id: str, parent_id: str | None,
            reply_count: int | None) -> dict:
    author_ch = snippet.get("authorChannelId") or {}
    return {
        "comment_id": comment_id,
        "video_id": video_id,
        "parent_id": parent_id,
        "is_reply": parent_id is not None,
        "author": snippet.get("authorDisplayName", ""),
        "author_channel_id": author_ch.get("value", ""),
        "text": snippet.get("textOriginal", ""),
        "like_count": snippet.get("likeCount", 0),
        "reply_count": reply_count,
        "published_at": snippet.get("publishedAt", ""),
        "updated_at": snippet.get("updatedAt", ""),
    }


def collect_video(client: YouTubeClient, video_id: str, order: str,
                  max_comments: int | None, fetch_all_replies: bool) -> list[dict]:
    rows: list[dict] = []
    for thread in client.iter_comment_threads(video_id, order=order):
        ts = thread["snippet"]
        top = ts["topLevelComment"]
        reply_count = ts.get("totalReplyCount", 0)
        rows.append(
            flatten(top["snippet"], top["id"], video_id, None, reply_count)
        )

        embedded = (thread.get("replies") or {}).get("comments", [])
        # commentThreads embeds at most 5 replies; go get the rest if asked.
        if fetch_all_replies and reply_count > len(embedded):
            for reply in client.iter_replies(top["id"]):
                rows.append(
                    flatten(reply["snippet"], reply["id"], video_id, top["id"], None)
                )
        else:
            for reply in embedded:
                rows.append(
                    flatten(reply["snippet"], reply["id"], video_id, top["id"], None)
                )

        if max_comments and len(rows) >= max_comments:
            break
    return rows


def already_done(jsonl_path: Path) -> set[str]:
    done: set[str] = set()
    if not jsonl_path.exists():
        return done
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            try:
                done.add(json.loads(line)["video_id"])
            except (ValueError, KeyError):
                continue
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description="Collect YouTube comments.")
    ap.add_argument("videos", nargs="*", help="video URLs or 11-char IDs")
    ap.add_argument("--channel", help="channel handle, URL, or UC... id")
    ap.add_argument("--limit", type=int, default=10,
                    help="how many recent videos when using --channel (default 10)")
    ap.add_argument("--order", choices=["time", "relevance"], default="time")
    ap.add_argument("--max-comments", type=int, default=None,
                    help="stop after roughly N comments per video")
    ap.add_argument("--all-replies", action="store_true",
                    help="fetch every reply (extra quota) instead of the first 5")
    ap.add_argument("--quota", type=int, default=9500,
                    help="local quota budget, kept under the 10000/day ceiling")
    ap.add_argument("--out", default="comments", help="output basename in data/")
    ap.add_argument("--fresh", action="store_true", help="ignore previous output and restart")
    args = ap.parse_args()

    load_dotenv()
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        print("YOUTUBE_API_KEY is not set. Copy .env.example to .env first.", file=sys.stderr)
        return 1

    client = YouTubeClient(api_key, quota_budget=args.quota)
    DATA_DIR.mkdir(exist_ok=True)
    jsonl_path = DATA_DIR / f"{args.out}.jsonl"
    csv_path = DATA_DIR / f"{args.out}.csv"
    videos_csv = DATA_DIR / f"{args.out}_videos.csv"

    if args.fresh:
        for p in (jsonl_path, csv_path, videos_csv):
            p.unlink(missing_ok=True)

    # ---------------------------------------------------------- build target list
    video_ids: list[str] = []
    try:
        if args.channel:
            ch = client.resolve_channel(args.channel)
            print(f"channel: {ch['title']}  ({ch['video_count']} videos, "
                  f"{ch['subscriber_count']:,} subscribers)")
            video_ids = client.list_playlist_video_ids(ch["uploads_playlist"], args.limit)
            print(f"newest {len(video_ids)} videos queued")
        for ref in args.videos:
            video_ids.append(YouTubeClient.parse_video_id(ref))
    except (ValueError, VideoUnavailable, QuotaExceeded) as exc:
        print(f"target resolution failed: {exc}", file=sys.stderr)
        return 1

    if not video_ids:
        ap.error("give at least one video, or --channel")

    seen = set()
    video_ids = [v for v in video_ids if not (v in seen or seen.add(v))]

    done = set() if args.fresh else already_done(jsonl_path)
    if done:
        skipped = [v for v in video_ids if v in done]
        video_ids = [v for v in video_ids if v not in done]
        print(f"resuming: {len(skipped)} video(s) already collected, {len(video_ids)} to go")

    # ------------------------------------------------------------- video metadata
    meta = client.get_videos(video_ids) if video_ids else []
    meta_by_id = {m["video_id"]: m for m in meta}
    for m in meta:
        if m["comment_count"] is None:
            print(f"  ! {m['video_id']} has comments disabled - skipping")
    live_ids = [v for v in video_ids
                if v in meta_by_id and meta_by_id[v]["comment_count"] is not None]
    missing = [v for v in video_ids if v not in meta_by_id]
    for v in missing:
        print(f"  ! {v} unavailable (private/deleted) - skipping")

    if meta:
        write_header = not videos_csv.exists()
        with videos_csv.open("a", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(meta[0].keys()))
            if write_header:
                w.writeheader()
            w.writerows(meta)

    # -------------------------------------------------------------------- collect
    csv_exists = csv_path.exists()
    total = 0
    quota_hit = False

    with jsonl_path.open("a", encoding="utf-8") as jf, \
         csv_path.open("a", encoding="utf-8-sig", newline="") as cf:
        writer = csv.DictWriter(cf, fieldnames=CSV_FIELDS)
        if not csv_exists:
            writer.writeheader()

        for i, vid in enumerate(live_ids, 1):
            title = meta_by_id[vid]["title"][:55]
            expected = meta_by_id[vid]["comment_count"]
            print(f"[{i}/{len(live_ids)}] {vid}  {title}  (~{expected} comments)")
            try:
                rows = collect_video(client, vid, args.order,
                                     args.max_comments, args.all_replies)
            except CommentsDisabled:
                print("    comments disabled - skipping")
                continue
            except VideoUnavailable as exc:
                print(f"    unavailable: {exc}")
                continue
            except QuotaExceeded as exc:
                print(f"    quota exhausted: {exc}")
                print("    partial progress saved; rerun tomorrow to resume.")
                quota_hit = True
                break

            for r in rows:
                jf.write(json.dumps(r, ensure_ascii=False) + "\n")
            writer.writerows(rows)
            jf.flush()
            cf.flush()
            total += len(rows)
            print(f"    collected {len(rows)}  |  quota used {client.quota.used}"
                  f"/{client.quota.budget}")

    print(f"\ntotal collected this run: {total}")
    print(f"quota used: {client.quota.used}  {client.quota.calls}")
    print(f"-> {csv_path}")
    print(f"-> {jsonl_path}")
    return 2 if quota_hit else 0


if __name__ == "__main__":
    raise SystemExit(main())
