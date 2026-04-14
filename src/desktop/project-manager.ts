/**
 * Project Manager — project organization for the desktop app.
 *
 * Projects group conversations, knowledge files, and custom instructions
 * into workspaces (similar to Claude's Projects feature).
 *
 * Features:
 * - Create/edit/delete projects
 * - Associate conversations with projects
 * - Upload knowledge files (persistent context)
 * - Custom instructions per project
 * - Quick-switch between projects
 * - Pin/unpin projects for quick access
 *
 * Persistence: projects are stored as JSON files
 * under .wotann/desktop/projects/{id}.json
 */

// ── Types ──────────────────────────────────────────────

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly conversations: readonly string[];
  readonly knowledgeFiles: readonly string[];
  readonly customInstructions: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pinned: boolean;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly conversationCount: number;
  readonly knowledgeFileCount: number;
  readonly updatedAt: string;
  readonly pinned: boolean;
}

// ── ID Generation ──────────────────────────────────────

let projectIdCounter = 0;

function generateProjectId(): string {
  projectIdCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `proj_${timestamp}_${random}_${projectIdCounter}`;
}

// ── Project Factory ────────────────────────────────────

export function createProject(
  name: string,
  path: string,
  options?: {
    readonly description?: string;
    readonly customInstructions?: string;
  },
): Project {
  const now = new Date().toISOString();
  return {
    id: generateProjectId(),
    name,
    description: options?.description ?? "",
    path,
    conversations: [],
    knowledgeFiles: [],
    customInstructions: options?.customInstructions ?? "",
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };
}

// ── Immutable Update Operations ────────────────────────

export function renameProject(project: Project, name: string): Project {
  return { ...project, name, updatedAt: new Date().toISOString() };
}

export function updateDescription(project: Project, description: string): Project {
  return { ...project, description, updatedAt: new Date().toISOString() };
}

export function updateCustomInstructions(project: Project, instructions: string): Project {
  return { ...project, customInstructions: instructions, updatedAt: new Date().toISOString() };
}

export function pinProject(project: Project, pinned: boolean): Project {
  return { ...project, pinned, updatedAt: new Date().toISOString() };
}

// ── Conversation Association ───────────────────────────

export function addConversation(project: Project, conversationId: string): Project {
  if (project.conversations.includes(conversationId)) return project;
  return {
    ...project,
    conversations: [...project.conversations, conversationId],
    updatedAt: new Date().toISOString(),
  };
}

export function removeConversation(project: Project, conversationId: string): Project {
  return {
    ...project,
    conversations: project.conversations.filter((id) => id !== conversationId),
    updatedAt: new Date().toISOString(),
  };
}

// ── Knowledge Files ────────────────────────────────────

export function addKnowledgeFile(project: Project, filePath: string): Project {
  if (project.knowledgeFiles.includes(filePath)) return project;
  return {
    ...project,
    knowledgeFiles: [...project.knowledgeFiles, filePath],
    updatedAt: new Date().toISOString(),
  };
}

export function removeKnowledgeFile(project: Project, filePath: string): Project {
  return {
    ...project,
    knowledgeFiles: project.knowledgeFiles.filter((f) => f !== filePath),
    updatedAt: new Date().toISOString(),
  };
}

// ── Summaries ──────────────────────────────────────────

export function toProjectSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    conversationCount: project.conversations.length,
    knowledgeFileCount: project.knowledgeFiles.length,
    updatedAt: project.updatedAt,
    pinned: project.pinned,
  };
}

/**
 * Get sorted project summaries with pinned projects first.
 */
export function getSortedProjects(
  projects: readonly Project[],
): readonly ProjectSummary[] {
  const summaries = projects.map(toProjectSummary);
  const pinned = summaries.filter((s) => s.pinned);
  const unpinned = summaries.filter((s) => !s.pinned);

  const byDate = (a: ProjectSummary, b: ProjectSummary) =>
    b.updatedAt.localeCompare(a.updatedAt);

  return [...pinned.sort(byDate), ...unpinned.sort(byDate)];
}

// ── Search ─────────────────────────────────────────────

/**
 * Search projects by name or description (case-insensitive substring match).
 */
export function searchProjects(
  projects: readonly Project[],
  query: string,
): readonly Project[] {
  const lowerQuery = query.toLowerCase();
  return projects.filter(
    (p) =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery),
  );
}

// ── Project Collection Operations ──────────────────────

/**
 * Find a project by ID in a collection.
 */
export function findProject(
  projects: readonly Project[],
  id: string,
): Project | undefined {
  return projects.find((p) => p.id === id);
}

/**
 * Replace a project in the collection (immutable).
 */
export function replaceProject(
  projects: readonly Project[],
  updated: Project,
): readonly Project[] {
  return projects.map((p) => (p.id === updated.id ? updated : p));
}

/**
 * Remove a project from the collection (immutable).
 */
export function removeProject(
  projects: readonly Project[],
  id: string,
): readonly Project[] {
  return projects.filter((p) => p.id !== id);
}
