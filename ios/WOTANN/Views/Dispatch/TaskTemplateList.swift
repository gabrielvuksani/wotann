import SwiftUI

// MARK: - TaskTemplateList

/// Grid of quick dispatch templates.
struct TaskTemplateList: View {
    @Binding var selectedTemplate: DispatchTemplate?
    let onSelect: (DispatchTemplate) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: WTheme.Spacing.sm),
        GridItem(.flexible(), spacing: WTheme.Spacing.sm),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: WTheme.Spacing.sm) {
            ForEach(DispatchTemplate.allCases, id: \.self) { template in
                TaskTemplateCard(
                    template: template,
                    isSelected: selectedTemplate == template,
                    onTap: { onSelect(template) }
                )
            }
        }
    }
}

// MARK: - TaskTemplateCard

/// Individual template card.
struct TaskTemplateCard: View {
    let template: DispatchTemplate
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                Image(systemName: template.icon)
                    .font(.title3)
                    .foregroundColor(isSelected ? WTheme.Colors.primary : WTheme.Colors.textSecondary)

                Text(template.displayName)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(WTheme.Colors.textPrimary)

                if template != .custom {
                    Text(template.defaultPrompt.prefix(40) + "...")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .lineLimit(2)
                } else {
                    Text("Describe your own task")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(WTheme.Spacing.md)
            .background(isSelected ? WTheme.Colors.primary.opacity(0.1) : WTheme.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: WTheme.Radius.md)
                    .strokeBorder(
                        isSelected ? WTheme.Colors.primary.opacity(0.5) : Color.clear,
                        lineWidth: 1.5
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(template.displayName) template")
        .accessibilityHint("Select the \(template.displayName.lowercased()) task template")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

#Preview {
    TaskTemplateList(
        selectedTemplate: .constant(.fixTests),
        onSelect: { _ in }
    )
    .padding()
    .background(WTheme.Colors.background)
    .preferredColorScheme(.dark)
}
