import SwiftUI

// MARK: - ErrorBanner

/// Top-of-view error/disconnected banner with retry button.
struct ErrorBanner: View {
    let message: String
    var type: BannerType = .error
    var onRetry: (() -> Void)? = nil

    enum BannerType {
        case error, warning, disconnected
    }

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Circle()
                .fill(bannerColor)
                .frame(width: 8, height: 8)

            Text(message)
                .font(WTheme.Typography.caption)
                .fontWeight(.medium)
                .foregroundColor(bannerTextColor)

            Spacer()

            if let onRetry {
                Button(action: onRetry) {
                    Text("Retry")
                        .font(WTheme.Typography.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(bannerTextColor)
                }
            }
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        .background(bannerBackground)
    }

    private var bannerColor: Color {
        switch type {
        case .error: return WTheme.Colors.error
        case .warning: return WTheme.Colors.warning
        case .disconnected: return WTheme.Colors.warning
        }
    }

    private var bannerTextColor: Color {
        switch type {
        case .error: return WTheme.Colors.error
        case .warning: return WTheme.Colors.warning
        case .disconnected: return WTheme.Colors.warning
        }
    }

    private var bannerBackground: Color {
        switch type {
        case .error: return WTheme.Colors.error.opacity(0.15)
        case .warning: return WTheme.Colors.warning.opacity(0.15)
        case .disconnected: return WTheme.Colors.warning.opacity(0.1)
        }
    }
}

// MARK: - RetryButton

/// Standalone retry button with loading state.
struct RetryButton: View {
    let action: () -> Void
    @State private var isLoading = false

    var body: some View {
        Button {
            isLoading = true
            action()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                isLoading = false
            }
        } label: {
            HStack(spacing: WTheme.Spacing.xs) {
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.7)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(WTheme.Typography.caption)
                }
                Text(isLoading ? "Retrying..." : "Try Again")
                    .font(WTheme.Typography.caption)
                    .fontWeight(.medium)
            }
            .foregroundColor(.white)
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
            .background(WTheme.Colors.primary)
            .cornerRadius(WTheme.Radius.md)
        }
        .disabled(isLoading)
    }
}

// Note: DisconnectedState is defined in EmptyState.swift
