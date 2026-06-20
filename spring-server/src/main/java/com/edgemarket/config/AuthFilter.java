package com.edgemarket.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Base64;
import java.util.Set;

/**
 * JWT authentication filter applied only to protected (write) endpoints.
 *
 * Protected endpoints:
 *   POST   /api/follows
 *   DELETE /api/follows
 *   POST   /api/push-tokens
 *   DELETE /api/push-tokens
 *
 * All other paths are skipped (shouldNotFilter returns true for them).
 */
@Component
public class AuthFilter extends OncePerRequestFilter {

    /** Exact path + method combinations that require authentication. */
    private static final Set<String> PROTECTED = Set.of(
            "POST /api/follows",
            "DELETE /api/follows",
            "POST /api/push-tokens",
            "DELETE /api/push-tokens",
            "POST /api/paper-trades"
    );

    private final String jwtSecret;

    public AuthFilter(@Value("${auth.jwt.secret}") String jwtSecret) {
        this.jwtSecret = jwtSecret;
    }

    /**
     * Returns {@code true} (skip the filter) for every request that is NOT in
     * the protected list, so unprotected endpoints are never touched by this filter.
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String key = request.getMethod() + " " + request.getRequestURI();
        return !PROTECTED.contains(key);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String authHeader = request.getHeader("Authorization");

        // 1. Missing or malformed Authorization header → 401
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            writeUnauthorized(response);
            return;
        }

        String token = authHeader.substring(7); // strip "Bearer "

        // 2. Validate JWT; on any failure → 401
        String subject;
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(Keys.hmacShaKeyFor(Base64.getDecoder().decode(jwtSecret)))
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            subject = claims.getSubject();
        } catch (Exception e) {
            writeUnauthorized(response);
            return;
        }

        // 3. Valid token — store sub in request attribute and continue
        request.setAttribute("authenticatedAddress", subject);
        filterChain.doFilter(request, response);
    }

    private void writeUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"Unauthorized\"}");
    }
}
