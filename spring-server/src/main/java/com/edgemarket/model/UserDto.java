package com.edgemarket.model;

import java.util.UUID;

public record UserDto(UUID id, String email, boolean emailVerified, String walletAddress) {}
