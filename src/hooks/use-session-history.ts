"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { HistorySession, HistoryResponse } from "@/lib/api-types";

export interface UseSessionHistoryFilters {
  search: string;
  status: string;
  fromDate: string;
  toDate: string;
  limit: number;
  offset: number;
}

export interface UseSessionHistoryResult {
  sessions: HistorySession[];
  total: number;
  isLoading: boolean;
  error: string | null;
}

const DEBOUNCE_MS = 300;

export function useSessionHistory(filters: UseSessionHistoryFilters): UseSessionHistoryResult {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHistory = useCallback(async (f: UseSessionHistoryFilters) => {
    const params = new URLSearchParams();
    if (f.search) params.set("search", f.search);
    if (f.status) params.set("status", f.status);
    if (f.fromDate) params.set("from", f.fromDate);
    if (f.toDate) params.set("to", f.toDate);
    params.set("limit", String(f.limit));
    params.set("offset", String(f.offset));

    try {
      setIsLoading(true);
      const response = await fetch(`/api/sessions/history?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as HistoryResponse;
      if (isMounted.current) {
        setSessions(data.sessions);
        setTotal(data.total);
        setError(null);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      fetchHistory(filters);
    }, DEBOUNCE_MS);

    return () => {
      isMounted.current = false;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [filters.search, filters.status, filters.fromDate, filters.toDate, filters.limit, filters.offset, fetchHistory]);

  return { sessions, total, isLoading, error };
}
