package com.edgemarket.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.CompletableFuture;

@Service
public class SendGridEmailService {

    private static final Logger log = LoggerFactory.getLogger(SendGridEmailService.class);
    private static final String SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

    @Value("${sendgrid.api.key}")
    private String apiKey;

    @Value("${sendgrid.from.email}")
    private String fromEmail;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    public void sendVerificationCodeAsync(String toEmail, String code) {
        CompletableFuture.runAsync(() -> {
            try {
                if (apiKey == null || apiKey.isBlank() || apiKey.startsWith("${")) {
                    log.warn("[SendGrid] SENDGRID_API_KEY not configured — skipping email to {}", toEmail);
                    return;
                }

                String body = "Your EdgeMarket verification code is: " + code +
                        "\n\nThis code expires in 10 minutes.";

                String json = """
                        {
                          "personalizations": [{"to": [{"email": "%s"}]}],
                          "from": {"email": "%s"},
                          "subject": "Your EdgeMarket verification code",
                          "content": [{"type": "text/plain", "value": "%s"}]
                        }
                        """.formatted(toEmail, fromEmail, body.replace("\n", "\\n"));

                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(SENDGRID_URL))
                        .header("Authorization", "Bearer " + apiKey)
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(json))
                        .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

                if (response.statusCode() >= 300) {
                    log.warn("[SendGrid] Unexpected status {} sending to {}: {}",
                            response.statusCode(), toEmail, response.body());
                } else {
                    log.info("[SendGrid] Verification code sent to {}", toEmail);
                }
            } catch (Exception e) {
                log.warn("[SendGrid] Failed to send email to {}: {}", toEmail, e.getMessage());
            }
        });
    }
}
