package com.edgemarket;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class EdgeMarketApplication {
    public static void main(String[] args) {
        SpringApplication.run(EdgeMarketApplication.class, args);
    }
}
