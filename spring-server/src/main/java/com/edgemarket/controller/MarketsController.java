package com.edgemarket.controller;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

@RestController
@RequestMapping("/api/markets")
public class MarketsController {

    private static final String MARKETS_URL =
        "https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=50";
    private static final long CACHE_TTL_MS = 60_000;

    private final RestTemplate restTemplate = new RestTemplate();

    private record CacheEntry(Object data, long fetchedAt) {}
    private final AtomicReference<CacheEntry> cache = new AtomicReference<>();

    @GetMapping
    public ResponseEntity<Object> getMarkets() {
        long now = Instant.now().toEpochMilli();
        CacheEntry current = cache.get();

        if (current != null && (now - current.fetchedAt()) < CACHE_TTL_MS) {
            return ResponseEntity.ok(current.data());
        }

        try {
            ResponseEntity<Object> response = restTemplate.getForEntity(MARKETS_URL, Object.class);
            Object data = response.getBody();
            cache.set(new CacheEntry(data, now));
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(java.util.Map.of("error", "Failed to fetch markets: " + e.getMessage()));
        }
    }
}
