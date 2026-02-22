import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export default function PullToRefresh({ children, containerRef }) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);
  const queryClient = useQueryClient();
  const THRESHOLD = 80;

  const handleTouchStart = useCallback((e) => {
    const el = containerRef?.current;
    if (!el) return;
    startYRef.current = e.touches[0].clientY;
    // Only mark as potential pull if already at the very top
    isPullingRef.current = el.scrollTop <= 0;
  }, [containerRef]);

  const handleTouchMove = useCallback((e) => {
    if (!isPullingRef.current || refreshing) return;
    const el = containerRef?.current;
    if (!el) return;

    // If user scrolled down since touchstart, cancel pull mode
    if (el.scrollTop > 0) {
      isPullingRef.current = false;
      setPullDistance(0);
      setPulling(false);
      return;
    }

    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;

    // Only activate pull-to-refresh on downward swipe (diff > 10 for threshold)
    // If swiping up (diff < 0), let normal scroll handle it
    if (diff < 0) {
      isPullingRef.current = false;
      setPullDistance(0);
      setPulling(false);
      return;
    }

    if (diff > 10) {
      setPulling(true);
      setPullDistance(Math.min((diff - 10) * 0.5, 120));
    }
  }, [refreshing, containerRef]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPullingRef.current) return;
    isPullingRef.current = false;
    if (pullDistance >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(THRESHOLD);
      await queryClient.invalidateQueries();
      await new Promise(r => setTimeout(r, 600));
      setRefreshing(false);
    }
    setPullDistance(0);
    setPulling(false);
  }, [pullDistance, refreshing, queryClient]);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [containerRef, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return (
    <>
      {(pulling || refreshing) && (
        <div
          className="flex items-center justify-center transition-all duration-200"
          style={{
            height: `${pullDistance}px`,
            overflow: 'hidden',
            minHeight: 0
          }}
        >
          <Loader2
            className={`h-6 w-6 text-white ${refreshing ? 'animate-spin' : ''}`}
            style={{
              transform: refreshing ? 'none' : `rotate(${pullDistance * 3}deg)`,
              opacity: Math.min(pullDistance / THRESHOLD, 1)
            }}
          />
        </div>
      )}
      {children}
    </>
  );
}