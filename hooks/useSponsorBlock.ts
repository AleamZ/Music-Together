"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SponsorSegment } from "@/lib/sponsorblock";

const STORAGE_KEY = "music-together:auto-skip-sponsor";
const clientCache = new Map<string, SponsorSegment[]>();

export interface SkippedToastInfo {
  segmentId: string;
  category: string;
  start: number;
  end: number;
  duration: number;
}

export interface UseSponsorBlockResult {
  segments: SponsorSegment[];
  loading: boolean;
  enabled: boolean;
  toggleEnabled: () => void;
  lastSkippedToast: SkippedToastInfo | null;
  triggerSkipToast: (seg: SponsorSegment) => void;
  clearSkipToast: () => void;
}

export function useSponsorBlock(videoId: string | null | undefined): UseSponsorBlockResult {
  const [segments, setSegments] = useState<SponsorSegment[]>(() => {
    if (videoId && clientCache.has(videoId)) {
      return clientCache.get(videoId)!;
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [lastSkippedToast, setLastSkippedToast] = useState<SkippedToastInfo | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Restore user preference from localStorage once on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      setEnabled(saved !== "false");
    }
  }, []);

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const triggerSkipToast = useCallback((seg: SponsorSegment) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setLastSkippedToast({
      segmentId: seg.segmentId,
      category: seg.category,
      start: seg.start,
      end: seg.end,
      duration: seg.duration,
    });
    toastTimeoutRef.current = setTimeout(() => {
      setLastSkippedToast(null);
    }, 4500);
  }, []);

  const clearSkipToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setLastSkippedToast(null);
  }, []);

  // Fetch segments when videoId changes
  useEffect(() => {
    if (!videoId) {
      setSegments([]);
      setLoading(false);
      return;
    }

    if (clientCache.has(videoId)) {
      setSegments(clientCache.get(videoId)!);
      setLoading(false);
      return;
    }

    let isCancelled = false;
    setLoading(true);

    fetch(`/api/sponsorblock?videoId=${encodeURIComponent(videoId)}`)
      .then((res) => (res.ok ? res.json() : { segments: [] }))
      .then((data) => {
        if (isCancelled) return;
        const list: SponsorSegment[] = Array.isArray(data.segments) ? data.segments : [];
        clientCache.set(videoId, list);
        setSegments(list);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.warn("[useSponsorBlock] Failed to fetch segments:", err);
        setSegments([]);
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [videoId]);

  return {
    segments,
    loading,
    enabled,
    toggleEnabled,
    lastSkippedToast,
    triggerSkipToast,
    clearSkipToast,
  };
}
