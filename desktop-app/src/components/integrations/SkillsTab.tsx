/**
 * SkillsTab — grid of skill cards with search + right-drawer reader.
 * RPCs: skills.list, skills.read
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { PALETTE, safeInvoke } from "./IntegrationsView";

interface Skill {
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly available?: boolean;
  readonly content?: string;
}

interface Props { readonly onRefresh?: () => Promise<void> | void }

export function SkillsTab({ onRefresh: _onRefresh }: Props) {
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const [drawerContent, setDrawerContent] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await safeInvoke<readonly Skill[]>("get_skills");
    setSkills(r ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = useCallback(async (name: string) => {
    setOpenName(name);
    const local = skills.find((s) => s.name === name);
    if (local?.content) { setDrawerContent(local.content); return; }
    setDrawerLoading(true);
    const r = await safeInvoke<{ readonly content?: string } | string>("skills.read", { name });
    const content =
      typeof r === "string" ? r
      : (r && typeof r === "object" && "content" in r) ? (r.content ?? "")
      : "";
    setDrawerContent(content);
    setDrawerLoading(false);
  }, [skills]);

  const close = useCallback(() => { setOpenName(null); setDrawerContent(null); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return skills;
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q) ||
      (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [skills, query]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "row", overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 24px 0 24px" }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills by name or tag..."
            aria-label="Search skills"
            style={{
              width: "100%", minHeight: 44, padding: "0 14px", borderRadius: 10,
              background: PALETTE.surface, border: `1px solid ${PALETTE.divider}`,
              color: PALETTE.textPrimary, fontSize: 13, outline: "none",
            }}
          />
        </div>
        {loading ? (
          <div style={{ padding: 32, color: PALETTE.textSecondary, fontSize: 13 }}>Loading skills...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, color: PALETTE.textSecondary, fontSize: 13 }}>
            {skills.length === 0 ? "No skills configured. See docs." : "No skills match your search."}
          </div>
        ) : (
          <div style={{
            flex: 1, overflowY: "auto", padding: "16px 24px 20px 24px",
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12, alignContent: "start",
          }}>
            {filtered.map((s) => (
              <Card key={s.name} skill={s} active={openName === s.name} onOpen={() => open(s.name)} />
            ))}
          </div>
        )}
      </div>
      {openName !== null && (
        <Drawer name={openName} content={drawerContent} loading={drawerLoading} onClose={close} />
      )}
    </div>
  );
}

function Card({ skill, active, onOpen }: { readonly skill: Skill; readonly active: boolean; readonly onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-pressed={active} style={{
      textAlign: "left", cursor: "pointer", padding: 14, borderRadius: 12,
      background: active ? PALETTE.surface2 : PALETTE.surface,
      border: `1px solid ${active ? PALETTE.accent : PALETTE.divider}`,
      display: "flex", flexDirection: "column", gap: 8,
      color: PALETTE.textPrimary, minHeight: 120,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: PALETTE.textPrimary, wordBreak: "break-word" }}>{skill.name}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, flexShrink: 0,
          background: skill.available === false ? PALETTE.surface2 : "rgba(48, 209, 88, 0.15)",
          color: skill.available === false ? PALETTE.textSecondary : PALETTE.green,
        }}>{skill.available === false ? "Unavailable" : "Available"}</span>
      </div>
      {skill.description && (
        <p style={{
          fontSize: 12, color: PALETTE.textSecondary, margin: 0,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{skill.description}</p>
      )}
      {((skill.tags ?? []).length > 0 || skill.category) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "auto" }}>
          {skill.category && <Tag label={skill.category} />}
          {(skill.tags ?? []).slice(0, 4).map((t) => <Tag key={t} label={t} />)}
        </div>
      )}
    </button>
  );
}

function Tag({ label }: { readonly label: string }) {
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 6,
      background: PALETTE.surface2, color: PALETTE.textSecondary, fontWeight: 500,
    }}>{label}</span>
  );
}

function Drawer({ name, content, loading, onClose }: {
  readonly name: string;
  readonly content: string | null;
  readonly loading: boolean;
  readonly onClose: () => void;
}) {
  return (
    <aside aria-label={`Skill: ${name}`} style={{
      width: 420, maxWidth: "50%", flexShrink: 0, height: "100%",
      background: PALETTE.surface, borderLeft: `1px solid ${PALETTE.divider}`,
      display: "flex", flexDirection: "column",
    }}>
      <header style={{
        padding: "16px 20px", borderBottom: `1px solid ${PALETTE.divider}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <h3 style={{
          margin: 0, fontSize: 15, fontWeight: 600, color: PALETTE.textPrimary,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{name}</h3>
        <button onClick={onClose} aria-label="Close skill reader" style={{
          minHeight: 44, minWidth: 44, background: "transparent", border: "none",
          color: PALETTE.textSecondary, fontSize: 18, cursor: "pointer",
        }}>{"\u2715"}</button>
      </header>
      <div style={{
        flex: 1, overflowY: "auto", padding: "16px 20px",
        fontSize: 13, lineHeight: 1.6, color: PALETTE.textPrimary,
      }}>
        {loading
          ? <span style={{ color: PALETTE.textSecondary }}>Loading...</span>
          : (content === null || content === "")
            ? <span style={{ color: PALETTE.textSecondary }}>No content available.</span>
            : <MiniMd source={content} />}
      </div>
    </aside>
  );
}

// Minimal markdown: renders **bold** and `code`; relies on whitespace-pre-wrap for line breaks.
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const CODE_RE = /`([^`]+)`/g;

function MiniMd({ source }: { readonly source: string }) {
  const parts = useMemo(() => render(source), [source]);
  return <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{parts}</div>;
}

function render(src: string): readonly JSX.Element[] {
  const codeSegs = splitBy(src, CODE_RE);
  const out: JSX.Element[] = [];
  codeSegs.forEach((seg, i) => {
    if (seg.m) {
      out.push(
        <code key={`c${i}`} style={{
          background: PALETTE.bg, padding: "1px 6px", borderRadius: 4,
          fontSize: 12, fontFamily: "ui-monospace, monospace", color: PALETTE.accent,
        }}>{seg.t}</code>,
      );
    } else {
      const boldSegs = splitBy(seg.t, BOLD_RE);
      boldSegs.forEach((b, j) => {
        if (b.m) {
          out.push(<strong key={`b${i}-${j}`} style={{ fontWeight: 700, color: PALETTE.textPrimary }}>{b.t}</strong>);
        } else {
          out.push(<span key={`t${i}-${j}`}>{b.t}</span>);
        }
      });
    }
  });
  return out;
}

interface Seg { readonly t: string; readonly m: boolean }

function splitBy(input: string, re: RegExp): readonly Seg[] {
  const out: Seg[] = [];
  const pat = new RegExp(re.source, re.flags);
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pat.exec(input)) !== null) {
    if (match.index > last) out.push({ t: input.slice(last, match.index), m: false });
    const captured = match[1];
    if (captured !== undefined) out.push({ t: captured, m: true });
    last = match.index + match[0].length;
    if (match[0].length === 0) pat.lastIndex += 1;
  }
  if (last < input.length) out.push({ t: input.slice(last), m: false });
  return out;
}
