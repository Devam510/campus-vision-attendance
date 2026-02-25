/**
 * hooks/useData.js – Centralised SWR data-fetching hook.
 *
 * All API GET calls go through here. SWR deduplicates in-flight
 * requests and returns cached data instantly on navigation,
 * revalidating in the background.
 */
import useSWR, { mutate as globalMutate } from "swr";
import api from "../api/client";

// Shared fetcher — SWR uses this for all requests
const fetcher = (url) => api.get(url).then((r) => r.data);

/**
 * useData(url, options?)
 *
 * Returns { data, error, loading, reload }
 *
 * @param {string|null} url  - API path (e.g. "/classrooms/"), or null to skip
 * @param {object}      opts - SWR options override
 */
export function useData(url, opts = {}) {
    const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
        dedupingInterval: 10_000,   // reuse cached result for 10s
        revalidateOnFocus: false,   // don't refetch when tab regains focus
        ...opts,
    });
    return { data: data ?? null, error, loading: isLoading, reload: mutate };
}

/**
 * Invalidate a cached endpoint from outside a component (e.g. after POST/DELETE)
 * Usage: invalidate("/classrooms/")
 */
export const invalidate = (url) => globalMutate(url);

/**
 * Prefetch a URL into SWR cache without rendering (call after login).
 */
export const prefetch = (url) => globalMutate(url, fetcher(url), false);
