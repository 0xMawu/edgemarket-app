package com.edgemarket.service;

import com.edgemarket.model.UserDto;
import java.util.UUID;

public interface EmailAuthService {
    /**
     * Creates an unverified user and sends a verification code email.
     * @throws com.edgemarket.exception.DuplicateEmailException if email already registered
     */
    void signup(String email, String password);

    /**
     * Verifies the email code and issues a JWT if valid.
     * @return HS256 JWT with sub = user UUID string
     * @throws com.edgemarket.exception.InvalidCodeException if code is wrong, consumed, or expired
     */
    String verifyEmail(String email, String code);

    /**
     * Authenticates user and issues a JWT.
     * @return HS256 JWT with sub = user UUID string
     * @throws com.edgemarket.exception.InvalidCredentialsException if email not found or password wrong
     * @throws com.edgemarket.exception.EmailNotVerifiedException if email not verified
     */
    String login(String email, String password);

    /**
     * Resends a verification code. No-op if email not found (to avoid enumeration).
     * @throws com.edgemarket.exception.TooManyResendsException if rate limit exceeded
     * @throws com.edgemarket.exception.AlreadyVerifiedException if already verified
     */
    void resendCode(String email);

    /**
     * Returns user details for the given UUID (for /api/auth/me).
     * @throws com.edgemarket.exception.UserNotFoundException if no user with that id
     */
    UserDto getUser(UUID userId);
}
