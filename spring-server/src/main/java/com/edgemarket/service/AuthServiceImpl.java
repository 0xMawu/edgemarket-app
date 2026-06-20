package com.edgemarket.service;

import com.edgemarket.exception.NonceExpiredException;
import com.edgemarket.exception.SignatureVerificationException;
import com.edgemarket.model.NonceResponse;
import com.edgemarket.model.TokenResponse;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.web3j.crypto.Keys;
import org.web3j.crypto.Sign;

import javax.crypto.SecretKey;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;

@Service
public class AuthServiceImpl implements AuthService {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final char[] HEX_CHARS = "0123456789abcdef".toCharArray();

    private final JdbcTemplate jdbcTemplate;
    private final String jwtSecret;

    public AuthServiceImpl(JdbcTemplate jdbcTemplate,
                           @Value("${auth.jwt.secret}") String jwtSecret) {
        this.jdbcTemplate = jdbcTemplate;
        this.jwtSecret = jwtSecret;
    }

    @Override
    public NonceResponse issueNonce(String walletAddress) {
        String nonce = generateNonce();
        Instant expiresAt = Instant.now().plus(5, ChronoUnit.MINUTES);

        jdbcTemplate.update(
                "INSERT INTO auth_nonces (wallet_address, nonce, expires_at) " +
                "VALUES (?, ?, ?)",
                walletAddress.toLowerCase(),
                nonce,
                java.sql.Timestamp.from(expiresAt)
        );

        return new NonceResponse(nonce, expiresAt.toString());
    }

    @Override
    @Transactional
    public TokenResponse verifyAndIssue(String walletAddress, String signature) {
        // 1. Look up the most recent unused, unexpired nonce for walletAddress
        String nonce;
        try {
            nonce = jdbcTemplate.queryForObject(
                    "SELECT nonce FROM auth_nonces " +
                    "WHERE wallet_address = ? AND used = FALSE AND expires_at > NOW() " +
                    "ORDER BY expires_at DESC LIMIT 1",
                    String.class,
                    walletAddress.toLowerCase()
            );
        } catch (EmptyResultDataAccessException e) {
            throw new NonceExpiredException("Nonce expired or already used");
        }

        if (nonce == null) {
            throw new NonceExpiredException("Nonce expired or already used");
        }

        // 2. Construct the Challenge_Message
        String message = "Sign in to EdgeMarket\nAddress: " + walletAddress.toLowerCase() + "\nNonce: " + nonce;

        // 3. Parse signature and recover signer address
        // Client sends a 132-char hex string (0x + 65 bytes). Strip "0x", decode hex to bytes[65].
        // r = bytes[0..31], s = bytes[32..63], v = bytes[64]
        String sigHex = signature.startsWith("0x") || signature.startsWith("0X")
                ? signature.substring(2)
                : signature;

        byte[] sigBytes;
        try {
            sigBytes = HexFormat.of().parseHex(sigHex);
        } catch (Exception e) {
            throw new SignatureVerificationException("Signature verification failed");
        }

        if (sigBytes.length != 65) {
            throw new SignatureVerificationException("Signature verification failed");
        }

        byte[] r = Arrays.copyOfRange(sigBytes, 0, 32);
        byte[] s = Arrays.copyOfRange(sigBytes, 32, 64);
        byte v = sigBytes[64];

        // Normalise v: EIP-155 / Metamask may send 0/1 or 27/28
        if (v < 27) {
            v += 27;
        }

        Sign.SignatureData signatureData = new Sign.SignatureData(v, r, s);

        byte[] messageBytes = message.getBytes(StandardCharsets.UTF_8);

        BigInteger publicKey;
        try {
            publicKey = Sign.signedPrefixedMessageToKey(messageBytes, signatureData);
        } catch (Exception e) {
            throw new SignatureVerificationException("Signature verification failed");
        }

        String recoveredAddress = "0x" + Keys.getAddress(publicKey);

        // 4. Compare recovered address to walletAddress (case-insensitive)
        if (!recoveredAddress.equalsIgnoreCase(walletAddress)) {
            throw new SignatureVerificationException("Signature verification failed");
        }

        // 5. On match — mark nonce used and issue JWT
        jdbcTemplate.update(
                "UPDATE auth_nonces SET used = TRUE WHERE wallet_address = ? AND nonce = ?",
                walletAddress.toLowerCase(),
                nonce
        );

        Instant now = Instant.now();
        SecretKey secretKey = io.jsonwebtoken.security.Keys.hmacShaKeyFor(
                Base64.getDecoder().decode(jwtSecret)
        );

        String token = Jwts.builder()
                .subject(walletAddress.toLowerCase())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(86400)))
                .signWith(secretKey)
                .compact();

        return new TokenResponse(token);
    }

    // Generates a 32-character lowercase hex nonce using SecureRandom
    private static String generateNonce() {
        byte[] bytes = new byte[16]; // 16 bytes → 32 hex chars
        SECURE_RANDOM.nextBytes(bytes);
        char[] hex = new char[32];
        for (int i = 0; i < 16; i++) {
            int b = bytes[i] & 0xFF;
            hex[i * 2]     = HEX_CHARS[b >>> 4];
            hex[i * 2 + 1] = HEX_CHARS[b & 0x0F];
        }
        return new String(hex);
    }
}
