---
name: java-architect
description: Spring Boot 3, enterprise patterns, JPA, security
context: fork
paths: ["**/*.java", "**/pom.xml", "**/build.gradle"]
requires:
  bins: ["java", "mvn"]
---
# Java Architect
## Rules
- Use Spring Boot 3.x with Java 21+ features (records, sealed classes, pattern matching).
- Use constructor injection (not field injection with @Autowired).
- Use `Optional<T>` for nullable returns, never return null.
- Use Lombok sparingly (records often replace @Data).
## Patterns
- Repository pattern with Spring Data JPA.
- Service layer for business logic (thin controllers).
- DTO ↔ Entity mapping (never expose entities in APIs).
- Exception handling with @ControllerAdvice.
## Testing
- JUnit 5 + Mockito for unit tests.
- @SpringBootTest for integration tests.
- Testcontainers for database tests.
