import { useEffect, useId, useRef } from "react";

import {
  clearPollingFailure,
  reportPollingFailure,
} from "@/lib/polling-status";

/**
 * One blip is not an outage. Only announce after this many consecutive
 * failures, so a single dropped request never flashes a notice at the user.
 */
export const ANNOUNCE_AFTER_FAILURES = 2;

/**
 * Interval polling with the three rules that were previously copy-pasted
 * (and mostly forgotten) at every call site:
 *
 *  1. A hidden tab does not poll. Background tabs multiplied every badge
 *     and list poll by the number of open dashboard tabs.
 *  2. Returning to the tab refreshes once, immediately, so a paused tab
 *     never shows stale data.
 *  3. Idle screens poll slowly; only screens with work in flight poll fast.
 *
 * Event-driven refresh (mount / tab return / midnight) without an interval
 * already lives in `useAutoRefresh` — use that when there is nothing to watch.
 */
export type PollingContext = {
  /** Caller says work is in flight (a job is rendering, transcribing, ...). */
  active: boolean;
  /** Fast cadence the caller wants while work is in flight, in ms. */
  activeMs: number;
  /** Slow cadence for an idle screen, in ms. */
  idleMs: number;
  /** Consecutive failed ticks. Resets to 0 after any success. */
  failures: number;
};

export type UsePollingOptions = {
  active?: boolean;
  activeMs?: number;
  idleMs?: number;
  /** Skip entirely (screen unmounted in spirit, modal closed, ...). */
  enabled?: boolean;
  /**
   * Stable label for this poll, used to de-duplicate outage notices when
   * several screens fail at once. Defaults to a per-instance id.
   */
  label?: string;
  /**
   * Set false for a poll whose failure the user should not be told about
   * (a nice-to-have side panel, say). The retry/backoff still runs.
   */
  announce?: boolean;
};

/** Never wait longer than this, however long the outage runs. */
export const MAX_BACKOFF_MS = 60_000;

/**
 * How long to wait before the next tick.
 *
 * Polling never gives up (this never returns null): going silent is the one
 * failure mode we refuse, because a frozen screen looks identical to a calm
 * one. An outage is announced by `<ConnectionNotice />` instead, and the
 * retries keep running underneath so recovery is automatic.
 *
 * While failing, the wait doubles per consecutive failure so a dead endpoint
 * is not hammered every 3s, capped so recovery is never more than a minute
 * away.
 */
export function resolveDelay(ctx: PollingContext): number {
  const base = ctx.active ? ctx.activeMs : ctx.idleMs;
  if (ctx.failures === 0) return base;
  const backoff = base * 2 ** (ctx.failures - 1);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

export function usePolling(
  callback: () => void | Promise<unknown>,
  {
    active = false,
    activeMs = 3_000,
    idleMs = 30_000,
    enabled = true,
    label,
    announce = true,
  }: UsePollingOptions = {},
) {
  // Keep the latest callback without restarting the timer on every render.
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  });

  const failuresRef = useRef(0);
  const autoId = useId();
  const key = label ?? autoId;

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    const tick = async () => {
      if (!alive) return;
      // Rule 1: a hidden tab costs nothing.
      if (document.hidden) {
        schedule();
        return;
      }
      // Never stack ticks — a slow response must not queue up behind itself.
      if (running) return;
      running = true;
      try {
        await cbRef.current();
        if (!alive) return;
        failuresRef.current = 0;
        if (announce) clearPollingFailure(key);
      } catch (err) {
        if (!alive) return;
        failuresRef.current += 1;
        if (announce && failuresRef.current >= ANNOUNCE_AFTER_FAILURES) {
          reportPollingFailure(key, err);
        }
      } finally {
        running = false;
        schedule();
      }
    };

    const schedule = () => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      const delay = resolveDelay({
        active,
        activeMs,
        idleMs,
        failures: failuresRef.current,
      });
      timer = setTimeout(() => void tick(), delay);
    };

    // Rule 2: refresh the moment the tab comes back.
    const onVisible = () => {
      if (document.hidden || !alive) return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    void tick();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      // Leaving the screen must not leave its outage notice on screen.
      if (announce) clearPollingFailure(key);
    };
  }, [enabled, active, activeMs, idleMs, announce, key]);
}
