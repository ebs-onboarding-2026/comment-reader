"""YouTube Data API v3 client for comment collection.

Thin wrapper over the REST endpoints with quota accounting, retries, and the
error cases that actually show up when scraping comments at scale.
"""
from __future__ import annotations

import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Iterator

import requests

API_ROOT = "https://www.googleapis.com/youtube/v3"

# Quota units charged per call. search.list is 100x everything else, which is
# why channel videos are enumerated through the uploads playlist instead.
QUOTA_COST = {
    "commentThreads": 1,
    "comments": 1,
    "videos": 1,
    "channels": 1,
    "playlistItems": 1,
    "search": 100,
}


class QuotaExceeded(RuntimeError):
    """Daily quota is gone. Nothing else will succeed until midnight PT."""


class CommentsDisabled(RuntimeError):
    """Uploader turned comments off for this video."""


class VideoUnavailable(RuntimeError):
    """Private, deleted, or region-blocked."""


@dataclass
class QuotaMeter:
    budget: int = 10_000
    used: int = 0
    calls: dict[str, int] = field(default_factory=dict)

    def charge(self, endpoint: str) -> None:
        cost = QUOTA_COST.get(endpoint, 1)
        if self.used + cost > self.budget:
            raise QuotaExceeded(
                f"local budget {self.budget} would be exceeded "
                f"(used {self.used}, next call costs {cost})"
            )
        self.used += cost
        self.calls[endpoint] = self.calls.get(endpoint, 0) + 1

    @property
    def remaining(self) -> int:
        return self.budget - self.used


class YouTubeClient:
    def __init__(self, api_key: str, quota_budget: int = 10_000, timeout: int = 30):
        self.api_key = api_key
        self.quota = QuotaMeter(budget=quota_budget)
        self.timeout = timeout
        self.session = requests.Session()

    # ---------------------------------------------------------------- low level

    def _get(self, endpoint: str, **params) -> dict:
        self.quota.charge(endpoint)
        params["key"] = self.api_key
        url = f"{API_ROOT}/{endpoint}"

        last_exc = None
        for attempt in range(5):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:  # network blip
                last_exc = exc
                time.sleep(2**attempt)
                continue

            if resp.status_code == 200:
                return resp.json()

            # Parse the structured reason Google returns; the HTTP code alone
            # does not distinguish "comments off" from "out of quota".
            reason = ""
            message = resp.text[:300]
            try:
                err = resp.json().get("error", {})
                message = err.get("message", message)
                errors = err.get("errors") or []
                if errors:
                    reason = errors[0].get("reason", "")
            except ValueError:
                pass

            if resp.status_code == 403:
                if reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"):
                    raise QuotaExceeded(f"{reason}: {message}")
                if reason in ("commentsDisabled", "forbidden"):
                    raise CommentsDisabled(f"{reason}: {message}")
                raise RuntimeError(f"403 {reason}: {message}")

            if resp.status_code == 404:
                raise VideoUnavailable(f"404 {reason}: {message}")

            if resp.status_code >= 500 or resp.status_code == 429:
                last_exc = RuntimeError(f"{resp.status_code}: {message}")
                time.sleep(2**attempt)
                continue

            raise RuntimeError(f"{resp.status_code} {reason}: {message}")

        raise RuntimeError(f"{endpoint} failed after retries: {last_exc}")

    def _paginate(self, endpoint: str, **params) -> Iterator[dict]:
        token = None
        while True:
            if token:
                params["pageToken"] = token
            page = self._get(endpoint, **params)
            yield from page.get("items", [])
            token = page.get("nextPageToken")
            if not token:
                return

    # ------------------------------------------------------------------ lookups

    @staticmethod
    def parse_video_id(ref: str) -> str:
        """Accept a bare ID, a watch URL, a youtu.be link, or a /shorts/ link."""
        ref = ref.strip()
        if re.fullmatch(r"[A-Za-z0-9_-]{11}", ref):
            return ref
        parsed = urllib.parse.urlparse(ref)
        if parsed.query:
            v = urllib.parse.parse_qs(parsed.query).get("v")
            if v:
                return v[0]
        parts = [p for p in parsed.path.split("/") if p]
        for part in reversed(parts):
            if re.fullmatch(r"[A-Za-z0-9_-]{11}", part):
                return part
        raise ValueError(f"cannot parse a video id out of: {ref!r}")

    def resolve_channel(self, ref: str) -> dict:
        """Resolve a handle / channel URL / channel ID to its uploads playlist.

        Uses channels.list (1 unit) rather than search.list (100 units).
        """
        ref = ref.strip()
        params = {"part": "snippet,contentDetails,statistics"}

        if ref.startswith("UC") and len(ref) == 24:
            params["id"] = ref
        elif ref.startswith("@"):
            params["forHandle"] = ref
        elif "youtube.com" in ref:
            path = [p for p in urllib.parse.urlparse(ref).path.split("/") if p]
            if path and path[0].startswith("@"):
                params["forHandle"] = path[0]
            elif len(path) >= 2 and path[0] == "channel":
                params["id"] = path[1]
            elif len(path) >= 2 and path[0] in ("c", "user"):
                params["forUsername"] = path[1]
            else:
                raise ValueError(f"unrecognised channel URL: {ref}")
        else:
            params["forHandle"] = "@" + ref.lstrip("@")

        data = self._get("channels", **params)
        items = data.get("items") or []
        if not items:
            raise VideoUnavailable(f"no channel matched: {ref}")
        ch = items[0]
        return {
            "channel_id": ch["id"],
            "title": ch["snippet"]["title"],
            "uploads_playlist": ch["contentDetails"]["relatedPlaylists"]["uploads"],
            "video_count": int(ch.get("statistics", {}).get("videoCount", 0)),
            "subscriber_count": int(ch.get("statistics", {}).get("subscriberCount", 0)),
        }

    def list_playlist_video_ids(self, playlist_id: str, limit: int | None = None) -> list[str]:
        ids: list[str] = []
        for item in self._paginate(
            "playlistItems", part="contentDetails", playlistId=playlist_id, maxResults=50
        ):
            ids.append(item["contentDetails"]["videoId"])
            if limit and len(ids) >= limit:
                break
        return ids

    def get_videos(self, video_ids: list[str]) -> list[dict]:
        """Fetch metadata in batches of 50 (one quota unit per batch)."""
        out = []
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i : i + 50]
            data = self._get("videos", part="snippet,statistics", id=",".join(batch))
            for v in data.get("items", []):
                stats = v.get("statistics", {})
                out.append(
                    {
                        "video_id": v["id"],
                        "title": v["snippet"]["title"],
                        "channel_id": v["snippet"]["channelId"],
                        "channel_title": v["snippet"]["channelTitle"],
                        "published_at": v["snippet"]["publishedAt"],
                        "view_count": int(stats.get("viewCount", 0)),
                        "like_count": int(stats.get("likeCount", 0)),
                        # commentCount is absent entirely when comments are off
                        "comment_count": int(stats["commentCount"])
                        if "commentCount" in stats
                        else None,
                    }
                )
        return out

    # ----------------------------------------------------------------- comments

    def iter_comment_threads(self, video_id: str, order: str = "time") -> Iterator[dict]:
        """Yield raw commentThreads resources. order: 'time' or 'relevance'."""
        yield from self._paginate(
            "commentThreads",
            part="snippet,replies",
            videoId=video_id,
            maxResults=100,
            order=order,
            textFormat="plainText",
        )

    def iter_replies(self, parent_id: str) -> Iterator[dict]:
        """All replies to one top-level comment.

        commentThreads only embeds the first 5 replies, so threads with more
        need this follow-up call.
        """
        yield from self._paginate(
            "comments",
            part="snippet",
            parentId=parent_id,
            maxResults=100,
            textFormat="plainText",
        )
