/**
 * Device pairing view — shows QR code and paired device list.
 * Allows connecting iOS companion via QR scan or manual PIN.
 */

import { useState, useCallback, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { commands, type CompanionDeviceInfo, type CompanionPairingInfo } from "../../hooks/useTauriCommand";

export function PairingView() {
  const [qrVisible, setQrVisible] = useState(false);
  const [pairing, setPairing] = useState<CompanionPairingInfo | null>(null);
  const [devices, setDevices] = useState<readonly CompanionDeviceInfo[]>([]);
  const [loadingQr, setLoadingQr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const entries = await commands.getCompanionDevices();
      setDevices(entries);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const handleGenerateQR = useCallback(async () => {
    setLoadingQr(true);
    setError(null);
    try {
      const nextPairing = await commands.getCompanionPairing();
      if (!nextPairing) {
        throw new Error("Companion server unavailable");
      }
      setPairing(nextPairing);
      setQrVisible(true);
      await refreshDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate pairing QR");
    } finally {
      setLoadingQr(false);
    }
  }, [refreshDevices]);

  const handleRevoke = useCallback(async (deviceId: string) => {
    try {
      await commands.unpairCompanionDevice(deviceId);
      await refreshDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove device");
    }
  }, [refreshDevices]);

  return (
    <div className="flex flex-col h-full" style={{ padding: "var(--space-lg)", background: "var(--color-bg-primary)" }}>
      {/* Header */}
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600, color: "var(--color-text-primary)" }}>Link Devices</h2>
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-xs)" }}>
          Connect your iPhone to control WOTANN remotely
        </p>
      </div>

      {/* QR Code Section */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
        <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: "var(--space-md)" }}>Pair New Device</h3>
        {qrVisible ? (
          <div className="flex flex-col items-center" style={{ gap: "var(--space-md)" }}>
            <div className="flex items-center justify-center" style={{ width: 192, height: 192, background: "white", borderRadius: "var(--radius-md)", padding: 12 }}>
              <QRCodeSVG
                value={pairing?.qrData ?? "wotann://pair"}
                size={168}
                bgColor="white"
                fgColor="black"
                level="M"
              />
            </div>
            <div className="text-center">
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>PIN Code</p>
              <p style={{ fontSize: "var(--font-size-2xl)", fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.1em", color: "var(--color-primary)" }}>
                {pairing?.pin ?? "------"}
              </p>
            </div>
            {pairing?.expiresAt && (
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
              </p>
            )}
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              Open WOTANN on your iPhone and scan this one-time QR code.
            </p>
            <button
              onClick={() => {
                setQrVisible(false);
                setPairing(null);
              }}
              className="transition-colors"
              style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer" }}
              aria-label="Cancel pairing"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => { void handleGenerateQR(); }}
            className="w-full btn-press transition-colors flex items-center justify-center"
            style={{
              padding: "12px var(--space-md)",
              color: "white",
              borderRadius: "var(--radius-md)",
              fontWeight: 500,
              fontSize: "var(--font-size-sm)",
              background: "var(--color-primary)",
              border: "none",
              cursor: "pointer",
              gap: "var(--space-sm)",
            }}
            aria-label="Generate QR code for device pairing"
            disabled={loadingQr}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="10" y="10" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {loadingQr ? "Preparing QR Code..." : "Generate QR Code"}
          </button>
        )}
        {error && (
          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-error)", marginTop: "var(--space-sm)" }}>
            {error}
          </p>
        )}
      </div>

      {/* Paired Devices */}
      <div className="flex-1">
        <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: "12px" }}>
          Paired Devices ({devices.length})
        </h3>
        {devices.length === 0 ? (
          <div className="text-center" style={{ padding: "var(--space-xl) 0" }}>
            <div
              className="flex items-center justify-center mx-auto"
              style={{
                width: 48,
                height: 48,
                borderRadius: "var(--radius-lg)",
                background: "var(--surface-2)",
                border: "1px solid var(--border-subtle)",
                marginBottom: "var(--space-sm)",
              }}
              aria-hidden="true"
            >
              <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
                <rect x="4" y="1" width="8" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <line x1="6" y1="12" x2="10" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>No devices paired yet</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between"
                style={{ borderRadius: "var(--radius-md)", padding: "12px var(--space-md)", background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-center" style={{ gap: "12px" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: device.connected ? "var(--color-success)" : "var(--color-text-dim)" }} aria-hidden="true" />
                  <div>
                    <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>{device.name}</p>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                      {device.platform} -- Last seen {device.lastSeen}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(device.id)}
                  className="btn-press transition-colors"
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-error)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                  aria-label={`Revoke access for ${device.name}`}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
