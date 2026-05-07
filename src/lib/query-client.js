import { QueryClient } from '@tanstack/react-query';

/**
 * Optimized React Query client with global defaults for better performance:
 * - staleTime: 60s default — data considered fresh for 1 minute, no auto-refetch.
 * - gcTime: 10min — cache kept for 10 minutes after unmount, fast page returns.
 * - refetchOnWindowFocus: false — no refetch when user switches tabs back.
 * - refetchOnReconnect: false — no automatic refetch on network reconnect.
 * - refetchOnMount: false — use cache if fresh, no refetch on remount.
 * - retry: 1 — single retry on failure.
 *
 * Individual queries can override these per-query via their own options.
 */
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 60 * 1000, // 1 minute default
			gcTime: 10 * 60 * 1000, // 10 minutes cache retention
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			refetchOnMount: false,
			retry: 1,
		},
	},
});