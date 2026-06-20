package com.edgemarket.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/push-tokens")
public class PushTokensController {

    private final JdbcTemplate jdbc;

    public PushTokensController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // POST /api/push-tokens  body: { userAddress, pushToken }
    @PostMapping
    public ResponseEntity<?> upsertToken(@RequestBody Map<String, String> body, HttpServletRequest request) {
        String userAddress = body.get("userAddress");
        String pushToken = body.get("pushToken");

        String authenticatedAddress = (String) request.getAttribute("authenticatedAddress");
        if (authenticatedAddress == null || !authenticatedAddress.equalsIgnoreCase(userAddress)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Forbidden: token subject does not match request address"));
        }

        if (userAddress == null || pushToken == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "userAddress and pushToken are required"));
        }
        try {
            jdbc.update(
                """
                INSERT INTO push_tokens (user_address, push_token, updated_at)
                VALUES (?, ?, NOW())
                ON CONFLICT (user_address)
                DO UPDATE SET push_token = EXCLUDED.push_token, updated_at = NOW()
                """,
                userAddress.toLowerCase(), pushToken
            );
            return ResponseEntity.ok(Map.of("ok", true, "persisted", true));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "DB error"));
        }
    }

    // DELETE /api/push-tokens  body: { userAddress }
    @DeleteMapping
    public ResponseEntity<?> deleteToken(@RequestBody Map<String, String> body, HttpServletRequest request) {
        String userAddress = body.get("userAddress");

        String authenticatedAddress = (String) request.getAttribute("authenticatedAddress");
        if (authenticatedAddress == null || !authenticatedAddress.equalsIgnoreCase(userAddress)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Forbidden: token subject does not match request address"));
        }

        if (userAddress == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "userAddress is required"));
        }
        try {
            jdbc.update(
                "DELETE FROM push_tokens WHERE user_address = ?",
                userAddress.toLowerCase()
            );
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "DB error"));
        }
    }
}
