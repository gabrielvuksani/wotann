import SwiftUI

// MARK: - PromptTemplate

struct PromptTemplate: Identifiable, Codable {
    let id: UUID
    var title: String
    var prompt: String
    var category: String
    var isFavorite: Bool
    let createdAt: Date

    init(
        id: UUID = UUID(),
        title: String,
        prompt: String,
        category: String = "General",
        isFavorite: Bool = false,
        createdAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.category = category
        self.isFavorite = isFavorite
        self.createdAt = createdAt
    }
}

// MARK: - PromptLibraryView

/// Searchable prompt library with categories, favorites, and one-tap use.
struct PromptLibraryView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var templates: [PromptTemplate] = PromptLibraryView.defaultTemplates
    @State private var searchQuery = ""
    @State private var selectedCategory: String?
    @State private var showAddSheet = false

    private let storageKey = "com.wotann.promptLibrary"

    var categories: [String] {
        Array(Set(templates.map(\.category))).sorted()
    }

    var filteredTemplates: [PromptTemplate] {
        var result = templates
        if let cat = selectedCategory {
            result = result.filter { $0.category == cat }
        }
        if !searchQuery.isEmpty {
            result = result.filter {
                $0.title.localizedCaseInsensitiveContains(searchQuery) ||
                $0.prompt.localizedCaseInsensitiveContains(searchQuery)
            }
        }
        return result.sorted { ($0.isFavorite ? 0 : 1) < ($1.isFavorite ? 0 : 1) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                categoryPicker
                templateList
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Prompt Library")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $searchQuery, prompt: "Search prompts...")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showAddSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(WTheme.Colors.primary)
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                AddPromptSheet { newTemplate in
                    templates.append(newTemplate)
                    saveTemplates()
                }
            }
            .onAppear { loadTemplates() }
        }
    }

    // MARK: - Category Picker

    private var categoryPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: WTheme.Spacing.sm) {
                CategoryChip(label: "All", isSelected: selectedCategory == nil) {
                    selectedCategory = nil
                }
                ForEach(categories, id: \.self) { cat in
                    CategoryChip(label: cat, isSelected: selectedCategory == cat) {
                        selectedCategory = cat
                    }
                }
            }
            .padding(.horizontal, WTheme.Spacing.lg)
            .padding(.vertical, WTheme.Spacing.sm)
        }
    }

    // MARK: - Template List

    private var templateList: some View {
        List {
            ForEach(filteredTemplates) { template in
                Button {
                    useTemplate(template)
                } label: {
                    PromptTemplateRow(template: template)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .leading) {
                    Button {
                        toggleFavorite(template)
                    } label: {
                        Label(
                            template.isFavorite ? "Unfavorite" : "Favorite",
                            systemImage: template.isFavorite ? "star.slash" : "star.fill"
                        )
                    }
                    .tint(WTheme.Colors.warning)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        deleteTemplate(template)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
            .listRowBackground(WTheme.Colors.surface)
        }
        .listStyle(.plain)
    }

    // MARK: - Actions

    private func useTemplate(_ template: PromptTemplate) {
        HapticService.shared.trigger(.buttonTap)
        let conversation = Conversation(
            title: template.title,
            provider: appState.currentProvider,
            model: appState.currentModel
        )
        appState.addConversation(conversation)
        appState.updateConversation(conversation.id) { conv in
            conv.messages.append(Message(role: .user, content: template.prompt))
        }
        appState.activeTab = 1
        dismiss()
    }

    private func toggleFavorite(_ template: PromptTemplate) {
        if let idx = templates.firstIndex(where: { $0.id == template.id }) {
            var updated = templates
            updated[idx].isFavorite.toggle()
            templates = updated
            saveTemplates()
        }
    }

    private func deleteTemplate(_ template: PromptTemplate) {
        templates = templates.filter { $0.id != template.id }
        saveTemplates()
    }

    // MARK: - Persistence

    private func loadTemplates() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode([PromptTemplate].self, from: data) else { return }
        templates = saved + Self.defaultTemplates.filter { def in
            !saved.contains { $0.title == def.title }
        }
    }

    private func saveTemplates() {
        if let data = try? JSONEncoder().encode(templates) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    // MARK: - Default Templates

    static let defaultTemplates: [PromptTemplate] = [
        PromptTemplate(title: "Code Review", prompt: "Review this code for bugs, security issues, and improvements. Be specific about line numbers and suggest fixes.", category: "Development"),
        PromptTemplate(title: "Write Tests", prompt: "Write comprehensive unit tests for the current module. Cover edge cases, error paths, and happy paths. Use the project's existing test framework.", category: "Development"),
        PromptTemplate(title: "Refactor", prompt: "Refactor this code to improve readability and maintainability. Keep the same behavior. Explain each change.", category: "Development"),
        PromptTemplate(title: "Debug This", prompt: "I'm seeing an unexpected behavior. Help me debug by analyzing the code flow, identifying potential causes, and suggesting fixes.", category: "Development"),
        PromptTemplate(title: "Explain Code", prompt: "Explain what this code does, step by step. Include the architectural patterns used and any potential issues.", category: "Learning"),
        PromptTemplate(title: "Security Audit", prompt: "Perform a security audit of this codebase. Check for OWASP Top 10, secrets in code, insecure dependencies, and injection vulnerabilities.", category: "Security"),
        PromptTemplate(title: "API Design", prompt: "Design a REST API for this feature. Include endpoints, request/response schemas, authentication, pagination, and error handling.", category: "Architecture"),
        PromptTemplate(title: "Migration Plan", prompt: "Create a step-by-step migration plan from the current implementation to the proposed new architecture. Include rollback steps.", category: "Architecture"),
        PromptTemplate(title: "Write Docs", prompt: "Generate documentation for this module. Include overview, setup instructions, API reference, and usage examples.", category: "Documentation"),
        PromptTemplate(title: "Performance Audit", prompt: "Analyze this code for performance bottlenecks. Profile the hot paths, suggest optimizations, and estimate impact.", category: "Performance"),
    ]
}

// MARK: - CategoryChip

private struct CategoryChip: View {
    let label: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(WTheme.Typography.caption)
                .fontWeight(.medium)
                .foregroundColor(isSelected ? .white : WTheme.Colors.textSecondary)
                .padding(.horizontal, WTheme.Spacing.md)
                .padding(.vertical, WTheme.Spacing.xs)
                .background(isSelected ? WTheme.Colors.primary : WTheme.Colors.surface)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - PromptTemplateRow

private struct PromptTemplateRow: View {
    let template: PromptTemplate

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack {
                if template.isFavorite {
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundColor(WTheme.Colors.warning)
                }
                Text(template.title)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(WTheme.Colors.textPrimary)

                Spacer()

                Text(template.category)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.primary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(WTheme.Colors.primary.opacity(0.1))
                    .clipShape(Capsule())
            }

            Text(template.prompt)
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textTertiary)
                .lineLimit(2)
        }
        .padding(.vertical, WTheme.Spacing.xs)
        .contentShape(Rectangle())
    }
}

// MARK: - AddPromptSheet

private struct AddPromptSheet: View {
    let onAdd: (PromptTemplate) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var prompt = ""
    @State private var category = "General"

    private let categories = ["General", "Development", "Security", "Architecture", "Documentation", "Learning", "Performance", "Custom"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Template") {
                    TextField("Title", text: $title)
                    TextField("Prompt", text: $prompt, axis: .vertical)
                        .lineLimit(3...8)
                }

                Section("Category") {
                    Picker("Category", selection: $category) {
                        ForEach(categories, id: \.self) { cat in
                            Text(cat).tag(cat)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("New Template")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        onAdd(PromptTemplate(title: title, prompt: prompt, category: category))
                        dismiss()
                    }
                    .disabled(title.isEmpty || prompt.isEmpty)
                }
            }
        }
    }
}

#Preview {
    PromptLibraryView()
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
