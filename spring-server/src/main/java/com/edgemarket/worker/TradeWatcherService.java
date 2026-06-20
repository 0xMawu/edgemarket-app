package com.edgemarket.worker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Background trade watcher — Spring Boot equivalent of tradeWatcher.ts.
 *
 * NOTE: Push notifications via Expo require calling the Expo Push API over HTTP.
 * This class sends notifications via a plain HTTP POST to https://exp.host/--/api/v2/push/send
 * (no native SDK needed — the Expo Push HTTP API is fully REST-based).
 *
 * The watcher interval is controlled by watcher.interval.ms in application.properties.
 */
@Service
public class TradeWatcherService {

    private static final Logger log = LoggerFactory.getLogger(TradeWatcherService.class);

    // Polymarket data API — matches what the client uses in usePolymarket.ts
    // Correct host: data-api.polymarket.com, correct param: user=
    private static final String TRADES_URL_PREFIX =
        "https://data-api.polymarket.com/trades?user=";
    private static final String TRADES_URL_SUFFIX =
        "&limit=50&sortBy=TIMESTAMP&sortDirection=DESC";
    private static final String EXPO_PUSH_URL =
        "https://exp.host/--/api/v2/push/send";

    private final JdbcTemplate jdbc;
    private final RestTemplate restTemplate = new RestTemplate();

    // In-memory fallback map: "userAddress|targetAddress" -> lastSeenTimestamp
    private final Map<String, Long> memorySeenMap = new ConcurrentHashMap<>();

    @Value("${watcher.interval.ms:60000}")
    private long intervalMs;

    public TradeWatcherService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(fixedDelayString = "${watcher.interval.ms:60000}", initialDelay = 5000)
    public void runWatcherCycle() {
        log.debug("[tradeWatcher] Running cycle");

        // 1. Fetch all follows
        List<Map<String, Object>> follows;
        try {
            follows = jdbc.queryForList("SELECT user_address, target_address FROM follows");
        } catch (Exception e) {
            log.error("[tradeWatcher] Failed to fetch follows: {}", e.getMessage());
            return;
        }

        if (follows.isEmpty()) return;

        // 2. Group by target to deduplicate fetch calls
        Map<String, List<String>> byTarget = new LinkedHashMap<>();
        for (Map<String, Object> row : follows) {
            String user = (String) row.get("user_address");
            String target = (String) row.get("target_address");
            byTarget.computeIfAbsent(target, k -> new ArrayList<>()).add(user);
        }

        List<Map<String, Object>> notifications = new ArrayList<>();

        for (Map.Entry<String, List<String>> entry : byTarget.entrySet()) {
            String targetAddress = entry.getKey();
            List<String> users = entry.getValue();

            List<Map<String, Object>> trades = fetchRecentTrades(targetAddress);
            if (trades.isEmpty()) continue;

            for (String userAddress : users) {
                long lastSeen = getLastSeen(userAddress, targetAddress);
                List<Map<String, Object>> newTrades = trades.stream()
                    .filter(t -> toLong(t.get("timestamp")) > lastSeen)
                    .toList();

                if (newTrades.isEmpty()) continue;

                long latestTs = newTrades.stream()
                    .mapToLong(t -> toLong(t.get("timestamp")))
                    .max().orElse(lastSeen);
                setLastSeen(userAddress, targetAddress, latestTs);

                // Most recent trade
                Map<String, Object> latest = newTrades.stream()
                    .max(Comparator.comparingLong(t -> toLong(t.get("timestamp"))))
                    .orElse(newTrades.get(0));

                String pushToken = getPushToken(userAddress);
                if (pushToken != null && pushToken.startsWith("ExponentPushToken[")) {
                    String traderShort = targetAddress.substring(0, 6) + "..." +
                        targetAddress.substring(targetAddress.length() - 4);
                    // Trades API returns: side (BUY/SELL), size, price — not title/outcome
                    String side = String.valueOf(latest.getOrDefault("side", "BUY")).toUpperCase();
                    double size = toDouble(latest.get("size"));
                    double price = toDouble(latest.get("price"));
                    String body = String.format("%s just placed a %s — %.0f shares @ %.2f",
                        traderShort, side, size, price);

                    notifications.add(Map.of(
                        "to", pushToken,
                        "title", "📈 New Trade Alert",
                        "body", body
                    ));
                }
            }
        }

        // 3. Send push notifications (Expo HTTP API)
        if (!notifications.isEmpty()) {
            sendExpoPushNotifications(notifications);
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> fetchRecentTrades(String address) {
        String url = TRADES_URL_PREFIX + address + TRADES_URL_SUFFIX;
        try {
            log.debug("[tradeWatcher] Fetching trades: {}", url);
            Object response = restTemplate.getForObject(URI.create(url), Object.class);
            if (response instanceof List<?> list) {
                return (List<Map<String, Object>>) list;
            }
        } catch (Exception e) {
            log.warn("[tradeWatcher] fetchRecentTrades error for {}: {}", address, e.getMessage());
        }
        return List.of();
    }

    private long getLastSeen(String userAddress, String targetAddress) {
        try {
            List<Long> rows = jdbc.queryForList(
                "SELECT last_seen_timestamp FROM seen_trades WHERE user_address=? AND target_address=?",
                Long.class, userAddress, targetAddress);
            return rows.isEmpty() ? 0L : rows.get(0);
        } catch (Exception e) {
            return memorySeenMap.getOrDefault(userAddress + "|" + targetAddress, 0L);
        }
    }

    private void setLastSeen(String userAddress, String targetAddress, long ts) {
        memorySeenMap.put(userAddress + "|" + targetAddress, ts);
        try {
            jdbc.update(
                """
                INSERT INTO seen_trades (user_address, target_address, last_seen_timestamp)
                VALUES (?, ?, ?)
                ON CONFLICT (user_address, target_address)
                DO UPDATE SET last_seen_timestamp = EXCLUDED.last_seen_timestamp
                """,
                userAddress, targetAddress, ts
            );
        } catch (Exception e) {
            log.error("[tradeWatcher] setLastSeen error: {}", e.getMessage());
        }
    }

    private String getPushToken(String userAddress) {
        try {
            List<String> rows = jdbc.queryForList(
                "SELECT push_token FROM push_tokens WHERE user_address=?",
                String.class, userAddress);
            return rows.isEmpty() ? null : rows.get(0);
        } catch (Exception e) {
            return null;
        }
    }

    private void sendExpoPushNotifications(List<Map<String, Object>> messages) {
        // Expo HTTP API accepts a JSON array (up to 100 per request)
        // Split into chunks of 100
        int chunkSize = 100;
        for (int i = 0; i < messages.size(); i += chunkSize) {
            List<Map<String, Object>> chunk = messages.subList(i,
                Math.min(i + chunkSize, messages.size()));
            try {
                restTemplate.postForObject(EXPO_PUSH_URL, chunk, Object.class);
                log.info("[tradeWatcher] Sent {} push notification(s)", chunk.size());
            } catch (Exception e) {
                log.error("[tradeWatcher] Push send error: {}", e.getMessage());
            }
        }
    }

    private long toLong(Object val) {
        if (val == null) return 0L;
        if (val instanceof Number n) return n.longValue();
        try { return Long.parseLong(val.toString()); } catch (Exception e) { return 0L; }
    }

    private double toDouble(Object val) {
        if (val == null) return 0.0;
        if (val instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (Exception e) { return 0.0; }
    }
}
