"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface GyroscopeTiltResult {
  rotateX: number;
  rotateY: number;
  glareX: number;
  glareY: number;
  isSupported: boolean;
  permissionGranted: boolean;
  requestPermission: () => Promise<boolean>;
}

interface UseGyroscopeTiltOptions {
  maxTilt?: number;
  sensitivity?: number;
  disabled?: boolean;
}

// Type for iOS DeviceOrientationEvent with requestPermission
interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export function useGyroscopeTilt(options: UseGyroscopeTiltOptions = {}): GyroscopeTiltResult {
  const { maxTilt = 15, sensitivity = 1, disabled = false } = options;

  const [isSupported, setIsSupported] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 });
  const rafRef = useRef<number | null>(null);
  const baseOrientation = useRef<{ beta: number; gamma: number } | null>(null);

  // Check if DeviceOrientationEvent is supported
  useEffect(() => {
    const supported = typeof window !== "undefined" && "DeviceOrientationEvent" in window;
    setIsSupported(supported);

    // Check if permission is already granted (non-iOS or already permitted)
    if (supported) {
      const DeviceOrientationEventTyped = DeviceOrientationEvent as unknown as DeviceOrientationEventiOS & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };

      // If requestPermission doesn't exist, permission isn't needed (Android/older iOS)
      if (!DeviceOrientationEventTyped.requestPermission) {
        setPermissionGranted(true);
      }
    }
  }, []);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    if (disabled) return;

    const beta = event.beta ?? 0;  // Front-back tilt (-180 to 180)
    const gamma = event.gamma ?? 0; // Left-right tilt (-90 to 90)

    // Set base orientation on first reading
    if (!baseOrientation.current) {
      baseOrientation.current = { beta, gamma };
    }

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      // Calculate relative tilt from base orientation
      const relativeBeta = beta - (baseOrientation.current?.beta ?? 0);
      const relativeGamma = gamma - (baseOrientation.current?.gamma ?? 0);

      // Normalize and clamp values
      const normalizedX = Math.max(-1, Math.min(1, (relativeGamma * sensitivity) / 45));
      const normalizedY = Math.max(-1, Math.min(1, (relativeBeta * sensitivity) / 45));

      const rotateY = normalizedX * maxTilt;
      const rotateX = -normalizedY * maxTilt;

      const glareX = ((normalizedX + 1) / 2) * 100;
      const glareY = ((normalizedY + 1) / 2) * 100;

      setTilt({ rotateX, rotateY, glareX, glareY });
    });
  }, [disabled, maxTilt, sensitivity]);

  // Request permission for iOS 13+
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const DeviceOrientationEventTyped = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
      };

      if (DeviceOrientationEventTyped.requestPermission) {
        const permission = await DeviceOrientationEventTyped.requestPermission();
        const granted = permission === "granted";
        setPermissionGranted(granted);
        if (granted) {
          baseOrientation.current = null; // Reset base on new permission
        }
        return granted;
      }

      // Permission not required
      setPermissionGranted(true);
      return true;
    } catch {
      setPermissionGranted(false);
      return false;
    }
  }, [isSupported]);

  // Listen for orientation changes when permitted and not disabled
  useEffect(() => {
    if (!isSupported || !permissionGranted || disabled) return;

    window.addEventListener("deviceorientation", handleOrientation);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isSupported, permissionGranted, disabled, handleOrientation]);

  return {
    rotateX: tilt.rotateX,
    rotateY: tilt.rotateY,
    glareX: tilt.glareX,
    glareY: tilt.glareY,
    isSupported,
    permissionGranted,
    requestPermission,
  };
}
