package com.edgemarket.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.util.*;

/**
 * Paper trading endpoints.
 *
 * POST /api/paper-trades
 *   Copies the target wallet's current open positions on Polymarket into the
 *   authenticated user's paper portfolio. Idempotent — existing positions are
 *   skipped (entry_price / created_at preserved).
 *   Requires: Authorization: Bearer <jwt>, body: { userAddress, targetAddress }
 *
 * GET /api/paper-trades/{userAddress}
 *   Returns the user's paper portfolio enriched with live prices and unrealised
 *   P&L fetched from the Polymarket positions endpoint. Public — no JWT needed.
 */
@RestController
@RequestMapping("/api/paper-trades")
public class PaperTradesController {

    private static final Logger log = LoggerFactory.getLogger(PaperTradesController.class);

    private static final String POSITIONS_URL =
            "https://data-api.polymarket.com/positions?user=%s&limit=50&sortBy=CASHPNL&sortDirection=DESC";

    private static final java.util.regex.Pattern ADDRESS_PATTERN =
            java.util.regex.Pattern.compile("^0x[0-9a-fA-F]{40}$");

    private final JdbcTemplate jdbc;
    private final RestTemplate restTemplate = new RestTemplate();

    public PaperTradesController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── POST /api/paper-trades ────────────────────────────────────────────────

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> copyPositions(
            @RequestBody Map<String, String> body,
            HttpServletRequest request) {

        String userAddress    = body.get("userAddress");
        String targetAddress  = body.get("targetAddress");

        // 1. Address format validation
        if (!isValidAddress(userAddress) || !isValidAddress(targetAddress)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "userAddress and targetAddress must be valid Ethereum addresses"));
        }

        // 2. JWT sub-match (AuthFilter already validated the JWT; this checks ownership)
        String authenticatedAddress = (String) request.getAttribute("authenticatedAddress");
        if (authenticatedAddress == null || !authenticatedAddress.equalsIgnoreCase(userAddress)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Forbidden: token subject does not match userAddress"));
        }

        String userLower   = userAddress.toLowerCase();
        String targetLower = targetAddress.toLowerCase();

        // 3. Fetch target wallet's open positions from Polymarket
        List<Map<String, Object>> positions;
        try {
            Object response = restTemplate.getForObject(
                    URI.create(String.format(POSITIONS_URL, targetLower)), Object.class);
            if (!(response instanceof List<?> list) || list.isEmpty()) {
                return ResponseEntity.unprocessableEntity()
                        .body(Map.of("error", "Target wallet has no open positions to copy"));
            }
            //noinspection unchecked
            positions = (List<Map<String, Object>>) list;
        } catch (Exception e) {
            log.warn("[paperTrades] Polymarket fetch failed for {}: {}", targetLower, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "Unable to fetch target wallet positions", "upstream", e.getMessage()));
        }

        if (positions.isEmpty()) {
            return ResponseEntity.unprocessableEntity()
                    .body(Map.of("error", "Target wallet has no open positions to copy"));
        }

        // 4. Upsert — skip positions that already exist
        int created = 0;
        int skipped = 0;

        for (Map<String, Object> pos : positions) {
            String conditionId = str(pos, "conditionId");
            double avgPrice    = toDouble(pos.get("avgPrice"));
            double size        = toDouble(pos.get("size"));
            String title       = str(pos, "title");
            String outcome     = str(pos, "outcome");

            if (conditionId == null || conditionId.isBlank() || avgPrice <= 0 || size <= 0) {
                continue; // skip malformed entries
            }

            try {
                int rows = jdbc.update(
                        """
                        INSERT INTO paper_trades
                            (user_address, target_address, market_id, entry_price, shares, market_title, outcome)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (user_address, target_address, market_id) DO NOTHING
                        """,
                        userLower, targetLower, conditionId,
                        BigDecimal.valueOf(avgPrice),
                        BigDecimal.valueOf(size),
                        title, outcome
                );
                if (rows > 0) created++; else skipped++;
            } catch (Exception e) {
                log.error("[paperTrades] DB insert error: {}", e.getMessage());
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("error", "Internal server error"));
            }
        }

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(Map.of("created", created, "skipped", skipped));
    }

    // ── GET /api/paper-trades/{userAddress} ───────────────────────────────────

    @GetMapping("/{userAddress}")
    public ResponseEntity<?> getPortfolio(@PathVariable String userAddress) {
        if (!isValidAddress(userAddress)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid wallet address"));
        }

        String userLower = userAddress.toLowerCase();

        // 1. Load stored paper trades
        List<Map<String, Object>> rows;
        try {
            rows = jdbc.queryForList(
                    """
                    SELECT id, target_address, market_id, entry_price, shares,
                           market_title, outcome, created_at
                    FROM paper_trades
                    WHERE user_address = ?
                    ORDER BY created_at DESC
                    """,
                    userLower
            );
        } catch (Exception e) {
            log.error("[paperTrades] DB read error: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Internal server error"));
        }

        if (rows.isEmpty()) {
            return ResponseEntity.ok(Map.of(
                    "trades", List.of(),
                    "portfolioSummary", Map.of(
                            "totalTrades", 0,
                            "totalUnrealisedPnl", 0.0,
                            "groupedByTarget", Map.of()
                    )
            ));
        }

        // 2. Group by target_address, fetch live prices per target (deduplicated)
        Map<String, List<Map<String, Object>>> byTarget = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            String target = (String) row.get("target_address");
            byTarget.computeIfAbsent(target, k -> new ArrayList<>()).add(row);
        }

        // 3. Fetch live positions for each target and build a price lookup
        //    key: conditionId → curPrice
        Map<String, Double> livePrices = new HashMap<>();
        Map<String, String> liveOutcomes = new HashMap<>();
        Map<String, String> liveTitles = new HashMap<>();

        for (String target : byTarget.keySet()) {
            try {
                Object response = restTemplate.getForObject(
                        URI.create(String.format(POSITIONS_URL, target)), Object.class);
                if (response instanceof List<?> list) {
                    for (Object item : list) {
                        if (!(item instanceof Map<?, ?> p)) continue;
                        String cid = str(p, "conditionId");
                        if (cid != null) {
                            livePrices.put(cid, toDouble(p.get("curPrice")));
                            if (p.get("outcome") != null) liveOutcomes.put(cid, str(p, "outcome"));
                            if (p.get("title")   != null) liveTitles.put(cid,   str(p, "title"));
                        }
                    }
                }
            } catch (Exception e) {
                log.warn("[paperTrades] live price fetch failed for {}: {}", target, e.getMessage());
                // Continue — return null livePrice for these positions
            }
        }

        // 4. Enrich each trade with live P&L
        List<Map<String, Object>> enrichedTrades = new ArrayList<>();
        double totalUnrealisedPnl = 0.0;

        for (Map<String, Object> row : rows) {
            String conditionId = (String) row.get("market_id");
            double entryPrice  = toDouble(row.get("entry_price"));
            double shares      = toDouble(row.get("shares"));

            Double livePrice = livePrices.get(conditionId);
            Double unrealisedPnl = null;
            Double pnlPercentage = null;

            if (livePrice != null && entryPrice > 0) {
                unrealisedPnl = round2((livePrice - entryPrice) * shares);
                pnlPercentage = round2(((livePrice - entryPrice) / entryPrice) * 100);
                totalUnrealisedPnl += unrealisedPnl;
            }

            Map<String, Object> trade = new LinkedHashMap<>();
            trade.put("id",            row.get("id"));
            trade.put("targetAddress", row.get("target_address"));
            trade.put("marketId",      conditionId);
            trade.put("marketTitle",   liveTitles.getOrDefault(conditionId, str(row, "market_title")));
            trade.put("outcome",       liveOutcomes.getOrDefault(conditionId, str(row, "outcome")));
            trade.put("entryPrice",    entryPrice);
            trade.put("shares",        shares);
            trade.put("livePrice",     livePrice);
            trade.put("unrealisedPnl", unrealisedPnl);
            trade.put("pnlPercentage", pnlPercentage);
            trade.put("createdAt",     row.get("created_at").toString());
            enrichedTrades.add(trade);
        }

        // 5. Build groupedByTarget map
        Map<String, List<Map<String, Object>>> groupedByTarget = new LinkedHashMap<>();
        for (Map<String, Object> trade : enrichedTrades) {
            String target = (String) trade.get("targetAddress");
            groupedByTarget.computeIfAbsent(target, k -> new ArrayList<>()).add(trade);
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("totalTrades",       enrichedTrades.size());
        summary.put("totalUnrealisedPnl", round2(totalUnrealisedPnl));
        summary.put("groupedByTarget",    groupedByTarget);

        return ResponseEntity.ok(Map.of(
                "trades", enrichedTrades,
                "portfolioSummary", summary
        ));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private boolean isValidAddress(String addr) {
        return addr != null && ADDRESS_PATTERN.matcher(addr).matches();
    }

    private double toDouble(Object val) {
        if (val == null) return 0.0;
        if (val instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (Exception e) { return 0.0; }
    }

    private double round2(double val) {
        return BigDecimal.valueOf(val).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    private String str(Map<?, ?> map, String key) {
        Object v = map.get(key);
        return v == null ? null : v.toString();
    }
}
