/** An installation guide usable even when WebGPU initialization fails. */
export function setupRecorderGuide(onOpenChange: (open: boolean) => void): void {
  const button = document.getElementById('recorderGuideOpen') as HTMLButtonElement;
  const dialog = document.getElementById('recorderGuide') as HTMLDialogElement;
  const download = document.getElementById('recorderDownload') as HTMLAnchorElement;
  const status = document.getElementById('recorderDownloadStatus') as HTMLElement;
  // Register before replay keyboard handlers: keep normal dialog Tab/Escape defaults,
  // but prevent P/V/WASD from reaching replay or camera controls. Key-up still clears held keys.
  window.addEventListener(
    'keydown',
    (event) => {
      if (dialog.open) event.stopImmediatePropagation();
    },
    true,
  );
  button.onclick = (): void => {
    dialog.showModal();
    onOpenChange(true);
  };
  dialog.addEventListener('close', () => {
    onOpenChange(false);
    button.focus({ preventScroll: true });
  });
  const manifestUrl = new URL('downloads/recorder-package.json', location.href);
  void fetch(manifestUrl, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Recorder package unavailable');
      const manifest: unknown = await response.json();
      if (
        !manifest ||
        typeof manifest !== 'object' ||
        !('sha256' in manifest) ||
        typeof manifest.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256)
      ) {
        throw new Error('Invalid recorder package manifest');
      }
      download.href = new URL(`GTASA-FlightRecorder-v13.zip?v=${manifest.sha256}`, manifestUrl).href;
      download.hidden = false;
      status.textContent = 'v13 · 仅录制飞行数据，包含录制器和安装说明';
    })
    .catch(() => {
      status.textContent = '此站点暂未提供安装包，请联系站点维护者获取 FlightRecorder.asi。';
    });
}
