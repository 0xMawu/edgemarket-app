package com.edgemarket.controller;

import com.edgemarket.exception.AlreadyVerifiedException;
import com.edgemarket.exception.DuplicateEmailException;
import com.edgemarket.exception.EmailNotVerifiedException;
import com.edgemarket.exception.InvalidCodeException;
import com.edgemarket.exception.InvalidCredentialsException;
import com.edgemarket.exception.TooManyResendsException;
import com.edgemarket.exception.UserNotFoundException;
import com.edgemarket.model.ErrorResponse;
import com.edgemarket.model.LoginRequest;
import com.edgemarket.model.ResendCodeRequest;
import com.edgemarket.model.SignupRequest;
import com.edgemarket.model.UserDto;
import com.edgemarket.model.VerifyEmailRequest;
import com.edgemarket.service.EmailAuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * Handles email/password authentication endpoints:
 * <ul>
 *   <li>POST /api/auth/signup       — register a new user, send verification code</li>
 *   <li>POST /api/auth/verify-email — verify the 6-digit code, receive JWT</li>
 *   <li>POST /api/auth/resend-code  — resend the verification code</li>
 *   <li>POST /api/auth/login        — authenticate and receive JWT</li>
 *   <li>GET  /api/auth/me           — return the authenticated user's profile</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/auth")
public class EmailAuthController {

    private final EmailAuthService emailAuthService;

    public EmailAuthController(EmailAuthService emailAuthService) {
        this.emailAuthService = emailAuthService;
    }

    // -------------------------------------------------------------------------
    // POST /api/auth/signup
    // -------------------------------------------------------------------------

    /**
     * Registers a new user and sends a 6-digit verification code to the supplied email.
     *
     * @param body {@link SignupRequest} containing {@code email} and {@code password}
     * @return 201 with a confirmation message on success
     */
    @PostMapping(value = "/signup", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, String>> signup(@RequestBody SignupRequest body) {
        emailAuthService.signup(body.email(), body.password());
        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(Map.of("message", "Verification code sent to your email"));
    }

    // -------------------------------------------------------------------------
    // POST /api/auth/verify-email
    // -------------------------------------------------------------------------

    /**
     * Verifies the 6-digit code sent to the user's email and, on success, issues a JWT.
     *
     * @param body {@link VerifyEmailRequest} containing {@code email} and {@code code}
     * @return 200 with {@code {"token": jwt}} on success
     */
    @PostMapping(value = "/verify-email", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, String>> verifyEmail(@RequestBody VerifyEmailRequest body) {
        String token = emailAuthService.verifyEmail(body.email(), body.code());
        return ResponseEntity.ok(Map.of("token", token));
    }

    // -------------------------------------------------------------------------
    // POST /api/auth/resend-code
    // -------------------------------------------------------------------------

    /**
     * Resends a fresh verification code to the given email address.
     *
     * @param body {@link ResendCodeRequest} containing {@code email}
     * @return 200 with a confirmation message on success
     */
    @PostMapping(value = "/resend-code", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, String>> resendCode(@RequestBody ResendCodeRequest body) {
        emailAuthService.resendCode(body.email());
        return ResponseEntity.ok(Map.of("message", "New code sent"));
    }

    // -------------------------------------------------------------------------
    // POST /api/auth/login
    // -------------------------------------------------------------------------

    /**
     * Authenticates a user with email and password, and issues a JWT on success.
     *
     * @param body {@link LoginRequest} containing {@code email} and {@code password}
     * @return 200 with {@code {"token": jwt}} on success; 403 if email is not verified
     */
    @PostMapping(value = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, String>> login(@RequestBody LoginRequest body) {
        String token = emailAuthService.login(body.email(), body.password());
        return ResponseEntity.ok(Map.of("token", token));
    }

    // -------------------------------------------------------------------------
    // GET /api/auth/me
    // -------------------------------------------------------------------------

    /**
     * Returns the authenticated user's profile.
     *
     * <p>Requires a valid JWT; {@code AuthFilter} populates the
     * {@code authenticatedAddress} request attribute with the JWT {@code sub} claim
     * (a UUID string for email-auth users).
     *
     * @param request the current HTTP request
     * @return 200 with {@link UserDto} on success
     */
    @GetMapping("/me")
    public ResponseEntity<UserDto> me(HttpServletRequest request) {
        String rawId = (String) request.getAttribute("authenticatedAddress");
        UUID userId = UUID.fromString(rawId);
        UserDto user = emailAuthService.getUser(userId);
        return ResponseEntity.ok(user);
    }

    // -------------------------------------------------------------------------
    // Exception handlers
    // -------------------------------------------------------------------------

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity
                .badRequest()
                .body(new ErrorResponse(ex.getMessage()));
    }

    @ExceptionHandler(DuplicateEmailException.class)
    public ResponseEntity<ErrorResponse> handleDuplicateEmail(DuplicateEmailException ex) {
        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(new ErrorResponse("Email already registered"));
    }

    @ExceptionHandler(InvalidCodeException.class)
    public ResponseEntity<ErrorResponse> handleInvalidCode(InvalidCodeException ex) {
        return ResponseEntity
                .badRequest()
                .body(new ErrorResponse("Invalid or expired code"));
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleInvalidCredentials(InvalidCredentialsException ex) {
        return ResponseEntity
                .status(HttpStatus.UNAUTHORIZED)
                .body(new ErrorResponse("Invalid credentials"));
    }

    @ExceptionHandler(EmailNotVerifiedException.class)
    public ResponseEntity<ErrorResponse> handleEmailNotVerified(EmailNotVerifiedException ex) {
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(new ErrorResponse(ex.getMessage()));
    }

    @ExceptionHandler(TooManyResendsException.class)
    public ResponseEntity<ErrorResponse> handleTooManyResends(TooManyResendsException ex) {
        return ResponseEntity
                .status(HttpStatus.TOO_MANY_REQUESTS)
                .body(new ErrorResponse("Too many resend requests. Try again later."));
    }

    @ExceptionHandler(AlreadyVerifiedException.class)
    public ResponseEntity<ErrorResponse> handleAlreadyVerified(AlreadyVerifiedException ex) {
        return ResponseEntity
                .badRequest()
                .body(new ErrorResponse("Email already verified"));
    }

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(new ErrorResponse("User not found"));
    }
}
