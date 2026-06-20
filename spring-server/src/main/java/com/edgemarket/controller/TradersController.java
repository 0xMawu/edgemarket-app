package com.edgemarket.controller;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

@RestController
@RequestMapping("/api/traders")
public class TradersController {

    private static final String POLYMARKET_URL =
        "https://data-api.polymarket.com/v1/leaderboard?orderBy=PNL&timePeriod=ALL&limit=25";
    private static final long CACHE_TTL_MS = 60_000;

    private final RestTemplate restTemplate = new RestTemplate();

    private record CacheEntry(Object data, long fetchedAt) {}
    private final AtomicReference<CacheEntry> cache = new AtomicReference<>();

    @GetMapping
    public ResponseEntity<Object> getTraders() {
        long now = Instant.now().toEpochMilli();
        CacheEntry current = cache.get();

        if (current != null && (now - current.fetchedAt()) < CACHE_TTL_MS) {
            return ResponseEntity.ok(current.data());
        }

        try {
            ResponseEntity<Object> response = restTemplate.getForEntity(POLYMARKET_URL, Object.class);
            Object data = response.getBody();
            cache.set(new CacheEntry(data, now));
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(java.util.Map.of("error", "Failed to fetch traders: " + e.getMessage()));
        }
    }
}
