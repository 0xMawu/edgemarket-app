package com.edgemarket.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/follows")
public class FollowsController {

    private final JdbcTemplate jdbc;

    public FollowsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // GET /api/follows/{walletAddress}
    @GetMapping("/{walletAddress}")
    public ResponseEntity<?> getFollows(@PathVariable String walletAddress) {
        if (walletAddress == null || walletAddress.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "walletAddress is required"));
        }
        try {
            List<String> addresses = jdbc.queryForList(
                "SELECT target_address FROM follows WHERE user_address = ? ORDER BY created_at DESC",
                String.class,
                walletAddress.toLowerCase()
            );
            return ResponseEntity.ok(addresses);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Database error"));
        }
    }

    // POST /api/follows  body: { userAddress, targetAddress }
    @PostMapping
    public ResponseEntity<?> follow(@RequestBody Map<String, String> body, HttpServletRequest request) {
        String userAddress = body.get("userAddress");
        String targetAddress = body.get("targetAddress");

        String authenticatedAddress = (String) request.getAttribute("authenticatedAddress");
        if (authenticatedAddress == null || !authenticatedAddress.equalsIgnoreCase(userAddress)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Forbidden: token subject does not match request address"));
        }

        if (userAddress == null || targetAddress == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "userAddress and targetAddress are required"));
        }
        try {
            jdbc.update(
                """
                INSERT INTO follows (user_address, target_address)
                VALUES (?, ?)
                ON CONFLICT (user_address, target_address) DO NOTHING
                """,
                userAddress.toLowerCase(), targetAddress.toLowerCase()
            );
            return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Database error"));
        }
    }

    // DELETE /api/follows  body: { userAddress, targetAddress }
    @DeleteMapping
    public ResponseEntity<?> unfollow(@RequestBody Map<String, String> body, HttpServletRequest request) {
        String userAddress = body.get("userAddress");
        String targetAddress = body.get("targetAddress");

        String authenticatedAddress = (String) request.getAttribute("authenticatedAddress");
        if (authenticatedAddress == null || !authenticatedAddress.equalsIgnoreCase(userAddress)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Forbidden: token subject does not match request address"));
        }

        if (userAddress == null || targetAddress == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "userAddress and targetAddress are required"));
        }
        try {
            jdbc.update(
                "DELETE FROM follows WHERE user_address = ? AND target_address = ?",
                userAddress.toLowerCase(), targetAddress.toLowerCase()
            );
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Database error"));
        }
    }
}
