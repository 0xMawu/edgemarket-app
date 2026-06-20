package com.edgemarket.exception;

public class EmailNotVerifiedException extends RuntimeException {
    private static final String DEFAULT_MESSAGE =
            "Email not verified. Check your inbox for the verification code.";

    public EmailNotVerifiedException() {
        super(DEFAULT_MESSAGE);
    }

    public EmailNotVerifiedException(String message) {
        super(message);
    }
}
