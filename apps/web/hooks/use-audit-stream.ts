'use client';

import { useState, useEffect, useRef } from 'react';
import type {
  AuditRecord,
  AuditCompetitor,
  AuditFinding,
  AuditQuery,
  AuditBlueprintSection,
  AuditPatch,
  AuditImage,
  AuditStatus,
} from '@rankforge/schema';

export interface UseAuditStreamResult {
  audit: AuditRecord | null;
  competitors: AuditCompetitor[];
  findings: AuditFinding[];
  queries: AuditQuery[];
  blueprint: AuditBlueprintSection[];
  patches: AuditPatch[];
  images: AuditImage[];
  status: AuditStatus;
  stage: string;
  progressPercent: number;
  elapsedSeconds: number;
  isConnected: boolean;
  isComplete: boolean;
  error: string | null;
}

export function useAuditStream(auditId: string): UseAuditStreamResult {
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [competitors, setCompetitors] = useState<AuditCompetitor[]>([]);
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [queries, setQueries] = useState<AuditQuery[]>([]);
  const [blueprint, setBlueprint] = useState<AuditBlueprintSection[]>([]);
  const [patches, setPatches] = useState<AuditPatch[]>([]);
  const [images, setImages] = useState<AuditImage[]>([]);
  const [status, setStatus] = useState<AuditStatus>('queued');
  const [stage, setStage] = useState<string>('init');
  const [progressPercent, setProgressPercent] = useState<number>(5);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isComplete, setIsComplete] = useState<boolean>(false);
  const [error] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<any>(null);
  const timerIntervalRef = useRef<any>(null);

  const isTerminalStatus = (st?: string) =>
    st === 'complete' || st === 'failed' || st === 'blocked';

  const stopStreamsAndTimers = () => {
    setIsComplete(true);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const applyData = (data: any) => {
    if (!data) return;
    if (data.audit) {
      setAudit(data.audit);
      setStatus(data.audit.status || 'queued');
      setStage(data.audit.stage || 'init');
      setProgressPercent(data.audit.progressPercent || 5);
      if (isTerminalStatus(data.audit.status)) {
        stopStreamsAndTimers();
      }
    }
    if (Array.isArray(data.competitors)) setCompetitors(data.competitors);
    if (Array.isArray(data.findings)) setFindings(data.findings);
    if (Array.isArray(data.queries)) setQueries(data.queries);
    if (Array.isArray(data.blueprint)) setBlueprint(data.blueprint);
    if (Array.isArray(data.patches)) setPatches(data.patches);
    if (Array.isArray(data.images)) setImages(data.images);
  };

  useEffect(() => {
    if (!auditId) return;

    // Start elapsed timer
    const startTime = Date.now();
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    // Initial snapshot fetch
    fetch(`/api/audits/${auditId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          applyData(data);
        }
      })
      .catch(() => {});

    // Helper to start polling fallback
    const startPollingFallback = () => {
      if (pollIntervalRef.current) return;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/audits/${auditId}`);
          if (res.ok) {
            const data = await res.json();
            applyData(data);
            if (isTerminalStatus(data.audit?.status)) {
              stopStreamsAndTimers();
            }
          }
        } catch {
          // Poll failed
        }
      }, 1500);
    };

    // Try EventSource (SSE)
    try {
      const sse = new EventSource(`/api/audits/${auditId}/stream`);
      eventSourceRef.current = sse;

      sse.onopen = () => {
        setIsConnected(true);
      };

      sse.addEventListener('audit_update', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          applyData(payload);
          if (isTerminalStatus(payload.audit?.status)) {
            stopStreamsAndTimers();
          }
        } catch {}
      });

      sse.addEventListener('done', () => {
        stopStreamsAndTimers();
      });

      sse.onerror = () => {
        setIsConnected(false);
        sse.close();
        // Fallback to polling
        startPollingFallback();
      };
    } catch {
      // EventSource not supported or failed
      startPollingFallback();
    }

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [auditId]);

  return {
    audit,
    competitors,
    findings,
    queries,
    blueprint,
    patches,
    images,
    status,
    stage,
    progressPercent,
    elapsedSeconds,
    isConnected,
    isComplete,
    error,
  };
}
