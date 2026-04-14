/**
 * Domain-Specific Skill Router — auto-loads skill overlays by task domain.
 *
 * FROM TERMINALBENCH RESEARCH (Phase 13C):
 * "Domain-specific skill routing (+3-5%): Security/ML/Sysadmin tasks benefit
 *  from specialized skill overlays that inject domain expertise."
 *
 * When the task is classified as belonging to a domain (security, ML, sysadmin, etc.),
 * the relevant skill overlay is auto-loaded into the system prompt for that query.
 */

// ── Domain Definitions ──────────────────────────────────

export type TaskDomain =
  | "general"
  | "security"
  | "ml"
  | "sysadmin"
  | "frontend"
  | "backend"
  | "database"
  | "devops"
  | "mobile";

interface DomainSignals {
  readonly keywords: readonly string[];
  readonly filePatterns: readonly string[];
  readonly skills: readonly string[];
}

const DOMAIN_MAP: Readonly<Record<TaskDomain, DomainSignals>> = {
  general: {
    keywords: [],
    filePatterns: [],
    skills: [],
  },
  security: {
    keywords: [
      "vulnerability", "exploit", "pentest", "injection", "xss", "csrf",
      "authentication", "authorization", "encrypt", "decrypt", "hash",
      "certificate", "tls", "ssl", "firewall", "nmap", "sqlmap", "owasp",
      "cve", "security audit", "penetration", "brute force", "nuclei",
    ],
    filePatterns: ["**/security/**", "**/auth/**", "**/crypto/**"],
    skills: ["security-reviewer", "pentest-patterns", "compliance-checker"],
  },
  ml: {
    keywords: [
      "machine learning", "neural network", "training", "model", "dataset",
      "tensor", "pytorch", "tensorflow", "keras", "scikit", "numpy",
      "embedding", "fine-tune", "inference", "gpu", "cuda", "onnx",
      "transformer", "attention", "backpropagation", "gradient",
    ],
    filePatterns: ["**/*.ipynb", "**/models/**", "**/training/**", "**/*.pt", "**/*.h5"],
    skills: ["python-pro"],
  },
  sysadmin: {
    keywords: [
      "server", "deploy", "nginx", "apache", "systemd", "docker", "kubernetes",
      "k8s", "helm", "terraform", "ansible", "ssh", "cron", "daemon",
      "process", "memory", "disk", "network", "dns", "load balancer",
      "monitoring", "prometheus", "grafana", "log", "syslog",
    ],
    filePatterns: ["**/Dockerfile", "**/docker-compose*", "**/*.tf", "**/k8s/**"],
    skills: ["docker-expert", "kubernetes-specialist", "terraform-engineer", "monitoring-expert"],
  },
  frontend: {
    keywords: [
      "react", "vue", "angular", "svelte", "next.js", "nuxt", "css",
      "tailwind", "component", "hook", "state", "render", "dom",
      "animation", "responsive", "accessibility", "a11y", "webpack", "vite",
    ],
    filePatterns: ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte", "**/components/**"],
    skills: ["react-expert", "nextjs-developer", "vue-expert"],
  },
  backend: {
    keywords: [
      "api", "rest", "graphql", "endpoint", "middleware", "route",
      "controller", "service", "express", "fastapi", "django", "spring",
      "grpc", "websocket", "microservice", "queue", "redis", "cache",
    ],
    filePatterns: ["**/routes/**", "**/controllers/**", "**/services/**", "**/api/**"],
    skills: ["api-design", "express-api", "nestjs-expert"],
  },
  database: {
    keywords: [
      "sql", "query", "database", "migration", "schema", "index",
      "postgres", "mysql", "mongodb", "redis", "sqlite", "orm",
      "transaction", "join", "aggregate", "performance", "explain",
    ],
    filePatterns: ["**/*.sql", "**/migrations/**", "**/models/**"],
    skills: ["sql-pro", "postgres-pro"],
  },
  devops: {
    keywords: [
      "ci", "cd", "pipeline", "github actions", "jenkins", "gitlab",
      "deploy", "release", "artifact", "container", "registry",
    ],
    filePatterns: ["**/.github/workflows/**", "**/Jenkinsfile", "**/.gitlab-ci*"],
    skills: ["cicd-engineer", "cloud-architect"],
  },
  mobile: {
    keywords: [
      "ios", "android", "swift", "kotlin", "react native", "flutter",
      "xcode", "gradle", "cocoapods", "app store", "play store",
    ],
    filePatterns: ["**/*.swift", "**/*.kt", "**/ios/**", "**/android/**"],
    skills: ["swift-expert", "react-native-expert", "flutter-expert"],
  },
};

// ── Domain Classifier ───────────────────────────────────

/**
 * Classify a task's domain from its prompt and relevant file paths.
 */
export function classifyTaskDomain(
  prompt: string,
  filePaths: readonly string[] = [],
): TaskDomain {
  const lowerPrompt = prompt.toLowerCase();
  let bestDomain: TaskDomain = "general";
  let bestScore = 0;

  for (const [domain, signals] of Object.entries(DOMAIN_MAP) as [TaskDomain, DomainSignals][]) {
    if (domain === "general") continue;

    let score = 0;

    // Keyword matching (weighted)
    for (const keyword of signals.keywords) {
      if (lowerPrompt.includes(keyword.toLowerCase())) {
        score += 2;
      }
    }

    // File pattern matching
    for (const path of filePaths) {
      for (const pattern of signals.filePatterns) {
        // Simple glob matching: check if the path contains the key part
        const key = pattern.replace(/\*\*/g, "").replace(/\*/g, "");
        if (path.includes(key)) {
          score += 1;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

/**
 * Get the skill overlay names for a domain.
 */
export function getSkillsForDomain(domain: TaskDomain): readonly string[] {
  return DOMAIN_MAP[domain]?.skills ?? [];
}

/**
 * Get a domain-specific prompt injection for the system prompt.
 */
export function getDomainContext(domain: TaskDomain): string | null {
  if (domain === "general") return null;

  const signals = DOMAIN_MAP[domain];
  if (!signals || signals.skills.length === 0) return null;

  return `DOMAIN DETECTED: ${domain.toUpperCase()}. Auto-loaded domain skills: ${signals.skills.join(", ")}. Apply domain-specific best practices.`;
}
