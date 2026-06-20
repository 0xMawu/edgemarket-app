package com.edgemarket.service;

import com.edgemarket.model.NonceResponse;
import com.edgemarket.model.TokenResponse;

public interface AuthService {

    /**
     * Generates a one-time nonce for the given wallet address and persists it
     * in {@code auth_nonces} with a 5-minute expiry.
     *
     * @param walletAddress EIP-55 or lowercase Ethereum address (0x + 40 hex chars)
     * @return {@link NonceResponse} containing the 32-char hex nonce and ISO-8601 expiry
     */
    NonceResponse issueNonce(String walletAddress);

    /**
     * Verifies the EIP-191 personal_sign signature against the most recent
     * unused, unexpired nonce for {@code walletAddress}.  On success the nonce
     * is marked used and a JWT is issued.
     *
     * @param walletAddress claimed signer address
     * @param signature     hex-encoded EIP-191 signature produced by the client
     * @return {@link TokenResponse} containing the signed HS256 JWT
     * @throws com.edgemarket.exception.SignatureVerificationException if the recovered
     *         address does not match {@code walletAddress}
     * @throws com.edgemarket.exception.NonceExpiredException if no valid unused
     *         nonce exists for the address
     */
    TokenResponse verifyAndIssue(String walletAddress, String signature);
}
