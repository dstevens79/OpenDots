export function localMicrophoneUnavailableReason(): string | undefined {
  if (!globalThis.isSecureContext)
    return 'Browser microphone access requires HTTPS or localhost. The browser is not treating this page as secure; open it through HTTPS with a trusted certificate.';
  if (!navigator.mediaDevices?.getUserMedia)
    return 'This browser does not support microphone recording.';
  if (typeof MediaRecorder === 'undefined')
    return 'This browser cannot record audio for local dictation.';
  return undefined;
}
