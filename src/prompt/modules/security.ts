/**
 * Security prompt module -- exploit mode capabilities, engagement tracking,
 * MITRE ATT&CK mapping, and structured finding format.
 *
 * Only active when mode is "exploit". Returns empty otherwise (zero token cost).
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

// ── Capability Categories ─────────────────────────────────────

interface SecurityCapability {
  readonly category: string;
  readonly tools: readonly string[];
  readonly description: string;
}

const CAPABILITY_CATEGORIES: readonly SecurityCapability[] = [
  {
    category: "Reconnaissance",
    tools: ["nmap", "shodan", "theHarvester"],
    description: "Network scanning, service enumeration, subdomain discovery, OSINT gathering",
  },
  {
    category: "Vulnerability Assessment",
    tools: ["sqlmap", "nuclei", "nikto"],
    description: "Automated vulnerability scanning, template-based detection, web server analysis",
  },
  {
    category: "Exploitation",
    tools: ["metasploit", "searchsploit"],
    description: "Exploit development, payload generation, post-exploitation, privilege escalation",
  },
  {
    category: "Web Application",
    tools: ["burpsuite", "OWASP ZAP"],
    description: "Proxy interception, active scanning, fuzzing, authentication bypass, OWASP Top 10",
  },
  {
    category: "Reverse Engineering",
    tools: ["ghidra", "radare2"],
    description: "Binary analysis, disassembly, decompilation, malware analysis, firmware extraction",
  },
  {
    category: "Forensics",
    tools: ["volatility", "autopsy"],
    description: "Memory forensics, disk imaging, timeline analysis, artifact recovery, evidence handling",
  },
  {
    category: "OSINT",
    tools: ["maltego", "recon-ng"],
    description: "Open source intelligence, entity mapping, social engineering reconnaissance, data correlation",
  },
  {
    category: "CTF",
    tools: ["pwntools", "binwalk"],
    description: "Binary exploitation, firmware extraction, crypto challenges, steganography, pwn scripting",
  },
];

// ── MITRE ATT&CK Tactic Mapping ──────────────────────────────

const MITRE_TACTICS: readonly string[] = [
  "TA0043 Reconnaissance",
  "TA0042 Resource Development",
  "TA0001 Initial Access",
  "TA0002 Execution",
  "TA0003 Persistence",
  "TA0004 Privilege Escalation",
  "TA0005 Defense Evasion",
  "TA0006 Credential Access",
  "TA0007 Discovery",
  "TA0008 Lateral Movement",
  "TA0009 Collection",
  "TA0011 Command and Control",
  "TA0010 Exfiltration",
  "TA0040 Impact",
];

// ── Prompt Builders ───────────────────────────────────────────

function buildCapabilityLines(): readonly string[] {
  const header = "SECURITY CAPABILITIES (8 categories):";
  const lines = CAPABILITY_CATEGORIES.map(
    (cap) => `  ${cap.category}: ${cap.tools.join(", ")} -- ${cap.description}`,
  );
  return [header, ...lines];
}

function buildMitreTacticLines(): readonly string[] {
  return [
    "MITRE ATT&CK TACTIC MAPPING:",
    "Tag each action with the applicable tactic ID for structured reporting.",
    `  Tactics: ${MITRE_TACTICS.join(", ")}`,
  ];
}

function buildEngagementScopeLines(): readonly string[] {
  return [
    "ENGAGEMENT SCOPE (track at all times):",
    "  Target IPs/Domains: [list authorized targets]",
    "  Engagement Type: black-box | white-box | grey-box",
    "  Authorization Status: authorized | pending | expired",
    "  Rules of Engagement: [specific constraints, e.g., no DoS, no social engineering]",
    "  Start/End Window: [engagement time boundaries]",
    "Stay within scope. Log all actions against scope boundaries.",
  ];
}

function buildFindingFormatLines(): readonly string[] {
  return [
    "STRUCTURED FINDING FORMAT (use for every discovered vulnerability):",
    "  Vulnerability: [name, e.g., SQL Injection in /api/users]",
    "  CVSS Score: [0.0-10.0, e.g., 9.8 Critical]",
    "  Affected Endpoint: [URL, IP:port, or service]",
    "  MITRE Tactic: [TA#### tactic ID]",
    "  Evidence: [command output, screenshot reference, or proof of concept]",
    "  Reproduction Steps: [numbered steps to reproduce]",
    "  Remediation: [specific fix with code example when applicable]",
    "  Risk Rating: Critical | High | Medium | Low | Informational",
  ];
}

// ── Module Export ──────────────────────────────────────────────

export const securityPromptModule: PromptModuleEntry = {
  name: "security",
  priority: 58,
  build(ctx: PromptContext): readonly string[] {
    if (ctx.mode !== "exploit") return [];

    return [
      ...buildCapabilityLines(),
      "",
      ...buildMitreTacticLines(),
      "",
      ...buildEngagementScopeLines(),
      "",
      ...buildFindingFormatLines(),
    ];
  },
};
