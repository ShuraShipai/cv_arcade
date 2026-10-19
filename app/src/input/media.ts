// getUserMedia wrappers that turn browser errors into plain words with a fix.

export class MediaError extends Error {
  constructor(message: string, readonly device: 'camera' | 'mic') {
    super(message);
  }
}

function explain(err: unknown, device: 'camera' | 'mic'): MediaError {
  const name = (err as DOMException)?.name ?? '';
  const Dev = device === 'camera' ? 'Camera' : 'Microphone';
  const icon = device === 'camera' ? 'camera' : 'microphone';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    return new MediaError(`${Dev} access needs a secure page. Open the arcade from localhost or an https address.`, device);
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new MediaError(`${Dev} blocked. Click the ${icon} icon in the address bar, allow it, then press Start again.`, device);
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return new MediaError(`No ${icon} found. Plug one in, then press Start again.`, device);
  if (name === 'NotReadableError' || name === 'AbortError')
    return new MediaError(`The ${icon} is busy. Close other apps or tabs that use it, then press Start again.`, device);
  return new MediaError(`The ${icon} did not start. Reload the page and press Start again.`, device);
}

export async function requestCamera(): Promise<MediaStream> {
  try {
    return await answer(
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      }),
      'camera',
    );
  } catch (err) {
    throw err instanceof MediaError ? err : explain(err, 'camera');
  }
}

export async function requestMic(): Promise<MediaStream> {
  try {
    return await answer(
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      }),
      'mic',
    );
  } catch (err) {
    throw err instanceof MediaError ? err : explain(err, 'mic');
  }
}

const NO_ANSWER_MS = 12000;

// The permission prompt can stay unanswered forever (hidden by fullscreen, page unfocused),
// so give up with a fix instead of hanging; if the stream arrives late, close it.
function answer(p: Promise<MediaStream>, device: 'camera' | 'mic'): Promise<MediaStream> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      p.then(stopStream).catch(() => undefined);
      const Dev = device === 'camera' ? 'Camera' : 'Microphone';
      reject(new MediaError(`${Dev} never answered. Press Esc — fullscreen may be hiding the permission pop-up — allow it, then press Start again.`, device));
    }, NO_ANSWER_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
