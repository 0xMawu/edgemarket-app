package com.edgemarket.service;

import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Sliding-window rate limiter for wallet address nonce requests.
 * Allows at most 5 requests per wallet address within any 60-second window.
 */
@Service
public class RateLimitService {

    private static final int MAX_REQUESTS = 5;
    private static final long WINDOW_MILLIS = 60_000L;

    private final ConcurrentHashMap<String, Deque<Long>> requestTimestamps = new ConcurrentHashMap<>();

    /**
     * Determines whether a request from the given wallet address should be allowed.
     *
     * <p>Uses a sliding-window algorithm: timestamps older than 60 seconds are evicted
     * before checking the current count. If fewer than 5 timestamps remain, the request
     * is admitted and the current timestamp is recorded; otherwise it is rejected.
     *
     * @param walletAddress the wallet address making the request
     * @return {@code true} if the request is within the rate limit, {@code false} otherwise
     */
    public boolean allow(String walletAddress) {
        Deque<Long> timestamps = requestTimestamps.computeIfAbsent(
                walletAddress, k -> new ArrayDeque<>());

        synchronized (timestamps) {
            long now = System.currentTimeMillis();
            long cutoff = now - WINDOW_MILLIS;

            // Evict timestamps outside the sliding window
            while (!timestamps.isEmpty() && timestamps.peekFirst() <= cutoff) {
                timestamps.pollFirst();
            }

            if (timestamps.size() >= MAX_REQUESTS) {
                return false;
            }

            timestamps.addLast(now);
            return true;
        }
    }
}
