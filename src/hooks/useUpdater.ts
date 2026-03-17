import { useState, useEffect, useCallback, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number; // 0-100
  error: string | null;
  install: () => void;
}

export function useUpdater(): UpdateState {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);

  useEffect(() => {
    check()
      .then((update) => {
        if (update) {
          updateRef.current = update;
          setVersion(update.version);
          setAvailable(true);
        }
      })
      .catch((e) => {
        console.warn("[mogy] update check failed:", e);
      });
  }, []);

  const install = useCallback(() => {
    const update = updateRef.current;
    if (!update || downloading) return;

    setDownloading(true);
    setProgress(0);
    setError(null);

    let contentLength = 0;
    let downloaded = 0;

    update
      .downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      })
      .then(() => {
        relaunch();
      })
      .catch((e) => {
        setDownloading(false);
        setError(String(e));
        console.error("[mogy] update install failed:", e);
      });
  }, [downloading]);

  return { available, version, downloading, progress, error, install };
}
