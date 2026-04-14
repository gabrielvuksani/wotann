import SwiftUI

// MARK: - ProviderBadge

/// Compact badge showing the provider name with color coding.
struct ProviderBadge: View {
    let provider: String
    var showIcon: Bool = true
    var size: BadgeSize = .regular

    enum BadgeSize {
        case small, regular
        var font: Font {
            switch self {
            case .small:   return WTheme.Typography.caption2
            case .regular: return WTheme.Typography.caption
            }
        }
        var hPadding: CGFloat {
            switch self {
            case .small:   return 6
            case .regular: return 8
            }
        }
        var vPadding: CGFloat {
            switch self {
            case .small:   return 2
            case .regular: return 4
            }
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            if showIcon {
                Image(systemName: "cpu")
                    .font(.system(size: size == .small ? 8 : 10))
            }
            Text(displayName)
                .font(size.font)
                .fontWeight(.medium)
        }
        .foregroundColor(providerColor)
        .padding(.horizontal, size.hPadding)
        .padding(.vertical, size.vPadding)
        .background(providerColor.opacity(0.15))
        .clipShape(Capsule())
    }

    private var providerColor: Color {
        WTheme.Colors.provider(provider)
    }

    private var displayName: String {
        switch provider.lowercased() {
        case "anthropic":   return "Anthropic"
        case "openai":      return "OpenAI"
        case "google":      return "Google"
        case "mistral":     return "Mistral"
        case "groq":        return "Groq"
        case "ollama":      return "Ollama"
        case "openrouter":  return "OpenRouter"
        case "deepseek":    return "DeepSeek"
        case "xai":         return "xAI"
        case "cohere":      return "Cohere"
        case "together":    return "Together"
        default:            return provider.capitalized
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        ProviderBadge(provider: "anthropic")
        ProviderBadge(provider: "openai")
        ProviderBadge(provider: "google", size: .small)
        ProviderBadge(provider: "groq")
        ProviderBadge(provider: "ollama")
    }
    .padding()
    .preferredColorScheme(.dark)
}
