export type MediaPreferences = {
  audioEnabled: boolean;
  videoEnabled: boolean;
};

const STORAGE_KEY = "mentor-platform-media-preferences";

export const defaultMediaPreferences: MediaPreferences = {
  audioEnabled: true,
  videoEnabled: true,
};

export function readMediaPreferences(): MediaPreferences {
  if (typeof window === "undefined") {
    return defaultMediaPreferences;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return defaultMediaPreferences;
    }

    const parsedValue = JSON.parse(rawValue);
    return {
      audioEnabled: parsedValue?.audioEnabled !== false,
      videoEnabled: parsedValue?.videoEnabled !== false,
    };
  } catch {
    return defaultMediaPreferences;
  }
}

export function writeMediaPreferences(nextValue: MediaPreferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextValue));
}
