package com.edgemarket.controller;

import com.edgemarket.exception.NonceExpiredException;
import com.edgemarket.exception.SignatureVerificationException;
import com.edgemarket.model.ErrorResponse;
import com.edgemarket.model.NonceResponse;
import com.edgemarket.model.TokenResponse;
import com.edgemarket.model.VerifyRequest;
import com.edgemarket.service.AuthService;
import com.edgemarket.service.RateLimitService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.regex.Pattern;

/**
 * Handles wallet authentication endpoints:
 * <ul>
 *   <li>GET  /api/auth/nonce  — issues a one-time nonce for an address</li>
 *   <li>POST /api/auth/verify — verifies an EIP-191 signature and issues a JWT</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Pattern ADDRESS_PATTERN =
            Pattern.compile("^0x[0-9a-fA-F]{40}$");

    private final AuthService authService;
    private final RateLimitService rateLimitService;

    public AuthController(AuthService authService, RateLimitService rateLimitService) {
        this.authService = authService;
        this.rateLimitService = rateLimitService;
    }

    // -------------------------------------------------------------------------
    // GET /api/auth/nonce
    // -------------------------------------------------------------------------

    /**
     * Issues a one-time nonce for the given wallet address.
     *
     * @param address EIP-55 or lowercase Ethereum address (0x + 40 hex chars)
     * @return 200 with {@link NonceResponse}, 400 on invalid address, 429 on rate-limit
     */
    @GetMapping("/nonce")
    public ResponseEntity<?> getNonce(@RequestParam(required = false) String address) {
        if (address == null || !ADDRESS_PATTERN.matcher(address).matches()) {
            return ResponseEntity
                    .badRequest()
                    .body(new ErrorResponse("Invalid wallet address"));
        }

        if (!rateLimitService.allow(address)) {
            return ResponseEntity
                    .status(429)
                    .body(new ErrorResponse("Too many requests"));
        }

        NonceResponse nonce = authService.issueNonce(address);
        return ResponseEntity.ok(nonce);
    }

    // -------------------------------------------------------------------------
    // POST /api/auth/verify
    // -------------------------------------------------------------------------

    /**
     * Verifies an EIP-191 personal_sign signature against the stored nonce and,
     * on success, issues an HS256 JWT.
     *
     * <p>Spring enforces {@code Content-Type: application/json} via the
     * {@code consumes} attribute; requests with any other content type receive 415.
     *
     * @param body {@link VerifyRequest} containing {@code address} and {@code signature}
     * @return 200 with {@link TokenResponse} on success, 400 on missing fields
     */
    @PostMapping(value = "/verify", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> verify(@RequestBody VerifyRequest body) {
        if (body.address() == null || body.address().isBlank()
                || body.signature() == null || body.signature().isBlank()) {
            return ResponseEntity
                    .badRequest()
                    .body(new ErrorResponse("address and signature are required"));
        }

        TokenResponse token = authService.verifyAndIssue(body.address(), body.signature());
        return ResponseEntity.ok(token);
    }

    // -------------------------------------------------------------------------
    // Exception handlers
    // -------------------------------------------------------------------------

    @ExceptionHandler(SignatureVerificationException.class)
    public ResponseEntity<ErrorResponse> handleSignatureVerificationException(
            SignatureVerificationException ex) {
        return ResponseEntity
                .status(401)
                .body(new ErrorResponse("Signature verification failed"));
    }

    @ExceptionHandler(NonceExpiredException.class)
    public ResponseEntity<ErrorResponse> handleNonceExpiredException(
            NonceExpiredException ex) {
        return ResponseEntity
                .status(401)
                .body(new ErrorResponse("Nonce expired or already used"));
    }
}
