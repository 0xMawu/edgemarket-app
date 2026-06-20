package com.edgemarket.service;

import org.springframework.stereotype.Service;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Sliding-window rate limiter for email verification code resend requests.
 * Allows at most 3 requests per email address within any 1-hour window.
 */
@Service
public class EmailRateLimitService {
    private static final int MAX_REQUESTS = 3;
    private static final long WINDOW_MILLIS = 3_600_000L; // 1 hour

    private final ConcurrentHashMap<String, Deque<Long>> requestTimestamps = new ConcurrentHashMap<>();

    /**
     * Determines whether a resend-code request for the given email should be allowed.
     *
     * <p>Uses a sliding-window algorithm: timestamps older than 1 hour are evicted
     * before checking the current count. If fewer than 3 timestamps remain, the request
     * is admitted and the current timestamp is recorded; otherwise it is rejected.
     *
     * @param email the email address making the resend request
     * @return {@code true} if the request is within the rate limit, {@code false} otherwise
     */
    public boolean allow(String email) {
        Deque<Long> timestamps = requestTimestamps.computeIfAbsent(
                email.toLowerCase(), k -> new ArrayDeque<>());
        synchronized (timestamps) {
            long now = System.currentTimeMillis();
            long cutoff = now - WINDOW_MILLIS;
            while (!timestamps.isEmpty() && timestamps.peekFirst() <= cutoff) {
                timestamps.pollFirst();
            }
            if (timestamps.size() >= MAX_REQUESTS) return false;
            timestamps.addLast(now);
            return true;
        }
    }
}
