package com.edgemarket.worker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class NonceCleaner {

    private static final Logger log = LoggerFactory.getLogger(NonceCleaner.class);

    private final JdbcTemplate jdbcTemplate;

    public NonceCleaner(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Scheduled(fixedDelay = 600_000)
    public void cleanExpiredNonces() {
        int deleted = jdbcTemplate.update("DELETE FROM auth_nonces WHERE expires_at < NOW()");
        log.info("[nonceCleaner] Deleted {} expired nonce(s)", deleted);
    }
}
