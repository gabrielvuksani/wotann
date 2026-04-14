---
name: spring-boot
description: Spring Boot 3, Security 6, JPA, REST APIs with Java 21+
context: fork
paths: ["**/application.properties", "**/application.yml"]
requires:
  bins: ["java", "mvn"]
---

# Spring Boot

## When to Use

- Building a new Java 21+ REST or GraphQL service with Spring Boot 3.x.
- Migrating from Spring Security 5 (WebSecurityConfigurerAdapter) to Security 6 (SecurityFilterChain).
- Wiring JPA repositories with Hibernate and query optimization.
- Adding observability (Micrometer, Actuator, OpenTelemetry) to an existing service.
- Containerizing a Spring app with buildpacks or Jib.

## Rules

- Spring Boot 3.x with Java 21+ only; drop anything <17.
- Use `SecurityFilterChain` bean; `WebSecurityConfigurerAdapter` is removed in Security 6.
- Constructor injection only; `@Autowired` fields are prohibited.
- `@Transactional` at service layer, never on controllers or repositories.
- Define DTOs via `record` types; never expose JPA entities through the API.
- Profile-aware config (`application-prod.yml`) for anything environment-specific.

## Patterns

- **Layered architecture**: Controller (HTTP) -> Service (business) -> Repository (data).
- **Problem+JSON errors**: `ResponseEntityExceptionHandler` for standardized error body.
- **Spring Cache**: `@Cacheable` on read-heavy service methods with TTL.
- **Testcontainers**: real DB in integration tests, never H2 as a Postgres stand-in.
- **Actuator**: `/actuator/health`, `/actuator/metrics`, behind auth in prod.

## Example

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(AbstractHttpConfigurer::disable)
            .authorizeHttpRequests(a -> a
                .requestMatchers("/api/public/**").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))
            .build();
    }
}
```

## Checklist

- [ ] Constructor injection only (no `@Autowired` fields).
- [ ] `SecurityFilterChain` bean defined; no deprecated adapter class.
- [ ] DTOs are records, not JPA entities.
- [ ] Integration tests use Testcontainers against real Postgres/MySQL.

## Common Pitfalls

- H2 in integration tests produces false greens; Postgres-specific SQL fails in prod.
- `@Transactional` on a controller method: no effect (wrong proxy layer).
- Returning `Entity` directly: Jackson triggers lazy-loading exceptions in JSON.
